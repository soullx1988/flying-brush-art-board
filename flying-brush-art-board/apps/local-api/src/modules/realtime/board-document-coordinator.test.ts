import { describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import { BoardDocumentCoordinator } from './board-document-coordinator.js'

function setup() {
  const database = createDatabase(':memory:')
  database.exec("INSERT INTO projects VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{\"version\":0}',NULL,0,'t','t')")
  const realtime = { applyCommittedSnapshot: vi.fn() }
  return { database, realtime, coordinator: new BoardDocumentCoordinator(database, new BoardRepository(database), realtime) }
}

describe('BoardDocumentCoordinator', () => {
  it('checkpoints, serializes commands, saves a new revision, and broadcasts the authoritative snapshot', async () => {
    const { database, realtime, coordinator } = setup()
    try {
      const first = coordinator.runCommand({
        boardId: 'b', actorOpenId: 'ou_1', reason: 'reference-create',
        async mutate(snapshot) { return { snapshot: { ...(snapshot as { version: number }), version: 1 }, result: 'first' } },
      })
      const second = coordinator.runCommand({
        boardId: 'b', actorOpenId: 'ou_2', reason: 'clipboard-paste',
        async mutate(snapshot) { return { snapshot: { ...(snapshot as { version: number }), version: 2 }, result: 'second' } },
      })

      await expect(first).resolves.toMatchObject({ revision: 1, result: 'first', snapshot: { version: 1 } })
      await expect(second).resolves.toMatchObject({ revision: 2, result: 'second', snapshot: { version: 2 } })
      expect(realtime.applyCommittedSnapshot).toHaveBeenLastCalledWith('b', { version: 2 })
      expect(database.prepare('SELECT reason, actor_open_id FROM board_checkpoints ORDER BY rowid').all()).toEqual([
        { reason: 'reference-create', actor_open_id: 'ou_1' },
        { reason: 'clipboard-paste', actor_open_id: 'ou_2' },
      ])
    } finally { database.close() }
  })

  it('keeps the Board, room and checkpoints unchanged when a mutation rejects', async () => {
    const { database, realtime, coordinator } = setup()
    try {
      await expect(coordinator.runCommand({
        boardId: 'b', actorOpenId: 'ou_1', reason: 'reference-create',
        async mutate() { throw new Error('REFERENCE_TRANSACTION_FAILED') },
      })).rejects.toThrow('REFERENCE_TRANSACTION_FAILED')
      await expect(coordinator.read('b')).resolves.toEqual({ snapshot: { version: 0 }, revision: 0 })
      expect(realtime.applyCommittedSnapshot).not.toHaveBeenCalled()
      expect(database.prepare('SELECT count(*) AS count FROM board_checkpoints').get()).toEqual({ count: 0 })
    } finally { database.close() }
  })

  it('invalidates a stale structural command after a changed realtime projection', async () => {
    const { database, coordinator } = setup()
    try {
      new BoardRepository(database).saveRealtimeSnapshot('b', { version: 1 })

      await expect(coordinator.runCommand({
        boardId: 'b',
        actorOpenId: 'ou_1',
        reason: 'snapshot-save',
        expectedRevision: 0,
        async mutate() { return { snapshot: { version: 2 }, result: undefined } },
      })).rejects.toBeInstanceOf(RevisionConflictError)

      await expect(coordinator.runCommand({
        boardId: 'b',
        actorOpenId: 'ou_1',
        reason: 'snapshot-save',
        expectedRevision: 1,
        async mutate(snapshot) {
          expect(snapshot).toEqual({ version: 1 })
          return { snapshot: { version: 2 }, result: undefined }
        },
      })).resolves.toMatchObject({ snapshot: { version: 2 }, revision: 2 })

      await expect(coordinator.read('b')).resolves.toEqual({ snapshot: { version: 2 }, revision: 2 })
    } finally { database.close() }
  })

  it('returns the committed command result when realtime broadcasting fails', async () => {
    const { database, realtime, coordinator } = setup()
    try {
      realtime.applyCommittedSnapshot.mockRejectedValueOnce(new Error('ROOM_COMPACT_FAILED'))

      await expect(coordinator.runCommand({
        boardId: 'b', actorOpenId: 'ou_1', reason: 'clipboard-paste',
        async mutate() { return { snapshot: { version: 1 }, result: 'committed' } },
      })).resolves.toEqual({ snapshot: { version: 1 }, revision: 1, result: 'committed' })
      await expect(coordinator.read('b')).resolves.toEqual({ snapshot: { version: 1 }, revision: 1 })
    } finally { database.close() }
  })
})
