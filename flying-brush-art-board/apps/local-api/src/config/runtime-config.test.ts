import { describe, expect, it } from 'vitest'

import { loadRuntimeConfig } from './runtime-config.js'

const valid = {
  FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: 'x'.repeat(32),
}

describe('loadRuntimeConfig', () => {
  it('loads authentication secrets without a fixed application origin', () => expect(loadRuntimeConfig(valid)).toMatchObject({ feishu: { appId: 'app' }, auditRetentionDays: 80 }))
  it('rejects missing secrets and invalid retention', () => {
    expect(() => loadRuntimeConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow('SESSION_SECRET')
    expect(() => loadRuntimeConfig({ ...valid, AUDIT_RETENTION_DAYS: '0' })).toThrow('AUDIT_RETENTION_DAYS')
  })
})
