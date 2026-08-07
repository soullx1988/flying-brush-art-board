import { createHash, randomBytes } from 'node:crypto'
export interface FeishuLoginIdentity {
  openId: string
  unionId?: string
  userId?: string
  name?: string
  enName?: string
  avatarUrl?: string
  tenantKey?: string
}
export interface FeishuOAuthProvider { createAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): URL; exchangeCode(input: { code: string; codeVerifier?: string; redirectUri: string }): Promise<FeishuLoginIdentity> }
export const createOpaqueToken = () => randomBytes(32).toString('base64url')
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url')

type Exchange = (input: { code: string; codeVerifier?: string; redirectUri: string }) => Promise<FeishuLoginIdentity>
type Fetcher = typeof fetch

export class FeishuLoginOAuthError extends Error {
  constructor(readonly code: 'FEISHU_OAUTH_CLIENT_INVALID' | 'FEISHU_OAUTH_CODE_INVALID_OR_EXPIRED' | 'FEISHU_OAUTH_PKCE_VERIFIER_INVALID' | 'FEISHU_OAUTH_REDIRECT_URI_MISMATCH' | 'FEISHU_OAUTH_APP_NOT_AUTHORIZED' | 'FEISHU_TOKEN_EXCHANGE_FAILED' | 'FEISHU_TOKEN_RESPONSE_INVALID' | 'FEISHU_USER_INFO_FAILED' | 'FEISHU_USER_INFO_INVALID') {
    super(code)
    this.name = 'FeishuLoginOAuthError'
  }
}

function tokenExchangeError(payload: unknown): FeishuLoginOAuthError {
  const record = typeof payload === 'object' && payload !== null
    ? payload as { error?: unknown; error_description?: unknown; code?: unknown; msg?: unknown }
    : undefined
  const error = typeof record?.error === 'string' ? record.error : undefined
  const description = [record?.error_description, record?.msg]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  if (error === 'invalid_client' || record?.code === 20001) return new FeishuLoginOAuthError('FEISHU_OAUTH_CLIENT_INVALID')
  if (error === 'invalid_grant') {
    if (/code.?verifier|code.?challenge|pkce/.test(description)) return new FeishuLoginOAuthError('FEISHU_OAUTH_PKCE_VERIFIER_INVALID')
    if (/redirect.?uri/.test(description)) return new FeishuLoginOAuthError('FEISHU_OAUTH_REDIRECT_URI_MISMATCH')
    return new FeishuLoginOAuthError('FEISHU_OAUTH_CODE_INVALID_OR_EXPIRED')
  }
  if (error === 'unauthorized_client') return new FeishuLoginOAuthError('FEISHU_OAUTH_APP_NOT_AUTHORIZED')
  return new FeishuLoginOAuthError('FEISHU_TOKEN_EXCHANGE_FAILED')
}

export class FeishuOAuthHttpProvider implements FeishuOAuthProvider {
  constructor(
    private readonly appId: string,
    private readonly exchange?: Exchange,
    private readonly appSecret?: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  createAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): URL {
    const url = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    url.search = new URLSearchParams({
      app_id: this.appId,
      response_type: 'code',
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: 'auth:user.id:read',
      ...(input.codeChallenge ? {
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
      } : {}),
    }).toString()
    return url
  }

  async exchangeCode(input: { code: string; codeVerifier?: string; redirectUri: string }): Promise<FeishuLoginIdentity> {
    if (this.exchange) return this.exchange(input)
    if (!this.appSecret) throw new Error('Feishu OAuth app secret is required')
    const tokenResponse = await this.fetcher('https://accounts.feishu.cn/oauth/v3/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.appId,
        client_secret: this.appSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      }),
    })
    const tokenBody = await tokenResponse.json().catch(() => undefined) as { access_token?: unknown; data?: { access_token?: unknown } } | undefined
    if (!tokenResponse.ok) throw tokenExchangeError(tokenBody)
    const accessToken = typeof tokenBody?.access_token === 'string' ? tokenBody.access_token : tokenBody?.data?.access_token
    if (typeof accessToken !== 'string' || !accessToken) throw new FeishuLoginOAuthError('FEISHU_TOKEN_RESPONSE_INVALID')
    const identityResponse = await this.fetcher('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!identityResponse.ok) throw new FeishuLoginOAuthError('FEISHU_USER_INFO_FAILED')
    const identityBody = await identityResponse.json() as Record<string, unknown> & { data?: Record<string, unknown> }
    const identityData = identityBody.data ?? identityBody
    const stringField = (name: string) => typeof identityData[name] === 'string' && identityData[name] ? identityData[name] as string : undefined
    const openId = stringField('open_id')
    if (typeof openId !== 'string' || !openId) throw new FeishuLoginOAuthError('FEISHU_USER_INFO_INVALID')
    const unionId = stringField('union_id')
    const userId = stringField('user_id')
    const name = stringField('name')
    const enName = stringField('en_name')
    const avatarUrl = stringField('avatar_url')
    const tenantKey = stringField('tenant_key')
    return {
      openId,
      ...(unionId ? { unionId } : {}),
      ...(userId ? { userId } : {}),
      ...(name ? { name } : {}),
      ...(enName ? { enName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(tenantKey ? { tenantKey } : {}),
    }
  }
}
