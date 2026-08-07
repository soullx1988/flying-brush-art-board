export const BOARD_SESSION_AUTOSAVE_DELAY_MS = 800

export type BoardSessionStatus =
  | 'loading'
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'conflict'
  | 'offline'
  | 'error'

export interface BoardCommit {
  snapshot: unknown
  revision: number
}

export interface BoardSessionApi {
  loadBoard(boardId: string): Promise<BoardCommit>
  saveSnapshot(
    boardId: string,
    expectedRevision: number,
    snapshot: unknown,
  ): Promise<BoardCommit>
}

export interface BoardEditor {
  getSnapshot(): unknown
  loadSnapshot(snapshot: unknown): void
  subscribe(listener: () => void): () => void
}

export interface BoardSessionOptions {
  api: BoardSessionApi
  /** Realtime rooms own ordinary canvas persistence; REST snapshots remain for commands only. */
  mode?: 'snapshot' | 'realtime'
  debounceMs?: number
  realtimeSyncMaxAttempts?: number
  waitForRealtimeSync?: () => Promise<void>
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export type BoardSessionFlushResult =
  | { ok: true; snapshot: unknown; revision: number }
  | {
      ok: false
      reason: 'conflict'
      currentRevision: number
      recoverySnapshot: unknown
    }
  | { ok: false; reason: 'offline' | 'error'; recoverySnapshot: unknown; error: unknown }

export class BoardSessionConflictError extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number) {
    super('REVISION_CONFLICT')
    this.name = 'BoardSessionConflictError'
    this.currentRevision = currentRevision
  }
}

function conflictRevision(error: unknown): number | undefined {
  if (error instanceof BoardSessionConflictError) return error.currentRevision
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { code?: unknown; status?: unknown; currentRevision?: unknown }
  if (candidate.code !== 'REVISION_CONFLICT' && candidate.status !== 409) return undefined
  return typeof candidate.currentRevision === 'number' ? candidate.currentRevision : 0
}

function isOfflineError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; name?: unknown }
  return (
    candidate.code === 'OFFLINE' ||
    candidate.code === 'NETWORK_ERROR' ||
    candidate.name === 'NetworkError'
  )
}

