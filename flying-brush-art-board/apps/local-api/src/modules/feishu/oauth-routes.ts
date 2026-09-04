import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { SESSION_COOKIE_NAME } from '../auth/auth-plugin.js'
import { FeishuOAuthError, FeishuOAuthService } from './oauth-service.js'

const callbackQuerySchema = z.object({
  state: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}).strict()

function sendOAuthError(reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) {
  if (error instanceof FeishuOAuthError) return reply.code(error.statusCode).send({ code: error.code })
  throw error
}

function oauthActor(request: FastifyRequest) {
  if (!request.user?.openId) return undefined
  return {
    openId: request.user.openId,
    sessionBinding: request.cookies[SESSION_COOKIE_NAME] ?? `development-bypass:${request.user.openId}`,
  }
}

function firstForwardedHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.split(',')[0]?.trim() || undefined
}

function requestOrigin(request: FastifyRequest): string {
  const protocol = firstForwardedHeader(request.headers['x-forwarded-proto']) ?? request.protocol
  const host = firstForwardedHeader(request.headers['x-forwarded-host']) ?? request.headers.host
  if ((protocol !== 'http' && protocol !== 'https') || !host) throw new Error('INVALID_APP_ORIGIN')
  const origin = new URL(`${protocol}://${host}`)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('INVALID_APP_ORIGIN')
  }
  return origin.origin
}

function callbackUrl(request: FastifyRequest, allowedOrigins: ReadonlySet<string> | undefined): string {
  const origin = requestOrigin(request)
  const url = new URL(origin)
  if (allowedOrigins) {
    if (!allowedOrigins.has(origin)) throw new Error('INVALID_APP_ORIGIN')
  } else if (!['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) {
    // Non-loopback import OAuth is available only behind the exact trusted
    // origin allowlist used by the authenticated LAN deployment.
    throw new Error('INVALID_APP_ORIGIN')
  }
  return new URL('/auth/feishu/import/callback', origin).toString()
}

export function registerFeishuOAuthRoutes(
  app: FastifyInstance,
  service: FeishuOAuthService,
  options: { configured?: boolean; allowedOrigins?: ReadonlySet<string> } = {},
): void {
  const configured = options.configured ?? true
  app.get('/auth/feishu/import/start', async (request, reply) => {
    const actor = oauthActor(request)
    if (!actor) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    if (!configured) return reply.code(503).send({ code: 'FEISHU_IMPORT_NOT_CONFIGURED' })
    try {
      return reply.redirect(service.start(actor, callbackUrl(request, options.allowedOrigins)).authorizationUrl)
    } catch {
      return reply.code(400).send({ code: 'INVALID_APP_ORIGIN' })
    }
  })

  app.get('/auth/feishu/import/callback', async (request, reply) => {
    const actor = oauthActor(request)
    if (!actor) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    if (!configured) return reply.code(503).send({ code: 'FEISHU_IMPORT_NOT_CONFIGURED' })
    const query = callbackQuerySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: query.error.issues })
    try {
      return await service.callback(query.data, actor, callbackUrl(request, options.allowedOrigins))
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_APP_ORIGIN') {
        return reply.code(400).send({ code: 'INVALID_APP_ORIGIN' })
      }
      return sendOAuthError(reply, error)
    }
  })

  app.get('/api/integrations/feishu/status', async (request, reply) => {
    if (!request.user?.openId) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    if (!configured) return { connected: false }
    return service.status(request.user.openId)
  })

  app.post('/api/integrations/feishu/refresh', async (request, reply) => {
    if (!request.user?.openId) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    if (!configured) return reply.code(503).send({ code: 'FEISHU_IMPORT_NOT_CONFIGURED' })
    try {
      return await service.refresh(request.user.openId)
    } catch (error) {
      return sendOAuthError(reply, error)
    }
  })

  app.delete('/api/integrations/feishu/account', async (request, reply) => {
    if (!request.user?.openId) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    if (!configured) return reply.code(503).send({ code: 'FEISHU_IMPORT_NOT_CONFIGURED' })
    service.revoke(request.user.openId)
    return reply.code(204).send()
  })
}
