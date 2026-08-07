import type { FeishuCredentials } from './credential-store.js'
import type { FeishuOAuthProvider } from './oauth-service.js'

export interface FeishuRealOAuthProviderOptions {
  clientId: string
  clientSecret: string
  scopes?: readonly string[]
  fetch?: typeof globalThis.fetch
}

const authorizationEndpoint = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'
const tokenEndpoint = 'https://accounts.feishu.cn/oauth/v3/token'
const defaultScopes = [
  'board:whiteboard:node:read',
  'docx:document:readonly',
  'wiki:node:retrieve',
  'docs:document.media:download',
  'offline_access',
]

export class FeishuOAuthTokenExchangeError extends Error {
  constructor(readonly code: 'FEISHU_OAUTH_CLIENT_INVALID' | 'FEISHU_OAUTH_SCOPE_NOT_APPROVED' | 'FEISHU_OAUTH_CODE_INVALID_OR_EXPIRED' | 'FEISHU_OAUTH_PKCE_VERIFIER_INVALID' | 'FEISHU_OAUTH_REDIRECT_URI_MISMATCH' | 'FEISHU_OAUTH_APP_NOT_AUTHORIZED' | 'FEISHU_TOKEN_EXCHANGE_FAILED' | 'FEISHU_TOKEN_RESPONSE_INVALID') {
    super(code)
    this.name = 'FeishuOAuthTokenExchangeError'
  }
}

function tokenExchangeError(payload: unknown): FeishuOAuthTokenExchangeError {
  const record = typeof payload === 'object' && payload !== null ? payload as { error?: unknown; error_description?: unknown } : undefined
  const error = typeof record?.error === 'string' ? record.error : undefined
  const description = typeof record?.error_description === 'string' ? record.error_description.toLowerCase() : ''
  switch (error) {
    case 'invalid_client': return new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_CLIENT_INVALID')
    case 'invalid_scope': return new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_SCOPE_NOT_APPROVED')
    case 'invalid_grant':
      if (/code.?verifier|code.?challenge|pkce/.test(description)) return new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_PKCE_VERIFIER_INVALID')
      if (/redirect.?uri/.test(description)) return new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_REDIRECT_URI_MISMATCH')
      return new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_CODE_INVALID_OR_EXPIRED')
    case 'unauthorized_client': return new FeishuOAuthTokenExchangeError('FEISHU_OAUTH_APP_NOT_AUTHORIZED')
    default: return new FeishuOAuthTokenExchangeError('FEISHU_TOKEN_EXCHANGE_FAILED')
  }
}

export class FeishuRealOAuthProvider implements FeishuOAuthProvider {
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: FeishuRealOAuthProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  createAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): string {
    const url = new URL(authorizationEndpoint)
    url.search = new URLSearchParams({
      app_id: this.options.clientId,
      response_type: 'code',
      state: input.state,
      redirect_uri: input.redirectUri,
      scope: (this.options.scopes ?? defaultScopes).join(' '),
      ...(input.codeChallenge ? {
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
      } : {}),
    }).toString()
    return url.toString()
  }

  async exchangeAuthorizationCode(code: string, input: { codeVerifier?: string; redirectUri: string }): Promise<FeishuCredentials> {
    return this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: input.redirectUri,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    })
  }

  async refreshToken(refreshToken: string): Promise<FeishuCredentials> {
    return this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  private async requestToken(input: Record<string, string>): Promise<FeishuCredentials> {
    const body = {
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      ...input,
    }
    const response = await this.fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => undefined) as { access_token?: unknown; refresh_token?: unknown; scope?: unknown } | undefined
    if (!response.ok) throw tokenExchangeError(payload)
    if (typeof payload?.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
      throw new FeishuOAuthTokenExchangeError('FEISHU_TOKEN_RESPONSE_INVALID')
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [],
    }
  }
}
