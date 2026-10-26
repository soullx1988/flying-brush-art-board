import {
  BoardSession,
  type BoardEditor,
  type BoardSessionApi,
  type BoardSessionFlushResult,
  type BoardSessionStatus,
} from '../boards/board-session'
import type { BoardReferenceRecord } from '@infinite-board/board-core'
import {
  createReferenceTabHistory,
} from '../board-references/navigation-state'
import {
  acquireEditingLease,
  getEditingLease,
  releaseEditingLease,
} from './editing-lease'

export interface WorkspaceViewState {
  camera: unknown
  selectedShapeIds: string[]
  currentToolId: string
  /** Only false for a newly opened history entry; saved views must not be reframed. */
  hasBeenViewed?: boolean
}

export interface WorkspaceReferenceSource {
  referenceId: string
  sourceBoardId: string
  targetBoardId: string
  shapeId: string
  kind: 'embed' | 'link'
}

export interface WorkspaceHistoryEntry {
  entryId: string
  projectId: string
  boardId: string
  via?: WorkspaceReferenceSource
  viewState: WorkspaceViewState
}

export interface WorkspaceBoardTabSession {
  tabId: string
  projectId: string
  history: WorkspaceHistoryEntry[]
  historyIndex: number
  lastKnownRevision: number
  pendingSnapshot?: unknown
  status: BoardSessionStatus
}

export interface WorkspaceTab {
  tabId: string
  boardId: string
  source?: WorkspaceReferenceSource
  session: WorkspaceBoardTabSession
  serializedSnapshot?: unknown
  readOnly: boolean
  leaseHolderTabId?: string
}

export interface WorkspaceEditor extends BoardEditor {
  getViewState(): WorkspaceViewState
  setViewState(viewState: WorkspaceViewState): void
  setReadOnly?(readOnly: boolean, holderTabId?: string): void
  dispose(): void
}

export interface WorkspaceTabsOptions {
  projectId: string
  api: BoardSessionApi
  /** A connected room owns canvas changes, so browser-local write leases are disabled. */
  realtime?: boolean
  createEditor(snapshot: unknown, tab: WorkspaceTab): WorkspaceEditor
  createTabId?: () => string
  createSession?: () => BoardSession
  copyRecovery?: (snapshot: unknown, tab: WorkspaceTab) => void | Promise<void>
}

export type EditableInputResult =
  | { applied: true }
  | { applied: false; holderTabId: string }

export type CloseTabDecision = 'save' | 'copy-recovery' | 'discard'

export type CloseTabResult =
  | { closed: true }
  | {
      closed: false
      requiresDecision: true
      recoverySnapshot: unknown
      choices: CloseTabDecision[]
    }
  | {
      closed: false
      requiresDecision: false
      recoverySnapshot: unknown
      saveResult: Exclude<BoardSessionFlushResult, { ok: true }>
    }

type FailedFlushResult = Exclude<BoardSessionFlushResult, { ok: true }>

export class WorkspaceNavigationBlockedError extends Error {
  readonly reason: FailedFlushResult['reason']
  readonly recoverySnapshot: unknown
  readonly saveResult: FailedFlushResult

  constructor(saveResult: FailedFlushResult) {
    super(`Navigation blocked because the board could not be saved: ${saveResult.reason}`)
    this.name = 'WorkspaceNavigationBlockedError'
    this.reason = saveResult.reason
    this.recoverySnapshot = saveResult.recoverySnapshot
    this.saveResult = saveResult
  }
}

const DEFAULT_VIEW_STATE: WorkspaceViewState = {
  camera: { x: 0, y: 0, z: 1 },
  selectedShapeIds: [],
  currentToolId: 'select',
  hasBeenViewed: false,
}

function cloneViewState(viewState: WorkspaceViewState): WorkspaceViewState {
  return {
    camera:
      typeof structuredClone === 'function'
        ? structuredClone(viewState.camera)
        : viewState.camera,
    selectedShapeIds: [...viewState.selectedShapeIds],
    currentToolId: viewState.currentToolId,
    ...(viewState.hasBeenViewed === undefined ? {} : { hasBeenViewed: viewState.hasBeenViewed }),
  }
}

export class WorkspaceTabs {
  activeTabId: string | undefined

