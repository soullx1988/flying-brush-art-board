import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { AuditRepository } from './audit-repository.js'
import type { BoardRepository } from '../boards/board-repository.js'
import type { ProjectRepository } from '../projects/project-repository.js'
import { canAccessBoard, canAccessProject } from '../../privacy/board-access-policy.js'

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

export function registerAuditRoutes(
  app: FastifyInstance,
  audits: AuditRepository,
  boards: BoardRepository,
  projects: ProjectRepository,
): void {
  const canReadProject = (projectId: string, actorOpenId: string) => {
    const project = projects.get(projectId)
    return Boolean(project && canAccessProject(project, actorOpenId, projects.isMember(project.id, actorOpenId)))
  }
  const canReadBoard = (boardId: string, actorOpenId: string) => {
    const board = boards.get(boardId)
    return Boolean(board && canAccessBoard(
      board,
      projects.get(board.projectId),
      actorOpenId,
      projects.isMember(board.projectId, actorOpenId),
    ))
  }
  const visibleEvents = <T extends { events: Array<{ actorOpenId: string; projectId?: string; boardId?: string }> }>(page: T, actorOpenId: string): T => ({
    ...page,
    events: page.events.filter((event) => event.actorOpenId === actorOpenId || (event.boardId
      ? canReadBoard(event.boardId, actorOpenId)
      : event.projectId ? canReadProject(event.projectId, actorOpenId) : true)),
  })

  app.get('/api/audit', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const query = querySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (query.data.boardId && boards.get(query.data.boardId)
      && !canReadBoard(query.data.boardId, request.user.openId)) {
      return reply.code(403).send({ code: 'BOARD_ACCESS_DENIED' })
    }
    if (query.data.projectId && projects.get(query.data.projectId)
      && !canReadProject(query.data.projectId, request.user.openId)) {
      return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    }
    return visibleEvents(audits.listPage({
      ...(query.data.projectId ? { projectId: query.data.projectId } : {}),
      ...(query.data.boardId ? { boardId: query.data.boardId } : {}),
      ...(query.data.actorOpenId ? { actorOpenId: query.data.actorOpenId } : {}),
      ...(query.data.action ? { action: query.data.action } : {}),
      ...(query.data.startAt ? { startAt: query.data.startAt } : {}),
      ...(query.data.endAt ? { endAt: query.data.endAt } : {}),
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      ...(query.data.limit ? { limit: query.data.limit } : {}),
    }), request.user.openId)
  })

  app.get('/api/audit-events', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const query = querySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (query.data.projectId && projects.get(query.data.projectId)
      && !canReadProject(query.data.projectId, request.user.openId)) {
      return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    }
    return audits.list(query.data.projectId, query.data.limit).filter((event) => event.actorOpenId === request.user!.openId || (event.boardId
      ? canReadBoard(event.boardId, request.user!.openId)
      : event.projectId ? canReadProject(event.projectId, request.user!.openId) : true))
  })
}
