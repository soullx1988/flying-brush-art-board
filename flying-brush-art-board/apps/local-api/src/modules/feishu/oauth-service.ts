import { createHash, randomBytes } from 'node:crypto'

import type { FeishuCredentials } from './credential-store.js'
import { FeishuOAuthTokenExchangeError } from './real-oauth-provider.js'

export interface FeishuOAuthProvider {
  createAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): string
  exchangeAuthorizationCode(code: string, input: { codeVerifier?: string; redirectUri: string }): Promise<FeishuCredentials>
  refreshToken(refreshToken: string): Promise<FeishuCredentials>
}

export interface FeishuCredentialStore {
  read(): FeishuCredentials | undefined
  replace(credentials: FeishuCredentials): void
  clear(): void
}

export interface FeishuOAuthLogger {
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
}

export class FeishuOAuthError extends Error {
  constructor(readonly code: string, readonly statusCode = 400) {
    super(code)
    this.name = 'FeishuOAuthError'
  }
}

interface PendingState {
  verifier?: string
  expiresAt: number
}

export interface FeishuOAuthServiceOptions {
  provider: FeishuOAuthProvider
  credentials: FeishuCredentialStore
  now?: () => number
  stateTtlMs?: number
  /**
   * Developer-created Feishu applications are confidential clients and use
   * `client_secret`; PKCE is therefore opt-in for a future public-client flow.
   */
  usePkce?: boolean
  logger?: FeishuOAuthLogger
}

const CALLBACK_URL = 'http://127.0.0.1:8787/auth/feishu/import/callback'

const noOpLogger: FeishuOAuthLogger = { info() {}, warn() {} }

/** RFC 7636 Base64URL verifier. 32 random bytes yield the interoperable 43-character form. */
export function createPkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export class FeishuOAuthService {
  private readonly pendingStates = new Map<string, PendingState>()
  private readonly now: () => number
  private readonly stateTtlMs: number
  private readonly logger: FeishuOAuthLogger
  private refreshInFlight: Promise<{ connected: true; refreshed: true }> | undefined

  constructor(private readonly options: FeishuOAuthServiceOptions) {
    this.now = options.now ?? Date.now
    this.stateTtlMs = options.stateTtlMs ?? 10 * 60 * 1000
    this.logger = options.logger ?? noOpLogger
  }

  start(): { state: string; authorizationUrl: string } {
    this.removeExpiredStates()
    const state = randomBytes(32).toString('base64url')
    const verifier = this.options.usePkce ? createPkceVerifier() : undefined
    this.pendingStates.set(state, {
      expiresAt: this.now() + this.stateTtlMs,
      ...(verifier ? { verifier } : {}),
    })
    return {
      state,
      authorizationUrl: this.options.provider.createAuthorizationUrl({
        state,
        redirectUri: CALLBACK_URL,
        ...(verifier ? { codeChallenge: createPkceChallenge(verifier) } : {}),
      }),
    }
  }

  async callback(input: { state?: string | undefined; code?: string | undefined; error?: string | undefined }): Promise<{ connected: true; scopes: readonly string[] }> {
    const pending = input.state ? this.pendingStates.get(input.state) : undefined
    if (!pending) throw this.fail('FEISHU_OAUTH_STATE_INVALID')
    this.pendingStates.delete(input.state!)
    if (pending.expiresAt <= this.now()) throw this.fail('FEISHU_OAUTH_STATE_EXPIRED')
    if (input.error || !input.code) throw this.fail('FEISHU_AUTHORIZATION_DENIED', 401)
    try {
      const credentials = await this.options.provider.exchangeAuthorizationCode(input.code, {
        redirectUri: CALLBACK_URL,
        ...(pending.verifier ? { codeVerifier: pending.verifier } : {}),
      })
      try {
        this.options.credentials.replace(credentials)
      } catch {
        this.clearUnusableCredentials()
        throw this.fail('FEISHU_CREDENTIAL_PERSISTENCE_FAILED', 500)
      }
      this.logger.info('feishu_import_oauth_connected', { scopeCount: credentials.scopes.length })
      return { connected: true, scopes: credentials.scopes }
    } catch (error) {
      if (error instanceof FeishuOAuthError) throw error
      if (error instanceof FeishuOAuthTokenExchangeError) throw this.fail(error.code, 502)
      throw this.fail('FEISHU_AUTHORIZATION_DENIED', 401)
    }
  }

  status(): { connected: boolean; scopes?: readonly string[] } {
    const credentials = this.options.credentials.read()
    return credentials ? { connected: true, scopes: credentials.scopes } : { connected: false }
  }

  async refresh(): Promise<{ connected: true; refreshed: true }> {
    if (this.refreshInFlight) return this.refreshInFlight
    const refresh = this.refreshInternal()
    this.refreshInFlight = refresh
    try {
      return await refresh
    } finally {
      if (this.refreshInFlight === refresh) this.refreshInFlight = undefined
    }
  }

  private async refreshInternal(): Promise<{ connected: true; refreshed: true }> {
    const credentials = this.options.credentials.read()
    if (!credentials) throw this.fail('FEISHU_ACCOUNT_NOT_CONNECTED', 404)
    let rotated: FeishuCredentials
    try {
      rotated = await this.options.provider.refreshToken(credentials.refreshToken)
    } catch {
      throw this.fail('FEISHU_REFRESH_FAILED', 401)
    }
    try {
      this.options.credentials.replace(rotated)
      this.logger.info('feishu_import_oauth_refreshed', { scopeCount: rotated.scopes.length })
      return { connected: true, refreshed: true }
    } catch {
      this.clearUnusableCredentials()
      throw this.fail('FEISHU_REAUTHORIZATION_REQUIRED', 503)
    }
  }

  revoke(): { connected: false } {
    this.options.credentials.clear()
    this.logger.info('feishu_import_oauth_revoked')
    return { connected: false }
  }

  private removeExpiredStates(): void {
    for (const [state, pending] of this.pendingStates) {
      if (pending.expiresAt <= this.now()) this.pendingStates.delete(state)
    }
  }

  private fail(code: string, statusCode = 400): FeishuOAuthError {
    this.logger.warn('feishu_import_oauth_failed', { code })
    return new FeishuOAuthError(code, statusCode)
  }

  private clearUnusableCredentials(): void {
    try {
      this.options.credentials.clear()
    } catch {
      // The underlying failure is intentionally redacted from logs and responses.
    }
  }
}
