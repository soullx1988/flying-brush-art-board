import { describe, expect, it } from 'vitest'

import { loadRuntimeConfig } from './runtime-config.js'

const valid = {
  FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'secret',
  SESSION_SECRET: 'x'.repeat(32),
  LAN_ALLOWED_ORIGINS: 'https://board.example.test',
}

describe('loadRuntimeConfig', () => {
  it('loads authentication secrets without a fixed application origin', () => expect(loadRuntimeConfig(valid)).toMatchObject({ feishu: { appId: 'app' }, auditRetentionDays: 80 }))
  it('rejects missing secrets and invalid retention', () => {
    expect(() => loadRuntimeConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow('SESSION_SECRET')
    expect(() => loadRuntimeConfig({ ...valid, AUDIT_RETENTION_DAYS: '0' })).toThrow('AUDIT_RETENTION_DAYS')
    expect(() => loadRuntimeConfig({ ...valid, LAN_ALLOWED_ORIGINS: 'http://board.example.test' })).toThrow('LAN_ALLOWED_ORIGINS')
    expect(() => loadRuntimeConfig({ ...valid, LAN_ALLOWED_ORIGINS: 'https://*.example.test' })).toThrow('LAN_ALLOWED_ORIGINS')
    expect(() => loadRuntimeConfig({ ...valid, FEISHU_WHITELIST_ENABLED: 'true' })).toThrow('FEISHU_ALLOWED_OPEN_IDS')
  })
  it('loads an explicit Feishu open-id allowlist', () => {
    expect(loadRuntimeConfig({
      ...valid,
      FEISHU_WHITELIST_ENABLED: 'true',
      FEISHU_ALLOWED_OPEN_IDS: 'ou_owner, ou_reviewer,ou_owner',
    }).allowedOpenIds).toEqual(new Set(['ou_owner', 'ou_reviewer']))
  })
})
