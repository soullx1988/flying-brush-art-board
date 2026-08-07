import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockFeishuProvider } from '../../../../../packages/test-fixtures/src/feishu/mock-provider.js'
import { EncryptedCredentialStore } from './credential-store.js'
import { createPkceChallenge, createPkceVerifier, FeishuOAuthError, FeishuOAuthService } from './oauth-service.js'

describe('FeishuOAuthService', () => {
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
    return {
      directory,
      service: new FeishuOAuthService({
        provider: createMockFeishuProvider(),
        credentials: new EncryptedCredentialStore({ directory }),
        now: () => now,
      }),
    }
  }

  it('uses a confidential-client loopback authorization request without PKCE and persists approved credentials encrypted', async () => {
    const { directory, service } = createService()
    const first = service.start()
    const second = service.start()

    expect(first.state).not.toBe(second.state)
    expect(first.authorizationUrl).toMatch(/^mock-feishu:\/\/authorize\?/)
    const authorize = new URL(first.authorizationUrl)
    expect(authorize.searchParams.get('state')).toBe(first.state)
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8787/auth/feishu/import/callback')
    expect(authorize.searchParams.has('code_challenge_method')).toBe(false)
    expect(authorize.searchParams.has('code_challenge')).toBe(false)

    await expect(service.callback({ state: first.state, code: 'mock-authorized-code' })).resolves.toEqual({
      connected: true,
      scopes: expect.arrayContaining(['offline_access']),
    })
    expect(service.status()).toEqual({ connected: true, scopes: expect.any(Array) })
    const persisted = readFileSync(join(directory, 'feishu-import-credentials.json'), 'utf8')
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

    const request = service.start()
    const authorize = new URL(request.authorizationUrl)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects denied, invalid, and expired callback states without exchanging a code', async () => {
    const { service } = createService()
    const request = service.start()

    await expect(service.callback({ state: request.state, error: 'access_denied' })).rejects.toMatchObject({
      code: 'FEISHU_AUTHORIZATION_DENIED',
    } satisfies Partial<FeishuOAuthError>)
    await expect(service.callback({ state: 'not-issued', code: 'mock-authorized-code' })).rejects.toMatchObject({
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
    const expiredRequest = expired.start()
    now += 2
    await expect(expired.callback({ state: expiredRequest.state, code: 'mock-authorized-code' })).rejects.toMatchObject({
      code: 'FEISHU_OAUTH_STATE_EXPIRED',
    } satisfies Partial<FeishuOAuthError>)
  })

  it('rotates refresh credentials atomically and revokes the local account', async () => {
    const { service } = createService()
    const request = service.start()
    await service.callback({ state: request.state, code: 'mock-authorized-code' })

    await expect(service.refresh()).resolves.toEqual({ connected: true, refreshed: true })
    expect(service.status()).toEqual({ connected: true, scopes: expect.any(Array) })
    expect(service.revoke()).toEqual({ connected: false })
    expect(service.status()).toEqual({ connected: false })
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
    const request = service.start()
    await service.callback({ state: request.state, code: 'mock-authorized-code' })
    await service.callback({ state: 'not-a-real-state', code: 'mock-user-access-token' }).catch(() => undefined)

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ])
    expect(logged).not.toContain('mock-user-access-token')
    expect(logged).not.toContain('mock-user-refresh-token')
  })

  it('clears credentials and requires reauthorization when durable refresh rotation fails', async () => {
    const { service } = createService()
    const request = service.start()
    await service.callback({ state: request.state, code: 'mock-authorized-code' })
    const credentials = (service as any).options.credentials as EncryptedCredentialStore
    const clear = vi.spyOn(credentials, 'clear')
    vi.spyOn(credentials, 'replace').mockImplementation(() => { throw new Error('disk full') })

    await expect(service.refresh()).rejects.toMatchObject({
      code: 'FEISHU_REAUTHORIZATION_REQUIRED', statusCode: 503,
    } satisfies Partial<FeishuOAuthError>)
    expect(clear).toHaveBeenCalledOnce()
    expect(service.status()).toEqual({ connected: false })
  })

  it('serializes concurrent refreshes for the local account', async () => {
    const { service } = createService()
    const request = service.start()
    await service.callback({ state: request.state, code: 'mock-authorized-code' })
    const provider = (service as any).options.provider
    const refresh = vi.spyOn(provider, 'refreshToken')

    await Promise.all([service.refresh(), service.refresh()])
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('returns a redacted persistence failure when initial credential storage fails', async () => {
    const { service } = createService()
    const request = service.start()
    const credentials = (service as any).options.credentials as EncryptedCredentialStore
    vi.spyOn(credentials, 'replace').mockImplementation(() => { throw new Error('disk full: mock-user-access-token') })

    await expect(service.callback({ state: request.state, code: 'mock-authorized-code' })).rejects.toMatchObject({
      code: 'FEISHU_CREDENTIAL_PERSISTENCE_FAILED', statusCode: 500,
    } satisfies Partial<FeishuOAuthError>)
  })
})
