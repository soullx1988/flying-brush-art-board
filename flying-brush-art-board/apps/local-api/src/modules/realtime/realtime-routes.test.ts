import { describe, expect, it } from 'vitest'

import {
  UnknownSnapshotRecordError,
  createBoardStore,
  getStoreSnapshot,
} from '@infinite-board/tldraw-adapter'

import {
  realtimeConnectionCloseForError,
  roomSnapshotToBoardSnapshot,
} from './realtime-routes.js'
import { tldrawRealtimeRoomFactory } from './tldraw-realtime-room-factory.js'

describe('roomSnapshotToBoardSnapshot', () => {
  it('keeps durable Board records and excludes sync-only presence records and schema clocks', () => {
    expect(roomSnapshotToBoardSnapshot({
      schema: { schemaVersion: 2 },
      documents: [
        { state: { id: 'document:document', typeName: 'document' } },
        { state: { id: 'shape:one', typeName: 'shape', type: 'geo' } },
        { state: { id: 'instance_presence:one', typeName: 'instance_presence' } },
      ],
    })).toEqual({
      store: {
        'document:document': { id: 'document:document', typeName: 'document' },
        'shape:one': { id: 'shape:one', typeName: 'shape', type: 'geo' },
      },
      schema: createBoardStore().schema.serialize(),
    })
  })
})

describe('realtimeConnectionCloseForError', () => {
  it('does not disguise an unsupported Board snapshot as a missing Board', () => {
    expect(realtimeConnectionCloseForError(
      new UnknownSnapshotRecordError('shape:alien'),
    )).toEqual({ code: 4409, reason: 'BOARD_SNAPSHOT_UNSUPPORTED' })
  })

  it('maps the actual room-factory failure for an unknown shape to snapshot unsupported', () => {
    const snapshot = getStoreSnapshot(createBoardStore()) as {
      store: Record<string, unknown>
    }
    snapshot.store['shape:alien'] = {
      id: 'shape:alien', typeName: 'shape', type: 'alien-widget',
    }
    let failure: unknown

    try {
      tldrawRealtimeRoomFactory.create({
        boardId: 'poisoned-board',
        initialSnapshot: snapshot,
        onDataChange() {},
        onMessage() {},
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(UnknownSnapshotRecordError)
    expect(realtimeConnectionCloseForError(failure))
      .toEqual({ code: 4409, reason: 'BOARD_SNAPSHOT_UNSUPPORTED' })
  })

  it('preserves missing Board and unexpected initialization errors separately', () => {
    expect(realtimeConnectionCloseForError(new Error('BOARD_NOT_FOUND')))
      .toEqual({ code: 4404, reason: 'BOARD_NOT_FOUND' })
    expect(realtimeConnectionCloseForError(new Error('boom')))
      .toEqual({ code: 1011, reason: 'REALTIME_INITIALIZATION_FAILED' })
  })
})
