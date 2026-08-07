import { randomUUID } from 'node:crypto'

import type { LocalDatabase } from '../../db/schema.js'

export interface AuditEvent {
  id: string
  actorOpenId: string
  projectId?: string
  boardId?: string
  action: string
  summary: Record<string, unknown>
  createdAt: string
}

export interface AuditListQuery {
  projectId?: string
  boardId?: string
  actorOpenId?: string
  action?: string
  startAt?: string
  endAt?: string
  cursor?: string
  limit?: number
}

export interface AuditListPage {
  events: AuditEvent[]
  nextCursor?: string
}

interface AuditCursor { createdAt: string; id: string }

function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(cursor: string | undefined): AuditCursor | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<AuditCursor>
    return typeof value.createdAt === 'string' && typeof value.id === 'string' ? { createdAt: value.createdAt, id: value.id } : undefined
  } catch { return undefined }
}

export class AuditRepository {
  constructor(private readonly db: LocalDatabase, private readonly now = () => new Date()) {}

  record(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
    const event: AuditEvent = { id: randomUUID(), createdAt: this.now().toISOString(), ...input }
    this.db.prepare('INSERT INTO audit_events(id,actor_open_id,project_id,board_id,action,summary_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(event.id, event.actorOpenId, event.projectId ?? null, event.boardId ?? null, event.action, JSON.stringify(event.summary), event.createdAt)
    return event
  }

  pruneOlderThan(days: number): number {
    if (!Number.isInteger(days) || days < 1) throw new Error('AUDIT_RETENTION_DAYS_INVALID')
    const cutoff = new Date(this.now().getTime() - days * 86_400_000).toISOString()
    return this.db.prepare('DELETE FROM audit_events WHERE created_at < ?').run(cutoff).changes
  }

  list(projectId?: string, limit = 100): AuditEvent[] {
    const rows = projectId
      ? this.db.prepare('SELECT * FROM audit_events WHERE project_id=? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
      : this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?').all(limit)
    return (rows as Array<{ id: string; actor_open_id: string; project_id: string | null; board_id: string | null; action: string; summary_json: string; created_at: string }>).map((row) => ({
      id: row.id, actorOpenId: row.actor_open_id, ...(row.project_id ? { projectId: row.project_id } : {}), ...(row.board_id ? { boardId: row.board_id } : {}), action: row.action, summary: JSON.parse(row.summary_json) as Record<string, unknown>, createdAt: row.created_at,
    }))
  }

  listPage(query: AuditListQuery): AuditListPage {
    const limit = query.limit ?? 50
    const cursor = decodeCursor(query.cursor)
    const conditions: string[] = []
    const values: Record<string, unknown> = { limit: limit + 1 }
    for (const [column, value] of [
      ['project_id', query.projectId],
      ['board_id', query.boardId],
      ['actor_open_id', query.actorOpenId],
      ['action', query.action],
    ] as const) {
      if (value === undefined) continue
      const key = column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      conditions.push(`${column} = @${key}`)
      values[key] = value
    }
    if (cursor) {
      conditions.push('(created_at < @cursorCreatedAt OR (created_at = @cursorCreatedAt AND id < @cursorId))')
      values.cursorCreatedAt = cursor.createdAt
      values.cursorId = cursor.id
    }
    if (query.startAt) {
      conditions.push('created_at >= @startAt')
      values.startAt = query.startAt
    }
    if (query.endAt) {
      conditions.push('created_at <= @endAt')
      values.endAt = query.endAt
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC, id DESC LIMIT @limit`).all(values) as Array<{ id: string; actor_open_id: string; project_id: string | null; board_id: string | null; action: string; summary_json: string; created_at: string }>
    const pageRows = rows.slice(0, limit)
    const events = pageRows.map((row) => ({
      id: row.id, actorOpenId: row.actor_open_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.board_id ? { boardId: row.board_id } : {}),
      action: row.action,
      summary: JSON.parse(row.summary_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }))
    const last = events.at(-1)
    return {
      events,
      ...(rows.length > limit && last ? { nextCursor: encodeCursor({ createdAt: last.createdAt, id: last.id }) } : {}),
    }
  }
}
