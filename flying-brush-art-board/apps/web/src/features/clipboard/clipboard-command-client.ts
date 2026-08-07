import type {
  ClipboardCommandReplayRequest,
  ClipboardDowngradeReport,
  ClipboardPasteRequest,
} from '@infinite-board/board-core'
import { createBrowserUuid } from '../../app/browser-uuid'

export interface ClipboardCommandReceipt {
  commandId: string
  boardId: string
  revision: number
  snapshot: unknown
  idMap: Record<string, string>
  createdReferenceIds: string[]
  downgrade?: ClipboardDowngradeReport
}

export interface ClipboardCommandClientOptions {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** A stable ID for this running application instance, not a user identity. */
  sessionId?: string
  adoptServerCommit(snapshot: unknown, revision: number, receipt: ClipboardCommandReceipt): void
}

export class ClipboardCommandClient {
  private readonly fetcher: NonNullable<ClipboardCommandClientOptions['fetcher']>
  private readonly sessionId: string

  constructor(private readonly options: ClipboardCommandClientOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.sessionId = options.sessionId ?? createBrowserUuid()
  }

  paste(
    boardId: string,
    request: Omit<ClipboardPasteRequest, 'sessionId'>,
  ): Promise<ClipboardCommandReceipt> {
    return this.commit(`/api/boards/${encodeURIComponent(boardId)}/clipboard/paste`, {
      ...request,
      sessionId: this.sessionId,
    })
  }

  undo(commandId: string, expectedRevision: number): Promise<ClipboardCommandReceipt> {
    return this.replay(commandId, 'undo', { expectedRevision })
  }

  redo(commandId: string, expectedRevision: number): Promise<ClipboardCommandReceipt> {
    return this.replay(commandId, 'redo', { expectedRevision })
  }

  private replay(
    commandId: string,
    action: 'undo' | 'redo',
    request: Omit<ClipboardCommandReplayRequest, 'sessionId'>,
  ): Promise<ClipboardCommandReceipt> {
    return this.commit(`/api/clipboard/commands/${encodeURIComponent(commandId)}/${action}`, {
      ...request,
      sessionId: this.sessionId,
    })
  }

  private async commit(path: string, body: unknown): Promise<ClipboardCommandReceipt> {
    const response = await this.fetcher(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => ({}))) as ClipboardCommandReceipt & { code?: string }
    if (!response.ok) throw Object.assign(new Error(payload.code ?? `HTTP_${response.status}`), payload)
    this.options.adoptServerCommit(payload.snapshot, payload.revision, payload)
    return payload
  }
}
