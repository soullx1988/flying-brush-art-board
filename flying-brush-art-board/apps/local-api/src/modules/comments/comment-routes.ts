import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { BoardRepository } from '../boards/board-repository.js'
import type { ProjectRepository } from '../projects/project-repository.js'
import { canAccessBoard, canManageProject } from '../../privacy/board-access-policy.js'
import { CommentEventHub, type CommentChangedEventInput } from './comment-events.js'
import { CommentRepository, type CommentThreadStatus } from './comment-repository.js'

const boardParams = z.object({ boardId: z.string().trim().min(1) }).strict()
const threadParams = z.object({ threadId: z.string().uuid() }).strict()
const messageParams = z.object({ messageId: z.string().uuid() }).strict()
const commentBody = z.string().trim().min(1).max(10_000)
const createThread = z.object({
  shapeId: z.string().trim().min(1).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  shapeOffsetX: z.number().finite().optional(),
  shapeOffsetY: z.number().finite().optional(),
  body: commentBody,
}).strict().superRefine((value, context) => {
  if ((value.shapeOffsetX === undefined) !== (value.shapeOffsetY === undefined)) {
    context.addIssue({ code: 'custom', message: 'Shape offsets must be supplied together' })
  }
  if ((value.shapeOffsetX !== undefined || value.shapeOffsetY !== undefined) && !value.shapeId) {
    context.addIssue({ code: 'custom', message: 'Shape offsets require a shape id' })
  }
})
const addMessage = z.object({ body: commentBody }).strict()
const threadUpdate = z.union([
  z.object({ status: z.enum(['open', 'resolved']) }).strict(),
  z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
])
const listQuery = z.object({ status: z.enum(['open', 'resolved']).optional() }).strict()

function actor(request: { user?: { openId: string } }, reply: { code(status: number): { send(body: unknown): unknown } }): string | undefined {
  if (request.user) return request.user.openId
  reply.code(401).send({ code: 'SESSION_EXPIRED' })
  return undefined
}

export interface CommentRouteOptions {
  events?: CommentEventHub
  revalidate?(request: FastifyRequest): boolean | Promise<boolean>
  heartbeatIntervalMs?: number
  revalidateIntervalMs?: number
}

