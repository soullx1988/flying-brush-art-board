import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { AuditRepository } from './audit-repository.js'

const querySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  boardId: z.string().trim().min(1).optional(),
  actorOpenId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict()

export function registerAuditRoutes(app: FastifyInstance, audits: AuditRepository): void {
  app.get('/api/audit', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const query = querySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    return audits.listPage({
      ...(query.data.projectId ? { projectId: query.data.projectId } : {}),
      ...(query.data.boardId ? { boardId: query.data.boardId } : {}),
      ...(query.data.actorOpenId ? { actorOpenId: query.data.actorOpenId } : {}),
      ...(query.data.action ? { action: query.data.action } : {}),
      ...(query.data.startAt ? { startAt: query.data.startAt } : {}),
      ...(query.data.endAt ? { endAt: query.data.endAt } : {}),
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      ...(query.data.limit ? { limit: query.data.limit } : {}),
    })
  })

  app.get('/api/audit-events', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const query = querySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    return audits.list(query.data.projectId, query.data.limit)
  })
}
