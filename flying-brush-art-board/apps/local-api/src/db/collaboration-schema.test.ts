import { describe, expect, it } from 'vitest'
import { createDatabase } from './schema.js'

describe('collaboration schema', () => {
  it('creates rooms, comments, audit and token-free sessions', () => {
    const db = createDatabase(':memory:')
    try {
      for (const name of ['oauth_states', 'app_sessions', 'realtime_room_snapshots', 'realtime_room_updates', 'board_checkpoints', 'comment_threads', 'comment_messages', 'audit_events', 'mcp_oauth_clients', 'mcp_oauth_grants', 'mcp_oauth_codes', 'mcp_oauth_access_tokens', 'mcp_oauth_refresh_tokens', 'mcp_operations', 'mcp_confirmations']) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toEqual({ name })
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_access_tokens'").get()).toBeUndefined()
      const columns = db.prepare('PRAGMA table_info(app_sessions)').all() as Array<{ name: string }>
      expect(columns.map((row) => row.name)).not.toEqual(expect.arrayContaining(['access_token', 'refresh_token']))
      expect(() => db.prepare("INSERT INTO comment_threads(id,project_id,board_id,shape_id,x,y,status,created_by,created_at,updated_at) VALUES ('x','p','b',NULL,NULL,NULL,'invalid','u','t','t')").run()).toThrow()
    } finally { db.close() }
  })

  it('enforces room/comment constraints and keeps audits when a board is deleted', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec(`INSERT INTO projects VALUES ('p','Project','b',1,'t','t');
        INSERT INTO boards VALUES ('b','p','Board','{}',NULL,0,'t','t');
        INSERT INTO realtime_room_updates VALUES ('b',1,'{}','u','t');
        INSERT INTO comment_threads(id,project_id,board_id,shape_id,x,y,status,created_by,created_at,updated_at) VALUES ('c','p','b',NULL,1,2,'open','u','t','t');
        INSERT INTO audit_events VALUES ('a','u','p','b','board.delete','{}','t');`)
      expect(() => db.prepare("INSERT INTO realtime_room_updates VALUES ('b',1,'{}','u','t')").run()).toThrow()
      expect(() => db.prepare("UPDATE comment_threads SET status='invalid' WHERE id='c'").run()).toThrow()
      db.prepare("DELETE FROM boards WHERE id='b'").run()
      expect(db.prepare('SELECT * FROM realtime_room_updates').all()).toEqual([])
      expect(db.prepare('SELECT * FROM comment_threads').all()).toEqual([])
      expect(db.prepare('SELECT board_id FROM audit_events WHERE id=?').get('a')).toEqual({ board_id: 'b' })
    } finally { db.close() }
  })
})
