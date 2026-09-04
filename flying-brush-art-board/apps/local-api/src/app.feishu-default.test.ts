import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { EncryptedCredentialStore } from './modules/feishu/credential-store.js'

describe('default Feishu mode', () => {
  const directories: string[] = []
  afterEach(() => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

  it('fails closed without Feishu app configuration and never performs an outbound fetch', async () => {
    const fetch = vi.fn(() => { throw new Error('OUTBOUND_NETWORK_FORBIDDEN') })
    vi.stubGlobal('fetch', fetch)
    const dataDirectory = mkdtempSync(join(tmpdir(), 'feishu-default-')); directories.push(dataDirectory)
    new EncryptedCredentialStore({ directory: dataDirectory }).replace('local-acceptance-user', {
      accessToken: 'stale-access', refreshToken: 'stale-refresh', scopes: ['offline_access'],
    })
    const app = await buildApp({
      dataDirectory,
      databasePath: ':memory:',
      assetDirectory: join(dataDirectory, 'assets'),
      // This test isolates Feishu's fail-closed boundary. The independent
      // localhost trading bridge has its own source and integration tests.
      enableTradingBridge: false,
    })
    const start = await app.inject({ method: 'GET', url: '/auth/feishu/import/start' })
    expect(start.statusCode).toBe(503)
    expect(start.json()).toEqual({ code: 'FEISHU_IMPORT_NOT_CONFIGURED' })
    const callback = await app.inject({ method: 'GET', url: '/auth/feishu/import/callback?state=unissued&code=mock-authorized-code' })
    expect(callback.statusCode).toBe(503)
    expect(callback.json()).toEqual({ code: 'FEISHU_IMPORT_NOT_CONFIGURED' })
    expect((await app.inject({ method: 'GET', url: '/api/integrations/feishu/status' })).json()).toEqual({ connected: false })
    const inspected = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'https://example.feishu.cn/wiki/wiki_token' } })
    expect(inspected.statusCode).toBe(401)
    expect(inspected.json()).toEqual({ code: 'FEISHU_ACCOUNT_NOT_CONNECTED' })
    expect(fetch).not.toHaveBeenCalled()
    await app.close()
  })
})
