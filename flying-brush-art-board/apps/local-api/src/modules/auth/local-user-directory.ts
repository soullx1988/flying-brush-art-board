import type { LocalDatabase } from '../../db/schema.js'
import { UserNotAllowedError, type AllowedUser, type AllowedUserDirectory } from './allowed-user-directory.js'
import type { FeishuLoginIdentity } from './feishu-oauth-provider.js'

export class LocalUserDirectory implements AllowedUserDirectory {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now = () => new Date(),
    private readonly allowedOpenIds?: ReadonlySet<string>,
  ) {}

  recordLogin(identity: FeishuLoginIdentity): AllowedUser {
    if (this.allowedOpenIds && !this.allowedOpenIds.has(identity.openId)) throw new UserNotAllowedError()
    const timestamp = this.now().toISOString()
    const name = identity.name?.trim() || identity.openId
    this.database.prepare(`
      INSERT INTO app_users(open_id,union_id,user_id,name,en_name,avatar_url,tenant_key,created_at,updated_at,last_login_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(open_id) DO UPDATE SET
        union_id=excluded.union_id,
        user_id=excluded.user_id,
        name=excluded.name,
        en_name=excluded.en_name,
        avatar_url=excluded.avatar_url,
        tenant_key=excluded.tenant_key,
        updated_at=excluded.updated_at,
        last_login_at=excluded.last_login_at
    `).run(
      identity.openId,
      identity.unionId ?? null,
      identity.userId ?? null,
      name,
      identity.enName ?? null,
      identity.avatarUrl ?? null,
      identity.tenantKey ?? null,
      timestamp,
      timestamp,
      timestamp,
    )
    return { openId: identity.openId, name }
  }

  async findByOpenId(openId: string): Promise<AllowedUser | undefined> {
    if (this.allowedOpenIds && !this.allowedOpenIds.has(openId)) return undefined
    const row = this.database.prepare('SELECT open_id, name FROM app_users WHERE open_id=?').get(openId) as {
      open_id: string
      name: string
    } | undefined
    return row ? { openId: row.open_id, name: row.name } : undefined
  }

  async checkHealth(): Promise<'ok' | 'error'> {
    const row = this.database.prepare('SELECT 1 AS value').get() as { value?: number }
    return row.value === 1 ? 'ok' : 'error'
  }

  async close(): Promise<void> {}
}
