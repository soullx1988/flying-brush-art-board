import type { FeishuCredentialStore } from './oauth-service.js'
import type { FeishuDocumentReference, WikiDocxClient } from './url-resolver.js'

const DEFAULT_MAX_ATTEMPTS = 3
const MAX_RETRY_ATTEMPTS = 5
const BASE_RETRY_DELAY_MS = 100
const MAX_BACKOFF_DELAY_MS = 2_000
const MAX_RETRY_AFTER_MS = 60_000

export interface FeishuWikiDocxClientOptions {
  credentials: Pick<FeishuCredentialStore, 'read'>
  actorOpenId?: string
  fetch?: typeof globalThis.fetch
  baseUrl?: string
  timeoutMs?: number
  maxAttempts?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface FeishuWikiDocxRequestOptions { signal?: AbortSignal; actorOpenId?: string }

export class FeishuWikiDocxClientError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode?: number,
    readonly requiredScope?: string,
    readonly retryAfterMs?: number,
  ) {
    super(requiredScope ? `${code}: authorize ${requiredScope} in Feishu and reconnect the account` : code)
    this.name = 'FeishuWikiDocxClientError'
  }
}

/** Resolves documented Wiki nodes. Docx whiteboards must be supplied with blockToken. */
export class FeishuWikiDocxClient implements WikiDocxClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(private readonly options: FeishuWikiDocxClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? 'https://open.feishu.cn'
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxAttempts = this.attemptCount(options.maxAttempts)
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  async resolveWhiteboardToken(reference: FeishuDocumentReference, options: FeishuWikiDocxRequestOptions = {}): Promise<string> {
    if (reference.kind === 'docx') throw new FeishuWikiDocxClientError('FEISHU_DOCX_BLOCK_TOKEN_REQUIRED')
    const actorOpenId = options.actorOpenId ?? this.options.actorOpenId
    const accessToken = actorOpenId ? this.options.credentials.read(actorOpenId)?.accessToken : undefined
    if (!accessToken) throw new FeishuWikiDocxClientError('FEISHU_ACCOUNT_NOT_CONNECTED', 401)
    const url = new URL('/open-apis/wiki/v2/spaces/get_node', this.baseUrl)
    url.searchParams.set('token', reference.token)
    const response = await this.request(url, accessToken, options)
    const payload = await response.json() as { code?: number; data?: { node?: { obj_type?: string; obj_token?: string } } }
    if (payload.code === 99991672) throw new FeishuWikiDocxClientError('FEISHU_SCOPE_DENIED', 403, 'wiki:node:retrieve')
    if (payload.code === 99991679) throw new FeishuWikiDocxClientError('FEISHU_RESOURCE_ACCESS_DENIED', 403)
    if (payload.code !== 0 || payload.data?.node?.obj_type !== 'whiteboard' || !payload.data.node.obj_token) {
      throw new FeishuWikiDocxClientError('FEISHU_WIKI_NODE_NOT_WHITEBOARD')
    }
    return payload.data.node.obj_token
  }

  private async request(url: URL, accessToken: string, options: FeishuWikiDocxRequestOptions): Promise<Response> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (options.signal?.aborted) throw new FeishuWikiDocxClientError('FEISHU_REQUEST_CANCELLED')
      const timeout = AbortSignal.timeout(this.timeoutMs)
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
      try {
        const response = await this.fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal })
        if (response.status === 403) throw new FeishuWikiDocxClientError('FEISHU_SCOPE_DENIED', 403, 'wiki:node:retrieve')
        if (response.status === 429) {
          const retryAfterMs = this.retryAfter(response)
          if (attempt + 1 < this.maxAttempts) {
            await this.waitForRetry(retryAfterMs ?? this.backoff(attempt), options.signal)
            continue
          }
          throw new FeishuWikiDocxClientError('FEISHU_RATE_LIMITED', 429, undefined, retryAfterMs)
        }
        if (response.status >= 500 && attempt + 1 < this.maxAttempts) {
          await this.waitForRetry(this.backoff(attempt), options.signal)
          continue
        }
        if (!response.ok) {
          const payload = await response.clone().json().catch(() => undefined) as { code?: unknown } | undefined
          if (payload?.code === 99991672) throw new FeishuWikiDocxClientError('FEISHU_SCOPE_DENIED', 403, 'wiki:node:retrieve')
          if (payload?.code === 99991679) throw new FeishuWikiDocxClientError('FEISHU_RESOURCE_ACCESS_DENIED', 403)
          throw new FeishuWikiDocxClientError('FEISHU_WIKI_NODE_RESOLUTION_FAILED', response.status)
        }
        return response
      } catch (error) {
        if (error instanceof FeishuWikiDocxClientError) throw error
        if (options.signal?.aborted) throw new FeishuWikiDocxClientError('FEISHU_REQUEST_CANCELLED')
        if (attempt + 1 < this.maxAttempts) {
          await this.waitForRetry(this.backoff(attempt), options.signal)
          continue
        }
        throw new FeishuWikiDocxClientError('FEISHU_REQUEST_TIMEOUT')
      }
    }
    throw new FeishuWikiDocxClientError('FEISHU_WIKI_NODE_RESOLUTION_FAILED')
  }

  private backoff(attempt: number): number {
    return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_BACKOFF_DELAY_MS)
  }

  private retryAfter(response: Response): number | undefined {
    const header = response.headers.get('retry-after')
    if (header === null) return undefined
    const seconds = Number(header)
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined
  }

  private attemptCount(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? MAX_RETRY_ATTEMPTS : DEFAULT_MAX_ATTEMPTS
    return Math.max(1, Math.min(Math.trunc(value), MAX_RETRY_ATTEMPTS))
  }

  private async waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new FeishuWikiDocxClientError('FEISHU_REQUEST_CANCELLED')
    if (!signal) return this.sleep(milliseconds)
    let rejectCancelled: (() => void) | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(new FeishuWikiDocxClientError('FEISHU_REQUEST_CANCELLED'))
      signal.addEventListener('abort', rejectCancelled, { once: true })
    })
    try {
      await Promise.race([this.sleep(milliseconds), cancelled])
    } finally {
      if (rejectCancelled) signal.removeEventListener('abort', rejectCancelled)
    }
  }
}
