import { describe, expect, it } from 'vitest'

import { createDatabase } from '../../db/schema.js'
import { LocalUserDirectory } from './local-user-directory.js'
import { UserNotAllowedError } from './allowed-user-directory.js'

describe('LocalUserDirectory', () => {
  it('records useful Feishu identity fields and refreshes the last login time', async () => {
    const database = createDatabase(':memory:')
    let now = new Date('2026-07-29T00:00:00.000Z')
    const directory = new LocalUserDirectory(database, () => now)

    expect(directory.recordLogin({
      openId: 'ou_local',
      unionId: 'on_union',
      userId: 'user_1',
      name: '测试用户',
      enName: 'Test User',
      avatarUrl: 'https://example.test/avatar.png',
      tenantKey: 'tenant_1',
    })).toEqual({ openId: 'ou_local', name: '测试用户' })
    expect(await directory.findByOpenId('ou_local')).toEqual({ openId: 'ou_local', name: '测试用户' })

    now = new Date('2026-07-29T01:00:00.000Z')
    directory.recordLogin({ openId: 'ou_local', name: '新名称' })
    expect(database.prepare('SELECT name, union_id, last_login_at FROM app_users WHERE open_id=?').get('ou_local')).toEqual({
      name: '新名称',
      union_id: null,
      last_login_at: '2026-07-29T01:00:00.000Z',
    })
    database.close()
  })

  it('rejects an unlisted first login before persisting identity and hides a removed identity', async () => {
    const database = createDatabase(':memory:')
    const unrestricted = new LocalUserDirectory(database)
    unrestricted.recordLogin({ openId: 'ou_removed', name: '已移除用户' })

    const restricted = new LocalUserDirectory(database, () => new Date(), new Set(['ou_owner']))
    expect(() => restricted.recordLogin({ openId: 'ou_unknown', name: '陌生用户' })).toThrow(UserNotAllowedError)
    expect(database.prepare('SELECT COUNT(*) AS count FROM app_users WHERE open_id=?').get('ou_unknown')).toEqual({ count: 0 })
    expect(await restricted.findByOpenId('ou_removed')).toBeUndefined()
    database.close()
  })
})
