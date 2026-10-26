import type { BoardClipboardPayload } from '@infinite-board/board-core'

export const BOARD_CLIPBOARD_MIME = 'application/x-infinite-board-clipboard+json'

export interface BrowserTextClipboard {
  writeText(text: string): Promise<void>
  readText(): Promise<string>
}

export interface ClipboardDataReader {
  readonly types?: readonly string[]
  readonly files?: ArrayLike<unknown>
  readonly items?: ArrayLike<unknown>
  getData(type: string): string
}

export interface ClipboardDataWriter {
  setData(type: string, value: string): void
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

function parseClipboardEnvelope(text: string): BoardClipboardPayload | undefined {
  if (text.trim().length === 0) return undefined
  try {
    const parsed = JSON.parse(text) as { type?: unknown; payload?: unknown }
    if (parsed.type !== BOARD_CLIPBOARD_MIME || !isBoardClipboardPayload(parsed.payload)) {
      return undefined
    }
    return parsed.payload
  } catch {
    return undefined
  }
}

function serializeClipboardEnvelope(payload: BoardClipboardPayload): string {
  return JSON.stringify({ type: BOARD_CLIPBOARD_MIME, payload })
}

function readClipboardData(data: ClipboardDataReader, type: string): string {
  try {
    return data.getData(type)
  } catch {
    return ''
  }
}

export class BrowserClipboardService {
  private payload: BoardClipboardPayload | undefined

  constructor(private readonly systemClipboard: BrowserTextClipboard | undefined = defaultClipboard()) {}

  async copy(payload: BoardClipboardPayload): Promise<void> {
    this.payload = clonePayload(payload)
    if (!this.systemClipboard) return
    try {
      await this.systemClipboard.writeText(serializeClipboardEnvelope(this.payload))
    } catch {
      // The in-memory payload remains authoritative when clipboard permission is denied.
    }
  }

  writeToClipboardData(data: ClipboardDataWriter, payload: BoardClipboardPayload): boolean {
    this.payload = clonePayload(payload)
    const envelope = serializeClipboardEnvelope(this.payload)
    try {
      data.setData('text/plain', envelope)
      try {
        data.setData(BOARD_CLIPBOARD_MIME, envelope)
      } catch {
        // text/plain remains sufficient for browsers that reject custom formats.
      }
      return true
    } catch {
      return false
    }
  }

  clear(): void {
    this.payload = undefined
  }

  onBoardActivated(_boardId: string): void {
    // Intentionally retain the payload across Board tab switches.
  }

  peek(): BoardClipboardPayload | undefined {
    return this.payload ? clonePayload(this.payload) : undefined
  }

  readFromClipboardData(data: ClipboardDataReader | null): BoardClipboardPayload | undefined {
    if (!data) return this.peek()

    const customText = readClipboardData(data, BOARD_CLIPBOARD_MIME)
    const plainText = readClipboardData(data, 'text/plain')
    const parsed = parseClipboardEnvelope(customText) ?? parseClipboardEnvelope(plainText)
    if (parsed) {
      this.payload = clonePayload(parsed)
      return clonePayload(parsed)
    }

    const hasCurrentClipboardContent =
      (data.types?.length ?? 0) > 0 ||
      (data.files?.length ?? 0) > 0 ||
      (data.items?.length ?? 0) > 0 ||
      customText.length > 0 ||
      plainText.length > 0
    if (hasCurrentClipboardContent) {
      this.payload = undefined
      return undefined
    }

    return this.peek()
  }

  async read(): Promise<BoardClipboardPayload | undefined> {
    if (!this.systemClipboard) return this.peek()
    try {
      const parsed = parseClipboardEnvelope(await this.systemClipboard.readText())
      this.payload = parsed ? clonePayload(parsed) : undefined
      return parsed ? clonePayload(parsed) : undefined
    } catch {
      return this.peek()
    }
  }
}
