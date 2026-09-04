import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { buildApp } from './app.js'
import { loadRuntimeConfig } from './config/runtime-config.js'
import { createDatabase } from './db/schema.js'
import { createProductionAuthentication } from './modules/auth/production-authentication.js'
import { loadAuthGate } from './modules/auth/auth-gate.js'
import { resolveFeishuOAuthConfig } from './server-config.js'
import { resolveAppDataDirectory } from './data-directory.js'
import { acquireDataDirectoryLock } from './data-directory-lock.js'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
const authGate = loadAuthGate(process.env)
const feishuOAuth = resolveFeishuOAuthConfig()
const runtime = authGate.authenticationEnabled ? loadRuntimeConfig(process.env) : undefined
const dataDirectory = runtime?.dataDirectory ?? resolveAppDataDirectory()
mkdirSync(dataDirectory, { recursive: true })
const dataDirectoryLock = acquireDataDirectoryLock(dataDirectory, port)
let app: Awaited<ReturnType<typeof buildApp>>
try {
  app = authGate.authenticationEnabled
    ? await createAuthenticatedApp(runtime!)
    : await buildApp({
        host,
        dataDirectory,
        assetDirectory: join(dataDirectory, 'assets'),
        enableRealtime: true,
        environment: process.env,
        ...(feishuOAuth ? { feishuOAuth } : {}),
      })
} catch (error) {
  dataDirectoryLock.release()
  throw error
}

async function createAuthenticatedApp(runtime: ReturnType<typeof loadRuntimeConfig>) {
  mkdirSync(runtime.dataDirectory, { recursive: true })
  const database = createDatabase(join(runtime.dataDirectory, 'infinite-board.sqlite'))
  const authentication = createProductionAuthentication(runtime, database)
  const authenticatedApp = await buildApp({
    host,
    database,
    dataDirectory: runtime.dataDirectory,
    assetDirectory: join(runtime.dataDirectory, 'assets'),
    auditRetentionDays: runtime.auditRetentionDays,
    authentication,
    enableRealtime: true,
    environment: process.env,
    ...(feishuOAuth ? { feishuOAuth } : {}),
  })
  authenticatedApp.addHook('onClose', async () => {
    await authentication.close()
    database.close()
  })
  return authenticatedApp
}

app.addHook('onClose', async () => dataDirectoryLock.release())

try {
  await app.listen({ host, port })
} catch (error) {
  await app.close().catch(() => undefined)
  dataDirectoryLock.release()
  throw error
}
console.log(`Infinite Board local API listening on http://${host}:${port}`)

const close = async () => {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
