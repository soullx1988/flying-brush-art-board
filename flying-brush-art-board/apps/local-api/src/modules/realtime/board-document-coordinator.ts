import { randomUUID } from 'node:crypto'

import type { LocalDatabase } from '../../db/schema.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import { BoardOperationQueue } from './board-operation-queue.js'

export interface BoardDocumentCoordinatorRealtime {
  applyCommittedSnapshot(boardId: string, snapshot: unknown): Promise<void>
  applyCommittedSnapshotWithinQueue?(boardId: string, snapshot: unknown): Promise<void>
}

export interface BoardDocumentCoordinatorCommand<T> {
  boardId: string
  actorOpenId: string
  reason: string
  expectedRevision?: number
  mutate(snapshot: unknown): Promise<{ snapshot: unknown; result: T; commit?: () => void }>
}

export class BoardDocumentCoordinator {
  constructor(
    private readonly database: LocalDatabase,
    private readonly boards: BoardRepository,
    private readonly realtime?: BoardDocumentCoordinatorRealtime,
    private readonly operationQueue = new BoardOperationQueue(),
  ) {}

  async read(boardId: string): Promise<{ snapshot: unknown; revision: number }> {
    const board = this.boards.get(boardId)
    if (!board) throw new Error('BOARD_NOT_FOUND')
    return { snapshot: board.tldrawSnapshot, revision: board.revision }
  }

  runCommand<T>(input: BoardDocumentCoordinatorCommand<T>): Promise<{ snapshot: unknown; revision: number; result: T }> {
    return this.operationQueue.run(input.boardId, () => this.runCommandNow(input))
  }

  private async runCommandNow<T>(input: BoardDocumentCoordinatorCommand<T>): Promise<{ snapshot: unknown; revision: number; result: T }> {
    const board = this.boards.get(input.boardId)
    if (!board) throw new Error('BOARD_NOT_FOUND')
    if (input.expectedRevision !== undefined && input.expectedRevision !== board.revision) {
      throw new RevisionConflictError(board.revision)
    }

    const mutation = await input.mutate(board.tldrawSnapshot)
    const saved = this.database.transaction(() => {
      this.database.prepare(
        'INSERT INTO board_checkpoints(id, board_id, snapshot_json, reason, actor_open_id, created_at) VALUES (?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        input.boardId,
        JSON.stringify(board.tldrawSnapshot),
        input.reason,
        input.actorOpenId,
        new Date().toISOString(),
      )
      mutation.commit?.()
      return this.boards.saveSnapshot(input.boardId, board.revision, mutation.snapshot)
    })()
    if (this.realtime) {
      if (this.realtime.applyCommittedSnapshotWithinQueue) {
        await this.realtime.applyCommittedSnapshotWithinQueue(input.boardId, saved.tldrawSnapshot)
      } else {
        await this.realtime.applyCommittedSnapshot(input.boardId, saved.tldrawSnapshot)
      }
    }
    return { snapshot: saved.tldrawSnapshot, revision: saved.revision, result: mutation.result }
  }
}
