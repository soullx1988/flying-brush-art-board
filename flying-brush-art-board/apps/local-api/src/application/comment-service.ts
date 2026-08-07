import type { BoardRepository } from '../modules/boards/board-repository.js'
import type { CommentRepository, CommentThreadStatus } from '../modules/comments/comment-repository.js'
import type { DomainEventPublisher } from './domain-event-publisher.js'
import type { McpCommandContext } from './operation-service.js'

export class CommentApplicationService {
  constructor(
    private readonly boards: BoardRepository,
    private readonly comments: CommentRepository,
    private readonly events?: DomainEventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(boardId: string, status?: CommentThreadStatus) {
    this.requireBoard(boardId)
    return this.comments.listThreads(boardId, status).map((thread) => ({ ...thread, messages: this.comments.listMessages(thread.id) }))
  }

  create(boardId: string, input: { body: string; shapeId?: string; x?: number; y?: number }, context: McpCommandContext) {
    const board = this.requireBoard(boardId)
    const created = this.comments.createThread({ projectId: board.projectId, boardId, authorOpenId: context.actorOpenId, ...input })
    this.publish('comment.created', context, board.projectId, boardId, `已创建评论`, [created.thread.id])
    return created
  }

  reply(threadId: string, body: string, context: McpCommandContext) {
    const thread = this.comments.getThread(threadId)
    if (!thread) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    const message = this.comments.addMessage(threadId, context.actorOpenId, body)
    if (!message) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    this.publish('comment.updated', context, thread.projectId, thread.boardId, '已回复评论', [threadId])
    return message
  }

  setStatus(threadId: string, status: CommentThreadStatus, context: McpCommandContext) {
    const current = this.comments.getThread(threadId)
    if (!current) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    const updated = this.comments.setStatus(threadId, status)!
    this.publish('comment.updated', context, current.projectId, current.boardId, status === 'resolved' ? '已解决评论' : '已重新打开评论', [threadId])
    return updated
  }

  deletePreview(threadId: string) {
    const thread = this.comments.getThread(threadId)
    if (!thread) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    return { thread, messageCount: this.comments.listMessages(threadId).filter((message) => !message.deletedAt).length }
  }

  remove(threadId: string, context: McpCommandContext): void {
    const thread = this.comments.getThread(threadId)
    if (!thread) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    if (!this.comments.deleteThread(threadId)) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    this.publish('comment.deleted', context, thread.projectId, thread.boardId, '已删除评论', [threadId])
  }

  private requireBoard(boardId: string) {
    const board = this.boards.get(boardId)
    if (!board) throw Object.assign(new Error('BOARD_NOT_FOUND'), { code: 'BOARD_NOT_FOUND' })
    return board
  }

  private publish(type: string, context: McpCommandContext, projectId: string, boardId: string, summary: string, affectedIds: string[]): void {
    this.events?.publish({
      type, actorOpenId: context.actorOpenId, actorName: context.actorName, clientId: context.clientId,
      operationId: context.operationId, projectId, boardId, summary, affectedIds, createdAt: this.now().toISOString(),
    })
  }
}
