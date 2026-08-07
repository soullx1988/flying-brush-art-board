import { describe, expect, it, vi } from 'vitest'

import { FeishuWikiDocxClient, FeishuWikiDocxClientError } from './wiki-docx-client.js'

const credentials = { read: () => ({ accessToken: 'user-token', refreshToken: 'refresh', scopes: [] }) }
const reference = { kind: 'wiki' as const, token: 'wiki-1', url: new URL('https://tenant.feishu.cn/wiki/wiki-1') }

describe('FeishuWikiDocxClient', () => {
  it('uses the documented endpoint and bearer authorization', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0, data: { node: { obj_type: 'whiteboard', obj_token: 'board-1' } },
    })))
    const client = new FeishuWikiDocxClient({ credentials, fetch })
    await expect(client.resolveWhiteboardToken(reference)).resolves.toBe('board-1')
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wiki-1'),
      expect.objectContaining({ headers: { Authorization: 'Bearer user-token' } }),
    )
  })

  it('returns a structured account error without exposing request details', async () => {
    const client = new FeishuWikiDocxClient({ credentials: { read: () => undefined }, fetch: vi.fn() })
    const error = await client.resolveWhiteboardToken(reference).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'FEISHU_ACCOUNT_NOT_CONNECTED', statusCode: 401 })
    expect(String(error)).not.toContain('wiki-1')
    expect(String(error)).not.toContain('user-token')
  })

  it('supports caller cancellation', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const client = new FeishuWikiDocxClient({ credentials, fetch, maxAttempts: 1 })
    const controller = new AbortController()
    const pending = client.resolveWhiteboardToken(reference, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'FEISHU_REQUEST_CANCELLED' })
  })

  it('times out with exponential retries', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const sleep = vi.fn(async (_milliseconds: number) => undefined)
    const client = new FeishuWikiDocxClient({ credentials, fetch, timeoutMs: 1, maxAttempts: 3, sleep })
    await expect(client.resolveWhiteboardToken(reference)).rejects.toMatchObject({ code: 'FEISHU_REQUEST_TIMEOUT' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([100, 200])
  })

  it('returns scope and rate-limit repair guidance', async () => {
    const scopeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 99991672 }), { status: 200 }))
    const scopeClient = new FeishuWikiDocxClient({ credentials, fetch: scopeFetch, maxAttempts: 1 })
    await expect(scopeClient.resolveWhiteboardToken(reference)).rejects.toMatchObject({
      code: 'FEISHU_SCOPE_DENIED', requiredScope: 'wiki:node:retrieve',
    } satisfies Partial<FeishuWikiDocxClientError>)

    const rateFetch = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '3' } }))
    const sleep = vi.fn(async (_milliseconds: number) => undefined)
    const rateClient = new FeishuWikiDocxClient({ credentials, fetch: rateFetch, maxAttempts: 2, sleep })
    await expect(rateClient.resolveWhiteboardToken(reference)).rejects.toMatchObject({ code: 'FEISHU_RATE_LIMITED', retryAfterMs: 3000 })
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('maps a Feishu user-resource authorization failure without exposing its response body', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 99991679 }), { status: 400 }))
    const client = new FeishuWikiDocxClient({ credentials, fetch, maxAttempts: 1 })

    await expect(client.resolveWhiteboardToken(reference)).rejects.toMatchObject({
      code: 'FEISHU_RESOURCE_ACCESS_DENIED', statusCode: 403,
    } satisfies Partial<FeishuWikiDocxClientError>)
  })

  it('bounds attempt counts and retry delays, and aborts while waiting', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '999999999' } }))
    const sleep = vi.fn(() => new Promise<void>(() => undefined))
    const client = new FeishuWikiDocxClient({ credentials, fetch, maxAttempts: Number.POSITIVE_INFINITY, sleep })
    const controller = new AbortController()
    const pending = client.resolveWhiteboardToken(reference, { signal: controller.signal })

    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(60_000))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'FEISHU_REQUEST_CANCELLED' })
    expect(fetch).toHaveBeenCalledTimes(1)

    const malformedFetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }))
    const immediateSleep = vi.fn(async (_milliseconds: number) => undefined)
    const malformedClient = new FeishuWikiDocxClient({ credentials, fetch: malformedFetch, maxAttempts: Number.NaN, sleep: immediateSleep })
    await expect(malformedClient.resolveWhiteboardToken(reference)).rejects.toMatchObject({ code: 'FEISHU_WIKI_NODE_RESOLUTION_FAILED' })
    expect(malformedFetch).toHaveBeenCalledTimes(3)
  })
})
