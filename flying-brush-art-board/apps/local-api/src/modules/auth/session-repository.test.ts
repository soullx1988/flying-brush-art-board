import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../db/schema.js'
import { SessionRepository } from './session-repository.js'

describe('SessionRepository', () => {
  it('stores only a hash of a 32-byte opaque session token', () => {
    const db = createDatabase(':memory:')
    try {
      const token = new SessionRepository(db, () => new Date('2026-07-23T00:00:00.000Z')).create({ openId: 'o', name: 'N' })
      expect(Buffer.from(token, 'base64url')).toHaveLength(32)
      const row = db.prepare('SELECT session_hash, expires_at, absolute_expires_at FROM app_sessions').get() as { session_hash: string; expires_at: string; absolute_expires_at: string }
      expect(row.session_hash).not.toContain(token)
      expect(row.expires_at).toBe('2026-07-23T12:00:00.000Z')
      expect(row.absolute_expires_at).toBe('2026-07-30T00:00:00.000Z')
    } finally { db.close() }
  })

  it('slides idle expiry without exceeding absolute expiry and revokes expired sessions', () => {
    const db = createDatabase(':memory:')
    let time = new Date('2026-07-23T00:00:00.000Z')
    try {
      const sessions = new SessionRepository(db, () => time)
      const token = sessions.create({ openId: 'o', name: 'N' })
      time = new Date('2026-07-23T06:00:00.000Z')
      expect(sessions.findAndRefresh(token)).toMatchObject({ openId: 'o' })
      expect(db.prepare('SELECT expires_at FROM app_sessions').get()).toMatchObject({ expires_at: '2026-07-23T18:00:00.000Z' })
      time = new Date('2026-07-30T00:00:00.000Z')
      expect(sessions.findAndRefresh(token)).toBeUndefined()
      expect(db.prepare('SELECT 1 FROM app_sessions').get()).toBeUndefined()
    } finally { db.close() }
  })
})
