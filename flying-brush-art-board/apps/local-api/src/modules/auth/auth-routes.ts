import type { FastifyInstance, FastifyRequest } from 'fastify'

import { createOpaqueToken, FeishuLoginOAuthError, type FeishuOAuthProvider } from './feishu-oauth-provider.js'
import { isSafeReturnTo, type OAuthStateRepository } from './oauth-state-repository.js'
import { SESSION_COOKIE_NAME, type AuthenticationDependencies } from './auth-plugin.js'
import type { AuditRepository } from '../audit/audit-repository.js'
import type { AllowedUser } from './allowed-user-directory.js'
import type { FeishuLoginIdentity } from './feishu-oauth-provider.js'

export interface AuthenticationRouteDependencies extends AuthenticationDependencies {
  oauth: FeishuOAuthProvider
  states: OAuthStateRepository
  recordLogin?(identity: FeishuLoginIdentity): Promise<AllowedUser>
  realtimeEnabled?: boolean
  audit?: AuditRepository
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function cookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: 7 * 24 * 60 * 60 }
}

function firstForwardedHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.split(',')[0]?.trim() || undefined
}

function requestProtocol(request: FastifyRequest): 'http' | 'https' {
  const forwarded = firstForwardedHeader(request.headers['x-forwarded-proto'])
  const protocol = forwarded ?? request.protocol
  if (protocol !== 'http' && protocol !== 'https') throw new Error('Invalid request protocol')
  return protocol
}

function callbackUrl(request: FastifyRequest, requestedOrigin?: string): string {
  if (requestedOrigin !== undefined) {
    const origin = new URL(requestedOrigin)
    if ((origin.protocol !== 'http:' && origin.protocol !== 'https:')
      || origin.origin !== requestedOrigin
      || origin.username
      || origin.password) throw new Error('Invalid requested origin')
    return new URL('/auth/feishu/callback', origin).toString()
  }
  const host = firstForwardedHeader(request.headers['x-forwarded-host']) ?? request.headers.host
  if (!host) throw new Error('Missing request host')
  const origin = new URL(`${requestProtocol(request)}://${host}`)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid request origin')
  return new URL('/auth/feishu/callback', origin).toString()
}

export function registerAuthenticationRoutes(app: FastifyInstance, dependencies: AuthenticationRouteDependencies): void {
  app.get('/auth/feishu/start', async (request, reply) => {
    const query = request.query as { returnTo?: unknown; origin?: unknown }
    const returnTo = stringQuery(query.returnTo) ?? '/'
    const requestedOrigin = stringQuery(query.origin)
    if (!isSafeReturnTo(returnTo)) return reply.code(400).send({ code: 'INVALID_RETURN_TO' })
    const state = createOpaqueToken()
    const verifier = createOpaqueToken()
    let redirectUri: string
    try {
      redirectUri = callbackUrl(request, requestedOrigin)
    } catch {
      return reply.code(400).send({ code: 'INVALID_APP_ORIGIN' })
    }
    dependencies.states.create(state, verifier, returnTo, redirectUri)
    return reply.redirect(dependencies.oauth.createAuthorizationUrl({
      state,
      redirectUri,
    }).toString())
  })

  app.get('/auth/feishu/callback', async (request, reply) => {
    const query = request.query as { state?: unknown; code?: unknown }
    const state = stringQuery(query.state)
    const code = stringQuery(query.code)
    if (!state || !code) return reply.code(400).send({ code: 'OAUTH_STATE_INVALID' })
    const savedState = dependencies.states.consume(state)
    if (!savedState) return reply.code(400).send({ code: 'OAUTH_STATE_INVALID' })
    let identity: Awaited<ReturnType<FeishuOAuthProvider['exchangeCode']>>
    try {
      identity = await dependencies.oauth.exchangeCode({ code, redirectUri: savedState.redirectUri })
    } catch (error) {
      if (error instanceof FeishuLoginOAuthError) return reply.code(502).send({ code: error.code })
      return reply.code(502).send({ code: 'OAUTH_EXCHANGE_FAILED' })
    }
    try {
      const user = dependencies.recordLogin
        ? await dependencies.recordLogin(identity)
        : await dependencies.users.requireAllowed(identity.openId)
      const token = dependencies.sessions.create(user)
      dependencies.audit?.record({
        actorOpenId: user.openId,
        action: 'auth.login',
        summary: { method: 'GET', route: '/auth/feishu/callback', statusCode: 302 },
      })
      reply.setCookie(SESSION_COOKIE_NAME, token, cookieOptions(new URL(savedState.redirectUri).protocol === 'https:'))
      return reply.redirect(savedState.returnTo)
    } catch (error) {
      if ((error as { code?: unknown }).code === 'USER_NOT_ALLOWED') return reply.code(403).send({ code: 'USER_NOT_ALLOWED' })
      return reply.code(503).send({ code: 'USER_DIRECTORY_UNAVAILABLE' })
    }
  })

  app.get('/api/me', async (request) => ({
    ...request.user,
    realtimeEnabled: dependencies.realtimeEnabled === true,
  }))

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME]
    if (token) dependencies.sessions.revoke(token)
    let secure = false
    try { secure = requestProtocol(request) === 'https' } catch {}
    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions(secure))
    return reply.code(204).send()
  })
}
