import { describe, expect, it, vi } from 'vitest'

import { BoardDeletionCoordinator } from './board-deletion-coordinator.js'
import { BoardOperationQueue } from './board-operation-queue.js'

describe('BoardDeletionCoordinator', () => {
  it('waits for queued board work, deletes, then closes the room without persisting it again', async () => {
    const queue = new BoardOperationQueue()
    const events: string[] = []
    let release!: () => void
    const pending = queue.run('b', async () => {
      events.push('pending:start')
      await new Promise<void>((resolve) => { release = resolve })
      events.push('pending:end')
    })
    const closer = {
      closeBoardWithinQueue: vi.fn(async () => { events.push('room:close') }),
    }
    const coordinator = new BoardDeletionCoordinator(queue, closer)

    const deletion = coordinator.deleteBoard('b', () => {
      events.push('board:delete')
      return true
    })
    await Promise.resolve()
    expect(events).toEqual(['pending:start'])

    release()
    await Promise.all([pending, deletion])
    expect(events).toEqual(['pending:start', 'pending:end', 'board:delete', 'room:close'])
  })

  it('closes every project board room after the project is removed', async () => {
    const events: string[] = []
    const closer = {
      closeBoardWithinQueue: vi.fn(async (boardId: string) => { events.push(`close:${boardId}`) }),
    }
    const coordinator = new BoardDeletionCoordinator(new BoardOperationQueue(), closer)

    await coordinator.deleteProject(['b2', 'b1'], () => {
      events.push('project:delete')
      return true
    })

    expect(events).toEqual(['project:delete', 'close:b2', 'close:b1'])
  })
})
