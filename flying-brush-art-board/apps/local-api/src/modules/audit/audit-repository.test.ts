import { describe, expect, it } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { AuditRepository } from './audit-repository.js'

describe('AuditRepository', () => {
  it('stores only supplied redacted summaries and filters by project', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p1','P1','b1',1,'t','t'); INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p2','P2','b2',1,'t','t'); INSERT INTO boards VALUES ('b1','p1','B1','{}',NULL,0,'t','t'); INSERT INTO boards VALUES ('b2','p2','B2','{}',NULL,0,'t','t')")
      const audits = new AuditRepository(db, () => new Date('2026-07-24T00:00:00.000Z'))
      audits.record({ actorOpenId: 'ou_1', projectId: 'p1', boardId: 'b1', action: 'board.edit', summary: { route: '/api/boards/:boardId', statusCode: 200 } })
      audits.record({ actorOpenId: 'ou_2', projectId: 'p2', action: 'project.create', summary: { route: '/api/projects', statusCode: 201 } })
      expect(audits.list('p1')).toEqual([expect.objectContaining({ actorOpenId: 'ou_1', action: 'board.edit', summary: { route: '/api/boards/:boardId', statusCode: 200 } })])
    } finally { db.close() }
  })

  it('filters audit events and returns a stable opaque cursor page', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p1','P1','b1',1,'t','t'); INSERT INTO boards VALUES ('b1','p1','B1','{}',NULL,0,'t','t')")
      let tick = 0
      const audits = new AuditRepository(db, () => new Date(`2026-07-24T00:00:0${++tick}.000Z`))
      audits.record({ actorOpenId: 'ou_1', projectId: 'p1', boardId: 'b1', action: 'board.edit', summary: {} })
      audits.record({ actorOpenId: 'ou_2', projectId: 'p1', boardId: 'b1', action: 'board.rename', summary: {} })
      audits.record({ actorOpenId: 'ou_1', projectId: 'p1', boardId: 'b1', action: 'board.edit', summary: {} })

      const filtered = audits.listPage({ projectId: 'p1', boardId: 'b1', actorOpenId: 'ou_1', action: 'board.edit', limit: 1 })
      expect(filtered.events).toHaveLength(1)
      expect(filtered.events[0]).toMatchObject({ actorOpenId: 'ou_1', action: 'board.edit' })
      expect(filtered.nextCursor).toEqual(expect.any(String))
      expect(audits.listPage({ ...(filtered.nextCursor ? { cursor: filtered.nextCursor } : {}), limit: 1 }).events).toHaveLength(1)
    } finally { db.close() }
  })

  it('filters events by an inclusive date range', () => {
    const db = createDatabase(':memory:')
    try {
      let now = new Date('2026-07-23T12:00:00.000Z')
      const audits = new AuditRepository(db, () => now)
      audits.record({ actorOpenId: 'ou_1', action: 'project.create', summary: {} })
      now = new Date('2026-07-24T12:00:00.000Z')
      audits.record({ actorOpenId: 'ou_1', action: 'board.create', summary: {} })
      now = new Date('2026-07-25T12:00:00.000Z')
      audits.record({ actorOpenId: 'ou_1', action: 'board.edit', summary: {} })

      expect(audits.listPage({
        startAt: '2026-07-24T00:00:00.000Z',
        endAt: '2026-07-24T23:59:59.999Z',
        limit: 10,
      }).events).toEqual([expect.objectContaining({ action: 'board.create' })])
    } finally { db.close() }
  })

  it('removes audit events older than the configured retention period', () => {
    const db = createDatabase(':memory:')
    try {
      const audits = new AuditRepository(db, () => new Date('2026-07-24T00:00:00.000Z'))
      db.prepare("INSERT INTO audit_events(id,actor_open_id,project_id,board_id,action,summary_json,created_at) VALUES ('old','ou',NULL,NULL,'board.edit','{}','2026-05-04T00:00:00.000Z')").run()
      audits.record({ actorOpenId: 'ou', action: 'board.edit', summary: {} })
      expect(audits.pruneOlderThan(80)).toBe(1)
      expect(audits.list()).toHaveLength(1)
      expect(() => audits.pruneOlderThan(0)).toThrow('AUDIT_RETENTION_DAYS_INVALID')
    } finally { db.close() }
  })

  it('retains the logical Board id for events recorded after that Board was deleted', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','root',1,'t','t'); INSERT INTO boards VALUES ('root','p','Root','{}',NULL,0,'t','t'); INSERT INTO boards VALUES ('deleted','p','Deleted','{}',NULL,0,'t','t'); DELETE FROM boards WHERE id='deleted'")
      const audits = new AuditRepository(db)
      audits.record({ actorOpenId: 'ou_1', projectId: 'p', boardId: 'deleted', action: 'board.delete', summary: {} })
      expect(audits.list('p')).toEqual([
        expect.objectContaining({ projectId: 'p', boardId: 'deleted', action: 'board.delete' }),
      ])
    } finally { db.close() }
  })
})