function cloneSnapshot(snapshot: unknown): unknown {
  return typeof structuredClone === 'function' ? structuredClone(snapshot) : snapshot
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function documentSnapshotFingerprint(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return JSON.stringify(snapshot)
  const value = snapshot as {
    document?: { store?: Record<string, unknown> }
    store?: Record<string, unknown>
  }
  return JSON.stringify(canonicalize(value.document?.store ?? value.store ?? value))
}

export class BoardSession {
  status: BoardSessionStatus = 'loading'
  currentRevision = 0
  pendingSnapshot: unknown | undefined

  private readonly api: BoardSessionApi
  private readonly mode: 'snapshot' | 'realtime'
  private readonly debounceMs: number
  private readonly realtimeSyncMaxAttempts: number
  private readonly waitForRealtimeSync: () => Promise<void>
  private readonly setTimer: NonNullable<BoardSessionOptions['setTimer']>
  private readonly clearTimer: NonNullable<BoardSessionOptions['clearTimer']>
  private readonly listeners = new Set<() => void>()
  private editor: BoardEditor | undefined
  private unsubscribeEditor: (() => void) | undefined
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined
  private committedSnapshot: unknown
  private tabId: string | undefined
  private boardId: string | undefined
  private changeVersion = 0
  private suppressEditorChanges = false
  private flushQueue: Promise<void> = Promise.resolve()
  private mountGeneration = 0

  constructor(options: BoardSessionOptions) {
    this.api = options.api
    this.mode = options.mode ?? 'snapshot'
    this.debounceMs = options.debounceMs ?? BOARD_SESSION_AUTOSAVE_DELAY_MS
    this.realtimeSyncMaxAttempts = options.realtimeSyncMaxAttempts ?? 80
    this.waitForRealtimeSync = options.waitForRealtimeSync
      ?? (() => new Promise((resolve) => globalThis.setTimeout(resolve, 25)))
    this.setTimer =
      options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer))
  }

  get mountedTabId(): string | undefined {
    return this.tabId
  }

  get mountedBoardId(): string | undefined {
    return this.boardId
  }

  get hasPendingChanges(): boolean {
    return this.pendingSnapshot !== undefined
  }

  get pendingVersion(): number {
    return this.changeVersion
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async mount(tabId: string, boardId: string, editor: BoardEditor): Promise<void> {
    const isSameBoard = this.boardId === boardId && this.committedSnapshot !== undefined
    this.detachEditor()
    const generation = this.mountGeneration
    this.tabId = tabId
    this.boardId = boardId
    this.editor = editor

    if (isSameBoard) {
      this.loadIntoEditor(this.pendingSnapshot ?? this.committedSnapshot)
    } else {
      this.status = 'loading'
      this.emit()
      const commit = await this.api.loadBoard(boardId)
      if (!this.isCurrentMount(generation, tabId, boardId, editor)) return
      this.adoptServerCommit(commit.snapshot, commit.revision)
    }

    if (!this.isCurrentMount(generation, tabId, boardId, editor)) return
    if (this.mode === 'snapshot') {
      this.unsubscribeEditor = editor.subscribe(() => this.handleEditorChange())
    }
  }

  detachEditor(): void {
    this.mountGeneration += 1
    this.unsubscribeEditor?.()
    this.unsubscribeEditor = undefined
    this.editor = undefined
  }

  dispose(): void {
    this.cancelAutosave()
    this.detachEditor()
    this.listeners.clear()
  }

  serializeSnapshot(): unknown {
    return this.pendingSnapshot ?? this.editor?.getSnapshot() ?? this.committedSnapshot
  }

  markDirty(snapshot: unknown): void {
    this.pendingSnapshot = snapshot
    this.changeVersion += 1
    this.status = 'dirty'
    this.scheduleAutosave()
    this.emit()
  }

  flush(): Promise<BoardSessionFlushResult> {
    const result = this.flushQueue.then(() => this.performFlush())
    this.flushQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async performFlush(): Promise<BoardSessionFlushResult> {
    this.cancelAutosave()
    const boardId = this.boardId
    const snapshot = this.pendingSnapshot
    if (this.mode === 'realtime') {
      // A clean tab has no local write that needs projection confirmation.
      // Avoid blocking tab close on a transient WebSocket outage.
      const editorSnapshot = this.editor?.getSnapshot()
      const hasUnconfirmedRealtimeChange = snapshot !== undefined || (
        editorSnapshot !== undefined &&
        this.committedSnapshot !== undefined &&
        documentSnapshotFingerprint(editorSnapshot) !== documentSnapshotFingerprint(this.committedSnapshot)
      )
      if (!hasUnconfirmedRealtimeChange) {
        this.status = this.committedSnapshot === undefined ? 'loading' : 'clean'
        this.emit()
        return { ok: true, snapshot: this.committedSnapshot, revision: this.currentRevision }
      }
      return this.waitForRealtimeProjection()
    }
    if (!boardId || snapshot === undefined) {
      this.status = this.committedSnapshot === undefined ? 'loading' : 'clean'
      this.emit()
      return {
        ok: true,
        snapshot: this.committedSnapshot,
        revision: this.currentRevision,
      }
    }

    const savingVersion = this.changeVersion
    const expectedRevision = this.currentRevision
    const savingGeneration = this.mountGeneration
    this.status = 'saving'
    this.emit()

    try {
      const commit = await this.api.saveSnapshot(boardId, expectedRevision, snapshot)
      if (savingGeneration !== this.mountGeneration || boardId !== this.boardId) {
        return { ok: true, snapshot: commit.snapshot, revision: commit.revision }
      }
      this.committedSnapshot = commit.snapshot
      this.currentRevision = commit.revision
      if (this.changeVersion === savingVersion) {
        this.pendingSnapshot = undefined
        this.status = 'clean'
      } else {
        this.status = 'dirty'
        this.scheduleAutosave()
      }
      this.emit()
      return { ok: true, snapshot: commit.snapshot, revision: commit.revision }
    } catch (error) {
      if (savingGeneration !== this.mountGeneration || boardId !== this.boardId) {
        return {
          ok: false,
          reason: isOfflineError(error) ? 'offline' : 'error',
          recoverySnapshot: snapshot,
          error,
        }
      }
      const currentRevision = conflictRevision(error)
      if (currentRevision !== undefined) {
        this.status = 'conflict'
        this.emit()
        return {
          ok: false,
          reason: 'conflict',
          currentRevision,
          recoverySnapshot: snapshot,
        }
      }

      this.status = isOfflineError(error) ? 'offline' : 'error'
      this.emit()
      return {
        ok: false,
        reason: this.status,
        recoverySnapshot: snapshot,
        error,
      }
    }
  }

  private async waitForRealtimeProjection(): Promise<BoardSessionFlushResult> {
    const boardId = this.boardId
    const editor = this.editor
    if (!boardId || !editor) {
      this.status = this.committedSnapshot === undefined ? 'loading' : 'clean'
      this.emit()
      return { ok: true, snapshot: this.committedSnapshot, revision: this.currentRevision }
    }

    const expectedSnapshot = editor.getSnapshot()
    const expectedFingerprint = documentSnapshotFingerprint(expectedSnapshot)
    const generation = this.mountGeneration
    this.status = 'saving'
    this.emit()

    try {
      for (let attempt = 0; attempt < this.realtimeSyncMaxAttempts; attempt += 1) {
        const commit = await this.api.loadBoard(boardId)
        if (generation !== this.mountGeneration || boardId !== this.boardId || editor !== this.editor) {
          return { ok: true, snapshot: commit.snapshot, revision: commit.revision }
        }
        if (documentSnapshotFingerprint(commit.snapshot) === expectedFingerprint) {
          this.committedSnapshot = commit.snapshot
          this.currentRevision = commit.revision
          this.status = 'clean'
          this.emit()
          return { ok: true, snapshot: commit.snapshot, revision: commit.revision }
        }
        await this.waitForRealtimeSync()
      }
      const error = new Error('REALTIME_SYNC_TIMEOUT')
      this.status = 'error'
      this.emit()
      return { ok: false, reason: 'error', recoverySnapshot: expectedSnapshot, error }
    } catch (error) {
      this.status = isOfflineError(error) ? 'offline' : 'error'
      this.emit()
      return {
        ok: false,
        reason: this.status,
        recoverySnapshot: expectedSnapshot,
        error,
      }
    }
  }

  flushBeforeNavigation(): Promise<BoardSessionFlushResult> {
    return this.flush()
  }

  flushBeforeClose(): Promise<BoardSessionFlushResult> {
    return this.flush()
  }

  flushBeforeReferenceEntry(): Promise<BoardSessionFlushResult> {
    return this.flush()
  }

  retry(): Promise<BoardSessionFlushResult> {
    return this.flush()
  }

  async reloadFromServer(): Promise<BoardCommit> {
    if (!this.boardId) throw new Error('Cannot reload an unmounted board session')
    const commit = await this.api.loadBoard(this.boardId)
    this.adoptServerCommit(commit.snapshot, commit.revision)
    return commit
  }

  async refreshFromServer(): Promise<BoardCommit> {
    if (!this.boardId) throw new Error('Cannot refresh an unmounted board session')
    const commit = await this.api.loadBoard(this.boardId)
    if (!this.hasPendingChanges && commit.revision !== this.currentRevision) {
      this.adoptServerCommit(commit.snapshot, commit.revision)
    }
    return commit
  }

  copyRecoverySnapshot(): unknown | undefined {
    return this.pendingSnapshot === undefined ? undefined : cloneSnapshot(this.pendingSnapshot)
  }

  adoptServerCommit(snapshot: unknown, revision: number): void {
    this.cancelAutosave()
    this.committedSnapshot = snapshot
    this.currentRevision = revision
    this.pendingSnapshot = undefined
    this.status = 'clean'
    this.loadIntoEditor(snapshot)
    this.emit()
  }

  private handleEditorChange(): void {
    if (this.suppressEditorChanges || !this.editor) return
    this.markDirty(this.editor.getSnapshot())
  }

  private isCurrentMount(
    generation: number,
    tabId: string,
    boardId: string,
    editor: BoardEditor,
  ): boolean {
    return (
      generation === this.mountGeneration &&
      tabId === this.tabId &&
      boardId === this.boardId &&
      editor === this.editor
    )
  }

  private loadIntoEditor(snapshot: unknown): void {
    if (!this.editor || snapshot === undefined) return
    this.suppressEditorChanges = true
    try {
      this.editor.loadSnapshot(snapshot)
    } finally {
      this.suppressEditorChanges = false
    }
  }

  private scheduleAutosave(): void {
    this.cancelAutosave()
    this.autosaveTimer = this.setTimer(() => {
      this.autosaveTimer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  private cancelAutosave(): void {
    if (this.autosaveTimer === undefined) return
    this.clearTimer(this.autosaveTimer)
    this.autosaveTimer = undefined
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
