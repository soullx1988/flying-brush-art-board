import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../db/schema.js'
import { OAuthStateRepository } from './oauth-state-repository.js'
describe('OAuthStateRepository', () => {
  it('uses hashed one-time state, encrypted verifier, and binds the dynamic callback', () => { const db = createDatabase(':memory:'); try { const r = new OAuthStateRepository(db, () => new Date('2026-07-23T00:00:00Z'), 'a sufficiently long state encryption secret'); r.create('state', 'verifier', '/projects/p', 'http://192.168.65.48:4173/auth/feishu/callback'); const row = db.prepare('SELECT state_hash, verifier_ciphertext FROM oauth_states').get() as { state_hash: string; verifier_ciphertext: string }; expect(row.state_hash).not.toBe('state'); expect(row.verifier_ciphertext).not.toContain('verifier'); expect(r.consume('state')).toEqual({ verifier: 'verifier', returnTo: '/projects/p', redirectUri: 'http://192.168.65.48:4173/auth/feishu/callback' }); expect(r.consume('state')).toBeUndefined(); expect(() => r.create('x', 'v', 'https://evil', 'http://board.test/auth/feishu/callback')).toThrow('Invalid'); expect(() => r.create('x', 'v', '/', 'ftp://board.test/auth/feishu/callback')).toThrow('Invalid') } finally { db.close() } })

  it('rejects expired and tampered state records while consuming them', () => {
    const db = createDatabase(':memory:')
    let now = new Date('2026-07-23T00:00:00.000Z')
    try {
      const repository = new OAuthStateRepository(db, () => now, 'a sufficiently long state encryption secret')
      repository.create('expired', 'verifier', '/', 'http://board.test/auth/feishu/callback')
      now = new Date('2026-07-23T00:10:00.000Z')
      expect(repository.consume('expired')).toBeUndefined()
      expect(db.prepare('SELECT 1 FROM oauth_states').get()).toBeUndefined()
      now = new Date('2026-07-23T00:00:00.000Z')
      repository.create('tampered', 'verifier', '/', 'http://board.test/auth/feishu/callback')
      db.prepare("UPDATE oauth_states SET verifier_ciphertext='v1.invalid.invalid.invalid'").run()
      expect(repository.consume('tampered')).toBeUndefined()
    } finally { db.close() }
  })
})
