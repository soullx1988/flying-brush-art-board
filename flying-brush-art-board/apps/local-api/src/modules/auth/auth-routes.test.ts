import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import type { AllowedUserDirectory } from './allowed-user-directory.js'
import { OAuthStateRepository } from './oauth-state-repository.js'
import { SessionRepository } from './session-repository.js'
import { UserDirectoryCache } from './user-directory-cache.js'
import type { AuthenticationRouteDependencies } from './auth-routes.js'

const apps: FastifyInstance[] = []
const databases: LocalDatabase[] = []

async function buildAuthenticatedApp(directory: AllowedUserDirectory = {
  async findByOpenId(openId) { return openId === 'allowed' ? { openId, name: 'Ada', department: 'Engineering' } : undefined },
  async checkHealth() { return 'ok' as const },
  async close() {},
}, overrides: Partial<AuthenticationRouteDependencies> = {}): Promise<FastifyInstance> {
  const db = createDatabase(':memory:')
  databases.push(db)
  const app = await buildApp({
    database: db,
    authentication: {
      oauth: {
        createAuthorizationUrl: ({ state }) => new URL(`https://accounts.example.test/authorize?state=${encodeURIComponent(state)}`),
        async exchangeCode() { return { openId: 'allowed' } },
      },
      states: new OAuthStateRepository(db, () => new Date('2026-07-23T00:00:00.000Z'), 'state repository test secret which is at least 32 bytes'),
      sessions: new SessionRepository(db, () => new Date('2026-07-23T00:00:00.000Z')),
      users: new UserDirectoryCache(directory),
      ...overrides,
    },
  })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  databases.splice(0).forEach((db) => db.close())
})

describe('authentication routes', () => {
  it('redirects through OAuth and creates a secure hash-only session', async () => {
    const app = await buildAuthenticatedApp()
    const start = await app.inject({
      method: 'GET',
      url: '/auth/feishu/start?returnTo=%2Fprojects%2Fp1&origin=https%3A%2F%2Fboard.example.test',
    })
    expect(start.statusCode).toBe(302)
    const state = new URL(start.headers.location!).searchParams.get('state')!
    const callback = await app.inject({ method: 'GET', url: `/auth/feishu/callback?state=${encodeURIComponent(state)}&code=code` })
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('/projects/p1')
    const setCookie = callback.headers['set-cookie'] as string
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    const cookie = setCookie.split(';')[0]
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    expect(me.json()).toEqual({ openId: 'allowed', name: 'Ada', department: 'Engineering', realtimeEnabled: false })
    const audits = await app.inject({ method: 'GET', url: '/api/audit?action=auth.login', headers: { cookie } })
    expect(audits.json()).toEqual({ events: [expect.objectContaining({ actorOpenId: 'allowed', action: 'auth.login' })] })
  })

  it('rejects missing sessions, unsafe return locations, and non-allowed identities', async () => {
    const app = await buildAuthenticatedApp()
    expect((await app.inject({ method: 'GET', url: '/api/me' })).json()).toEqual({ code: 'SESSION_EXPIRED' })
    expect((await app.inject({ method: 'GET', url: '/auth/feishu/start?returnTo=https%3A%2F%2Fevil.example' })).json()).toEqual({ code: 'INVALID_RETURN_TO' })
    expect((await app.inject({ method: 'GET', url: '/auth/feishu/start?origin=javascript%3Aalert(1)' })).json()).toEqual({ code: 'INVALID_APP_ORIGIN' })

    const denied = await buildAuthenticatedApp({
      async findByOpenId() { return undefined }, async checkHealth() { return 'ok' as const }, async close() {},
    })
    const start = await denied.inject({ method: 'GET', url: '/auth/feishu/start' })
    const state = new URL(start.headers.location!).searchParams.get('state')!
    const callback = await denied.inject({ method: 'GET', url: `/auth/feishu/callback?state=${state}&code=code` })
    expect(callback.statusCode).toBe(403)
    expect(callback.json()).toEqual({ code: 'USER_NOT_ALLOWED' })
  })

  it('records a first-time Feishu identity and permits an HTTP LAN test cookie', async () => {
    let savedName: string | undefined
    let authorizationRedirectUri: string | undefined
    let exchangeRedirectUri: string | undefined
    const directory: AllowedUserDirectory = {
      async findByOpenId(openId) { return savedName ? { openId, name: savedName } : undefined },
      async checkHealth() { return 'ok' as const },
      async close() {},
    }
    const app = await buildAuthenticatedApp(directory, {
      oauth: {
        createAuthorizationUrl: ({ state, redirectUri }) => {
          authorizationRedirectUri = redirectUri
          return new URL(`https://accounts.example.test/authorize?state=${encodeURIComponent(state)}`)
        },
        async exchangeCode(input) { exchangeRedirectUri = input.redirectUri; return { openId: 'new-user', name: '局域网用户' } },
      },
      async recordLogin(identity) {
        savedName = identity.name ?? identity.openId
        return { openId: identity.openId, name: savedName }
      },
    })
    const start = await app.inject({ method: 'GET', url: '/auth/feishu/start?origin=http%3A%2F%2F192.168.65.48%3A4173' })
    const state = new URL(start.headers.location!).searchParams.get('state')!
    const callback = await app.inject({ method: 'GET', url: `/auth/feishu/callback?state=${state}&code=code` })
    const setCookie = callback.headers['set-cookie'] as string
    expect(callback.statusCode).toBe(302)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).not.toContain('Secure')
    expect(savedName).toBe('局域网用户')
    expect(authorizationRedirectUri).toBe('http://192.168.65.48:4173/auth/feishu/callback')
    expect(exchangeRedirectUri).toBe(authorizationRedirectUri)
  })

  it('logs out by deleting the server session and clearing the cookie', async () => {
    const app = await buildAuthenticatedApp()
    const start = await app.inject({ method: 'GET', url: '/auth/feishu/start' })
    const state = new URL(start.headers.location!).searchParams.get('state')!
    const callback = await app.inject({ method: 'GET', url: `/auth/feishu/callback?state=${state}&code=code` })
    const cookie = (callback.headers['set-cookie'] as string).split(';')[0]
    const secondStart = await app.inject({ method: 'GET', url: '/auth/feishu/start' })
    const secondState = new URL(secondStart.headers.location!).searchParams.get('state')!
    const secondCallback = await app.inject({ method: 'GET', url: `/auth/feishu/callback?state=${secondState}&code=code` })
    const secondCookie = (secondCallback.headers['set-cookie'] as string).split(';')[0]
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(logout.statusCode).toBe(204)
    expect(logout.headers['set-cookie']).toContain('Max-Age=0')
    const audits = await app.inject({ method: 'GET', url: '/api/audit?action=auth.logout', headers: { cookie: secondCookie } })
    expect(audits.json()).toEqual({ events: [expect.objectContaining({ actorOpenId: 'allowed', action: 'auth.logout' })] })
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401)
  })
})
