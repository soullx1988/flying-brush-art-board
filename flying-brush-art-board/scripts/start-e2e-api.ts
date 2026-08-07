import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildApp } from '../apps/local-api/src/app.js'
import { createDatabase } from '../apps/local-api/src/db/schema.js'
import { OAuthStateRepository } from '../apps/local-api/src/modules/auth/oauth-state-repository.js'
import { SessionRepository } from '../apps/local-api/src/modules/auth/session-repository.js'
import { UserDirectoryCache } from '../apps/local-api/src/modules/auth/user-directory-cache.js'

const runId = (process.env.E2E_RUN_ID ?? 'isolated').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
const root = mkdtempSync(join(tmpdir(), `infinite-board-e2e-${runId}-`))
const apiPort = Number(process.env.E2E_API_PORT ?? 8787)
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:4173'
const shutdownToken = process.env.E2E_SHUTDOWN_TOKEN?.trim()
const database = createDatabase(join(root, 'database.sqlite'))
const app = await buildApp({
  host: '127.0.0.1', database, dataDirectory: root, assetDirectory: join(root, 'assets'), enableRealtime: true,
  authentication: {
    oauth: {
      createAuthorizationUrl: ({ state, redirectUri }) => {
        const url = new URL(redirectUri)
        url.search = new URLSearchParams({ state, code: 'e2e' }).toString()
        return url
      },
      async exchangeCode() { return { openId: 'e2e-user' } },
    },
    states: new OAuthStateRepository(database, undefined, 'e2e only OAuth state secret with at least 32 bytes'),
    sessions: new SessionRepository(database),
    users: new UserDirectoryCache({
      async findByOpenId(openId) { return openId === 'e2e-user' ? { openId, name: 'E2E User', department: 'Test' } : undefined },
      async checkHealth() { return 'ok' as const }, async close() {},
    }),
  },
})

let closePromise: Promise<void> | undefined
let databaseClosed = false
let rootRemoved = false
const removeRoot = () => {
  if (rootRemoved) return
  rmSync(root, { recursive: true, force: true })
  rootRemoved = true
}
const close = async (exitCode = 0) => {
  closePromise ??= (async () => {
    try {
      await app.close()
    } finally {
      if (!databaseClosed) {
        database.close()
        databaseClosed = true
      }
      removeRoot()
    }
  })()
  await closePromise
  process.exitCode = exitCode
}
const terminate = (exitCode: number) => {
  void close(exitCode).finally(() => process.exit(exitCode))
}

if (shutdownToken) {
  app.post('/__e2e/shutdown', async (request, reply) => {
    if (request.headers['x-e2e-shutdown-token'] !== shutdownToken) {
      return reply.code(404).send({ code: 'NOT_FOUND' })
    }
    const response = reply.send({ ok: true, runId })
    setImmediate(() => void close())
    return response
  })
}

process.once('exit', () => {
  if (!databaseClosed) {
    try {
      database.close()
      databaseClosed = true
    } catch {
      // The graceful close path may already have released the native handle.
    }
  }
  try {
    removeRoot()
  } catch {
    // Exit handlers cannot recover; the next isolated run still has a unique runId.
  }
})
process.once('SIGINT', () => terminate(0))
process.once('SIGTERM', () => terminate(0))
process.once('SIGHUP', () => terminate(0))
if (process.platform === 'win32') process.once('SIGBREAK', () => terminate(0))

await app.listen({ host: '127.0.0.1', port: apiPort })
