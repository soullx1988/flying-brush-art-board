import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockFeishuProvider } from '../../../../../packages/test-fixtures/src/feishu/mock-provider.js'
import { EncryptedCredentialStore } from './credential-store.js'
import { createPkceChallenge, createPkceVerifier, FeishuOAuthError, FeishuOAuthService } from './oauth-service.js'

describe('FeishuOAuthService', () => {
  const actorA = { openId: 'user-a', sessionBinding: 'session-a' }
  const actorAOtherSession = { openId: 'user-a', sessionBinding: 'session-a-other' }
  const actorB = { openId: 'user-b', sessionBinding: 'session-b' }
  const callbackUrl = 'http://127.0.0.1:8787/auth/feishu/import/callback'

  it('uses the RFC 7636 43-character Base64URL verifier and S256 challenge', () => {
    const verifier = createPkceVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  const directories: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  function createService(now = 1_700_000_000_000) {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-feishu-oauth-'))
    directories.push(directory)
    const credentials = new EncryptedCredentialStore({ directory })
    return {
      directory,
      credentials,
      service: new FeishuOAuthService({
        provider: createMockFeishuProvider(),
        credentials,
        now: () => now,
      }),
    }
  }

  it('uses a confidential-client loopback authorization request without PKCE and persists approved credentials encrypted', async () => {
    const { directory, service } = createService()
    const first = service.start(actorA, callbackUrl)
    const second = service.start(actorA, callbackUrl)

    expect(first.state).not.toBe(second.state)
    expect(first.authorizationUrl).toMatch(/^mock-feishu:\/\/authorize\?/)
    const authorize = new URL(first.authorizationUrl)
    expect(authorize.searchParams.get('state')).toBe(first.state)
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8787/auth/feishu/import/callback')
    expect(authorize.searchParams.has('code_challenge_method')).toBe(false)
    expect(authorize.searchParams.has('code_challenge')).toBe(false)

    await expect(service.callback({ state: first.state, code: 'mock-authorized-code' }, actorA, callbackUrl)).resolves.toEqual({
      connected: true,
      scopes: expect.arrayContaining(['offline_access']),
    })
    expect(service.status(actorA.openId)).toEqual({ connected: true, scopes: expect.any(Array) })
    const subjectHash = createHash('sha256').update(actorA.openId).digest('hex')
    const persisted = readFileSync(join(directory, `feishu-import-credentials-${subjectHash}.json`), 'utf8')
    expect(persisted).not.toContain('mock-user-access-token')
    expect(persisted).not.toContain('mock-user-refresh-token')
  })

  it('keeps RFC 7636 S256 available only when a future public-client flow explicitly opts in', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-feishu-oauth-'))
    directories.push(directory)
    const service = new FeishuOAuthService({
      provider: createMockFeishuProvider(),
      credentials: new EncryptedCredentialStore({ directory }),
      usePkce: true,
    })

    const request = service.start(actorA, callbackUrl)
    const authorize = new URL(request.authorizationUrl)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects denied, invalid, and expired callback states without exchanging a code', async () => {
    const { service } = createService()
    const request = service.start(actorA, callbackUrl)

    await expect(service.callback({ state: request.state, error: 'access_denied' }, actorA, callbackUrl)).rejects.toMatchObject({
      code: 'FEISHU_AUTHORIZATION_DENIED',
    } satisfies Partial<FeishuOAuthError>)
    await expect(service.callback({ state: 'not-issued', code: 'mock-authorized-code' }, actorA, callbackUrl)).rejects.toMatchObject({
      code: 'FEISHU_OAUTH_STATE_INVALID',
    } satisfies Partial<FeishuOAuthError>)
    let now = 1_700_000_000_000
    const expiredDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-feishu-oauth-'))
    directories.push(expiredDirectory)
    const expired = new FeishuOAuthService({
      provider: createMockFeishuProvider(),
      credentials: new EncryptedCredentialStore({ directory: expiredDirectory }),
      now: () => now,
      stateTtlMs: 1,
    })
    const expiredRequest = expired.start(actorA, callbackUrl)
    now += 2
    await expect(expired.callback({ state: expiredRequest.state, code: 'mock-authorized-code' }, actorA, callbackUrl)).rejects.toMatchObject({
      code: 'FEISHU_OAUTH_STATE_EXPIRED',
    } satisfies Partial<FeishuOAuthError>)
  })

  it('rotates refresh credentials atomically and revokes only the requested account', async () => {
    const { service } = createService()
    const requestA = service.start(actorA, callbackUrl)
    const requestB = service.start(actorB, callbackUrl)
    await service.callback({ state: requestA.state, code: 'mock-authorized-code' }, actorA, callbackUrl)
    await service.callback({ state: requestB.state, code: 'mock-authorized-code' }, actorB, callbackUrl)

    await expect(service.refresh(actorA.openId)).resolves.toEqual({ connected: true, refreshed: true })
    expect(service.status(actorA.openId)).toEqual({ connected: true, scopes: expect.any(Array) })
    expect(service.status(actorB.openId)).toEqual({ connected: true, scopes: expect.any(Array) })
    expect(service.revoke(actorA.openId)).toEqual({ connected: false })
    expect(service.status(actorA.openId)).toEqual({ connected: false })
    expect(service.status(actorB.openId)).toEqual({ connected: true, scopes: expect.any(Array) })
  })

  it('binds pending state to both openId and the initiating session without consuming it for another actor', async () => {
    const { service, credentials } = createService()
    const state = service.start(actorA, callbackUrl)
    const replace = vi.spyOn(credentials, 'replace')

    await expect(service.callback({ state: state.state, code: 'mock-authorized-code' }, actorB, callbackUrl)).rejects.toMatchObject({
      code: 'FEISHU_OAUTH_STATE_INVALID',
    } satisfies Partial<FeishuOAuthError>)
    await expect(service.callback({ state: state.state, code: 'mock-authorized-code' }, actorAOtherSession, callbackUrl)).rejects.toMatchObject({
      code: 'FEISHU_OAUTH_STATE_INVALID',
    } satisfies Partial<FeishuOAuthError>)
    await expect(service.callback(
      { state: state.state, code: 'mock-authorized-code' },
      actorA,
      'http://localhost:4173/auth/feishu/import/callback',
    )).rejects.toMatchObject({ code: 'FEISHU_OAUTH_STATE_INVALID' })
    expect(replace).not.toHaveBeenCalled()
    expect(service.status(actorA.openId)).toEqual({ connected: false })
    expect(service.status(actorB.openId)).toEqual({ connected: false })

    await expect(service.callback({ state: state.state, code: 'mock-authorized-code' }, actorA, callbackUrl)).resolves.toMatchObject({ connected: true })
    expect(replace).toHaveBeenCalledOnce()
    expect(service.status(actorA.openId)).toMatchObject({ connected: true })
    expect(service.status(actorB.openId)).toEqual({ connected: false })
  })

  it('redacts credentials from OAuth errors and logs', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-feishu-oauth-'))
    directories.push(directory)
    const service = new FeishuOAuthService({
      provider: createMockFeishuProvider(),
      credentials: new EncryptedCredentialStore({ directory }),
      logger,
    })
    const request = service.start(actorA, callbackUrl)
    await service.callback({ state: request.state, code: 'mock-authorized-code' }, actorA, callbackUrl)
    await service.callback({ state: 'not-a-real-state', code: 'mock-user-access-token' }, actorA, callbackUrl).catch(() => undefined)

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ])
    expect(logged).not.toContain('mock-user-access-token')
    expect(logged).not.toContain('mock-user-refresh-token')
  })

  it('clears credentials and requires reauthorization when durable refresh rotation fails', async () => {
    const { service } = createService()
    const request = service.start(actorA, callbackUrl)
    await service.callback({ state: request.state, code: 'mock-authorized-code' }, actorA, callbackUrl)
    const credentials = (service as any).options.credentials as EncryptedCredentialStore
    const clear = vi.spyOn(credentials, 'clear')
    vi.spyOn(credentials, 'replace').mockImplementation(() => { throw new Error('disk full') })

    await expect(service.refresh(actorA.openId)).rejects.toMatchObject({
      code: 'FEISHU_REAUTHORIZATION_REQUIRED', statusCode: 503,
    } satisfies Partial<FeishuOAuthError>)
    expect(clear).toHaveBeenCalledOnce()
    expect(service.status(actorA.openId)).toEqual({ connected: false })
  })

  it('serializes concurrent refreshes for the local account', async () => {
    const { service } = createService()
    const request = service.start(actorA, callbackUrl)
    await service.callback({ state: request.state, code: 'mock-authorized-code' }, actorA, callbackUrl)
    const provider = (service as any).options.provider
    const refresh = vi.spyOn(provider, 'refreshToken')

    await Promise.all([service.refresh(actorA.openId), service.refresh(actorA.openId)])
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not let an in-flight refresh recreate credentials after revoke', async () => {
    const { service } = createService()
    const request = service.start(actorA, callbackUrl)
    await service.callback({ state: request.state, code: 'mock-authorized-code' }, actorA, callbackUrl)
    const provider = (service as any).options.provider
    let completeRefresh!: (credentials: { accessToken: string; refreshToken: string; scopes: string[] }) => void
    vi.spyOn(provider, 'refreshToken').mockImplementation(() => new Promise((resolve) => { completeRefresh = resolve }))

    const refreshing = service.refresh(actorA.openId)
    await vi.waitFor(() => expect(completeRefresh).toBeTypeOf('function'))
    service.revoke(actorA.openId)
    completeRefresh({ accessToken: 'late-access', refreshToken: 'late-refresh', scopes: ['offline_access'] })

    await expect(refreshing).rejects.toMatchObject({ code: 'FEISHU_REFRESH_SUPERSEDED' })
    expect(service.status(actorA.openId)).toEqual({ connected: false })
  })

  it('returns a redacted persistence failure when initial credential storage fails', async () => {
    const { service } = createService()
    const request = service.start(actorA, callbackUrl)
    const credentials = (service as any).options.credentials as EncryptedCredentialStore
    vi.spyOn(credentials, 'replace').mockImplementation(() => { throw new Error('disk full: mock-user-access-token') })

    await expect(service.callback({ state: request.state, code: 'mock-authorized-code' }, actorA, callbackUrl)).rejects.toMatchObject({
      code: 'FEISHU_CREDENTIAL_PERSISTENCE_FAILED', statusCode: 500,
    } satisfies Partial<FeishuOAuthError>)
  })
})
