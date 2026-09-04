import { randomUUID } from 'node:crypto'

import { BoardReferenceGraphError, type StoredBoard } from '@infinite-board/board-core'

import type { LocalDatabase } from '../db/schema.js'
import type { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import type { BoardRepository } from '../modules/boards/board-repository.js'
import type { ProjectRepository } from '../modules/projects/project-repository.js'
import type { DomainEventPublisher } from './domain-event-publisher.js'
import type { McpCommandContext } from './operation-service.js'
import type { BoardDeletionCoordinator } from '../modules/realtime/board-deletion-coordinator.js'

export class BoardApplicationService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly projects: ProjectRepository,
    private readonly boards: BoardRepository,
    private readonly references: BoardReferenceRepository,
    private readonly events?: DomainEventPublisher,
    private readonly now: () => Date = () => new Date(),
    private readonly deletions?: BoardDeletionCoordinator,
  ) {}

  list(projectId: string, input: { query?: string; cursor?: string; limit?: number } = {}): { boards: StoredBoard[]; nextCursor?: string } {
    if (!this.projects.get(projectId)) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const query = input.query?.trim().toLocaleLowerCase('zh-CN')
    const filtered = this.boards.listByProject(projectId).filter((board) => !query || board.title.toLocaleLowerCase('zh-CN').includes(query))
    const start = input.cursor ? Math.max(filtered.findIndex((board) => board.id === input.cursor) + 1, 0) : 0
    const page = filtered.slice(start, start + limit)
    return { boards: page.map(({ tldrawSnapshot: _snapshot, ...board }) => board as StoredBoard), ...(filtered.length > start + limit && page.at(-1) ? { nextCursor: page.at(-1)!.id } : {}) }
  }

  get(boardId: string): StoredBoard {
    const board = this.boards.get(boardId)
    if (!board) throw Object.assign(new Error('BOARD_NOT_FOUND'), { code: 'BOARD_NOT_FOUND' })
    return board
  }

  create(projectId: string, title: string, context: McpCommandContext): StoredBoard {
    if (!this.projects.get(projectId)) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const timestamp = this.now().toISOString()
    const board: StoredBoard = {
      id: `board-${randomUUID()}`, projectId, title: title.trim(), tldrawSnapshot: { store: {} },
      accessLevel: 'project', revision: 0, createdAt: timestamp, updatedAt: timestamp,
    }
    if (!board.title) throw Object.assign(new Error('VALIDATION_ERROR'), { code: 'VALIDATION_ERROR' })
    this.boards.create(board)
    this.publish('board.created', context, board, `已创建画板“${board.title}”`)
    return board
  }

  duplicate(boardId: string, title: string | undefined, context: McpCommandContext): StoredBoard {
    const source = this.get(boardId)
    const duplicated = this.boards.duplicate(boardId, { id: `board-${randomUUID()}`, title: title?.trim() || `${source.title} 副本` })
    this.publish('board.created', context, duplicated, `已复制画板“${source.title}”`)
    return duplicated
  }

  rename(boardId: string, title: string, context: McpCommandContext): StoredBoard {
    this.get(boardId)
    const updated = this.boards.rename(boardId, title.trim())
    this.publish('board.renamed', context, updated, `画板已重命名为“${updated.title}”`)
    return updated
  }

  deletePreview(boardId: string): Record<string, unknown> {
    const board = this.get(boardId)
    const project = this.projects.get(board.projectId)!
    const counts = this.database.prepare(`SELECT
      (SELECT COUNT(*) FROM board_references WHERE target_board_id=@id) AS inbound_reference_count,
      (SELECT COUNT(*) FROM board_references WHERE source_board_id=@id) AS outbound_reference_count,
      (SELECT COUNT(*) FROM comment_threads WHERE board_id=@id) AS comment_count,
      (SELECT COUNT(*) FROM asset_usages WHERE board_id=@id) AS asset_usage_count`).get({ id: boardId }) as Record<string, number>
    return { board: { id: board.id, title: board.title, projectId: board.projectId, revision: board.revision }, isRootBoard: project.rootBoardId === boardId, ...counts }
  }

  async remove(boardId: string, context: McpCommandContext): Promise<void> {
    const board = this.get(boardId)
    try {
      const remove = () => this.boards.remove(board.projectId, board.id)
      const removed = this.deletions ? await this.deletions.deleteBoard(board.id, remove) : remove()
      if (!removed) throw Object.assign(new Error('BOARD_NOT_FOUND'), { code: 'BOARD_NOT_FOUND' })
    } catch (error) {
      if (error instanceof BoardReferenceGraphError) throw Object.assign(error, { code: error.code, details: error.details })
      throw error
    }
    this.publish('board.deleted', context, board, `已删除画板“${board.title}”`)
  }

  referencesForBoard(boardId: string, direction: 'inbound' | 'outbound') {
    this.get(boardId)
    return direction === 'inbound' ? this.references.listInbound(boardId) : this.references.listOutbound(boardId)
  }

  private publish(type: string, context: McpCommandContext, board: StoredBoard, summary: string): void {
    this.events?.publish({
      type, actorOpenId: context.actorOpenId, actorName: context.actorName, clientId: context.clientId,
      operationId: context.operationId, projectId: board.projectId, boardId: board.id, summary,
      createdAt: this.now().toISOString(),
    })
  }
}
