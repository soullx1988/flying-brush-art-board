import { createHash } from 'node:crypto'

import { z } from 'zod'

import type { FeishuCredentialStore } from './oauth-service.js'

const tokenSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/)
const allowedMediaMime = /^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/(pdf|octet-stream))$/i
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_RETRY_ATTEMPTS = 5
const BASE_RETRY_DELAY_MS = 100
const MAX_BACKOFF_DELAY_MS = 2_000
const MAX_RETRY_AFTER_MS = 60_000

export class FeishuBoardClientError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode?: number,
    readonly requiredScope?: string,
    readonly retryAfterMs?: number,
  ) {
    super(requiredScope ? `${code}: authorize ${requiredScope} in Feishu and reconnect the account` : code)
    this.name = 'FeishuBoardClientError'
  }
}

export interface FeishuRequestOptions { signal?: AbortSignal }
export interface FeishuBoardClientOptions {
  credentials: Pick<FeishuCredentialStore, 'read'>
  fetch?: typeof globalThis.fetch
  baseUrl?: string
  timeoutMs?: number
  maxAttempts?: number
  maxMediaBytes?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export class FeishuBoardClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly maxMediaBytes: number
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(private readonly options: FeishuBoardClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? 'https://open.feishu.cn'
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxAttempts = this.attemptCount(options.maxAttempts)
    this.maxMediaBytes = options.maxMediaBytes ?? 50 * 1024 * 1024
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  listWhiteboardNodes(token: string, options: FeishuRequestOptions = {}): Promise<unknown> {
    return this.json(`/open-apis/board/v1/whiteboards/${this.token(token)}/nodes`, 'board:whiteboard:node:read', options)
  }

  getWhiteboardTheme(token: string, options: FeishuRequestOptions = {}): Promise<unknown> {
    return this.json(`/open-apis/board/v1/whiteboards/${this.token(token)}/theme`, 'board:whiteboard:node:read', options)
  }

  async downloadWhiteboardPreview(token: string, options: FeishuRequestOptions = {}): Promise<Uint8Array> {
    const scope = 'board:whiteboard:node:read'
    const response = await this.request(`/open-apis/board/v1/whiteboards/${this.token(token)}/download_as_image`, scope, options)
    await this.assertNoBinaryBusinessError(response, scope)
    return new Uint8Array(await response.arrayBuffer())
  }

  async downloadMedia(mediaToken: string, options: FeishuRequestOptions = {}): Promise<{ bytes: Uint8Array; mime: string; sha256: string }> {
    const scope = 'docs:document.media:download'
    const response = await this.request(`/open-apis/drive/v1/medias/${this.token(mediaToken)}/download`, scope, options)
    await this.assertNoBinaryBusinessError(response, scope)
    const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
    if (!allowedMediaMime.test(mime)) throw new FeishuBoardClientError('FEISHU_MEDIA_MIME_INVALID')
    const lengthHeader = response.headers.get('content-length')
    const declaredLength = lengthHeader === null ? undefined : Number(lengthHeader)
    if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > this.maxMediaBytes) throw new FeishuBoardClientError('FEISHU_MEDIA_TOO_LARGE')
    const bytes = await this.readCapped(response)
    if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength !== bytes.byteLength) throw new FeishuBoardClientError('FEISHU_MEDIA_SIZE_MISMATCH')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const declaredHash = response.headers.get('x-content-sha256') ?? response.headers.get('x-checksum-sha256')
    if (declaredHash && declaredHash.toLowerCase() !== sha256) throw new FeishuBoardClientError('FEISHU_MEDIA_HASH_MISMATCH')
    return { bytes, mime, sha256 }
  }

  private async json(path: string, scope: string, options: FeishuRequestOptions): Promise<unknown> {
    const response = await this.request(path, scope, options)
    const payload = await response.json() as { code?: number; msg?: string; data?: unknown }
    if (payload.code === 99991672) throw new FeishuBoardClientError('FEISHU_SCOPE_DENIED', 403, scope)
    if (payload.code !== undefined && payload.code !== 0) throw new FeishuBoardClientError('FEISHU_API_ERROR', response.status)
    return payload.data ?? payload
  }

  private async request(path: string, scope: string, options: FeishuRequestOptions): Promise<Response> {
    const accessToken = this.options.credentials.read()?.accessToken
    if (!accessToken) throw new FeishuBoardClientError('FEISHU_ACCOUNT_NOT_CONNECTED', 401)
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (options.signal?.aborted) throw new FeishuBoardClientError('FEISHU_REQUEST_CANCELLED')
      const timeout = AbortSignal.timeout(this.timeoutMs)
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      try {
        const response = await this.fetch(new URL(path, this.baseUrl).toString(), { headers: { Authorization: `Bearer ${accessToken}` }, signal })
        if (response.status === 403) throw new FeishuBoardClientError('FEISHU_SCOPE_DENIED', 403, scope)
        if (response.status === 429) {
          const retryAfterMs = this.retryAfter(response)
          if (attempt + 1 < this.maxAttempts) { await this.waitForRetry(retryAfterMs ?? this.backoff(attempt), options.signal); continue }
          throw new FeishuBoardClientError('FEISHU_RATE_LIMITED', 429, undefined, retryAfterMs)
        }
        if (response.status >= 500 && attempt + 1 < this.maxAttempts) { await this.waitForRetry(this.backoff(attempt), options.signal); continue }
        if (!response.ok) throw new FeishuBoardClientError('FEISHU_REQUEST_FAILED', response.status)
        return response
      } catch (error) {
        if (error instanceof FeishuBoardClientError) throw error
        if (options.signal?.aborted) throw new FeishuBoardClientError('FEISHU_REQUEST_CANCELLED')
        if (attempt + 1 < this.maxAttempts) { await this.waitForRetry(this.backoff(attempt), options.signal); continue }
        throw new FeishuBoardClientError('FEISHU_REQUEST_TIMEOUT')
      }
    }
    throw new FeishuBoardClientError('FEISHU_REQUEST_FAILED')
  }

  private retryAfter(response: Response): number | undefined {
    const header = response.headers.get('retry-after')
    if (header === null) return undefined
    const seconds = Number(header)
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined
  }

  private backoff(attempt: number): number {
    return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_BACKOFF_DELAY_MS)
  }

  private attemptCount(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? MAX_RETRY_ATTEMPTS : DEFAULT_MAX_ATTEMPTS
    return Math.max(1, Math.min(Math.trunc(value), MAX_RETRY_ATTEMPTS))
  }

  private async waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new FeishuBoardClientError('FEISHU_REQUEST_CANCELLED')
    if (!signal) return this.sleep(milliseconds)
    let rejectCancelled: (() => void) | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(new FeishuBoardClientError('FEISHU_REQUEST_CANCELLED'))
      signal.addEventListener('abort', rejectCancelled, { once: true })
    })
    try {
      await Promise.race([this.sleep(milliseconds), cancelled])
    } finally {
      if (rejectCancelled) signal.removeEventListener('abort', rejectCancelled)
    }
  }

  private async assertNoBinaryBusinessError(response: Response, scope: string): Promise<void> {
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return
    const payload = await response.clone().json().catch(() => undefined) as { code?: number } | undefined
    if (payload?.code === 99991672) throw new FeishuBoardClientError('FEISHU_SCOPE_DENIED', 403, scope)
  }

  private async readCapped(response: Response): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > this.maxMediaBytes) {
          await reader.cancel('FEISHU_MEDIA_TOO_LARGE')
          throw new FeishuBoardClientError('FEISHU_MEDIA_TOO_LARGE')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  }

  private token(value: string): string {
    const parsed = tokenSchema.safeParse(value)
    if (!parsed.success) throw new FeishuBoardClientError('FEISHU_TOKEN_INVALID')
    return encodeURIComponent(parsed.data)
  }
}