export function registerCommentRoutes(
  app: FastifyInstance,
  boards: BoardRepository,
  projects: ProjectRepository,
  comments: CommentRepository,
  options: CommentRouteOptions = {},
): void {
  const events = options.events ?? new CommentEventHub()
  const publish = (event: Omit<CommentChangedEventInput, 'type'>) => events.publish({ type: 'comment.changed', ...event })
  const revalidate = options.revalidate ?? ((request: FastifyRequest) => Boolean(request.user))
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000
  const revalidateIntervalMs = options.revalidateIntervalMs ?? 60_000
  const boardAllowed = (boardId: string, actorOpenId: string | undefined) => {
    const board = boards.get(boardId)
    return Boolean(board && canAccessBoard(
      board,
      projects.get(board.projectId),
      actorOpenId,
      projects.isMember(board.projectId, actorOpenId),
    ))
  }
  const requireBoard = (boardId: string, actorOpenId: string | undefined, reply: any) => {
    const board = boards.get(boardId)
    if (!board) {
      reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
      return undefined
    }
    if (!boardAllowed(boardId, actorOpenId)) {
      reply.code(403).send({ code: 'BOARD_ACCESS_DENIED' })
      return undefined
    }
    return board
  }

  app.get('/api/boards/:boardId/comment-events', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const params = boardParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (!requireBoard(params.data.boardId, request.user.openId, reply)) return
    if (!events.canSubscribe(params.data.boardId)) return reply.code(429).send({ code: 'COMMENT_EVENT_CONNECTION_LIMIT' })

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const write = (payload: string) => !reply.raw.destroyed && !reply.raw.writableEnded && reply.raw.write(payload)
    if (!write(': connected\n\n')) {
      reply.raw.end()
      return
    }
    let closed = false
    let unsubscribe: () => void = () => undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let revalidation: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (revalidation) clearInterval(revalidation)
      unsubscribe()
      if (!reply.raw.writableEnded) reply.raw.end()
    }
    const lastEventIdHeader = request.headers['last-event-id']
    const lastEventId = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader
    unsubscribe = events.subscribe(
      params.data.boardId,
      (event) => write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
      cleanup,
      lastEventId,
    )
    request.raw.once('close', cleanup)
    heartbeat = setInterval(() => { if (!write(': heartbeat\n\n')) cleanup() }, heartbeatIntervalMs)
    revalidation = setInterval(() => {
      void Promise.resolve(revalidate(request)).then((valid) => {
        if (!valid || !boardAllowed(params.data.boardId, request.user?.openId)) cleanup()
      }, cleanup)
    }, revalidateIntervalMs)
  })

  app.get('/api/boards/:boardId/comment-state', async (request, reply) => {
    const params = boardParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (!requireBoard(params.data.boardId, request.user?.openId, reply)) return
    return {
      threads: comments.listThreads(params.data.boardId),
      messages: comments.listBoardMessages(params.data.boardId),
    }
  })
  app.get('/api/boards/:boardId/comments', async (request, reply) => {
    const params = boardParams.safeParse(request.params)
    const query = listQuery.safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    if (!requireBoard(params.data.boardId, request.user?.openId, reply)) return
    return comments.listThreads(params.data.boardId, query.data.status as CommentThreadStatus | undefined)
  })

  app.post('/api/boards/:boardId/comments', async (request, reply) => {
    const openId = actor(request, reply)
    if (!openId) return
    const params = boardParams.safeParse(request.params)
    const input = createThread.safeParse(request.body)
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const board = requireBoard(params.data.boardId, openId, reply)
    if (!board) return
    const created = comments.createThread({
      projectId: board.projectId,
      boardId: board.id,
      authorOpenId: openId,
      body: input.data.body,
      ...(input.data.shapeId === undefined ? {} : { shapeId: input.data.shapeId }),
      ...(input.data.x === undefined ? {} : { x: input.data.x }),
      ...(input.data.y === undefined ? {} : { y: input.data.y }),
      ...(input.data.shapeOffsetX === undefined ? {} : { shapeOffsetX: input.data.shapeOffsetX }),
      ...(input.data.shapeOffsetY === undefined ? {} : { shapeOffsetY: input.data.shapeOffsetY }),
    })
    publish({ boardId: board.id, threadId: created.thread.id, action: 'create', messageId: created.message.id })
    return reply.code(201).send(created)
  })

  app.get('/api/comment-threads/:threadId/messages', async (request, reply) => {
    const params = threadParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const thread = comments.getThread(params.data.threadId)
    if (!thread) return reply.code(404).send({ code: 'COMMENT_THREAD_NOT_FOUND' })
    if (!requireBoard(thread.boardId, request.user?.openId, reply)) return
    return comments.listMessages(params.data.threadId)
  })

  app.post('/api/comment-threads/:threadId/messages', async (request, reply) => {
    const openId = actor(request, reply)
    if (!openId) return
    const params = threadParams.safeParse(request.params)
    const input = addMessage.safeParse(request.body)
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const thread = comments.getThread(params.data.threadId)
    if (thread && !requireBoard(thread.boardId, openId, reply)) return
    const message = comments.addMessage(params.data.threadId, openId, input.data.body)
    if (!message || !thread) return reply.code(404).send({ code: 'COMMENT_THREAD_NOT_FOUND' })
    publish({ boardId: thread.boardId, threadId: thread.id, action: 'reply', messageId: message.id })
    return reply.code(201).send(message)
  })

  app.patch('/api/comment-threads/:threadId', async (request, reply) => {
    const openId = actor(request, reply)
    if (!openId) return
    const params = threadParams.safeParse(request.params)
    const input = threadUpdate.safeParse(request.body)
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const current = comments.getThread(params.data.threadId)
    if (!current) return reply.code(404).send({ code: 'COMMENT_THREAD_NOT_FOUND' })
    if (!requireBoard(current.boardId, openId, reply)) return
    const thread = 'status' in input.data
      ? comments.setStatus(params.data.threadId, input.data.status)
      : comments.updateAnchor(params.data.threadId, input.data)
    if (!thread) return reply.code(404).send({ code: 'COMMENT_THREAD_NOT_FOUND' })
    publish({
      boardId: thread.boardId,
      threadId: thread.id,
      action: 'status' in input.data ? (input.data.status === 'resolved' ? 'resolve' : 'reopen') : 'move',
    })
    return thread
  })

  app.delete('/api/comment-threads/:threadId', async (request, reply) => {
    const openId = actor(request, reply)
    if (!openId) return
    const params = threadParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const thread = comments.getThread(params.data.threadId)
    if (thread && !requireBoard(thread.boardId, openId, reply)) return
    if (thread && thread.createdBy !== openId && !canManageProject(projects.get(thread.projectId)!, openId)) {
      return reply.code(403).send({ code: 'COMMENT_THREAD_DELETE_FORBIDDEN' })
    }
    if (!thread || !comments.deleteThread(params.data.threadId)) return reply.code(404).send({ code: 'COMMENT_THREAD_NOT_FOUND' })
    publish({ boardId: thread.boardId, threadId: thread.id, action: 'delete' })
    return reply.code(204).send()
  })

  app.delete('/api/comment-messages/:messageId', async (request, reply) => {
    const openId = actor(request, reply)
    if (!openId) return
    const params = messageParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const thread = comments.getThreadByMessageId(params.data.messageId)
    if (thread && !requireBoard(thread.boardId, openId, reply)) return
    if (!thread || !comments.deleteMessage(params.data.messageId, openId)) return reply.code(404).send({ code: 'COMMENT_MESSAGE_NOT_FOUND' })
    publish({ boardId: thread.boardId, threadId: thread.id, action: 'delete', messageId: params.data.messageId })
    return reply.code(204).send()
  })

  app.addHook('preClose', async () => events.close())
}
