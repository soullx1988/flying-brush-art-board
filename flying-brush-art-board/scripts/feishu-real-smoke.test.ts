import { describe, expect, it } from 'vitest'

import { FEISHU_SKIPPED_MESSAGE, getFeishuRealSmokeGate, runFeishuRealSmoke } from './feishu-real-smoke.js'

describe('Feishu real smoke gate', () => {
  it('skips when user authorization has not been enabled', () => {
    expect(getFeishuRealSmokeGate({})).toEqual({
      status: 'skipped',
      message: FEISHU_SKIPPED_MESSAGE,
    })
  })

  it('skips when credentials are incomplete', () => {
    expect(getFeishuRealSmokeGate({ FEISHU_REAL_SMOKE: '1' })).toEqual({
      status: 'skipped',
      message: FEISHU_SKIPPED_MESSAGE,
    })
  })

  it('opens the gate only for an explicit flag and local credentials', () => {
    expect(
      getFeishuRealSmokeGate({
        FEISHU_REAL_SMOKE: '1',
        FEISHU_APP_ID: 'local-app-id',
        FEISHU_APP_SECRET: 'local-app-secret',
      }),
    ).toEqual({ status: 'ready' })
  })

  it('requires a completed local OAuth session before a real request', async () => {
    const errors: string[] = []
    await expect(runFeishuRealSmoke([], {
      FEISHU_REAL_SMOKE: '1', FEISHU_APP_ID: 'local-app-id', FEISHU_APP_SECRET: 'local-app-secret',
    }, {
      credentialStore: { read: () => undefined } as never,
      error: (message) => errors.push(message),
    })).resolves.toBe(2)
    expect(errors).toEqual([expect.stringContaining('FEISHU_OAUTH_REQUIRED')])
  })

  it('runs nodes, theme, preview, and each media download serially without printing source content', async () => {
    const calls: string[] = []
    const output: string[] = []
    await expect(runFeishuRealSmoke([], {
      FEISHU_REAL_SMOKE: '1', FEISHU_APP_ID: 'local-app-id', FEISHU_APP_SECRET: 'local-app-secret', FEISHU_REAL_WHITEBOARD_URL: 'board-token',
    }, {
      credentialStore: { read: () => ({ accessToken: 'access', refreshToken: 'refresh', scopes: [] }) } as never,
      resolveWhiteboardToken: async () => { calls.push('resolve'); return 'resolved-token' },
      client: {
        listWhiteboardNodes: async () => { calls.push('nodes'); return { nodes: [{ id: 'image-1', type: 'image', x: 0, y: 0, width: 1, height: 1, mediaToken: 'media-1' }] } },
        getWhiteboardTheme: async () => { calls.push('theme'); return {} },
        downloadWhiteboardPreview: async () => { calls.push('preview'); return new Uint8Array([1, 2]) },
        downloadMedia: async () => { calls.push('media'); return { bytes: new Uint8Array(), mime: 'image/png', sha256: 'hash' } },
      } as never,
      log: (message) => output.push(message),
    })).resolves.toBe(0)
    expect(calls).toEqual(['resolve', 'nodes', 'theme', 'preview', 'media'])
    expect(output).toEqual(['PASSED: nodes=1; media=1; previewBytes=2'])
  })
})
