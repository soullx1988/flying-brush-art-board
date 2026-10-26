import { describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { RealtimeRoomManager, type RealtimeRoomFactory } from './realtime-room-manager.js'
import { RealtimeRoomRepository } from './realtime-room-repository.js'

describe('RealtimeRoomManager', () => {
  it('hydrates one room per board, persists updates, compacts, and releases idle rooms', async () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const repository = new RealtimeRoomRepository(db)
      repository.saveSnapshot('b', { documents: [{ state: { id: 'shape:old' }, lastChangedClock: 1 }] })
      let options!: Parameters<RealtimeRoomFactory['create']>[0]
      const room = {
        getCurrentSnapshot: vi.fn(() => ({ documents: [{ state: { id: 'shape:new' }, lastChangedClock: 2 }] })),
        getNumActiveSessions: vi.fn(() => 0),
        loadSnapshot: vi.fn(async () => undefined),
        handleSocketConnect: vi.fn(),
        handleSocketClose: vi.fn(),
      }
      const factory: RealtimeRoomFactory = { create(input) { options = input; return room } }
      const manager = new RealtimeRoomManager(repository, factory, (boardId) => boardId === 'b', 1)
      const connection = manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      expect(options.initialSnapshot).toEqual({ documents: [{ state: { id: 'shape:old' }, lastChangedClock: 1 }] })
      expect(room.handleSocketConnect).toHaveBeenCalledWith(expect.objectContaining({ sessionId: connection.sessionId, isReadonly: false, meta: { openId: 'ou_1', name: 'Ada' } }))
      options.onMessage('{"op":"put"}', 'ou_1')
      options.onDataChange()
      expect(repository.listUpdates('b')).toEqual([])
      expect(repository.loadSnapshot('b')).toMatchObject({ updateCount: 0, snapshot: { documents: [{ state: { id: 'shape:new' }, lastChangedClock: 2 }] } })
      connection.disconnect()
      expect(room.handleSocketClose).toHaveBeenCalledWith(connection.sessionId)
      await manager.closeIdleRooms()
      expect(manager.getActiveRoomCount()).toBe(0)
    } finally { db.close() }
  })

  it('does not create rooms for a deleted or unknown board', () => {
    const repository = new RealtimeRoomRepository(createDatabase(':memory:'))
    const manager = new RealtimeRoomManager(repository, { create: () => { throw new Error('unreachable') } }, () => false)
    expect(() => manager.connect({ boardId: 'missing', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })).toThrow('BOARD_NOT_FOUND')
  })

  it('seeds a new room from the persisted Board snapshot when no realtime snapshot exists', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      let options!: Parameters<RealtimeRoomFactory['create']>[0]
      const room = { getCurrentSnapshot: () => ({}), getNumActiveSessions: () => 0, async loadSnapshot() {}, handleSocketConnect() {}, handleSocketClose() {} }
      const manager = new RealtimeRoomManager(
        new RealtimeRoomRepository(db),
        { create(input) { options = input; return room } },
        () => true,
        500,
        () => ({ store: { 'shape:seed': { id: 'shape:seed' } } }),
      )
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      expect(options.initialSnapshot).toEqual({ store: { 'shape:seed': { id: 'shape:seed' } } })
    } finally { db.close() }
  })

  it('broadcasts committed structured snapshots to a live room and persists them', async () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const room = { getCurrentSnapshot: () => ({}), getNumActiveSessions: () => 1, loadSnapshot: vi.fn(async () => undefined), handleSocketConnect() {}, handleSocketClose() {} }
      const manager = new RealtimeRoomManager(new RealtimeRoomRepository(db), { create: () => room }, () => true)
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      const snapshot = { documents: [{ state: { id: 'shape:reference' }, lastChangedClock: 1 }] }
      await manager.applyCommittedSnapshot('b', snapshot)
      expect(room.loadSnapshot).toHaveBeenCalledWith(snapshot)
      expect(new RealtimeRoomRepository(db).loadSnapshot('b')).toMatchObject({ snapshot: room.getCurrentSnapshot() })
    } finally { db.close() }
  })

  it('materializes document changes without treating a server command broadcast as another edit', async () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      let options!: Parameters<RealtimeRoomFactory['create']>[0]
      const materialized = vi.fn()
      const room = {
        getCurrentSnapshot: () => ({ documents: [{ state: { id: 'shape:one', typeName: 'shape' }, lastChangedClock: 1 }] }),
        getNumActiveSessions: () => 1,
        loadSnapshot: vi.fn(async () => undefined), handleSocketConnect() {}, handleSocketClose() {},
      }
      const manager = new RealtimeRoomManager(
        new RealtimeRoomRepository(db),
        { create(input) { options = input; return room } },
        () => true,
        500,
        () => undefined,
        materialized,
      )
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      options.onDataChange()
      expect(materialized).toHaveBeenCalledWith('b', room.getCurrentSnapshot())

      await manager.applyCommittedSnapshot('b', { store: { 'shape:command': { id: 'shape:command' } } })
      expect(materialized).toHaveBeenCalledTimes(1)
    } finally { db.close() }
  })

  it('rejects an invalid room snapshot before persistence and restores the authoritative Board', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const repository = new RealtimeRoomRepository(db)
      repository.saveSnapshot('b', { store: { valid: true } })
      let options!: Parameters<RealtimeRoomFactory['create']>[0]
      const room = {
        getCurrentSnapshot: () => ({ store: { invalid: true } }),
        getNumActiveSessions: () => 1,
        loadSnapshot: vi.fn(async () => undefined),
        handleSocketConnect() {}, handleSocketClose() {},
      }
      const manager = new RealtimeRoomManager(
        repository,
        { create(input) { options = input; return room } },
        () => true,
        500,
        () => ({ store: { authoritative: true } }),
        () => undefined,
        () => { throw new Error('BOARD_REFERENCE_COMMAND_REQUIRED') },
      )
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      options.onMessage('{"op":"invalid-reference-change"}', 'ou_1')
      options.onDataChange()

      expect(repository.loadSnapshot('b')?.snapshot).toEqual({ store: { valid: true } })
      expect(repository.listUpdates('b')).toEqual([])
      expect(room.loadSnapshot).toHaveBeenCalledWith({ store: { authoritative: true } })
    } finally { db.close() }
  })

  it('keeps a valid collaborative edit in memory when SQLite persistence fails and retries it later', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const repository = new RealtimeRoomRepository(db)
      repository.saveSnapshot('b', { store: { old: true } })
      const saveSnapshot = vi.spyOn(repository, 'saveSnapshot')
      saveSnapshot.mockImplementationOnce(() => { throw new Error('SQLITE_BUSY') })
      let options!: Parameters<RealtimeRoomFactory['create']>[0]
      const room = {
        getCurrentSnapshot: () => ({ store: { validEdit: true } }),
        getNumActiveSessions: () => 1,
        loadSnapshot: vi.fn(async () => undefined),
        handleSocketConnect() {}, handleSocketClose() {},
      }
      const manager = new RealtimeRoomManager(
        repository,
        { create(input) { options = input; return room } },
        () => true,
        500,
        () => ({ store: { authoritative: true } }),
      )
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      options.onMessage('{"op":"put"}', 'ou_1')
      options.onDataChange()

      expect(room.loadSnapshot).not.toHaveBeenCalled()
      expect(repository.loadSnapshot('b')?.snapshot).toEqual({ store: { old: true } })
      expect(repository.listUpdates('b')).toEqual([])

      options.onDataChange()
      expect(repository.loadSnapshot('b')?.snapshot).toEqual({ store: { validEdit: true } })
      expect(repository.listUpdates('b')).toEqual([
        expect.objectContaining({ payload: '{"op":"put"}', actorOpenId: 'ou_1' }),
      ])
    } finally { db.close() }
  })

  it('does not evict an idle room when its durable snapshot cannot be written', async () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const repository = new RealtimeRoomRepository(db)
      vi.spyOn(repository, 'compact').mockImplementationOnce(() => { throw new Error('SQLITE_BUSY') })
      const room = {
        getCurrentSnapshot: () => ({ store: { validEdit: true } }),
        getNumActiveSessions: () => 0,
        async loadSnapshot() {}, handleSocketConnect() {}, handleSocketClose() {},
      }
      const manager = new RealtimeRoomManager(repository, { create: () => room }, () => true)
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })

      await manager.closeIdleRooms()
      expect(manager.getActiveRoomCount()).toBe(1)
      await manager.closeIdleRooms()
      expect(manager.getActiveRoomCount()).toBe(0)
    } finally { db.close() }
  })

  it('retries a failed Board projection before evicting an idle room', async () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      let options!: Parameters<RealtimeRoomFactory['create']>[0]
      const materialized = vi.fn(() => {
        if (materialized.mock.calls.length === 1) throw new Error('SQLITE_BUSY')
      })
      const room = {
        getCurrentSnapshot: () => ({ store: { validEdit: true } }),
        getNumActiveSessions: () => 0,
        async loadSnapshot() {},
        handleSocketConnect() {},
        handleSocketClose() {},
        close: vi.fn(),
      }
      const manager = new RealtimeRoomManager(
        new RealtimeRoomRepository(db),
        { create(input) { options = input; return room } },
        () => true,
        500,
        () => ({ store: { authoritative: true } }),
        materialized,
      )
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })
      options.onDataChange()
      expect(materialized).toHaveBeenCalledOnce()

      await manager.closeIdleRooms()
      expect(materialized).toHaveBeenCalledTimes(2)
      expect(manager.getActiveRoomCount()).toBe(0)
      expect(room.close).toHaveBeenCalledOnce()
    } finally { db.close() }
  })

  it('closes and removes a board room when the board is deleted', async () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const room = {
        getCurrentSnapshot: () => ({ store: { validEdit: true } }),
        getNumActiveSessions: () => 1,
        async loadSnapshot() {},
        handleSocketConnect() {},
        handleSocketClose() {},
        close: vi.fn(),
      }
      const manager = new RealtimeRoomManager(new RealtimeRoomRepository(db), { create: () => room }, () => true)
      manager.connect({ boardId: 'b', socket: {}, user: { openId: 'ou_1', name: 'Ada' } })

      await manager.closeBoard('b')

      expect(room.close).toHaveBeenCalledOnce()
      expect(manager.getActiveRoomCount()).toBe(0)
    } finally { db.close() }
  })
})