  private readonly projectId: string
  private readonly api: BoardSessionApi
  private readonly realtime: boolean
  private readonly createEditor: WorkspaceTabsOptions['createEditor']
  private readonly createTabId: NonNullable<WorkspaceTabsOptions['createTabId']>
  private readonly createSession: NonNullable<WorkspaceTabsOptions['createSession']>
  private readonly copyRecovery: NonNullable<WorkspaceTabsOptions['copyRecovery']>
  private readonly tabOrder: string[] = []
  private readonly tabsById = new Map<string, WorkspaceTab>()
  private readonly sessionsById = new Map<string, BoardSession>()
  private readonly unsubscribeById = new Map<string, () => void>()
  private readonly listeners = new Set<() => void>()
  private activeEditor: WorkspaceEditor | undefined
  private idCounter = 0
  private transitionQueue: Promise<void> = Promise.resolve()

  constructor(options: WorkspaceTabsOptions) {
    this.projectId = options.projectId
    this.api = options.api
    this.realtime = options.realtime ?? false
    this.createEditor = options.createEditor
    this.createTabId = options.createTabId ?? (() => `board-tab-${++this.idCounter}`)
    this.createSession = options.createSession ?? (() => new BoardSession({
      api: this.api,
      mode: this.realtime ? 'realtime' : 'snapshot',
    }))
    this.copyRecovery = options.copyRecovery ?? (() => undefined)
  }

