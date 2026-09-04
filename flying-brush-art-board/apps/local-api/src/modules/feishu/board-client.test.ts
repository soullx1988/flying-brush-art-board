import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { FeishuBoardClient, FeishuBoardClientError } from './board-client.js'

const credentials = { read: () => ({ accessToken: 'user-token', refreshToken: 'refresh', scopes: [] }) }
const authenticated = { credentials, actorOpenId: 'user-a' }

function response(body: BodyInit, init: ResponseInit = {}): Response {
  return new Response(body, init)
}

describe('FeishuBoardClient', () => {
  it('uses only documented Board and media OpenAPI endpoints', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify({ code: 0, data: { nodes: [] } }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(response(JSON.stringify({ code: 0, data: { theme: {} } }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png', 'content-length': '4' } }))
    const client = new FeishuBoardClient({ ...authenticated, fetch })

    await client.listWhiteboardNodes('board-1')
    await client.getWhiteboardTheme('board-1')
    await client.downloadWhiteboardPreview('board-1')

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://open.feishu.cn/open-apis/board/v1/whiteboards/board-1/nodes',
      'https://open.feishu.cn/open-apis/board/v1/whiteboards/board-1/theme',
      'https://open.feishu.cn/open-apis/board/v1/whiteboards/board-1/download_as_image',
    ])
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer user-token' } })
  })

  it('honors caller cancellation', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1 })
    const controller = new AbortController()
    const pending = client.listWhiteboardNodes('board-1', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'FEISHU_REQUEST_CANCELLED' })
  })

  it('times out and retries with exponential backoff', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const sleep = vi.fn(async (_milliseconds: number) => undefined)
    const client = new FeishuBoardClient({ ...authenticated, fetch, timeoutMs: 1, maxAttempts: 3, sleep })

    await expect(client.listWhiteboardNodes('board-1')).rejects.toMatchObject({ code: 'FEISHU_REQUEST_TIMEOUT' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([100, 200])
  })

  it('provides scope repair guidance without expanding scopes', async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ code: 99991672, msg: 'Access denied' }), { status: 403 }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1 })

    await expect(client.listWhiteboardNodes('board-1')).rejects.toMatchObject({
      code: 'FEISHU_SCOPE_DENIED',
      requiredScope: 'board:whiteboard:node:read',
    } satisfies Partial<FeishuBoardClientError>)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('maps an HTTP 200 Feishu permission business code to scope guidance', async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ code: 99991672, msg: 'Access denied' }), {
      headers: { 'content-type': 'application/json' },
    }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1 })

    await expect(client.listWhiteboardNodes('board-1')).rejects.toMatchObject({
      code: 'FEISHU_SCOPE_DENIED',
      requiredScope: 'board:whiteboard:node:read',
    } satisfies Partial<FeishuBoardClientError>)
  })

  it('maps HTTP 200 permission business errors from binary endpoints to their required scopes', async () => {
    const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ code: 99991672, msg: 'Access denied' }), {
      headers: { 'content-type': 'application/json' },
    }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1 })

    await expect(client.downloadWhiteboardPreview('board-1')).rejects.toMatchObject({
      code: 'FEISHU_SCOPE_DENIED', requiredScope: 'board:whiteboard:node:read',
    } satisfies Partial<FeishuBoardClientError>)
    await expect(client.downloadMedia('media-1')).rejects.toMatchObject({
      code: 'FEISHU_SCOPE_DENIED', requiredScope: 'docs:document.media:download',
    } satisfies Partial<FeishuBoardClientError>)
  })

  it('reports rate limits with retry guidance after bounded retries', async () => {
    const fetch = vi.fn().mockResolvedValue(response('', { status: 429, headers: { 'retry-after': '2' } }))
    const sleep = vi.fn(async (_milliseconds: number) => undefined)
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 2, sleep })

    await expect(client.getWhiteboardTheme('board-1')).rejects.toMatchObject({
      code: 'FEISHU_RATE_LIMITED', retryAfterMs: 2000,
    } satisfies Partial<FeishuBoardClientError>)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('bounds malformed attempt counts and oversized retry delays', async () => {
    const fetch = vi.fn().mockResolvedValue(response('', { status: 429, headers: { 'retry-after': 'Infinity' } }))
    const sleep = vi.fn(async (_milliseconds: number) => undefined)
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: Number.POSITIVE_INFINITY, sleep })

    await expect(client.getWhiteboardTheme('board-1')).rejects.toMatchObject({ code: 'FEISHU_RATE_LIMITED' })
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([100, 200, 400, 800])

    const malformedFetch = vi.fn().mockResolvedValue(response('', { status: 500 }))
    const malformedClient = new FeishuBoardClient({ ...authenticated, fetch: malformedFetch, maxAttempts: Number.NaN, sleep })
    await expect(malformedClient.getWhiteboardTheme('board-1')).rejects.toMatchObject({ code: 'FEISHU_REQUEST_FAILED' })
    expect(malformedFetch).toHaveBeenCalledTimes(3)
  })

  it('caps Retry-After and cancels promptly while waiting to retry', async () => {
    const fetch = vi.fn().mockResolvedValue(response('', { status: 429, headers: { 'retry-after': '999999999' } }))
    const sleep = vi.fn(() => new Promise<void>(() => undefined))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 2, sleep })
    const controller = new AbortController()
    const pending = client.getWhiteboardTheme('board-1', { signal: controller.signal })

    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(60_000))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'FEISHU_REQUEST_CANCELLED' })
  })

  it('validates media MIME, length and SHA-256', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(bytes, { headers: { 'content-type': 'image/png', 'content-length': '4', 'x-content-sha256': sha256 } }))
      .mockResolvedValueOnce(response(bytes, { headers: { 'content-type': 'text/html', 'content-length': '4' } }))
      .mockResolvedValueOnce(response(bytes, { headers: { 'content-type': 'image/png', 'content-length': '5' } }))
      .mockResolvedValueOnce(response(bytes, { headers: { 'content-type': 'image/png', 'content-length': '4', 'x-content-sha256': '0'.repeat(64) } }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1 })

    await expect(client.downloadMedia('media-1')).resolves.toEqual({ bytes, mime: 'image/png', sha256 })
    await expect(client.downloadMedia('media-2')).rejects.toMatchObject({ code: 'FEISHU_MEDIA_MIME_INVALID' })
    await expect(client.downloadMedia('media-3')).rejects.toMatchObject({ code: 'FEISHU_MEDIA_SIZE_MISMATCH' })
    await expect(client.downloadMedia('media-4')).rejects.toMatchObject({ code: 'FEISHU_MEDIA_HASH_MISMATCH' })
  })

  it('stops reading unknown-length media as soon as the byte limit is exceeded', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(4))
        if (pulls === 3) controller.close()
      },
    }, { highWaterMark: 0 })
    const fetch = vi.fn().mockResolvedValue(response(body, { headers: { 'content-type': 'image/png' } }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1, maxMediaBytes: 5 })

    await expect(client.downloadMedia('media-stream')).rejects.toMatchObject({ code: 'FEISHU_MEDIA_TOO_LARGE' })
    expect(pulls).toBe(2)
  })

  it('stops reading an unknown-length preview as soon as its byte limit is exceeded', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(4))
        if (pulls === 3) controller.close()
      },
    }, { highWaterMark: 0 })
    const fetch = vi.fn().mockResolvedValue(response(body, { headers: { 'content-type': 'image/png' } }))
    const client = new FeishuBoardClient({ ...authenticated, fetch, maxAttempts: 1, maxPreviewBytes: 5 })

    await expect(client.downloadWhiteboardPreview('board-stream')).rejects.toMatchObject({ code: 'FEISHU_PREVIEW_TOO_LARGE' })
    expect(pulls).toBe(2)
  })
})
