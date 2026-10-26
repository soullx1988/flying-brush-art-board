import { describe, expect, it } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { CommentRepository } from './comment-repository.js'

describe('CommentRepository', () => {
  it('creates anchored threads, replies, resolves, and deletes a whole thread with its messages', () => {
    const db = createDatabase(':memory:')
    try {
      db.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
      const comments = new CommentRepository(db, () => new Date('2026-07-24T00:00:00.000Z'))
      const created = comments.createThread({ projectId: 'p', boardId: 'b', shapeId: 'shape:1', x: 10, y: 20, shapeOffsetX: 3, shapeOffsetY: 4, authorOpenId: 'ou_1', body: 'Review this' })
      expect(created.thread).toMatchObject({ status: 'open', shapeId: 'shape:1', x: 10, y: 20, shapeOffsetX: 3, shapeOffsetY: 4 })
      const reply = comments.addMessage(created.thread.id, 'ou_2', 'Looks good')!
      expect(comments.listMessages(created.thread.id)).toHaveLength(2)
      expect(comments.listBoardMessages('b')).toHaveLength(2)
      expect(comments.setStatus(created.thread.id, 'resolved')).toMatchObject({ status: 'resolved' })
      expect(comments.updateAnchor(created.thread.id, { x: 30, y: 40 })).toMatchObject({ x: 30, y: 40 })
      expect(comments.getThread(created.thread.id)).not.toHaveProperty('shapeId')
      expect(comments.getThread(created.thread.id)).not.toHaveProperty('shapeOffsetX')
      expect(comments.deleteMessage(reply.id, 'ou_1')).toBe(false)
      expect(comments.deleteMessage(reply.id, 'ou_2')).toBe(true)
      expect(comments.listMessages(created.thread.id)[1]).toMatchObject({ deletedAt: '2026-07-24T00:00:00.000Z' })
      expect(comments.deleteThread(created.thread.id)).toBe(true)
      expect(comments.getThread(created.thread.id)).toBeUndefined()
      expect(comments.listMessages(created.thread.id)).toEqual([])
      expect(comments.deleteThread(created.thread.id)).toBe(false)
    } finally { db.close() }
  })
})
