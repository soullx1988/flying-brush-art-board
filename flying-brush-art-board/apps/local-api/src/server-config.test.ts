import { describe, expect, it } from 'vitest'

import { resolveFeishuOAuthConfig } from './server-config.js'

describe('resolveFeishuOAuthConfig', () => {
  it('keeps the mock provider when ambient credentials exist without the explicit real smoke gate', () => {
    expect(resolveFeishuOAuthConfig({
      FEISHU_APP_ID: 'ambient-app-id',
      FEISHU_APP_SECRET: 'ambient-app-secret',
    })).toBeUndefined()
  })

  it('enables the real provider only when the explicit gate and both credentials are present', () => {
    expect(resolveFeishuOAuthConfig({
      FEISHU_REAL_SMOKE: '1',
      FEISHU_APP_ID: 'local-app-id',
      FEISHU_APP_SECRET: 'local-app-secret',
    })).toEqual({ clientId: 'local-app-id', clientSecret: 'local-app-secret' })

    expect(resolveFeishuOAuthConfig({ FEISHU_REAL_SMOKE: '1', FEISHU_APP_ID: 'incomplete' })).toBeUndefined()
  })
})
