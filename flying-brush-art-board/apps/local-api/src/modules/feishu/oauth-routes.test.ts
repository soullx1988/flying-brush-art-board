import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import type { AllowedUser, AllowedUserDirectory } from '../auth/allowed-user-directory.js'
import { registerAuthenticationPlugin, SESSION_COOKIE_NAME } from '../auth/auth-plugin.js'
import { SessionRepository } from '../auth/session-repository.js'
import { UserDirectoryCache } from '../auth/user-directory-cache.js'
import { EncryptedCredentialStore } from './credential-store.js'
import { registerFeishuOAuthRoutes } from './oauth-routes.js'
import { FeishuOAuthService, type FeishuOAuthProvider } from './oauth-service.js'

const userA = { openId: 'user-a', name: 'User A' }
const userB = { openId: 'user-b', name: 'User B' }

describe('Feishu import OAuth routes', () => {
  const directories: string[] = []
  const databases: LocalDatabase[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const database of databases.splice(0)) database.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  async function fixture(allowedOrigins?: ReadonlySet<string>) {
    const directory = mkdtempSync(join(tmpdir(), 'feishu-oauth-routes-'))
    directories.push(directory)
    const database = createDatabase(':memory:')
    databases.push(database)
    const sessions = new SessionRepository(database)
    const users = new Map<string, AllowedUser>([[userA.openId, userA], [userB.openId, userB]])
    const directoryClient: AllowedUserDirectory = {
      async findByOpenId(openId) { return users.get(openId) },
      async checkHealth() { return 'ok' },
      async close() {},
    }
    const exchangedRedirectUris: string[] = []
    const provider: FeishuOAuthProvider = {
      createAuthorizationUrl: ({ state, redirectUri }) => `https://accounts.example.test/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri })}`,
      async exchangeAuthorizationCode(code, input) {
        exchangedRedirectUris.push(input.redirectUri)
        return { accessToken: `access:${code}`, refreshToken: `refresh:${code}`, scopes: [`scope:${code}`] }
      },
      async refreshToken(refreshToken) {
        return { accessToken: `${refreshToken}:rotated-access`, refreshToken: `${refreshToken}:rotated`, scopes: ['scope:rotated'] }
      },
    }
    const credentials = new EncryptedCredentialStore({ directory })
    const app = Fastify({ logger: false })
    await app.register(cookie)
    registerAuthenticationPlugin(app, { sessions, users: new UserDirectoryCache(directoryClient) })
    registerFeishuOAuthRoutes(app, new FeishuOAuthService({ provider, credentials }), {
      configured: true,
      ...(allowedOrigins ? { allowedOrigins } : {}),
    })
    const cookieFor = (user: AllowedUser) => `${SESSION_COOKIE_NAME}=${sessions.create(user)}`
    return {
      app,
      credentials,
      exchangedRedirectUris,
      cookieA: cookieFor(userA),
      cookieAOtherSession: cookieFor(userA),
      cookieB: cookieFor(userB),
    }
  }

  const stateFrom = (location: string | undefined) => new URL(location!).searchParams.get('state')!

  it('rejects anonymous start and callback before issuing or consuming state', async () => {
    const { app } = await fixture()

    expect(await app.inject({ method: 'GET', url: '/auth/feishu/import/start' })).toMatchObject({ statusCode: 401 })
    expect(await app.inject({ method: 'GET', url: '/auth/feishu/import/callback?state=unknown&code=code' })).toMatchObject({ statusCode: 401 })
    await app.close()
  })

  it('binds callback state to user and session and isolates status, refresh, and revoke for A/B', async () => {
    const { app, credentials, cookieA, cookieAOtherSession, cookieB } = await fixture()
    const startA = await app.inject({ method: 'GET', url: '/auth/feishu/import/start', headers: { cookie: cookieA } })
    const stateA = stateFrom(startA.headers.location)

    const wrongUser = await app.inject({ method: 'GET', url: `/auth/feishu/import/callback?state=${stateA}&code=code-b`, headers: { cookie: cookieB } })
    expect(wrongUser.statusCode).toBe(400)
    expect(wrongUser.json()).toEqual({ code: 'FEISHU_OAUTH_STATE_INVALID' })
    const wrongSession = await app.inject({ method: 'GET', url: `/auth/feishu/import/callback?state=${stateA}&code=code-a-other`, headers: { cookie: cookieAOtherSession } })
    expect(wrongSession.statusCode).toBe(400)
    expect(credentials.read(userA.openId)).toBeUndefined()
    expect(credentials.read(userB.openId)).toBeUndefined()

    expect(await app.inject({ method: 'GET', url: `/auth/feishu/import/callback?state=${stateA}&code=code-a`, headers: { cookie: cookieA } })).toMatchObject({ statusCode: 200 })
    expect((await app.inject({ method: 'GET', url: '/api/integrations/feishu/status', headers: { cookie: cookieA } })).json()).toEqual({ connected: true, scopes: ['scope:code-a'] })
    expect((await app.inject({ method: 'GET', url: '/api/integrations/feishu/status', headers: { cookie: cookieB } })).json()).toEqual({ connected: false })

    const startB = await app.inject({ method: 'GET', url: '/auth/feishu/import/start', headers: { cookie: cookieB } })
    const stateB = stateFrom(startB.headers.location)
    expect(await app.inject({ method: 'GET', url: `/auth/feishu/import/callback?state=${stateB}&code=code-b`, headers: { cookie: cookieB } })).toMatchObject({ statusCode: 200 })
    const aBeforeBRefresh = credentials.read(userA.openId)
    expect(await app.inject({ method: 'POST', url: '/api/integrations/feishu/refresh', headers: { cookie: cookieB } })).toMatchObject({ statusCode: 200 })
    expect(credentials.read(userA.openId)).toEqual(aBeforeBRefresh)
    expect(credentials.read(userB.openId)?.accessToken).toBe('refresh:code-b:rotated-access')

    expect(await app.inject({ method: 'DELETE', url: '/api/integrations/feishu/account', headers: { cookie: cookieA } })).toMatchObject({ statusCode: 204 })
    expect((await app.inject({ method: 'GET', url: '/api/integrations/feishu/status', headers: { cookie: cookieA } })).json()).toEqual({ connected: false })
    expect((await app.inject({ method: 'GET', url: '/api/integrations/feishu/status', headers: { cookie: cookieB } })).json()).toEqual({ connected: true, scopes: ['scope:rotated'] })
    await app.close()
  }, 15_000)

  it('binds import OAuth to the exact trusted HTTPS origin behind a reverse proxy', async () => {
    const externalOrigin = 'https://board.example.test'
    const { app, cookieA, exchangedRedirectUris } = await fixture(new Set([externalOrigin]))
    const proxyHeaders = {
      cookie: cookieA,
      host: '127.0.0.1:8787',
      'x-forwarded-host': 'board.example.test',
      'x-forwarded-proto': 'https',
    }

    const start = await app.inject({ method: 'GET', url: '/auth/feishu/import/start', headers: proxyHeaders })
    expect(start.statusCode).toBe(302)
    const authorization = new URL(start.headers.location!)
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${externalOrigin}/auth/feishu/import/callback`)
    const state = authorization.searchParams.get('state')!

    const wrongOrigin = await app.inject({
      method: 'GET',
      url: '/auth/feishu/import/start',
      headers: { ...proxyHeaders, 'x-forwarded-host': 'evil.example.test' },
    })
    expect(wrongOrigin.statusCode).toBe(400)
    expect(wrongOrigin.json()).toEqual({ code: 'INVALID_APP_ORIGIN' })

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/feishu/import/callback?state=${state}&code=code-a`,
      headers: proxyHeaders,
    })
    expect(callback.statusCode).toBe(200)
    expect(exchangedRedirectUris).toEqual([`${externalOrigin}/auth/feishu/import/callback`])
    await app.close()
  })
})
