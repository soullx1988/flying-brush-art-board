import { describe, expect, it } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { RealtimeRoomRepository } from './realtime-room-repository.js'

describe('RealtimeRoomRepository', () => {
  it('persists ordered updates and atomically compacts them into a restart snapshot', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const rooms = new RealtimeRoomRepository(db, () => new Date('2026-07-23T00:00:00.000Z'))
      rooms.saveSnapshot('b', { documents: [] })
      expect(rooms.appendUpdate('b', '{"op":1}', 'ou_1')).toMatchObject({ sequence: 1, actorOpenId: 'ou_1' })
      expect(rooms.appendUpdate('b', '{"op":2}', 'ou_2')).toMatchObject({ sequence: 2, actorOpenId: 'ou_2' })
      expect(rooms.loadSnapshot('b')).toMatchObject({ snapshot: { documents: [] }, updateCount: 2 })
      rooms.compact('b', { documents: [{ state: { id: 'shape:1' }, lastChangedClock: 1 }] })
      expect(rooms.listUpdates('b')).toEqual([])
      expect(rooms.loadSnapshot('b')).toMatchObject({ updateCount: 0, compactedAt: '2026-07-23T00:00:00.000Z', snapshot: { documents: [{ state: { id: 'shape:1' }, lastChangedClock: 1 }] } })
    } finally { db.close() }
  })
})
