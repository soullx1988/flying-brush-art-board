import { describe, expect, it, vi } from 'vitest'

import { FeishuOAuthTokenExchangeError, FeishuRealOAuthProvider } from './real-oauth-provider.js'

describe('FeishuRealOAuthProvider', () => {
  it('uses the documented confidential-client v3 authorization and token endpoint contract without PKCE', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token', refresh_token: 'refresh-token', scope: 'offline_access board:whiteboard:node:read',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'rotated-access-token', refresh_token: 'rotated-refresh-token', scope: 'offline_access',
      }), { status: 200 }))
    const provider = new FeishuRealOAuthProvider({
      clientId: 'app-id', clientSecret: 'app-secret', fetch: fetchMock,
    })

    const authorization = new URL(provider.createAuthorizationUrl({ state: 'state-value', redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback' }))
    expect(authorization.origin + authorization.pathname).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      app_id: 'app-id', response_type: 'code', state: 'state-value', redirect_uri: 'http://127.0.0.1:8787/auth/feishu/import/callback',
    })
    expect(authorization.searchParams.get('scope')).toBe([
      'board:whiteboard:node:read', 'docx:document:readonly', 'wiki:node:retrieve',
      'docs:document.media:download', 'offline_access',
    ].join(' '))

    expect(authorization.searchParams.has('code_challenge')).toBe(false)
    expect(authorization.searchParams.has('code_challenge_method')).toBe(false)

    await expect(provider.exchangeAuthorizationCode('authorization-code', { redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback' }))
      .resolves.toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' })
    await expect(provider.refreshToken('refresh-token')).resolves.toMatchObject({
      accessToken: 'rotated-access-token', refreshToken: 'rotated-refresh-token',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://accounts.feishu.cn/oauth/v3/token', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: expect.stringContaining('"grant_type":"authorization_code"'),
    }))
    expect(fetchMock.mock.calls[0]?.[1].body).toContain('"client_id":"app-id"')
    expect(fetchMock.mock.calls[0]?.[1].body).toContain('"client_secret":"app-secret"')
    expect(fetchMock.mock.calls[0]?.[1].body).not.toContain('"code_verifier"')
    expect(fetchMock.mock.calls[1]?.[1].body).toContain('"grant_type":"refresh_token"')
    expect(fetchMock.mock.calls[1]?.[1].body).toContain('"refresh_token":"refresh-token"')
  })

  it('preserves RFC 7636 parameters when an explicit public-client flow supplies them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token', refresh_token: 'refresh-token', scope: 'offline_access',
    }), { status: 200 }))
    const provider = new FeishuRealOAuthProvider({ clientId: 'app-id', clientSecret: 'app-secret', fetch: fetchMock })

    const authorization = new URL(provider.createAuthorizationUrl({
      state: 'state-value', codeChallenge: 'challenge-value', redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback',
    }))
    expect(authorization.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')

    await provider.exchangeAuthorizationCode('authorization-code', {
      codeVerifier: 'verifier-value', redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback',
    })
    expect(fetchMock.mock.calls[0]?.[1].body).toContain('"code_verifier":"verifier-value"')
  })

  it('maps safe standard token-exchange failures without surfacing provider payloads', async () => {
    const provider = new FeishuRealOAuthProvider({
      clientId: 'app-id', clientSecret: 'app-secret',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_scope', error_description: 'private detail' }), { status: 400 })),
    })

    await expect(provider.exchangeAuthorizationCode('authorization-code', {
      codeVerifier: 'verifier-value', redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback',
    })).rejects.toEqual(new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_SCOPE_NOT_APPROVED'))
  })

  it('classifies verifier and redirect mismatches without forwarding provider descriptions', async () => {
    const verifierProvider = new FeishuRealOAuthProvider({
      clientId: 'app-id', clientSecret: 'app-secret',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE code verifier did not match' }), { status: 400 })),
    })
    const redirectProvider = new FeishuRealOAuthProvider({
      clientId: 'app-id', clientSecret: 'app-secret',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'redirect_uri does not match' }), { status: 400 })),
    })

    await expect(verifierProvider.exchangeAuthorizationCode('authorization-code', {
      codeVerifier: 'verifier-value', redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback',
    })).rejects.toEqual(new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_PKCE_VERIFIER_INVALID'))
    await expect(redirectProvider.exchangeAuthorizationCode('authorization-code', {
      codeVerifier: 'verifier-value', redirectUri: 'http://127.0.0.1:8787/auth/feishu/import/callback',
    })).rejects.toEqual(new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_REDIRECT_URI_MISMATCH'))
  })
})
