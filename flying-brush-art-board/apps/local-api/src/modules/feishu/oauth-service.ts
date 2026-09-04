import { createHash, randomBytes } from 'node:crypto'

import type { FeishuCredentials } from './credential-store.js'
import { FeishuOAuthTokenExchangeError } from './real-oauth-provider.js'

export interface FeishuOAuthProvider {
  createAuthorizationUrl(input: { state: string; codeChallenge?: string; redirectUri: string }): string
  exchangeAuthorizationCode(code: string, input: { codeVerifier?: string; redirectUri: string }): Promise<FeishuCredentials>
  refreshToken(refreshToken: string): Promise<FeishuCredentials>
}

export interface FeishuCredentialStore {
  read(openId: string): FeishuCredentials | undefined
  replace(openId: string, credentials: FeishuCredentials): void
  clear(openId: string): void
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
  actorOpenId: string
  sessionBindingHash: string
  redirectUri: string
  verifier?: string
  expiresAt: number
}

export interface FeishuOAuthActor {
  openId: string
  sessionBinding: string
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

const noOpLogger: FeishuOAuthLogger = { info() {}, warn() {} }

function validCallbackUri(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new FeishuOAuthError('FEISHU_OAUTH_REDIRECT_URI_INVALID')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.pathname !== '/auth/feishu/import/callback'
    || url.search
    || url.hash
    || url.username
    || url.password) {
    throw new FeishuOAuthError('FEISHU_OAUTH_REDIRECT_URI_INVALID')
  }
  return url.toString()
}

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
  private readonly refreshesInFlight = new Map<string, Promise<{ connected: true; refreshed: true }>>()
  private readonly credentialGenerations = new Map<string, number>()

  constructor(private readonly options: FeishuOAuthServiceOptions) {
    this.now = options.now ?? Date.now
    this.stateTtlMs = options.stateTtlMs ?? 10 * 60 * 1000
    this.logger = options.logger ?? noOpLogger
  }

  start(actor: FeishuOAuthActor, redirectUri: string): { state: string; authorizationUrl: string } {
    this.removeExpiredStates()
    const callbackUri = validCallbackUri(redirectUri)
    const sessionBindingHash = this.sessionBindingHash(actor)
    const state = randomBytes(32).toString('base64url')
    const verifier = this.options.usePkce ? createPkceVerifier() : undefined
    this.pendingStates.set(state, {
      actorOpenId: actor.openId,
      sessionBindingHash,
      redirectUri: callbackUri,
      expiresAt: this.now() + this.stateTtlMs,
      ...(verifier ? { verifier } : {}),
    })
    return {
      state,
      authorizationUrl: this.options.provider.createAuthorizationUrl({
        state,
        redirectUri: callbackUri,
        ...(verifier ? { codeChallenge: createPkceChallenge(verifier) } : {}),
      }),
    }
  }

  async callback(
    input: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
    actor: FeishuOAuthActor,
    redirectUri: string,
  ): Promise<{ connected: true; scopes: readonly string[] }> {
    const pending = input.state ? this.pendingStates.get(input.state) : undefined
    if (!pending) throw this.fail('FEISHU_OAUTH_STATE_INVALID')
    let callbackUri: string
    try {
      callbackUri = validCallbackUri(redirectUri)
    } catch {
      throw this.fail('FEISHU_OAUTH_STATE_INVALID')
    }
    if (pending.actorOpenId !== actor.openId
      || pending.sessionBindingHash !== this.sessionBindingHash(actor)
      || pending.redirectUri !== callbackUri) {
      throw this.fail('FEISHU_OAUTH_STATE_INVALID')
    }
    this.pendingStates.delete(input.state!)
    if (pending.expiresAt <= this.now()) throw this.fail('FEISHU_OAUTH_STATE_EXPIRED')
    if (input.error || !input.code) throw this.fail('FEISHU_AUTHORIZATION_DENIED', 401)
    try {
      const credentials = await this.options.provider.exchangeAuthorizationCode(input.code, {
        redirectUri: pending.redirectUri,
        ...(pending.verifier ? { codeVerifier: pending.verifier } : {}),
      })
      try {
        this.advanceCredentialGeneration(actor.openId)
        this.options.credentials.replace(actor.openId, credentials)
      } catch {
        this.clearUnusableCredentials(actor.openId)
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

  status(openId: string): { connected: boolean; scopes?: readonly string[] } {
    const credentials = this.options.credentials.read(openId)
    return credentials ? { connected: true, scopes: credentials.scopes } : { connected: false }
  }

  async refresh(openId: string): Promise<{ connected: true; refreshed: true }> {
    const existing = this.refreshesInFlight.get(openId)
    if (existing) return existing
    const refresh = this.refreshInternal(openId)
    this.refreshesInFlight.set(openId, refresh)
    try {
      return await refresh
    } finally {
      if (this.refreshesInFlight.get(openId) === refresh) this.refreshesInFlight.delete(openId)
    }
  }

  private async refreshInternal(openId: string): Promise<{ connected: true; refreshed: true }> {
    const credentials = this.options.credentials.read(openId)
    if (!credentials) throw this.fail('FEISHU_ACCOUNT_NOT_CONNECTED', 404)
    const generation = this.credentialGeneration(openId)
    let rotated: FeishuCredentials
    try {
      rotated = await this.options.provider.refreshToken(credentials.refreshToken)
    } catch {
      throw this.fail('FEISHU_REFRESH_FAILED', 401)
    }
    if (this.credentialGeneration(openId) !== generation) throw this.fail('FEISHU_REFRESH_SUPERSEDED', 409)
    try {
      this.options.credentials.replace(openId, rotated)
      this.logger.info('feishu_import_oauth_refreshed', { scopeCount: rotated.scopes.length })
      return { connected: true, refreshed: true }
    } catch {
      this.clearUnusableCredentials(openId)
      throw this.fail('FEISHU_REAUTHORIZATION_REQUIRED', 503)
    }
  }

  revoke(openId: string): { connected: false } {
    this.advanceCredentialGeneration(openId)
    this.options.credentials.clear(openId)
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

  private clearUnusableCredentials(openId: string): void {
    try {
      this.options.credentials.clear(openId)
    } catch {
      // The underlying failure is intentionally redacted from logs and responses.
    }
  }

  private sessionBindingHash(actor: FeishuOAuthActor): string {
    if (!actor.openId || !actor.sessionBinding) throw this.fail('FEISHU_OAUTH_SESSION_INVALID', 401)
    return createHash('sha256').update(actor.sessionBinding, 'utf8').digest('hex')
  }

  private credentialGeneration(openId: string): number {
    return this.credentialGenerations.get(openId) ?? 0
  }

  private advanceCredentialGeneration(openId: string): void {
    this.credentialGenerations.set(openId, this.credentialGeneration(openId) + 1)
  }
}
