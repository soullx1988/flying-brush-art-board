import { createHash, randomBytes } from 'node:crypto'
import type { LocalDatabase } from '../../db/schema.js'
import type { AllowedUser } from './allowed-user-directory.js'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export interface SessionIdentity {
  openId: string
  name: string
  department?: string
  position?: string
}

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1_000
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1_000

export class SessionRepository {
  constructor(private readonly db: LocalDatabase, private readonly now = () => new Date()) {}
  create(user: AllowedUser): string {
    const token = randomBytes(32).toString('base64url')
    const time = this.now()
    const expires = new Date(time.getTime() + SESSION_IDLE_MS).toISOString()
    const absolute = new Date(time.getTime() + SESSION_ABSOLUTE_MS).toISOString()
    this.db.prepare('INSERT INTO app_sessions(session_hash,open_id,name,department,position,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(hash(token), user.openId, user.name, user.department ?? null, user.position ?? null, time.toISOString(), time.toISOString(), expires, absolute)
    return token
  }

  findAndRefresh(token: string): SessionIdentity | undefined {
    const sessionHash = hash(token)
    const row = this.db.prepare('SELECT open_id, name, department, position, expires_at, absolute_expires_at FROM app_sessions WHERE session_hash=?').get(sessionHash) as {
      open_id: string; name: string; department: string | null; position: string | null; expires_at: string; absolute_expires_at: string
    } | undefined
    if (!row) return undefined
    const now = this.now()
    const absolute = new Date(row.absolute_expires_at)
    if (new Date(row.expires_at) <= now || absolute <= now) {
      this.db.prepare('DELETE FROM app_sessions WHERE session_hash=?').run(sessionHash)
      return undefined
    }
    const refreshedExpiry = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absolute.getTime())).toISOString()
    this.db.prepare('UPDATE app_sessions SET last_seen_at=?, expires_at=? WHERE session_hash=?').run(now.toISOString(), refreshedExpiry, sessionHash)
    return { openId: row.open_id, name: row.name, ...(row.department ? { department: row.department } : {}), ...(row.position ? { position: row.position } : {}) }
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM app_sessions WHERE session_hash=?').run(hash(token))
  }
}
