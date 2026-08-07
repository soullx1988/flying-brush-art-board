import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { buildApp } from './app.js'
import { loadRuntimeConfig } from './config/runtime-config.js'
import { createDatabase } from './db/schema.js'
import { createProductionAuthentication } from './modules/auth/production-authentication.js'
import { loadAuthGate } from './modules/auth/auth-gate.js'
import { resolveFeishuOAuthConfig } from './server-config.js'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
const authGate = loadAuthGate(process.env)
const feishuOAuth = resolveFeishuOAuthConfig()
const app = authGate.authenticationEnabled
  ? await createAuthenticatedApp()
  : await buildApp({
      host,
      enableRealtime: true,
      environment: process.env,
      ...(feishuOAuth ? { feishuOAuth } : {}),
    })

async function createAuthenticatedApp() {
  const runtime = loadRuntimeConfig(process.env)
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

await app.listen({ host, port })
console.log(`Infinite Board local API listening on http://${host}:${port}`)

const close = async () => {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
