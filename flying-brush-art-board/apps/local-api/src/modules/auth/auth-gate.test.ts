import { describe, expect, it } from 'vitest'

import { loadAuthGate } from './auth-gate.js'

describe('authentication gate', () => {
  it('uses the local acceptance user when Feishu authentication is disabled in development', () => {
    expect(loadAuthGate({
      NODE_ENV: 'development',
      FEISHU_AUTH_ENABLED: 'false',
      FEISHU_WHITELIST_ENABLED: 'false',
    })).toEqual({
      authenticationEnabled: false,
      whitelistEnabled: false,
      mode: 'development-bypass',
      localUser: {
        id: 'local-acceptance-user',
        name: 'Local acceptance user',
      },
    })
  })

  it('requires Feishu authentication before allowing application requests when enabled', () => {
    expect(loadAuthGate({
      NODE_ENV: 'development',
      FEISHU_AUTH_ENABLED: 'true',
      FEISHU_WHITELIST_ENABLED: 'true',
    })).toMatchObject({
      authenticationEnabled: true,
      whitelistEnabled: true,
      mode: 'feishu-login-required',
    })
  })

  it('rejects an allowlist without Feishu authentication', () => {
    expect(() => loadAuthGate({
      NODE_ENV: 'development',
      FEISHU_AUTH_ENABLED: 'false',
      FEISHU_WHITELIST_ENABLED: 'true',
    })).toThrow('FEISHU_WHITELIST_ENABLED requires FEISHU_AUTH_ENABLED')
  })

  it('rejects a production authentication bypass', () => {
    expect(() => loadAuthGate({
      NODE_ENV: 'production',
      FEISHU_AUTH_ENABLED: 'false',
      FEISHU_WHITELIST_ENABLED: 'false',
    })).toThrow('FEISHU_AUTH_ENABLED must be true in production')
  })
})
