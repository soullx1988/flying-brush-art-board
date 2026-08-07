import { describe, expect, it } from 'vitest'
import { FeishuOAuthHttpProvider, createOpaqueToken } from './feishu-oauth-provider.js'
describe('Feishu OAuth provider', () => {
  it('uses state, an explicit code response, and the login identity scope without PKCE for a confidential client', () => { const state = createOpaqueToken(); expect(Buffer.from(state, 'base64url')).toHaveLength(32); const url = new FeishuOAuthHttpProvider('id', async () => ({ openId: 'o' })).createAuthorizationUrl({ state, redirectUri: 'https://board/auth/feishu/callback' }); expect(url.searchParams.get('code_challenge_method')).toBeNull(); expect(url.searchParams.get('code_challenge')).toBeNull(); expect(url.searchParams.get('response_type')).toBe('code'); expect(url.searchParams.get('scope')).toBe('auth:user.id:read') })

  it('keeps the OAuth token inside the exchange and returns only identity', async () => {
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push([input, init])
      if (requests.length === 1) return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 })
      return new Response(JSON.stringify({ data: { open_id: 'ou_123', name: 'Ada' } }), { status: 200 })
    }
    const provider = new FeishuOAuthHttpProvider('app', undefined, 'secret', fetcher)
    await expect(provider.exchangeCode({ code: 'code', redirectUri: 'https://board/auth/feishu/callback' })).resolves.toEqual({ openId: 'ou_123', name: 'Ada' })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.[1]).toMatchObject({ headers: { 'content-type': 'application/json; charset=utf-8' } })
    expect(requests[0]?.[1]?.body).toBe(JSON.stringify({
      grant_type: 'authorization_code',
      client_id: 'app',
      client_secret: 'secret',
      code: 'code',
      redirect_uri: 'https://board/auth/feishu/callback',
    }))
  })
})
