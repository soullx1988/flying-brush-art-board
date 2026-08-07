import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

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

export function registerFeishuOAuthRoutes(app: FastifyInstance, service: FeishuOAuthService): void {
  app.get('/auth/feishu/import/start', async (_request, reply) => {
    return reply.redirect(service.start().authorizationUrl)
  })

  app.get('/auth/feishu/import/callback', async (request, reply) => {
    const query = callbackQuerySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: query.error.issues })
    try {
      return await service.callback(query.data)
    } catch (error) {
      return sendOAuthError(reply, error)
    }
  })

  app.get('/api/integrations/feishu/status', async () => service.status())

  app.post('/api/integrations/feishu/refresh', async (_request, reply) => {
    try {
      return await service.refresh()
    } catch (error) {
      return sendOAuthError(reply, error)
    }
  })

  app.delete('/api/integrations/feishu/account', async (_request, reply) => {
    service.revoke()
    return reply.code(204).send()
  })
}