  get tabs(): readonly WorkspaceTab[] {
    return this.tabOrder.flatMap((tabId) => {
      const tab = this.tabsById.get(tabId)
      return tab ? [tab] : []
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getTab(tabId: string): WorkspaceTab | undefined {
    return this.tabsById.get(tabId)
  }

  getActiveEditor(): WorkspaceEditor | undefined {
    return this.activeEditor
  }

  get hasPendingChanges(): boolean {
    for (const tabId of this.tabOrder) {
      if (this.sessionsById.get(tabId)?.hasPendingChanges) return true
    }
    return false
  }

  openBoardInNewTab(
    boardId: string,
    source?: WorkspaceReferenceSource,
  ): Promise<WorkspaceTab> {
    return this.runTransition(() => this.openBoardInNewTabNow(boardId, source))
  }

  private async openBoardInNewTabNow(
    boardId: string,
    source?: WorkspaceReferenceSource,
  ): Promise<WorkspaceTab> {
    const previousTabId = this.activeTabId
    await this.deactivateActiveTab()
    const tabId = this.createTabId()
    const tab = this.createTab(tabId, boardId, source)
    this.tabOrder.push(tabId)
    this.tabsById.set(tabId, tab)
    this.activeTabId = tabId
    try {
      await this.attachTab(tab, false)
    } catch (error) {
      await this.rollbackProvisionalTab(tab, previousTabId)
      throw error
    }
    this.emit()
    return tab
  }

  openBoardInCurrentTab(boardId: string): Promise<WorkspaceTab> {
    return this.runTransition(() => this.openBoardInCurrentTabNow(boardId))
  }

  private async openBoardInCurrentTabNow(boardId: string): Promise<WorkspaceTab> {
    const currentTabId = this.activeTabId
    if (!currentTabId) return this.openBoardInNewTabNow(boardId)
    const currentTab = this.requireTab(currentTabId)
    if (currentTab.boardId === boardId) {
      if (!this.activeEditor) await this.attachTab(currentTab, false)
      return currentTab
    }

    await this.flushActiveForBoardReplacement(currentTab)
    this.disposeSession(currentTab)
    releaseEditingLease(this.projectId, currentTab.boardId, currentTab.tabId)

    currentTab.boardId = boardId
    currentTab.readOnly = !this.realtime
    delete currentTab.leaseHolderTabId
    delete currentTab.serializedSnapshot
    currentTab.session.history = currentTab.session.history.slice(
      0,
      currentTab.session.historyIndex + 1,
    )
    currentTab.session.history.push(this.createHistoryEntry(boardId))
    currentTab.session.historyIndex = currentTab.session.history.length - 1
    currentTab.session.lastKnownRevision = 0
    currentTab.session.status = 'loading'
    delete currentTab.session.pendingSnapshot
    this.installSession(currentTab)
    this.activeTabId = currentTabId
    await this.attachTab(currentTab, false)
    this.emit()
    return currentTab
  }

  enterReferenceTarget(
    boardId: string,
    source: WorkspaceReferenceSource,
  ): Promise<WorkspaceTab> {
    return this.runTransition(() => this.enterReferenceTargetNow(boardId, source))
  }

  enterReference(
    tabId: string,
    reference: BoardReferenceRecord,
    mode: 'current' | 'new-tab',
  ): Promise<WorkspaceTab> {
    return this.runTransition(async () => {
      const sourceTab = this.requireTab(tabId)
      if (reference.projectId !== this.projectId) {
        throw new Error(`Reference ${reference.id} belongs to another project`)
      }
      if (sourceTab.boardId !== reference.sourceBoardId) {
        throw new Error(`Reference ${reference.id} does not leave tab ${tabId}`)
      }
      if (this.activeTabId !== tabId) await this.activateTabNow(tabId)
      const source: WorkspaceReferenceSource = {
        referenceId: reference.id,
        sourceBoardId: reference.sourceBoardId,
        targetBoardId: reference.targetBoardId,
        shapeId: reference.shapeId,
        kind: reference.kind,
      }
      if (mode === 'new-tab') return this.openReferenceInNewTabNow(reference, source)
      return this.enterReferenceTargetNow(reference.targetBoardId, source)
    })
  }

  goBackAlongHistoryPath(tabId: string): Promise<WorkspaceTab | undefined> {
    return this.runTransition(async () => {
      const tab = this.requireTab(tabId)
      if (tab.session.historyIndex === 0) return undefined
      return this.goToHistoryEntryNow(tabId, tab.session.historyIndex - 1)
    })
  }

  goToHistoryEntry(tabId: string, index: number): Promise<WorkspaceTab> {
    return this.runTransition(() => this.goToHistoryEntryNow(tabId, index))
  }

  private async goToHistoryEntryNow(tabId: string, index: number): Promise<WorkspaceTab> {
    const tab = this.requireTab(tabId)
    const targetEntry = tab.session.history[index]
    if (!targetEntry) throw new Error(`History entry ${index} does not exist in tab ${tabId}`)
    if (tab.session.historyIndex === index) {
      if (this.activeTabId !== tabId) await this.activateTabNow(tabId)
      else if (!this.activeEditor) await this.attachTab(tab, false)
      return tab
    }
    if (this.activeTabId !== tabId) await this.activateTabNow(tabId)

    await this.flushActiveForBoardReplacement(tab)
    this.disposeSession(tab)
    releaseEditingLease(this.projectId, tab.boardId, tab.tabId)

    tab.session.historyIndex = index
    tab.boardId = targetEntry.boardId
    if (targetEntry.via) {
      tab.source = { ...targetEntry.via }
    } else {
      delete tab.source
    }
    tab.readOnly = !this.realtime
    delete tab.leaseHolderTabId
    delete tab.serializedSnapshot
    tab.session.lastKnownRevision = 0
    tab.session.status = 'loading'
    delete tab.session.pendingSnapshot
    this.installSession(tab)
    this.activeTabId = tabId
    await this.attachTab(tab, false)
    this.emit()
    return tab
  }

  private async enterReferenceTargetNow(
    boardId: string,
    source: WorkspaceReferenceSource,
  ): Promise<WorkspaceTab> {
    const currentTabId = this.activeTabId
    if (!currentTabId) return this.openBoardInNewTabNow(boardId, source)
    const currentTab = this.requireTab(currentTabId)
    await this.flushActiveForBoardReplacement(currentTab)
    this.disposeSession(currentTab)
    releaseEditingLease(this.projectId, currentTab.boardId, currentTab.tabId)

    currentTab.boardId = boardId
    currentTab.source = source
    currentTab.readOnly = !this.realtime
    delete currentTab.leaseHolderTabId
    delete currentTab.serializedSnapshot
    currentTab.session.history = currentTab.session.history.slice(
      0,
      currentTab.session.historyIndex + 1,
    )
    currentTab.session.history.push(this.createHistoryEntry(boardId, source))
    currentTab.session.historyIndex = currentTab.session.history.length - 1
    currentTab.session.lastKnownRevision = 0
    currentTab.session.status = 'loading'
    delete currentTab.session.pendingSnapshot
    this.installSession(currentTab)
    this.activeTabId = currentTabId
    await this.attachTab(currentTab, false)
    this.emit()
    return currentTab
  }

  activateTab(tabId: string): Promise<WorkspaceTab> {
    return this.runTransition(() => this.activateTabNow(tabId))
  }

  private async activateTabNow(tabId: string): Promise<WorkspaceTab> {
    const tab = this.requireTab(tabId)
    if (this.activeTabId === tabId && this.activeEditor) return tab

    await this.deactivateActiveTab()
    this.activeTabId = tabId
    await this.attachTab(tab, true)
    this.emit()
    return tab
  }

  applyEditableInput(
    tabId: string,
    applyInput: (editor: WorkspaceEditor) => void,
  ): EditableInputResult {
    const leaseResult = this.acquireEditingLease(tabId)
    if (!leaseResult.applied) return leaseResult

    const editor = this.activeEditor
    if (!editor) throw new Error(`Tab ${tabId} does not own the active editor`)
    applyInput(editor)
    this.syncTab(this.requireTab(tabId))
    this.emit()
    return { applied: true }
  }

  /**
   * Synchronously authorizes a mounted tldraw input before that input reaches
   * tldraw's mutable document handlers.
   */
  acquireEditingLease(tabId: string): EditableInputResult {
    const tab = this.requireTab(tabId)
    if (this.activeTabId !== tabId || !this.activeEditor) {
      throw new Error(`Tab ${tabId} does not own the active editor`)
    }

    if (this.realtime) {
      tab.readOnly = false
      delete tab.leaseHolderTabId
      this.activeEditor.setReadOnly?.(false)
      this.emit()
      return { applied: true }
    }

    const lease = acquireEditingLease(this.projectId, tab.boardId, tabId)
    if (!lease.acquired) {
      tab.readOnly = !this.realtime
      tab.leaseHolderTabId = lease.holderTabId
      this.activeEditor.setReadOnly?.(true, lease.holderTabId)
      this.emit()
      return { applied: false, holderTabId: lease.holderTabId }
    }

    tab.readOnly = false
    delete tab.leaseHolderTabId
    this.activeEditor.setReadOnly?.(false)
    this.emit()
    return { applied: true }
  }

  reorderTab(sourceTabId: string, targetTabId: string): void {
    this.requireTab(sourceTabId)
    this.requireTab(targetTabId)
    if (sourceTabId === targetTabId) return
    const sourceIndex = this.tabOrder.indexOf(sourceTabId)
    this.tabOrder.splice(sourceIndex, 1)
    const targetIndex = this.tabOrder.indexOf(targetTabId)
    this.tabOrder.splice(targetIndex + 1, 0, sourceTabId)
    this.emit()
  }

  adoptCommandCommit(tabId: string, snapshot: unknown, revision: number): void {
    const tab = this.requireTab(tabId)
    const session = this.requireSession(tabId)
    session.adoptServerCommit(snapshot, revision)
    tab.serializedSnapshot = session.serializeSnapshot()
    this.syncTab(tab)
    this.emit()
  }

  async retryTabSave(tabId: string): Promise<BoardSessionFlushResult> {
    const tab = this.requireTab(tabId)
    const result = await this.requireSession(tabId).retry()
    this.syncTab(tab)
    this.emit()
    return result
  }

  async reloadTabFromServer(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId)
    await this.requireSession(tabId).reloadFromServer()
    tab.serializedSnapshot = this.requireSession(tabId).serializeSnapshot()
    this.syncTab(tab)
    this.emit()
  }

  async copyTabRecovery(tabId: string): Promise<boolean> {
    const tab = this.requireTab(tabId)
    const snapshot = this.requireSession(tabId).copyRecoverySnapshot()
    if (snapshot === undefined) return false
    await this.copyRecovery(snapshot, tab)
    return true
  }

  closeTab(
    tabId: string,
    decision?: CloseTabDecision,
  ): Promise<CloseTabResult> {
    return this.runTransition(() => this.closeTabNow(tabId, decision))
  }

  private async closeTabNow(
    tabId: string,
    decision?: CloseTabDecision,
  ): Promise<CloseTabResult> {
    const tab = this.requireTab(tabId)
    const session = this.requireSession(tabId)
    const recoverySnapshot = session.copyRecoverySnapshot()
    const decisionVersion = session.pendingVersion
    if (recoverySnapshot !== undefined && decision === undefined) {
      return {
        closed: false,
        requiresDecision: true,
        recoverySnapshot,
        choices: ['save', 'copy-recovery', 'discard'],
      }
    }

    if (recoverySnapshot !== undefined && decision === 'save') {
      const result = await session.flushBeforeClose()
      this.syncTab(tab)
      if (!result.ok) {
        return {
          closed: false,
          requiresDecision: false,
          recoverySnapshot,
          saveResult: result,
        }
      }
      if (session.hasPendingChanges) {
        return {
          closed: false,
          requiresDecision: true,
          recoverySnapshot: session.copyRecoverySnapshot(),
          choices: ['save', 'copy-recovery', 'discard'],
        }
      }
    } else if (recoverySnapshot !== undefined && decision === 'copy-recovery') {
      await this.copyRecovery(recoverySnapshot, tab)
      if (session.pendingVersion !== decisionVersion) {
        return {
          closed: false,
          requiresDecision: true,
          recoverySnapshot: session.copyRecoverySnapshot(),
          choices: ['save', 'copy-recovery', 'discard'],
        }
      }
    }

    if (recoverySnapshot === undefined) {
      await session.flushBeforeClose()
      this.syncTab(tab)
      if (session.hasPendingChanges) {
        return {
          closed: false,
          requiresDecision: true,
          recoverySnapshot: session.copyRecoverySnapshot(),
          choices: ['save', 'copy-recovery', 'discard'],
        }
      }
    }
    const wasActive = this.activeTabId === tabId
    if (wasActive) this.disposeActiveEditor(tab)
    const oldIndex = this.tabOrder.indexOf(tabId)
    this.removeTab(tab)

    if (wasActive) {
      this.activeTabId = undefined
      const nextTabId = this.tabOrder[Math.min(oldIndex, this.tabOrder.length - 1)]
      if (nextTabId) await this.activateTabNow(nextTabId)
    }
    this.emit()
    return { closed: true }
  }

  async flushBeforePageClose(): Promise<BoardSessionFlushResult[]> {
    const results: BoardSessionFlushResult[] = []
    for (const tabId of this.tabOrder) {
      const tab = this.requireTab(tabId)
      const result = await this.requireSession(tabId).flushBeforeClose()
      this.syncTab(tab)
      results.push(result)
    }
    return results
  }

  leaveWorkspace(): Promise<void> {
    return this.runTransition(async () => {
      const activeTabId = this.activeTabId

      // A failed save can remain attached to an inactive tab after the user
      // switches away from it. Flush those recovery snapshots before touching
      // the active editor so a blocked exit leaves the current canvas mounted.
      for (const tabId of this.tabOrder) {
        if (tabId === activeTabId) continue
        const tab = this.requireTab(tabId)
        const session = this.requireSession(tabId)
        const result = await session.flushBeforeNavigation()
        tab.serializedSnapshot = session.serializeSnapshot()
        this.syncTab(tab)
        if (!result.ok) throw new WorkspaceNavigationBlockedError(result)
        if (!session.hasPendingChanges) {
          releaseEditingLease(this.projectId, tab.boardId, tab.tabId)
          tab.readOnly = !this.realtime
          delete tab.leaseHolderTabId
        }
      }

      if (!activeTabId) return
      const tab = this.requireTab(activeTabId)
      if (this.activeEditor) {
        await this.flushActiveForBoardReplacement(tab)
        return
      }

      const session = this.requireSession(activeTabId)
      const result = await session.flushBeforeNavigation()
      tab.serializedSnapshot = session.serializeSnapshot()
      this.syncTab(tab)
      if (!result.ok) throw new WorkspaceNavigationBlockedError(result)
    })
  }

  dispose(): void {
    if (this.activeTabId) {
      const activeTab = this.tabsById.get(this.activeTabId)
      if (activeTab) this.disposeActiveEditor(activeTab)
    }
    for (const tab of this.tabs) this.removeTab(tab)
    this.listeners.clear()
    this.activeTabId = undefined
  }

  private createTab(
    tabId: string,
    boardId: string,
    source?: WorkspaceReferenceSource,
  ): WorkspaceTab {
    const historyEntry = this.createHistoryEntry(boardId, source)
    const tab: WorkspaceTab = {
      tabId,
      boardId,
      session: {
        tabId,
        projectId: this.projectId,
        history: [historyEntry],
        historyIndex: 0,
        lastKnownRevision: 0,
        status: 'loading',
      },
      readOnly: !this.realtime,
    }
    if (source) tab.source = source
    this.installSession(tab)
    return tab
  }

  private async openReferenceInNewTabNow(
    reference: BoardReferenceRecord,
    source: WorkspaceReferenceSource,
  ): Promise<WorkspaceTab> {
    const activeTabId = this.activeTabId
    if (!activeTabId) return this.openBoardInNewTabNow(reference.targetBoardId, source)
    const sourceTab = this.requireTab(activeTabId)
    await this.deactivateActiveTab()
    const sourceEntry = this.currentHistoryEntry(sourceTab)
    const navigation = createReferenceTabHistory(
      sourceEntry,
      reference,
      () => `history-${++this.idCounter}`,
    )
    const tabId = this.createTabId()
    const tab = this.createTab(tabId, reference.targetBoardId, source)
    tab.session.history = navigation.history
    tab.session.historyIndex = navigation.historyIndex
    this.tabOrder.push(tabId)
    this.tabsById.set(tabId, tab)
    this.activeTabId = tabId
    try {
      await this.attachTab(tab, false)
    } catch (error) {
      await this.rollbackProvisionalTab(tab, activeTabId)
      throw error
    }
    this.emit()
    return tab
  }

  private createHistoryEntry(
    boardId: string,
    source?: WorkspaceReferenceSource,
  ): WorkspaceHistoryEntry {
    const entry: WorkspaceHistoryEntry = {
      entryId: `history-${++this.idCounter}`,
      projectId: this.projectId,
      boardId,
      viewState: cloneViewState(DEFAULT_VIEW_STATE),
    }
    if (source) entry.via = source
    return entry
  }

  private installSession(tab: WorkspaceTab): void {
    const session = this.createSession()
    this.sessionsById.set(tab.tabId, session)
    this.unsubscribeById.set(
      tab.tabId,
      session.subscribe(() => {
        this.syncTab(tab)
        this.emit()
      }),
    )
  }

  private async attachTab(tab: WorkspaceTab, refresh: boolean): Promise<void> {
    const session = this.requireSession(tab.tabId)
    if (refresh) {
      const serverCommit = await this.api.loadBoard(tab.boardId)
      if (session.hasPendingChanges) {
        const lease = getEditingLease(this.projectId, tab.boardId)
        if (lease?.holderTabId === tab.tabId) {
          await session.flush()
        } else if (lease) {
          tab.readOnly = !this.realtime
          tab.leaseHolderTabId = lease.holderTabId
        }
      } else if (serverCommit.revision !== session.currentRevision) {
        session.adoptServerCommit(serverCommit.snapshot, serverCommit.revision)
      }
      tab.serializedSnapshot = session.serializeSnapshot()
      this.syncTab(tab)
    }

    const editor = this.createEditor(tab.serializedSnapshot, tab)
    this.activeEditor = editor
    try {
      await session.mount(tab.tabId, tab.boardId, editor)
    } catch (error) {
      this.activeEditor = undefined
      editor.dispose()
      throw error
    }
    tab.serializedSnapshot = session.serializeSnapshot()
    editor.setViewState(this.currentHistoryEntry(tab).viewState)
    editor.setReadOnly?.(tab.readOnly, tab.leaseHolderTabId)
    this.syncTab(tab)
  }

  private async deactivateActiveTab(): Promise<void> {
    const tabId = this.activeTabId
    const editor = this.activeEditor
    if (!tabId || !editor) return
    const tab = this.requireTab(tabId)
    const session = this.requireSession(tabId)
    this.currentHistoryEntry(tab).viewState = cloneViewState(editor.getViewState())
    const result = await session.flushBeforeNavigation()
    tab.serializedSnapshot = session.serializeSnapshot()
    if (result.ok && !session.hasPendingChanges) {
      releaseEditingLease(this.projectId, tab.boardId, tab.tabId)
      tab.readOnly = !this.realtime
      delete tab.leaseHolderTabId
    }
    this.syncTab(tab)
    this.disposeActiveEditor(tab)
  }

  private async flushActiveForBoardReplacement(tab: WorkspaceTab): Promise<void> {
    const editor = this.activeEditor
    const session = this.requireSession(tab.tabId)
    if (editor) {
      this.currentHistoryEntry(tab).viewState = cloneViewState(editor.getViewState())
    }
    const result = await session.flushBeforeNavigation()
    tab.serializedSnapshot = session.serializeSnapshot()
    this.syncTab(tab)
    if (!result.ok) throw new WorkspaceNavigationBlockedError(result)
    if (!session.hasPendingChanges) {
      releaseEditingLease(this.projectId, tab.boardId, tab.tabId)
    }
    this.disposeActiveEditor(tab)
  }

  private disposeActiveEditor(tab: WorkspaceTab): void {
    const editor = this.activeEditor
    if (!editor) return
    this.currentHistoryEntry(tab).viewState = cloneViewState(editor.getViewState())
    const session = this.requireSession(tab.tabId)
    tab.serializedSnapshot = session.serializeSnapshot()
    session.detachEditor()
    this.activeEditor = undefined
    editor.dispose()
  }

  private syncTab(tab: WorkspaceTab): void {
    const session = this.sessionsById.get(tab.tabId)
    if (!session) return
    tab.session.lastKnownRevision = session.currentRevision
    tab.session.status = session.status
    if (session.pendingSnapshot === undefined) {
      delete tab.session.pendingSnapshot
    } else {
      tab.session.pendingSnapshot = session.pendingSnapshot
    }
  }

  private currentHistoryEntry(tab: WorkspaceTab): WorkspaceHistoryEntry {
    const entry = tab.session.history[tab.session.historyIndex]
    if (!entry) throw new Error(`Tab ${tab.tabId} has no current history entry`)
    return entry
  }

  private requireTab(tabId: string): WorkspaceTab {
    const tab = this.tabsById.get(tabId)
    if (!tab) throw new Error(`Unknown workspace tab: ${tabId}`)
    return tab
  }

  private requireSession(tabId: string): BoardSession {
    const session = this.sessionsById.get(tabId)
    if (!session) throw new Error(`Workspace tab ${tabId} has no board session`)
    return session
  }

  private disposeSession(tab: WorkspaceTab): void {
    this.unsubscribeById.get(tab.tabId)?.()
    this.unsubscribeById.delete(tab.tabId)
    this.sessionsById.get(tab.tabId)?.dispose()
    this.sessionsById.delete(tab.tabId)
  }

  private async rollbackProvisionalTab(
    tab: WorkspaceTab,
    previousTabId: string | undefined,
  ): Promise<void> {
    if (this.activeEditor && this.activeTabId === tab.tabId) this.disposeActiveEditor(tab)
    this.removeTab(tab)
    this.activeTabId = previousTabId
    const previousTab = previousTabId ? this.tabsById.get(previousTabId) : undefined
    if (previousTab && !this.activeEditor) await this.attachTab(previousTab, false)
    this.emit()
  }

  private removeTab(tab: WorkspaceTab): void {
    this.disposeSession(tab)
    releaseEditingLease(this.projectId, tab.boardId, tab.tabId)
    this.tabsById.delete(tab.tabId)
    const index = this.tabOrder.indexOf(tab.tabId)
    if (index >= 0) this.tabOrder.splice(index, 1)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private runTransition<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transitionQueue.then(operation)
    this.transitionQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export function openBoardInCurrentTab(
  workspace: WorkspaceTabs,
  boardId: string,
): Promise<WorkspaceTab> {
  return workspace.openBoardInCurrentTab(boardId)
}

export function openBoardInNewTab(
  workspace: WorkspaceTabs,
  boardId: string,
  source?: WorkspaceReferenceSource,
): Promise<WorkspaceTab> {
  return workspace.openBoardInNewTab(boardId, source)
}

export function activateTab(workspace: WorkspaceTabs, tabId: string): Promise<WorkspaceTab> {
  return workspace.activateTab(tabId)
}

export function closeTab(
  workspace: WorkspaceTabs,
  tabId: string,
  decision?: CloseTabDecision,
): Promise<CloseTabResult> {
  return workspace.closeTab(tabId, decision)
}

export function reorderTab(
  workspace: WorkspaceTabs,
  sourceTabId: string,
  targetTabId: string,
): void {
  workspace.reorderTab(sourceTabId, targetTabId)
}
