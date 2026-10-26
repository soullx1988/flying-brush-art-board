import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { AuditRepository } from './audit-repository.js'
import type { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import type { BoardRepository } from '../boards/board-repository.js'
import type { CommentRepository } from '../comments/comment-repository.js'

const ACTIONS: Record<string, string> = {
  'POST /api/projects': 'project.create',
  'PATCH /api/projects/:projectId': 'project.rename',
  'DELETE /api/projects/:projectId': 'project.delete',
  'PUT /api/projects/:projectId/root-board': 'project.root-board',
  'PUT /api/projects/:projectId/navigation': 'project.navigation',
  'POST /api/projects/:projectId/boards': 'board.create',
  'POST /api/boards/:boardId/duplicate': 'board.create',
  'PATCH /api/boards/:boardId': 'board.rename',
  'DELETE /api/boards/:boardId': 'board.delete',
  'PUT /api/boards/:boardId/snapshot': 'board.edit',
  'POST /api/boards/:boardId/references': 'reference.create',
  'PATCH /api/references/:referenceId': 'reference.update',
  'DELETE /api/references/:referenceId': 'reference.delete',
  'POST /api/boards/:boardId/comments': 'comment.create',
  'POST /api/comment-threads/:threadId/messages': 'comment.reply',
  'PATCH /api/comment-threads/:threadId': 'comment.update',
  'DELETE /api/comment-threads/:threadId': 'comment.delete',
  'DELETE /api/comment-messages/:messageId': 'comment.delete',
  'POST /api/auth/logout': 'auth.logout',
  'POST /api/import/iboard/commit': 'import.commit',
  'POST /api/import/feishu/commit': 'import.commit',
  'GET /api/projects/:projectId/export.iboard': 'export.complete',
  'POST /api/boards/:boardId/export.pdf': 'export.complete',
  'POST /api/projects/:projectId/export.pdf': 'export.complete',
}

function routeKey(request: FastifyRequest): string {
  return `${request.method} ${request.routeOptions.url ?? ''}`
}

function routeIdentifiers(request: FastifyRequest): { projectId?: string; boardId?: string } {
  const params = request.params as { projectId?: unknown; boardId?: unknown }
  return {
    ...(typeof params.projectId === 'string' ? { projectId: params.projectId } : {}),
    ...(typeof params.boardId === 'string' ? { boardId: params.boardId } : {}),
  }
}

function actionFor(request: FastifyRequest): string | undefined {
  const action = ACTIONS[routeKey(request)]
  if (action !== 'comment.update') return action
  const status = (request.body as { status?: unknown } | undefined)?.status
  if (status === 'resolved') return 'comment.resolve'
  if (status === 'open') return 'comment.reopen'
  const body = request.body as { x?: unknown; y?: unknown } | undefined
  return typeof body?.x === 'number' && typeof body.y === 'number' ? 'comment.move' : undefined
}

export function registerAuditPlugin(
  app: FastifyInstance,
  audits: AuditRepository,
  boards?: BoardRepository,
  comments?: CommentRepository,
  references?: BoardReferenceRepository,
): void {
  const resolvedIdentifiers = new WeakMap<FastifyRequest, { projectId?: string; boardId?: string }>()

  app.addHook('preHandler', async (request) => {
    const direct = routeIdentifiers(request)
    if (direct.boardId && boards) {
      const board = boards.get(direct.boardId)
      const duplicateTargetId = routeKey(request) === 'POST /api/boards/:boardId/duplicate'
        ? (request.body as { id?: unknown } | undefined)?.id
        : undefined
      resolvedIdentifiers.set(request, {
        ...direct,
        ...(board ? { projectId: board.projectId } : {}),
        ...(typeof duplicateTargetId === 'string' ? { boardId: duplicateTargetId } : {}),
      })
      return
    }
    const params = request.params as { threadId?: unknown; messageId?: unknown; referenceId?: unknown }
    const reference = references && typeof params.referenceId === 'string'
      ? references.get(params.referenceId)
      : undefined
    if (reference) {
      resolvedIdentifiers.set(request, { projectId: reference.projectId, boardId: reference.sourceBoardId })
      return
    }
    const thread = comments && typeof params.threadId === 'string'
      ? comments.getThread(params.threadId)
      : comments && typeof params.messageId === 'string'
        ? comments.getThreadByMessageId(params.messageId)
        : undefined
    resolvedIdentifiers.set(request, thread ? { projectId: thread.projectId, boardId: thread.boardId } : direct)
  })

  app.addHook('onResponse', async (request, reply) => {
    const action = actionFor(request)
    if (!action || !request.user || reply.statusCode >= 400) return
    audits.record({
      actorOpenId: request.user.openId,
      action,
      ...(resolvedIdentifiers.get(request) ?? routeIdentifiers(request)),
      summary: { method: request.method, route: request.routeOptions.url ?? '', statusCode: reply.statusCode },
    })
  })
}
