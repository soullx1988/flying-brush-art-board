import { randomUUID } from 'node:crypto'

import type { LocalDatabase } from '../../db/schema.js'

export type CommentThreadStatus = 'open' | 'resolved'

export interface CommentThread {
  id: string
  projectId: string
  boardId: string
  shapeId?: string
  x?: number
  y?: number
  shapeOffsetX?: number
  shapeOffsetY?: number
  status: CommentThreadStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CommentMessage {
  id: string
  threadId: string
  authorOpenId: string
  body: string
  createdAt: string
  deletedAt?: string
}

function thread(row: Record<string, unknown>): CommentThread {
  return {
    id: String(row.id), projectId: String(row.project_id), boardId: String(row.board_id),
    ...(typeof row.shape_id === 'string' ? { shapeId: row.shape_id } : {}),
    ...(typeof row.x === 'number' ? { x: row.x } : {}),
    ...(typeof row.y === 'number' ? { y: row.y } : {}),
    ...(typeof row.shape_offset_x === 'number' ? { shapeOffsetX: row.shape_offset_x } : {}),
    ...(typeof row.shape_offset_y === 'number' ? { shapeOffsetY: row.shape_offset_y } : {}),
    status: row.status as CommentThreadStatus, createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function message(row: Record<string, unknown>): CommentMessage {
  return {
    id: String(row.id), threadId: String(row.thread_id), authorOpenId: String(row.author_open_id), body: String(row.body), createdAt: String(row.created_at),
    ...(typeof row.deleted_at === 'string' ? { deletedAt: row.deleted_at } : {}),
  }
}

export class CommentRepository {
  constructor(private readonly db: LocalDatabase, private readonly now = () => new Date()) {}

  createThread(input: { projectId: string; boardId: string; shapeId?: string; x?: number; y?: number; shapeOffsetX?: number; shapeOffsetY?: number; authorOpenId: string; body: string }): { thread: CommentThread; message: CommentMessage } {
    const time = this.now().toISOString()
    const created = this.db.transaction(() => {
      const threadId = randomUUID()
      const messageId = randomUUID()
      this.db.prepare('INSERT INTO comment_threads(id,project_id,board_id,shape_id,x,y,status,created_by,created_at,updated_at,shape_offset_x,shape_offset_y) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(threadId, input.projectId, input.boardId, input.shapeId ?? null, input.x ?? null, input.y ?? null, 'open', input.authorOpenId, time, time, input.shapeOffsetX ?? null, input.shapeOffsetY ?? null)
      this.db.prepare('INSERT INTO comment_messages(id,thread_id,author_open_id,body,created_at,deleted_at) VALUES (?,?,?,?,?,NULL)')
        .run(messageId, threadId, input.authorOpenId, input.body, time)
      return { thread: this.getThread(threadId)!, message: this.getMessage(messageId)! }
    })
    return created()
  }

  getThread(id: string): CommentThread | undefined {
    const row = this.db.prepare('SELECT * FROM comment_threads WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? thread(row) : undefined
  }

  listThreads(boardId: string, status?: CommentThreadStatus): CommentThread[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM comment_threads WHERE board_id=? AND status=? ORDER BY updated_at DESC').all(boardId, status)
      : this.db.prepare('SELECT * FROM comment_threads WHERE board_id=? ORDER BY updated_at DESC').all(boardId)
    return (rows as Record<string, unknown>[]).map(thread)
  }

  listMessages(threadId: string): CommentMessage[] {
    return (this.db.prepare('SELECT * FROM comment_messages WHERE thread_id=? ORDER BY created_at').all(threadId) as Record<string, unknown>[]).map(message)
  }

  listBoardMessages(boardId: string): CommentMessage[] {
    return (this.db.prepare(`SELECT m.* FROM comment_messages m
      INNER JOIN comment_threads t ON t.id=m.thread_id
      WHERE t.board_id=? ORDER BY m.created_at, m.id`).all(boardId) as Record<string, unknown>[]).map(message)
  }

  getThreadByMessageId(messageId: string): CommentThread | undefined {
    const row = this.db.prepare(`SELECT t.* FROM comment_threads t
      INNER JOIN comment_messages m ON m.thread_id=t.id WHERE m.id=?`).get(messageId) as Record<string, unknown> | undefined
    return row ? thread(row) : undefined
  }

  addMessage(threadId: string, authorOpenId: string, body: string): CommentMessage | undefined {
    if (!this.getThread(threadId)) return undefined
    const time = this.now().toISOString()
    const id = randomUUID()
    const append = this.db.transaction(() => {
      this.db.prepare('INSERT INTO comment_messages(id,thread_id,author_open_id,body,created_at,deleted_at) VALUES (?,?,?,?,?,NULL)').run(id, threadId, authorOpenId, body, time)
      this.db.prepare('UPDATE comment_threads SET updated_at=? WHERE id=?').run(time, threadId)
      return this.getMessage(id)!
    })
    return append()
  }

  setStatus(threadId: string, status: CommentThreadStatus): CommentThread | undefined {
    const time = this.now().toISOString()
    const changed = this.db.prepare('UPDATE comment_threads SET status=?,updated_at=? WHERE id=?').run(status, time, threadId)
    return changed.changes > 0 ? this.getThread(threadId) : undefined
  }

  updateAnchor(threadId: string, anchor: { x: number; y: number }): CommentThread | undefined {
    const time = this.now().toISOString()
    const changed = this.db
      .prepare('UPDATE comment_threads SET shape_id=NULL,shape_offset_x=NULL,shape_offset_y=NULL,x=?,y=?,updated_at=? WHERE id=?')
      .run(anchor.x, anchor.y, time, threadId)
    return changed.changes > 0 ? this.getThread(threadId) : undefined
  }

  deleteThread(threadId: string): boolean {
    const changed = this.db.prepare('DELETE FROM comment_threads WHERE id=?').run(threadId)
    return changed.changes > 0
  }

  deleteMessage(messageId: string, authorOpenId: string): boolean {
    const time = this.now().toISOString()
    const changed = this.db.prepare('UPDATE comment_messages SET deleted_at=? WHERE id=? AND author_open_id=? AND deleted_at IS NULL').run(time, messageId, authorOpenId)
    return changed.changes > 0
  }

  private getMessage(id: string): CommentMessage | undefined {
    const row = this.db.prepare('SELECT * FROM comment_messages WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? message(row) : undefined
  }
}
