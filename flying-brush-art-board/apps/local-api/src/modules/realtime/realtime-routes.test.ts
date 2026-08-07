import { describe, expect, it } from 'vitest'

import { createBoardStore } from '@infinite-board/tldraw-adapter'

import { roomSnapshotToBoardSnapshot } from './realtime-routes.js'

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
