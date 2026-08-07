import type { BoardClipboardPayload } from '@infinite-board/board-core'

export const BOARD_CLIPBOARD_MIME = 'application/x-infinite-board-clipboard+json'

export interface BrowserTextClipboard {
  writeText(text: string): Promise<void>
  readText(): Promise<string>
}

function defaultClipboard(): BrowserTextClipboard | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.clipboard
}

function isBoardClipboardPayload(value: unknown): value is BoardClipboardPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BoardClipboardPayload>
  return (
    candidate.version === 1 &&
    typeof candidate.sourceProjectId === 'string' &&
    typeof candidate.sourceBoardId === 'string' &&
    Array.isArray(candidate.shapes) &&
    Array.isArray(candidate.bindings) &&
    Array.isArray(candidate.references) &&
    Array.isArray(candidate.assets) &&
    typeof candidate.copiedAt === 'string'
  )
}

function clonePayload(payload: BoardClipboardPayload): BoardClipboardPayload {
  return structuredClone(payload)
}

export class BrowserClipboardService {
  private payload: BoardClipboardPayload | undefined

  constructor(private readonly systemClipboard: BrowserTextClipboard | undefined = defaultClipboard()) {}

  async copy(payload: BoardClipboardPayload): Promise<void> {
    this.payload = clonePayload(payload)
    if (!this.systemClipboard) return
    try {
      await this.systemClipboard.writeText(
        JSON.stringify({ type: BOARD_CLIPBOARD_MIME, payload: this.payload }),
      )
    } catch {
      // The in-memory payload remains authoritative when clipboard permission is denied.
    }
  }

  onBoardActivated(_boardId: string): void {
    // Intentionally retain the payload across Board tab switches.
  }

  peek(): BoardClipboardPayload | undefined {
    return this.payload ? clonePayload(this.payload) : undefined
  }

  async read(): Promise<BoardClipboardPayload | undefined> {
    if (this.payload) return clonePayload(this.payload)
    if (!this.systemClipboard) return undefined
    try {
      const parsed = JSON.parse(await this.systemClipboard.readText()) as {
        type?: unknown
        payload?: unknown
      }
      if (parsed.type !== BOARD_CLIPBOARD_MIME || !isBoardClipboardPayload(parsed.payload)) {
        return undefined
      }
      this.payload = clonePayload(parsed.payload)
      return clonePayload(parsed.payload)
    } catch {
      return undefined
    }
  }
}
