import { describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import type { RuntimeConfig } from '../../config/runtime-config.js'
import { createDatabase } from '../../db/schema.js'
import { createProductionAuthentication } from './production-authentication.js'

describe('production authentication allowlist', () => {
  it('returns 403 for an unlisted OAuth identity without persisting a user or session', async () => {
    const database = createDatabase(':memory:')
    const runtime: RuntimeConfig = {
      dataDirectory: '.',
      feishu: { appId: 'cli_test', appSecret: 'secret' },
      sessionSecret: 'state repository test secret which is at least 32 bytes',
      auditRetentionDays: 80,
      allowedOpenIds: new Set(['ou_owner']),
      allowedAppOrigins: new Set(['https://board.example.test']),
    }
    const authentication = createProductionAuthentication(runtime, database)
    const app = await buildApp({
      database,
      authentication: {
        ...authentication,
        oauth: {
          createAuthorizationUrl: ({ state }) => new URL(`https://accounts.example.test/authorize?state=${state}`),
          async exchangeCode() { return { openId: 'ou_unknown', name: '陌生用户' } },
        },
      },
    })

    try {
      const evilStart = await app.inject({
        method: 'GET',
        url: '/auth/feishu/start?origin=https%3A%2F%2Fevil.example.test',
      })
      expect(evilStart.statusCode).toBe(400)
      expect(evilStart.json()).toEqual({ code: 'INVALID_APP_ORIGIN' })
      expect(evilStart.headers.location).toBeUndefined()
      expect(database.prepare('SELECT COUNT(*) AS count FROM oauth_states').get()).toEqual({ count: 0 })

      const start = await app.inject({
        method: 'GET',
        url: '/auth/feishu/start?origin=https%3A%2F%2Fboard.example.test',
      })
      const state = new URL(start.headers.location!).searchParams.get('state')!
      const wrongHostCallback = await app.inject({
        method: 'GET',
        url: `/auth/feishu/callback?state=${state}&code=code`,
        headers: { 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'https' },
      })
      expect(wrongHostCallback.statusCode).toBe(400)
      expect(wrongHostCallback.json()).toEqual({ code: 'INVALID_APP_ORIGIN' })

      const secondStart = await app.inject({
        method: 'GET',
        url: '/auth/feishu/start?origin=https%3A%2F%2Fboard.example.test',
      })
      const secondState = new URL(secondStart.headers.location!).searchParams.get('state')!
      const callback = await app.inject({
        method: 'GET',
        url: `/auth/feishu/callback?state=${secondState}&code=code`,
        headers: { 'x-forwarded-host': 'board.example.test', 'x-forwarded-proto': 'https' },
      })

      expect(callback.statusCode).toBe(403)
      expect(callback.json()).toEqual({ code: 'USER_NOT_ALLOWED' })
      expect(database.prepare('SELECT COUNT(*) AS count FROM app_users').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM app_sessions').get()).toEqual({ count: 0 })
    } finally {
      await app.close()
      await authentication.close()
      database.close()
    }
  })
})
