import { BoardOperationQueue } from './board-operation-queue.js'

export interface BoardRoomCloser {
  closeBoardWithinQueue(boardId: string): Promise<void>
}

/** Closes realtime rooms and performs deletion while all affected board queues are locked. */
export class BoardDeletionCoordinator {
  constructor(
    private readonly operationQueue: BoardOperationQueue,
    private readonly realtime?: BoardRoomCloser,
  ) {}

  deleteBoard<T>(boardId: string, remove: () => Promise<T> | T): Promise<T> {
    return this.withBoardLocks([boardId], async () => {
      const result = await remove()
      await this.realtime?.closeBoardWithinQueue(boardId)
      return result
    })
  }

  deleteProject<T>(boardIds: readonly string[], remove: () => Promise<T> | T): Promise<T> {
    return this.withBoardLocks(boardIds, async () => {
      const result = await remove()
      for (const boardId of boardIds) await this.realtime?.closeBoardWithinQueue(boardId)
      return result
    })
  }

  private withBoardLocks<T>(boardIds: readonly string[], operation: () => Promise<T> | T): Promise<T> {
    const orderedIds = [...new Set(boardIds)].sort()
    const acquire = (index: number): Promise<T> => {
      const boardId = orderedIds[index]
      if (!boardId) return Promise.resolve().then(operation)
      return this.operationQueue.run(boardId, () => acquire(index + 1))
    }
    return acquire(0)
  }
}
