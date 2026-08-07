import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'

describe('default Feishu mode', () => {
  const directories: string[] = []
  afterEach(() => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

  it('never performs an outbound fetch while inspecting a Wiki/Docx URL', async () => {
    const fetch = vi.fn(() => { throw new Error('OUTBOUND_NETWORK_FORBIDDEN') })
    vi.stubGlobal('fetch', fetch)
    const dataDirectory = mkdtempSync(join(tmpdir(), 'feishu-default-')); directories.push(dataDirectory)
    const app = await buildApp({ dataDirectory, databasePath: ':memory:', assetDirectory: join(dataDirectory, 'assets') })
    const start = await app.inject({ method: 'GET', url: '/auth/feishu/import/start' })
    const state = new URL(start.headers.location!).searchParams.get('state')!
    expect((await app.inject({ method: 'GET', url: `/auth/feishu/import/callback?state=${encodeURIComponent(state)}&code=mock-authorized-code` })).statusCode).toBe(200)
    const inspected = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'https://example.feishu.cn/wiki/wiki_token' } })
    expect(inspected.statusCode).toBe(422)
    expect(inspected.json()).toEqual({ code: 'FEISHU_MOCK_DOCUMENT_RESOLUTION_UNAVAILABLE' })
    expect(fetch).not.toHaveBeenCalled()
    await app.close()
  })
})
