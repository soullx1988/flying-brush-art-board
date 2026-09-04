import type { LocalDatabase } from '../../db/schema.js'

export interface RealtimeRoomSnapshot {
  boardId: string
  roomVersion: number
  snapshot: unknown
  updateCount: number
  boardRevision?: number
  compactedAt?: string
  updatedAt: string
}

export interface RealtimeRoomUpdate {
  boardId: string
  sequence: number
  payload: string
  actorOpenId: string
  createdAt: string
}

function parseSnapshot(value: string): unknown {
  return JSON.parse(value) as unknown
}

export class RealtimeRoomRepository {
  constructor(private readonly db: LocalDatabase, private readonly now = () => new Date()) {}

  loadSnapshot(boardId: string): RealtimeRoomSnapshot | undefined {
    const row = this.db.prepare('SELECT board_id, room_version, snapshot_json, update_count, board_revision, compacted_at, updated_at FROM realtime_room_snapshots WHERE board_id=?').get(boardId) as {
      board_id: string; room_version: number; snapshot_json: string; update_count: number; board_revision: number | null; compacted_at: string | null; updated_at: string
    } | undefined
    return row ? {
      boardId: row.board_id,
      roomVersion: row.room_version,
      snapshot: parseSnapshot(row.snapshot_json),
      updateCount: row.update_count,
      ...(row.board_revision === null ? {} : { boardRevision: row.board_revision }),
      ...(row.compacted_at ? { compactedAt: row.compacted_at } : {}),
      updatedAt: row.updated_at,
    } : undefined
  }

  listUpdates(boardId: string): RealtimeRoomUpdate[] {
    return (this.db.prepare('SELECT board_id, sequence, payload, actor_open_id, created_at FROM realtime_room_updates WHERE board_id=? ORDER BY sequence').all(boardId) as Array<{
      board_id: string; sequence: number; payload: string; actor_open_id: string; created_at: string
    }>).map((row) => ({ boardId: row.board_id, sequence: row.sequence, payload: row.payload, actorOpenId: row.actor_open_id, createdAt: row.created_at }))
  }

  appendUpdate(boardId: string, payload: string, actorOpenId: string): RealtimeRoomUpdate {
    const time = this.now().toISOString()
    const append = this.db.transaction(() => {
      const sequence = ((this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM realtime_room_updates WHERE board_id=?').get(boardId) as { value: number }).value) + 1
      this.db.prepare('INSERT INTO realtime_room_updates(board_id, sequence, payload, actor_open_id, created_at) VALUES (?,?,?,?,?)').run(boardId, sequence, payload, actorOpenId, time)
      this.db.prepare('UPDATE realtime_room_snapshots SET update_count=update_count+1, updated_at=? WHERE board_id=?').run(time, boardId)
      return { boardId, sequence, payload, actorOpenId, createdAt: time }
    })
    return append()
  }

  saveSnapshot(boardId: string, snapshot: unknown, roomVersion = 1, boardRevision?: number): void {
    const time = this.now().toISOString()
    this.db.prepare(`INSERT INTO realtime_room_snapshots(board_id, room_version, snapshot_json, update_count, board_revision, compacted_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(board_id) DO UPDATE SET room_version=excluded.room_version, snapshot_json=excluded.snapshot_json, board_revision=excluded.board_revision, updated_at=excluded.updated_at`).run(boardId, roomVersion, JSON.stringify(snapshot), 0, boardRevision ?? null, null, time)
  }

  compact(boardId: string, snapshot: unknown, roomVersion = 1, boardRevision?: number): void {
    const time = this.now().toISOString()
    const compact = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO realtime_room_snapshots(board_id, room_version, snapshot_json, update_count, board_revision, compacted_at, updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(board_id) DO UPDATE SET room_version=excluded.room_version, snapshot_json=excluded.snapshot_json, update_count=0, board_revision=excluded.board_revision, compacted_at=excluded.compacted_at, updated_at=excluded.updated_at`).run(boardId, roomVersion, JSON.stringify(snapshot), 0, boardRevision ?? null, time, time)
      this.db.prepare('DELETE FROM realtime_room_updates WHERE board_id=?').run(boardId)
    })
    compact()
  }

  markBoardRevision(boardId: string, boardRevision: number): void {
    this.db.prepare('UPDATE realtime_room_snapshots SET board_revision=? WHERE board_id=?')
      .run(boardRevision, boardId)
  }
}
