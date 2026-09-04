import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../apps/local-api/src/app.js'
import type { AllowedUser, AllowedUserDirectory } from '../../apps/local-api/src/modules/auth/allowed-user-directory.js'
import { OAuthStateRepository } from '../../apps/local-api/src/modules/auth/oauth-state-repository.js'
import { SessionRepository } from '../../apps/local-api/src/modules/auth/session-repository.js'
import { UserDirectoryCache } from '../../apps/local-api/src/modules/auth/user-directory-cache.js'
import { createDatabase, type LocalDatabase } from '../../apps/local-api/src/db/schema.js'
import type { TradingSource } from '../../apps/local-api/src/modules/trading/trading-source.js'

export interface TestAppOptions {
  users?: AllowedUser[]
  oauthIdentity?: { openId: string }
  tradingSource?: TradingSource
  enableTradingBridge?: boolean
  enableRealtime?: boolean
  environment?: Record<string, string | undefined>
  assetDirectory?: string
  automationProjectTag?: string
}

export interface TestApp {
  app: FastifyInstance
  database: LocalDatabase
  sessionCookie(user?: AllowedUser): string
  close(): Promise<void>
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const users = new Map((options.users ?? [{ openId: 'test-user', name: 'Test User' }]).map((user) => [user.openId, user]))
  const directory: AllowedUserDirectory = {
    async findByOpenId(openId) { return users.get(openId) },
    async checkHealth() { return 'ok' },
    async close() {},
  }
  const database = createDatabase(':memory:')
  const sessions = new SessionRepository(database)
  const enableTradingBridge = options.enableTradingBridge
    ?? (options.environment?.TRADING_BRIDGE_ENABLED === undefined ? Boolean(options.tradingSource) : undefined)
  const app = await buildApp({
    database,
    ...(options.assetDirectory ? { assetDirectory: options.assetDirectory } : {}),
    authentication: {
      oauth: {
        createAuthorizationUrl: ({ state }) => new URL(`https://accounts.example.test/authorize?state=${encodeURIComponent(state)}`),
        async exchangeCode() { return options.oauthIdentity ?? { openId: 'test-user' } },
      },
      states: new OAuthStateRepository(database, undefined, 'test-only OAuth state secret with at least 32 bytes'),
      sessions,
      users: new UserDirectoryCache(directory),
    },
    ...(enableTradingBridge === undefined ? {} : { enableTradingBridge }),
    ...(options.enableRealtime === undefined ? {} : { enableRealtime: options.enableRealtime }),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.tradingSource ? { tradingSource: options.tradingSource } : {}),
    ...(options.automationProjectTag ? { automationProjectTag: options.automationProjectTag } : {}),
  })
  return {
    app,
    database,
    sessionCookie(user = users.get('test-user') ?? { openId: 'test-user', name: 'Test User' }) {
      return `infinite_board_session=${sessions.create(user)}`
    },
    async close() {
      await app.close()
      database.close()
    },
  }
}
