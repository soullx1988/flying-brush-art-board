import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultHandleExternalTextContent,
  type Editor,
  type TLShapeId,
} from 'tldraw'
import { Button, Empty, toast } from '@ttqtt/liquid-glass-react'

import type {
  BoardClipboardPayload,
  ClipboardPasteRequest,
  BoardReferenceKind,
  BoardReferenceRecord,
  StoredBoard,
} from '@infinite-board/board-core'
import {
  BOARD_REFERENCE_DEFAULT_HEIGHT,
  BOARD_REFERENCE_DEFAULT_WIDTH,
  type BoardReferenceShape,
  collectClipboardPayload,
  setBoardReferencePreviewResolver,
} from '@infinite-board/tldraw-adapter'

import type { BoardSessionApi } from '../boards/board-session'
import { BoardPage } from '../boards/BoardPage'
import { BoardTopicLocation } from '../boards/BoardTopicLocation'
import { RealtimeBoardPage } from '../realtime/RealtimeBoardPage'
import type { CommentClient } from '../comments/comment-client'
import type { AuditClient } from '../audit/AuditPanel'
import { CreateBoardDialog } from '../boards/CreateBoardDialog'
import {
  ProjectHomePage,
  type CreateBoardInput,
  type ProjectHomeClient,
  type ProjectHomeData,
} from '../boards/ProjectHomePage'
import { BrowserClipboardService } from '../clipboard/clipboard-service'
import {
  clipboardRootShapeIds,
  clipboardHasTldrawContent,
  structuredClipboardAssets,
  structuredClipboardPlainText,
  writeTldrawClipboardData,
} from '../clipboard/clipboard-routing'
import { createBrowserUuid } from '../../app/browser-uuid'
import { HistoryBreadcrumbs } from '../board-references/HistoryBreadcrumbs'
import { InboundReferenceList } from '../board-references/InboundReferenceList'
import { repairImportedReferenceParent } from '../board-references/repair-imported-reference'
import {
  CreateBoardReferenceDialog,
  type CreateBoardReferenceInput,
} from '../board-references/CreateBoardReferenceDialog'
import {
  findInboundReferences,
  historyBreadcrumbEntries,
  isBrowserBoardHistoryState,
  validateSharedReferencePath,
} from '../board-references/navigation-state'
import {
  type BoardNavigationNavigate,
  useBoardNavigation,
} from '../board-references/use-board-navigation'
import { AppDropOverlay, type AppDropTarget } from '../import-export/AppDropOverlay'
import {
  createDropImportController,
} from '../import-export/DropImportController'
import {
  IboardImportWizard,
  type IboardImportClient,
  type IboardImportCommitResult,
} from '../import-export/IboardImportWizard'
import {
  DrawioImportDialog,
  prepareDrawioBoardImport,
  type DrawioImportResult,
} from '../import-export/DrawioImportDialog'
import {
  importVisualFile,
  type VisualImportInput,
} from '../import-export/visual-import'
import { chineseErrorMessage } from '../../ui-text'
import { registerWorkspaceExitGuard } from '../../app/workspace-exit-guard'
import {
  BoardTabStrip,
  DEFAULT_MAX_VISIBLE_BOARD_TABS,
  WORKSPACE_TEMPORARY_TAB_TARGET_ID,
  type BoardTabView,
} from './BoardTabStrip'
import { useWorkspaceTabs } from './use-workspace-tabs'
import { WorkspaceCommandLayer } from './WorkspaceCommandLayer'
import { WorkspaceDecisionDialogs } from './WorkspaceDecisionDialogs'
import {
  WorkspaceLibraryDrawers,
  type WorkspaceLibraryPanel,
} from './WorkspaceLibraryDrawers'
import {
  WorkspaceTabs,
  WorkspaceNavigationBlockedError,
  type CloseTabDecision,
  type WorkspaceTab,
} from './workspace-tabs'
import { TldrawWorkspaceEditor } from './TldrawWorkspaceEditor'
import type { TldrawUserIdentity } from '../auth/tldraw-user'

export interface ClipboardCommandReceipt {
  commandId: string
  boardId: string
  revision: number
  snapshot: unknown
  idMap: Record<string, string>
  createdReferenceIds: string[]
}

type ClipboardHistoryCommand = {
  commandId: string
  state: 'applied' | 'undone'
  appliedFingerprint: string
  undoneFingerprint?: string
}

function canonicalizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshot)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeSnapshot(child)]),
  )
}

function documentSnapshotFingerprint(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return JSON.stringify(snapshot)
  const value = snapshot as {
    document?: { store?: Record<string, unknown> }
    store?: Record<string, unknown>
  }
  return JSON.stringify(canonicalizeSnapshot(value.document?.store ?? value.store ?? value))
}

function downloadRecoverySnapshot(snapshot: unknown, title: string): void {
  const candidate = snapshot as { schema?: unknown; store?: Record<string, unknown> }
  const payload = candidate?.store && typeof candidate.store === 'object'
    ? {
        tldrawFileFormatVersion: 1,
        schema: candidate.schema,
        records: Object.values(candidate.store),
      }
    : snapshot
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').trim() || '画板'
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/vnd.tldraw+json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeTitle}-恢复副本.tldr`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export interface WorkspaceClient extends ProjectHomeClient, BoardSessionApi, IboardImportClient {
  createBoardWithClipboard(
    projectId: string,
    input: CreateBoardInput,
    payload: BoardClipboardPayload,
  ): Promise<StoredBoard>
  pasteClipboard(
    boardId: string,
    payload: BoardClipboardPayload,
    expectedRevision: number,
    placement?: ClipboardPasteRequest['placement'],
  ): Promise<ClipboardCommandReceipt>
  undoClipboard(commandId: string, expectedRevision: number): Promise<ClipboardCommandReceipt>
  redoClipboard(commandId: string, expectedRevision: number): Promise<ClipboardCommandReceipt>
  createBoardReference(
    sourceBoardId: string,
    input:
      | { targetBoardId: string; shapeId: string; kind: BoardReferenceKind; expectedRevision: number; placement?: { x: number; y: number } }
      | { newBoard: { id: string; title: string; tldrawSnapshot: unknown }; shapeId: string; kind: 'embed'; expectedRevision: number; placement?: { x: number; y: number } },
  ): Promise<{ reference: BoardReferenceRecord; revision: number; snapshot: unknown }>
  updateBoardReference(
    referenceId: string,
    input: { targetBoardId?: string; kind?: BoardReferenceKind; expectedRevision: number },
  ): Promise<{ reference: BoardReferenceRecord; revision: number; snapshot: unknown }>
  removeBoardReference(
    referenceId: string,
    expectedRevision: number,
  ): Promise<{ reference: BoardReferenceRecord; revision: number; snapshot: unknown }>
  renameBoard(boardId: string, title: string): Promise<StoredBoard>
  deleteBoard(boardId: string): Promise<void>
}

function isCommentClient(client: WorkspaceClient): client is WorkspaceClient & CommentClient {
  const candidate = client as Partial<CommentClient>
  return typeof candidate.listThreads === 'function'
    && typeof candidate.listMessages === 'function'
    && typeof candidate.createThread === 'function'
    && typeof candidate.addMessage === 'function'
    && typeof candidate.setThreadStatus === 'function'
    && typeof candidate.updateThreadAnchor === 'function'
}

function isAuditClient(client: WorkspaceClient): client is WorkspaceClient & AuditClient {
  return typeof (client as Partial<AuditClient>).listAuditEvents === 'function'
}

export interface WorkspaceShellProps {
  projectId: string
  routeBoardId?: string
  routePathReferenceIds?: readonly string[]
  routeHistoryState?: unknown
  client: WorkspaceClient
  navigate: BoardNavigationNavigate
  enableRealtime?: boolean
  tldrawUser?: TldrawUserIdentity
}

function boardTitle(data: ProjectHomeData | undefined, boardId: string): string {
  return data?.boards.find((board) => board.id === boardId)?.title ?? boardId
}

function isEditableClipboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}

function clipboardContainsFiles(data: DataTransfer): boolean {
  if (data.files.length > 0) return true
  if (Array.from(data.items).some((item) => item.kind === 'file')) return true
  return Array.from(data.types).some((type) => type.startsWith('image/'))
}

function readClipboardText(data: DataTransfer, type: string): string {
  try {
    return data.getData(type)
  } catch {
    return ''
  }
}

function htmlTextContent(html: string): string {
  if (!html) return ''
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
}

function isPointerOverCanvas(editor: Editor): boolean {
  return editor.getContainer().matches(':hover')
}

function getPastePoint(editor: Editor): { x: number; y: number } {
  if (isPointerOverCanvas(editor)) {
    const point = editor.inputs.getCurrentPagePoint()
    return { x: point.x, y: point.y }
  }
  const center = editor.getViewportPageBounds().center
  return { x: center.x, y: center.y }
}

export function WorkspaceShell({
  projectId,
  routeBoardId,
  routePathReferenceIds = [],
  routeHistoryState,
  client,
  navigate,
  enableRealtime = true,
  tldrawUser,
}: WorkspaceShellProps) {
  const projectDataRef = useRef<ProjectHomeData | undefined>(undefined)
  const sharedEditor = useMemo(() => new TldrawWorkspaceEditor(undefined), [projectId])
  const workspace = useMemo(
    () =>
      new WorkspaceTabs({
        projectId,
        api: client,
        realtime: enableRealtime,
        createEditor: (snapshot) => sharedEditor.prepare(snapshot),
        copyRecovery: (snapshot, tab) => {
          const title = projectDataRef.current?.boards.find((board) => board.id === tab.boardId)?.title ?? '画板'
          downloadRecoverySnapshot(snapshot, title)
        },
      }),
    [client, enableRealtime, projectId, sharedEditor],
  )
  const workspaceState = useWorkspaceTabs(workspace)
  const boardNavigation = useBoardNavigation(projectId, workspaceState, navigate)
  const clipboard = useMemo(() => new BrowserClipboardService(), [])
  const [projectData, setProjectData] = useState<ProjectHomeData>()
  const [projectLoadError, setProjectLoadError] = useState<string>()
  const [routeLoadError, setRouteLoadError] = useState<string>()
  const [routeLoadAttempt, setRouteLoadAttempt] = useState(0)
  const [workspacePanel, setWorkspacePanel] = useState<WorkspaceLibraryPanel>()
  const [commandOpen, setCommandOpen] = useState(false)
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string>()
  const [pendingCloseBusy, setPendingCloseBusy] = useState(false)
  const [pendingCloseError, setPendingCloseError] = useState<string>()
  const [referenceRename, setReferenceRename] = useState<{ boardId: string; title: string }>()
  const [referenceRenameTitle, setReferenceRenameTitle] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createReferenceDialogOpen, setCreateReferenceDialogOpen] = useState(false)
  const [createReferencePlacement, setCreateReferencePlacement] = useState<{ x: number; y: number }>()
  const [temporaryProgress, setTemporaryProgress] = useState<string>()
  const [importWizard, setImportWizard] = useState<{ key: string; file?: File }>()
  const [drawioImport, setDrawioImport] = useState<{ key: string; file?: File }>()
  const [navigationBlocked, setNavigationBlocked] = useState<WorkspaceNavigationBlockedError>()
  const [pendingInboundLocation, setPendingInboundLocation] = useState<{ boardId: string; shapeId: string }>()
  const clipboardCommands = useRef(new Map<string, ClipboardHistoryCommand[]>())
  const pasteAsPlainTextShortcut = useRef(false)
  const windowPasteHandler = useRef<(event: ClipboardEvent) => void>(() => undefined)
  const mountedWorkspace = useRef<WorkspaceTabs | undefined>(undefined)
  const handledRouteKey = useRef<string | undefined>(undefined)
  const lastBoardRouteId = useRef(routeBoardId)
  const projectHomeExitAttempted = useRef(false)
  const latestProjectRefresh = useRef(0)
  const [projectHomeReady, setProjectHomeReady] = useState(!routeBoardId)

  useEffect(() => {
    projectDataRef.current = projectData
  }, [projectData])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        pasteAsPlainTextShortcut.current = event.shiftKey
        if (!isEditableClipboardTarget(event.target)) {
          const editor = (workspaceState.activeEditor as TldrawWorkspaceEditor | undefined)?.getTldrawEditor()
          if (editor && isPointerOverCanvas(editor)) editor.getContainer().focus({ preventScroll: true })
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'v') pasteAsPlainTextShortcut.current = false
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [workspaceState.activeEditor])

  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => windowPasteHandler.current(event)
    window.addEventListener('paste', onWindowPaste, true)
    return () => window.removeEventListener('paste', onWindowPaste, true)
  }, [])

  const guardWorkspaceExit = useCallback(async () => {
    setNavigationBlocked(undefined)
    try {
      await workspace.leaveWorkspace()
    } catch (error) {
      if (error instanceof WorkspaceNavigationBlockedError) setNavigationBlocked(error)
      throw error
    }
  }, [workspace])

  const refreshProject = async () => {
    const refreshId = ++latestProjectRefresh.current
    setProjectLoadError(undefined)
    try {
      const data = await client.getProject(projectId)
      // The landing-page fetch can resolve after a new-board refresh. Do not
      // replace the current Board graph with that now-stale response while a
      // route transition is mounting its tab.
      if (refreshId === latestProjectRefresh.current) setProjectData(data)
      return data
    } catch (error) {
      if (refreshId === latestProjectRefresh.current) setProjectLoadError(chineseErrorMessage(error, '无法加载项目，请稍后重试。'))
      throw error
    }
  }

  useEffect(() => {
    void refreshProject().catch(() => undefined)
  }, [client, projectId])

  useEffect(
    () => registerWorkspaceExitGuard(guardWorkspaceExit),
    [guardWorkspaceExit],
  )

  useEffect(() => {
    const flushBeforePageExit = (event: BeforeUnloadEvent) => {
      if (!workspace.hasPendingChanges) return
      event.preventDefault()
      event.returnValue = ''
      void workspace.flushBeforePageClose().catch(() => undefined)
    }
    const flushOnPageHide = () => {
      if (workspace.hasPendingChanges) {
        void workspace.flushBeforePageClose().catch(() => undefined)
      }
    }
    window.addEventListener('beforeunload', flushBeforePageExit)
    window.addEventListener('pagehide', flushOnPageHide)
    return () => {
      window.removeEventListener('beforeunload', flushBeforePageExit)
      window.removeEventListener('pagehide', flushOnPageHide)
    }
  }, [workspace])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setCreateDialogOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(
    () => setBoardReferencePreviewResolver(
      (boardId) => {
        const board = projectData?.boards.find((candidate) => candidate.id === boardId)
        const tab = workspace.tabs.find((candidate) => candidate.boardId === boardId)
        const liveSnapshot = tab?.tabId === workspace.activeTabId
          ? workspace.getActiveEditor()?.getSnapshot()
          : tab?.session.pendingSnapshot ?? tab?.serializedSnapshot
        const snapshot = liveSnapshot ?? board?.tldrawSnapshot
        return snapshot ? { title: board?.title ?? boardId, snapshot } : undefined
      },
    ),
    [projectData, workspace, workspaceState],
  )

  useEffect(() => {
    mountedWorkspace.current = workspace
    return () => {
      // React development StrictMode deliberately runs an effect cleanup and
      // setup back-to-back. Defer disposal one task so that rehearsal does not
      // tear down an active realtime tab, while a genuine unmount still does.
      mountedWorkspace.current = undefined
      setTimeout(() => {
        if (mountedWorkspace.current !== workspace) workspace.dispose()
      }, 0)
    }
  }, [workspace])

  useEffect(() => {
    if (routeBoardId) {
      const boardRouteChanged = lastBoardRouteId.current !== routeBoardId
      lastBoardRouteId.current = routeBoardId
      projectHomeExitAttempted.current = false
      if (boardRouteChanged) {
        setProjectHomeReady(false)
        setNavigationBlocked(undefined)
      }
      return
    }
    if (!lastBoardRouteId.current) {
      setProjectHomeReady(true)
      return
    }
    if (projectHomeExitAttempted.current) return
    projectHomeExitAttempted.current = true

    void workspaceState.leaveWorkspace().then(
      () => setProjectHomeReady(true),
      (error: unknown) => {
        if (!(error instanceof WorkspaceNavigationBlockedError)) throw error
        setNavigationBlocked(error)
        setProjectHomeReady(false)
        const activeTab = workspace.getTab(workspace.activeTabId ?? '')
        if (activeTab) boardNavigation.commitTab(activeTab, true)
      },
    )
  }, [boardNavigation, routeBoardId, workspace, workspaceState])

  useEffect(() => {
    if (!routeBoardId || !projectData) return
    let disposed = false
    let routeTransitionSettled = false
    const stateEntryId = isBrowserBoardHistoryState(routeHistoryState)
      ? routeHistoryState.entryId
      : ''
    const routeKey = `${routeBoardId}|${routePathReferenceIds.join(',')}|${stateEntryId}`
    if (handledRouteKey.current === routeKey) return
    handledRouteKey.current = routeKey
    setRouteLoadError(undefined)

    void (async () => {
      if (
        isBrowserBoardHistoryState(routeHistoryState) &&
        routeHistoryState.projectId === projectId
      ) {
        const stateTab = workspace.getTab(routeHistoryState.tabId)
        const stateIndex = stateTab?.session.history.findIndex(
          (entry) => entry.entryId === routeHistoryState.entryId,
        ) ?? -1
        if (stateTab && stateIndex >= 0) {
          const tab = await workspace.goToHistoryEntry(stateTab.tabId, stateIndex)
          boardNavigation.commitTab(tab, true)
          return
        }
      }

      const sharedPath = validateSharedReferencePath(
        projectId,
        routeBoardId,
        routePathReferenceIds,
        projectData.references,
      )
      if (sharedPath.length > 0) {
        let tab = await workspace.openBoardInCurrentTab(sharedPath[0]!.sourceBoardId)
        for (const reference of sharedPath) {
          tab = await workspace.enterReference(tab.tabId, reference, 'current')
        }
        boardNavigation.commitTab(tab, true)
        return
      }

      const active = workspace.tabs.find((tab) => tab.tabId === workspace.activeTabId)
      const tab = active?.boardId === routeBoardId
        ? active
        : await workspace.openBoardInCurrentTab(routeBoardId)
      boardNavigation.commitTab(tab, true)
    })().catch((error: unknown) => {
      // A tab can be closed while its earlier history-state route transition
      // is still queued. The next route effect owns navigation in that case.
      if (disposed) return
      if (error instanceof Error && error.message.startsWith('Unknown workspace tab:')) return
      setRouteLoadError(chineseErrorMessage(error, '无法打开画板。画板可能不存在，或当前账号没有访问权限。'))
    }).finally(() => {
      routeTransitionSettled = true
    })
    return () => {
      disposed = true
      // React development StrictMode tears down effects before the initial
      // asynchronous board transition resolves. Do not let that rehearsal
      // permanently consume the route key and leave the workspace empty.
      if (!routeTransitionSettled && handledRouteKey.current === routeKey) {
        handledRouteKey.current = undefined
      }
    }
  }, [
    boardNavigation,
    projectData,
    projectId,
    routeBoardId,
    routeHistoryState,
    routePathReferenceIds,
    routeLoadAttempt,
    workspace,
  ])

  useEffect(() => {
    const handleClipboardCopy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isEditableClipboardTarget(event.target)) return
      const activeTab = workspaceState.tabs.find((tab) => tab.tabId === workspaceState.activeTabId)
      const bridge = workspaceState.activeEditor as TldrawWorkspaceEditor | undefined
      const editor = bridge?.getTldrawEditor()
      if (!activeTab || !editor) return

      const selectedShapeIds = editor.getSelectedShapeIds()
      if (selectedShapeIds.length === 0) return
      const data = event.clipboardData
      if (!data) return

      const assets = structuredClipboardAssets(editor, selectedShapeIds)
      if (!assets) {
        if (!writeTldrawClipboardData(editor, selectedShapeIds, data)) return
        clipboard.clear()
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      const collected = collectClipboardPayload({
        getShapeAndDescendantIds: (shapeId) =>
          editor.getShapeAndDescendantIds([shapeId as TLShapeId]),
        getContentFromCurrentPage: (shapeIds) => {
          const content = editor.getContentFromCurrentPage(shapeIds as TLShapeId[])
          return content
            ? {
                shapes: content.shapes as unknown as Record<string, unknown>[],
                bindings: content.bindings as unknown as Record<string, unknown>[],
                assets: content.assets as unknown as Record<string, unknown>[],
              }
            : undefined
        },
        store: {
          allRecords: () =>
            editor.store.allRecords() as unknown as readonly Record<string, unknown>[],
        },
      }, selectedShapeIds, {
        sourceProjectId: projectId,
        sourceBoardId: activeTab.boardId,
        references: (projectData?.references ?? [])
          .filter((reference) => reference.sourceBoardId === activeTab.boardId)
          .map((reference) => ({
            shapeId: reference.shapeId,
            referenceId: reference.id,
            targetBoardId: reference.targetBoardId,
            kind: reference.kind,
          })),
        assets,
      })
      const { brokenBindingIds: _brokenBindingIds, ...payload } = collected
      if (!clipboard.writeToClipboardData(data, payload)) return

      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('copy', handleClipboardCopy, { capture: true })
    return () => window.removeEventListener('copy', handleClipboardCopy, { capture: true })
  }, [clipboard, projectData, projectId, workspaceState])

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const activeTab = workspaceState.tabs.find((tab) => tab.tabId === workspaceState.activeTabId)
      const bridge = workspaceState.activeEditor as TldrawWorkspaceEditor | undefined
      const editor = bridge?.getTldrawEditor()
      if (!activeTab || !bridge || !editor) return

      const redoShortcut = event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)
      const undoShortcut = event.key.toLowerCase() === 'z' && !event.shiftKey
      if (undoShortcut || redoShortcut) {
        const commands = clipboardCommands.current.get(activeTab.tabId) ?? []
        const command = undoShortcut
          ? [...commands].reverse().find((candidate) => candidate.state === 'applied')
          : commands.find((candidate) => candidate.state === 'undone')
        if (!command) return
        const expectedFingerprint = undoShortcut
          ? command.appliedFingerprint
          : command.undoneFingerprint
        const currentFingerprint = documentSnapshotFingerprint(bridge.getSnapshot())
        if (currentFingerprint !== expectedFingerprint) {
          event.preventDefault()
          event.stopImmediatePropagation()
          const canReplay = () => undoShortcut ? editor.getCanUndo() : editor.getCanRedo()
          let attempts = 0
          while (canReplay() && documentSnapshotFingerprint(bridge.getSnapshot()) === currentFingerprint) {
            if (undoShortcut) editor.undo()
            else editor.redo()
            attempts += 1
            if (attempts >= 100) break
          }
          return
        }
        event.preventDefault()
        event.stopImmediatePropagation()
        const replay = undoShortcut
          ? client.undoClipboard(command.commandId, activeTab.session.lastKnownRevision)
          : client.redoClipboard(command.commandId, activeTab.session.lastKnownRevision)
        void replay.then((receipt) => {
          command.state = undoShortcut ? 'undone' : 'applied'
          workspaceState.adoptCommandCommit(activeTab.tabId, receipt.snapshot, receipt.revision)
          if (undoShortcut) {
            command.undoneFingerprint = documentSnapshotFingerprint(bridge.getSnapshot())
          } else {
            command.appliedFingerprint = documentSnapshotFingerprint(bridge.getSnapshot())
            delete command.undoneFingerprint
          }
        }).catch((error: unknown) => {
          toast.error(chineseErrorMessage(error, '撤销或重做失败，请稍后重试。'))
        })
      }
    }
    window.addEventListener('keydown', handleClipboardShortcut, { capture: true })
    return () => window.removeEventListener('keydown', handleClipboardShortcut, { capture: true })
  }, [client, workspaceState])

  const openBoard = async (boardId: string, mode: 'current' | 'new') => {
    await refreshProject()
    const tab = mode === 'new'
      ? await workspaceState.openBoardInNewTab(boardId)
      : await workspaceState.openBoardInCurrentTab(boardId)
    clipboard.onBoardActivated(boardId)
    setWorkspacePanel(undefined)
    boardNavigation.commitTab(tab)
  }

  const activateTab = async (tabId: string) => {
    const tab = await boardNavigation.activateTab(tabId)
    clipboard.onBoardActivated(tab.boardId)
  }

  const leaveForProjectHome = async () => {
    setNavigationBlocked(undefined)
    try {
      await workspaceState.leaveWorkspace()
      boardNavigation.projectHome()
    } catch (error) {
      if (error instanceof WorkspaceNavigationBlockedError) {
        setNavigationBlocked(error)
        return
      }
      throw error
    }
  }

  const leaveForProjectCenter = async () => {
    try {
      await guardWorkspaceExit()
      navigate('/')
    } catch (error) {
      if (error instanceof WorkspaceNavigationBlockedError) return
      throw error
    }
  }

  const finalizeClosedTab = (closed: boolean) => {
    if (!closed) return
    const active = workspace.tabs.find((tab) => tab.tabId === workspace.activeTabId)
    if (active) boardNavigation.commitTab(active, true)
    else boardNavigation.projectHome()
  }

  const closeTab = async (tabId: string) => {
    const result = await workspaceState.closeTab(tabId)
    if (!result.closed && result.requiresDecision) {
      setPendingCloseTabId(tabId)
      setPendingCloseError(undefined)
      return
    }
    if (result.closed) await refreshProject().catch(() => undefined)
    finalizeClosedTab(result.closed)
  }

  const resolvePendingClose = async (decision: CloseTabDecision) => {
    const tabId = pendingCloseTabId
    if (!tabId) return
    setPendingCloseBusy(true)
    setPendingCloseError(undefined)
    try {
      const result = await workspaceState.closeTab(tabId, decision)
      if (result.closed) {
        await refreshProject().catch(() => undefined)
        setPendingCloseTabId(undefined)
        finalizeClosedTab(true)
        return
      }
      if (!result.requiresDecision) {
        const cause = 'error' in result.saveResult ? result.saveResult.error : result.saveResult.reason
        setPendingCloseError(chineseErrorMessage(cause, '保存失败。请重试，或下载恢复副本后关闭。'))
      }
    } catch (error) {
      setPendingCloseError(chineseErrorMessage(error, '无法下载恢复副本，请稍后重试。'))
    } finally {
      setPendingCloseBusy(false)
    }
  }

  const createBoard = async (title: string, openInNewTab: boolean) => {
    const input: CreateBoardInput = {
      id: `board-${createBrowserUuid()}`,
      title,
      tldrawSnapshot: { store: {} },
    }
    const board = await client.createBoard(projectId, input)
    await refreshProject()
    setCreateDialogOpen(false)
    await openBoard(board.id, openInNewTab ? 'new' : 'current')
  }

  const setDefault = async (boardId: string) => {
    const project = await client.setDefaultBoard(projectId, boardId)
    setProjectData((current) => (current ? { ...current, project } : current))
  }

  const renameBoardFromLibrary = async (boardId: string, title: string) => {
    await client.renameBoard(boardId, title)
    await refreshProject()
  }

  const duplicateBoardFromLibrary = async (board: StoredBoard) => {
    await client.duplicateBoard(board.id, {
      id: `board-${createBrowserUuid()}`,
      title: `${board.title} 副本`,
    })
    await refreshProject()
  }

  const deleteBoardFromLibrary = async (board: StoredBoard) => {
    if (workspaceState.tabs.some((tab) => tab.boardId === board.id)) {
      throw new Error('BOARD_IS_OPEN')
    }
    await client.deleteBoard(board.id)
    await refreshProject()
  }

  const importTldrAsBoard = async (file: File): Promise<{ boardId: string }> => {
      setTemporaryProgress(`正在导入 ${file.name}…`)
    try {
      const { importTldr } = await import('@infinite-board/interop/tldraw/import-tldr')
      const result = importTldr(new Uint8Array(await file.arrayBuffer()))
      const title = file.name.replace(/\.tldr$/i, '').trim() || '导入的画板'
      const board = await client.createBoard(projectId, {
        id: `board-${createBrowserUuid()}`,
        title,
        tldrawSnapshot: result.value,
      })
      await openBoard(board.id, 'new')
      setTemporaryProgress(
        result.report.issues.length > 0
          ? `${file.name} 已导入，包含 ${result.report.issues.length} 个兼容性提示。`
          : undefined,
      )
      return { boardId: board.id }
    } catch (error) {
      const message = `无法导入 ${file.name}：${chineseErrorMessage(error, '未知错误。')}`
      setTemporaryProgress(message)
      throw error
    }
  }

  const importDrawioAsBoard = async (file: File): Promise<DrawioImportResult> => {
    setTemporaryProgress(undefined)
    if (!projectData) throw new Error('项目数据不可用')
    const boardId = `board-${createBrowserUuid()}`
    const xml = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()))
    const prepared = prepareDrawioBoardImport(xml, {
      projectId,
      boardId,
      boards: projectData.boards.map((board) => ({ id: board.id, projectId: board.projectId })),
    })
    const title = file.name.replace(/\.drawio$/i, '').trim() || '导入的画板'
    const input = {
      id: boardId,
      title,
      tldrawSnapshot: prepared.initialSnapshot,
    }
    const board = prepared.referencePayload
      ? await client.createBoardWithClipboard(projectId, input, {
        ...prepared.referencePayload,
        sourceBoardId: boardId,
      })
      : await client.createBoard(projectId, input)
    await openBoard(board.id, 'new')
    return { boardId: board.id, warningCount: prepared.warningCount }
  }

  const importVisual = async (input: VisualImportInput) => {
    const active = workspace.tabs.find((tab) => tab.tabId === workspace.activeTabId)
    let resolvedInput = input
    let beforePersist: (() => Promise<void>) | undefined
    if (input.target.kind === 'current-board') {
      if (!active || active.boardId !== input.target.boardId) throw new Error('NO_ACTIVE_BOARD')
      if (!workspaceState.acquireEditingLease(active.tabId).applied) {
        throw new Error('BOARD_EDITING_LEASE_REQUIRED')
      }
      const editor = (workspaceState.activeEditor as TldrawWorkspaceEditor | undefined)?.getTldrawEditor()
      const pagePoint = editor
        ? editor.screenToPage(input.target.dropPoint)
        : input.target.dropPoint
      const dropPoint = { x: pagePoint.x, y: pagePoint.y }
      resolvedInput = {
        ...input,
        target: { ...input.target, dropPoint, ...(editor ? { pageId: editor.getCurrentPageId() } : {}) },
      }
      beforePersist = async () => {
        const flushes = await workspace.flushBeforePageClose()
        if (flushes.some((result) => !result.ok)) throw new Error('BOARD_FLUSH_FAILED')
      }
    }

    const result = beforePersist
      ? await importVisualFile(resolvedInput, undefined, { beforePersist })
      : await importVisualFile(resolvedInput)
    setTemporaryProgress(undefined)
    if (result.createdBoard) {
      await openBoard(result.boardId, 'new')
    } else if (active) {
      workspaceState.adoptCommandCommit(active.tabId, result.snapshot, result.revision)
      await refreshProject()
    }
    return result
  }

  const dropController = useMemo(() => createDropImportController({
    onIboard: (file) => {
      setTemporaryProgress(undefined)
      setImportWizard({ key: createBrowserUuid(), file })
    },
    onTldr: importTldrAsBoard,
    onDrawio: importDrawioAsBoard,
    onVisual: importVisual,
    onUnsupported: (message) => {
      setTemporaryProgress(message)
    },
    activeTab: () => {
      const boardId = workspace.activeTabId
        ? workspace.getTab(workspace.activeTabId)?.boardId
        : undefined
      return boardId ? { projectId, boardId } : { projectId }
    },
  }), [client, projectId, projectData, workspaceState])

  const dispatchDrop = (files: readonly File[], target: AppDropTarget) => {
    void dropController.dispatch(files, target)
  }

  const openImportedRoot = async (result: IboardImportCommitResult) => {
    await refreshProject()
    const tab = await workspaceState.openBoardInNewTab(result.importedRootBoardId)
    clipboard.onBoardActivated(result.importedRootBoardId)
    boardNavigation.commitTab(tab)
  }

  const flushForPdfExport = async () => {
    const flushes = await workspace.flushBeforePageClose()
    if (flushes.some((result) => !result.ok)) throw new Error('BOARD_FLUSH_FAILED')
  }

  const importWizardElement = importWizard && projectData ? (
    <IboardImportWizard
      key={importWizard.key}
      open
      targetProject={{ id: projectData.project.id, title: projectData.project.title }}
      {...(importWizard.file ? { initialFile: importWizard.file } : {})}
      client={client}
      onClose={() => setImportWizard(undefined)}
      onCommitted={openImportedRoot}
      temporaryTabTargetId={WORKSPACE_TEMPORARY_TAB_TARGET_ID}
    />
  ) : null

  const drawioImportElement = drawioImport ? (
    <DrawioImportDialog
      key={drawioImport.key}
      open
      {...(drawioImport.file ? { initialFile: drawioImport.file } : {})}
      onImport={importDrawioAsBoard}
      onClose={() => setDrawioImport(undefined)}
    />
  ) : null

  const workspaceCommands = (
    <WorkspaceCommandLayer
      open={commandOpen}
      onOpenChange={setCommandOpen}
      boards={projectData?.boards ?? []}
      onProjectCenter={() => void leaveForProjectCenter()}
      onProjectHome={() => navigate(`/projects/${projectId}`)}
      onOpenBoard={(boardId) => void openBoard(boardId, 'current')}
      onCreateBoard={() => setCreateDialogOpen(true)}
      onImportFiles={(files) => dispatchDrop(files, { kind: 'new-tab' })}
      onShowAllBoards={() => setWorkspacePanel('boards')}
      onShowActivity={() => setWorkspacePanel('activity')}
    />
  )

  if (projectLoadError && !projectData) {
    return <main className="workspace-error" id="main-content"><Empty title="无法加载项目" description={projectLoadError}><div className="dialog__actions"><Button variant="accent" onClick={() => void refreshProject().catch(() => undefined)}>重试</Button><Button variant="glass" onClick={() => navigate('/')}>返回项目中心</Button></div></Empty></main>
  }

  if (!routeBoardId && projectHomeReady) {
    return (
      <div className="workspace-shell">
        <BoardTabStrip
          tabs={[]}
          activeTabId={undefined}
          maxVisibleTabs={DEFAULT_MAX_VISIBLE_BOARD_TABS}
          showWorkspaceActions={false}
          {...(projectData?.project.title ? { projectTitle: projectData.project.title } : {})}
          onProjectCenter={() => void leaveForProjectCenter()}
          onCommandPalette={() => setCommandOpen(true)}
          onActivate={() => undefined}
          onClose={() => undefined}
          onCreate={() => setCreateDialogOpen(true)}
          onDropOnNewTab={(files) => dispatchDrop(files, { kind: 'new-tab' })}
          onPickFiles={(files) => dispatchDrop(files, { kind: 'new-tab' })}
          onReorder={() => undefined}
        />
        <ProjectHomePage
          projectId={projectId}
          client={client}
          onOpenBoard={(boardId, mode) => void openBoard(boardId, mode)}
          onImport={() => setImportWizard({ key: createBrowserUuid() })}
          onImportDrawio={() => setDrawioImport({ key: createBrowserUuid() })}
          onFeishuImported={async (result) => {
            if (result.projectId === projectId) {
              await openBoard(result.boardId, 'new')
              return
            }
            try {
              await guardWorkspaceExit()
              navigate(`/projects/${encodeURIComponent(result.projectId)}/boards/${encodeURIComponent(result.boardId)}`)
            } catch (error) {
              if (error instanceof WorkspaceNavigationBlockedError) toast.error('当前画板尚未保存，已取消切换项目。')
              else throw error
            }
          }}
          onProjectDeleted={() => navigate('/')}
          {...(isAuditClient(client) ? { auditClient: client } : {})}
        />
        {temporaryProgress ? <div className="temporary-progress-tab" role="status">{temporaryProgress}</div> : null}
        {importWizardElement}
        {drawioImportElement}
        {workspaceCommands}
        <AppDropOverlay onDispatch={dispatchDrop} />
      </div>
    )
  }

  const tabs: BoardTabView[] = workspaceState.tabs.map((tab) => ({
    tabId: tab.tabId,
    boardId: tab.boardId,
    title: boardTitle(projectData, tab.boardId),
    status: tab.session.status,
    readOnly: tab.readOnly,
  }))
  const activeTab = workspaceState.tabs.find((tab) => tab.tabId === workspaceState.activeTabId)
  const activeEditor = workspaceState.activeEditor as TldrawWorkspaceEditor | undefined
  const activeHistoryEntries = activeTab
    ? historyBreadcrumbEntries(activeTab.session.history, activeTab.session.historyIndex)
    : []
  const isBareDeepLink = Boolean(
    activeTab &&
    activeTab.session.history.length === 1 &&
    activeTab.session.historyIndex === 0 &&
    !activeTab.session.history[0]?.via,
  )
  const inboundReferences = activeTab && projectData && isBareDeepLink
    ? findInboundReferences(activeTab.boardId, projectData.references)
    : []
  const navigationElement = activeTab ? (
    <div className="board-topic-navigation">
    <HistoryBreadcrumbs
      entries={activeHistoryEntries}
      getBoardTitle={(boardId) => boardTitle(projectData, boardId)}
      onBack={() => void (
        activeTab.session.historyIndex === 0
          ? leaveForProjectHome()
          : boardNavigation.goBackAlongHistoryPath(activeTab.tabId)
      )}
      onProjectHome={() => void leaveForProjectHome()}
      onGoToEntry={(index) => void boardNavigation.goToHistoryEntry(activeTab.tabId, index)}
    />
    {projectData ? <BoardTopicLocation data={projectData} boardId={activeTab.boardId} onShowMap={() => setWorkspacePanel('map')} /> : null}
    </div>
  ) : undefined
  const requestEditIntent = () => {
    const tabId = workspace.activeTabId
    if (!tabId || !workspace.getActiveEditor()) return false
    return workspace.acquireEditingLease(tabId).applied
  }

  const handleClipboardPaste = ({
    editor,
    event,
    pasteAsPlainText,
  }: {
    editor: Editor
    event: ClipboardEvent
    pasteAsPlainText: boolean
  }): boolean => {
    if (!activeTab || !activeEditor || editor.getEditingShapeId() || isEditableClipboardTarget(event.target)) {
      return false
    }

    const forcePlainText = pasteAsPlainText || pasteAsPlainTextShortcut.current
    const data = event.clipboardData
    const payload = clipboard.readFromClipboardData(data)
    const point = getPastePoint(editor)

    if (payload && forcePlainText) {
      const text = structuredClipboardPlainText(editor, payload)
      if (text) {
        const previousShapeIds = new Set(editor.getCurrentPageShapeIds())
        editor.markHistoryStoppingPoint('paste_text')
        void defaultHandleExternalTextContent(editor, { point, text }).then(() => {
          const pastedTextIds = editor.getCurrentPageShapes()
            .filter((shape) => shape.type === 'text' && !previousShapeIds.has(shape.id))
            .map((shape) => shape.id)
          if (pastedTextIds.length > 0) editor.setSelectedShapes(pastedTextIds)
        }).catch((error: unknown) => {
          toast.error(chineseErrorMessage(error, '无法粘贴文本，请稍后重试。'))
        })
      }
      // An application payload has no meaningful plain-text representation for
      // non-text shapes. Do not fall through and paste the structured JSON.
      return true
    }

    // 应用结构化数据优先，确保分组、绑定和父子关系走服务端原子命令。
    if (payload) {
      const pastedRootIds = clipboardRootShapeIds(payload)
      void client.pasteClipboard(
        activeTab.boardId,
        payload,
        activeTab.session.lastKnownRevision,
        isPointerOverCanvas(editor) ? point : { viewportCenter: true },
      ).then((receipt) => {
        workspaceState.adoptCommandCommit(activeTab.tabId, receipt.snapshot, receipt.revision)
        const selectedShapeIds = pastedRootIds.flatMap((shapeId) => {
          const pastedShapeId = receipt.idMap[shapeId]
          return pastedShapeId ? [pastedShapeId as TLShapeId] : []
        })
        if (selectedShapeIds.length > 0) editor.setSelectedShapes(selectedShapeIds)
        const commands = (clipboardCommands.current.get(activeTab.tabId) ?? [])
          .filter((command) => command.state === 'applied')
        commands.push({
          commandId: receipt.commandId,
          state: 'applied',
          appliedFingerprint: documentSnapshotFingerprint(activeEditor.getSnapshot()),
        })
        clipboardCommands.current.set(activeTab.tabId, commands)
      }).catch((error: unknown) => {
        toast.error(chineseErrorMessage(error, '粘贴失败，请稍后重试。'))
      })
      return true
    }

    if (!data || clipboardContainsFiles(data)) return false

    // tldraw's native clipboard resolves embedded asset records and mixed selections.
    // Let its document-level paste handler restore that content at the cursor. For
    // plain-text paste, only let the native handler proceed when there is no text;
    // otherwise the browser's text/plain value should become one text shape.
    if (clipboardHasTldrawContent(data)) {
      const nativePlainText = readClipboardText(data, 'text/plain').trim()
      if (!forcePlainText || nativePlainText.length === 0) return false
    }

    const types = Array.from(data.types)
    const plainText = readClipboardText(data, 'text/plain').replace(/\r\n?/g, '\n')
    const html = forcePlainText ? '' : readClipboardText(data, 'text/html')
    const hasTextContent = types.includes('text/plain') || types.includes('text/html')
      || plainText.length > 0 || html.length > 0
    if (!hasTextContent) return false

    const text = plainText.trim().length > 0 ? plainText : htmlTextContent(html)
    if (text.trim().length === 0) return true

    const previousShapeIds = new Set(editor.getCurrentPageShapeIds())
    editor.markHistoryStoppingPoint('paste_text')
    void defaultHandleExternalTextContent(editor, {
      point,
      text,
      ...(html ? { html } : {}),
    }).then(() => {
      const pastedTextIds = editor.getCurrentPageShapes()
        .filter((shape) => shape.type === 'text' && !previousShapeIds.has(shape.id))
        .map((shape) => shape.id)
      if (pastedTextIds.length > 0) editor.setSelectedShapes(pastedTextIds)
    }).catch((error: unknown) => {
      toast.error(chineseErrorMessage(error, '无法粘贴文本，请稍后重试。'))
    })
    return true
  }

  windowPasteHandler.current = (event) => {
    if (event.defaultPrevented || isEditableClipboardTarget(event.target)) return
    const editor = activeEditor?.getTldrawEditor()
    if (!editor || !isPointerOverCanvas(editor)) return
    const target = event.target
    if (target instanceof Node && editor.getContainer().contains(target)) return
    if (!requestEditIntent()) return
    if (!handleClipboardPaste({
      editor,
      event,
      pasteAsPlainText: pasteAsPlainTextShortcut.current,
    })) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const mountActiveEditor = (editor: Editor) => {
    activeEditor?.mountEditor(editor)
    if (!pendingInboundLocation || pendingInboundLocation.boardId !== activeTab?.boardId) return
    window.requestAnimationFrame(() => {
      repairImportedReferenceParent(editor, pendingInboundLocation.shapeId as TLShapeId)
      const bounds = editor.getShapePageBounds(pendingInboundLocation.shapeId as TLShapeId)
      if (!bounds) {
        setTemporaryProgress('来源画板已打开，但引用卡片不存在或已被删除。')
        setPendingInboundLocation(undefined)
        return
      }
      editor.setSelectedShapes([pendingInboundLocation.shapeId as TLShapeId])
      editor.centerOnPoint(bounds.center, { animation: { duration: 180 } })
      setPendingInboundLocation(undefined)
    })
  }

  const openInboundSource = async (reference: BoardReferenceRecord) => {
    setPendingInboundLocation({ boardId: reference.sourceBoardId, shapeId: reference.shapeId })
    await openBoard(reference.sourceBoardId, 'current')
  }

  const adoptReferenceCommit = async (commit: { snapshot: unknown; revision: number }) => {
    if (!activeTab) return
    workspaceState.adoptCommandCommit(activeTab.tabId, commit.snapshot, commit.revision)
    await refreshProject()
  }

  const flushActiveBeforeStructuralCommand = async (): Promise<typeof activeTab> => {
    if (!activeTab) return undefined
    const results = await workspace.flushBeforePageClose()
    if (results.some((result) => !result.ok)) throw new Error('BOARD_FLUSH_FAILED')
    return workspace.getTab(activeTab.tabId)
  }

  const createReference = async (input: CreateBoardReferenceInput, placement?: { x: number; y: number }) => {
    if (!activeTab || !requestEditIntent()) return
    try {
      const commandTab = await flushActiveBeforeStructuralCommand()
      if (!commandTab) return
      const shapeId = `shape:${createBrowserUuid()}`
      const commit = input.mode === 'existing'
        ? await client.createBoardReference(activeTab.boardId, {
            targetBoardId: input.targetBoardId,
            shapeId,
            kind: input.kind,
            expectedRevision: commandTab.session.lastKnownRevision,
            ...(placement ? { placement } : {}),
          })
        : await client.createBoardReference(activeTab.boardId, {
            newBoard: {
              id: `board-${createBrowserUuid()}`,
              title: input.title,
              tldrawSnapshot: { store: {} },
            },
            shapeId,
            kind: 'embed',
            expectedRevision: commandTab.session.lastKnownRevision,
            ...(placement ? { placement } : {}),
          })
      setCreateReferenceDialogOpen(false)
      setCreateReferencePlacement(undefined)
      await adoptReferenceCommit(commit)
    } catch (error) {
      setTemporaryProgress(chineseErrorMessage(error, '无法插入子画板，请稍后重试。'))
    }
  }

  const updateReferenceKind = async (referenceId: string, kind: BoardReferenceKind) => {
    if (!requestEditIntent()) return
    try {
      const commandTab = await flushActiveBeforeStructuralCommand()
      if (!commandTab) return
      await adoptReferenceCommit(await client.updateBoardReference(referenceId, {
        kind,
        expectedRevision: commandTab.session.lastKnownRevision,
      }))
    } catch (error) {
      setTemporaryProgress(chineseErrorMessage(error, '无法更新画板引用，请稍后重试。'))
    }
  }

  const removeReference = async (referenceId: string) => {
    if (!requestEditIntent()) return
    try {
      const commandTab = await flushActiveBeforeStructuralCommand()
      if (!commandTab) return
      await adoptReferenceCommit(await client.removeBoardReference(
        referenceId,
        commandTab.session.lastKnownRevision,
      ))
    } catch (error) {
      setTemporaryProgress(chineseErrorMessage(error, '无法移除画板引用，请稍后重试。'))
    }
  }

  const openReference = (shape: BoardReferenceShape) => {
    if (!activeTab) return
    const reference = projectData?.references.find((candidate) => candidate.id === shape.props.referenceId)
    if (reference) void boardNavigation.enterReference(activeTab.tabId, reference, 'current')
  }

  const boardReferenceActions = activeTab ? {
    enter: openReference,
    openInNewTab: (shape: BoardReferenceShape) => {
      const reference = projectData?.references.find(
        (candidate) => candidate.id === shape.props.referenceId,
      )
      if (reference) void boardNavigation.enterReference(activeTab.tabId, reference, 'new-tab')
    },
    renameTarget: (shape: BoardReferenceShape) => {
      const boardId = shape.props.targetBoardId
      const title = boardTitle(projectData, boardId)
      setReferenceRename({ boardId, title })
      setReferenceRenameTitle(title)
    },
    changeKind: (shape: BoardReferenceShape, kind: BoardReferenceKind) => {
      void updateReferenceKind(shape.props.referenceId, kind)
    },
    remove: (shape: BoardReferenceShape) => {
      void removeReference(shape.props.referenceId)
    },
  } : undefined

  const saveReferenceRename = () => {
    if (!referenceRename || !referenceRenameTitle.trim()) return
    void client.renameBoard(referenceRename.boardId, referenceRenameTitle.trim()).then(async () => {
      await refreshProject()
      setReferenceRename(undefined)
      toast.success('画板名称已更新')
    }, () => toast.error('无法重命名画板，请稍后重试。'))
  }

  return (
    <div className="workspace-shell workspace-shell--board">
      <BoardTabStrip
        tabs={tabs}
        activeTabId={workspaceState.activeTabId}
        maxVisibleTabs={DEFAULT_MAX_VISIBLE_BOARD_TABS}
        {...(projectData?.project.title ? { projectTitle: projectData.project.title } : {})}
        onProjectCenter={() => void leaveForProjectCenter()}
        onCommandPalette={() => setCommandOpen(true)}
        onActivate={(tabId) => void activateTab(tabId)}
        onClose={(tabId) => void closeTab(tabId)}
        onCreate={() => setCreateDialogOpen(true)}
        onDropOnNewTab={(files) => dispatchDrop(files, { kind: 'new-tab' })}
        onPickFiles={(files) => dispatchDrop(files, { kind: 'new-tab' })}
        onReorder={workspaceState.reorderTab}
      />
      {temporaryProgress ? <div className="temporary-progress-tab" role="status">{temporaryProgress}</div> : null}
      {importWizardElement}
      {drawioImportElement}
      {navigationBlocked ? (
        <p role="alert">
          离开此画板前无法保存。恢复快照仍可在此处使用。
        </p>
      ) : null}
      {activeTab && isBareDeepLink && inboundReferences.length > 0 ? (
        <InboundReferenceList
          references={inboundReferences}
          getBoardTitle={(boardId) => boardTitle(projectData, boardId)}
          onOpenSource={(reference) => void openInboundSource(reference)}
        />
      ) : null}
      {activeTab && activeEditor ? (
        enableRealtime ? <RealtimeBoardPage
          title={boardTitle(projectData, activeTab.boardId)}
          navigation={navigationElement}
          projectId={projectId}
          boardId={activeTab.boardId}
          status={activeTab.session.status}
          readOnly={activeTab.readOnly}
          {...(activeTab.leaseHolderTabId ? { leaseHolderTabId: activeTab.leaseHolderTabId } : {})}
          onRetrySave={() => { void workspaceState.retryTabSave(activeTab.tabId).then((result) => { if (!result.ok) toast.error('保存仍未成功，请下载恢复副本后再重试。') }) }}
          onReloadFromServer={() => { void workspaceState.reloadTabFromServer(activeTab.tabId).catch(() => toast.error('无法重新加载服务器版本。')) }}
          onDownloadRecovery={() => { void workspaceState.copyTabRecovery(activeTab.tabId).then((copied) => { if (copied) toast.success('恢复副本已下载') }).catch(() => toast.error('无法下载恢复副本。')) }}
          inputSessionKey={`${activeTab.tabId}:${activeTab.boardId}`}
          {...(tldrawUser ? { tldrawUser } : {})}
          onEditorMount={mountActiveEditor}
          {...(isCommentClient(client) ? { commentClient: client } : {})}
          onBeforePdfExport={flushForPdfExport}
          onEditIntent={requestEditIntent}
          onClipboardPaste={handleClipboardPaste}
          onCreateReference={(center) => {
            setCreateReferencePlacement({
              x: center.x - BOARD_REFERENCE_DEFAULT_WIDTH / 2,
              y: center.y - BOARD_REFERENCE_DEFAULT_HEIGHT / 2,
            })
            setCreateReferenceDialogOpen(true)
          }}
          onBoardReferenceOpen={openReference}
          {...(boardReferenceActions ? { boardReferenceActions } : {})}
          onBoardReferenceDrop={({ boardId, x, y }) => void createReference({
            mode: 'existing', targetBoardId: boardId, kind: 'embed',
          }, { x, y })}
          onShowAllBoards={() => setWorkspacePanel((current) => current === 'boards' ? undefined : 'boards')}
          onShowActivity={() => setWorkspacePanel((current) => current === 'activity' ? undefined : 'activity')}
        /> : <BoardPage
          title={boardTitle(projectData, activeTab.boardId)}
          navigation={navigationElement}
          projectId={projectId}
          boardId={activeTab.boardId}
          status={activeTab.session.status}
          readOnly={activeTab.readOnly}
          {...(activeTab.leaseHolderTabId ? { leaseHolderTabId: activeTab.leaseHolderTabId } : {})}
          onRetrySave={() => { void workspaceState.retryTabSave(activeTab.tabId).then((result) => { if (!result.ok) toast.error('保存仍未成功，请下载恢复副本后再重试。') }) }}
          onReloadFromServer={() => { void workspaceState.reloadTabFromServer(activeTab.tabId).catch(() => toast.error('无法重新加载服务器版本。')) }}
          onDownloadRecovery={() => { void workspaceState.copyTabRecovery(activeTab.tabId).then((copied) => { if (copied) toast.success('恢复副本已下载') }).catch(() => toast.error('无法下载恢复副本。')) }}
          store={activeEditor.store}
          inputSessionKey={`${activeTab.tabId}:${activeTab.boardId}`}
          {...(tldrawUser ? { tldrawUser } : {})}
          onEditorMount={mountActiveEditor}
          {...(isCommentClient(client) ? { commentClient: client } : {})}
          onBeforePdfExport={flushForPdfExport}
          onEditIntent={requestEditIntent}
          onClipboardPaste={handleClipboardPaste}
          onCreateReference={(center) => {
            setCreateReferencePlacement({
              x: center.x - BOARD_REFERENCE_DEFAULT_WIDTH / 2,
              y: center.y - BOARD_REFERENCE_DEFAULT_HEIGHT / 2,
            })
            setCreateReferenceDialogOpen(true)
          }}
          onBoardReferenceOpen={openReference}
          {...(boardReferenceActions ? { boardReferenceActions } : {})}
          onBoardReferenceDrop={({ boardId, x, y }) => void createReference({
            mode: 'existing', targetBoardId: boardId, kind: 'embed',
          }, { x, y })}
          onShowAllBoards={() => setWorkspacePanel((current) => current === 'boards' ? undefined : 'boards')}
          onShowActivity={() => setWorkspacePanel((current) => current === 'activity' ? undefined : 'activity')}
        />
      ) : routeLoadError ? (
        <Empty title="无法打开画板" description={routeLoadError}><div className="dialog__actions"><Button variant="accent" onClick={() => { handledRouteKey.current = undefined; setRouteLoadError(undefined); setRouteLoadAttempt((attempt) => attempt + 1) }}>重试</Button><Button variant="glass" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>返回项目首页</Button></div></Empty>
      ) : <p className="loading-state">正在加载画板…</p>}
      <WorkspaceLibraryDrawers
        panel={workspacePanel}
        onPanelChange={setWorkspacePanel}
        projectId={projectId}
        data={projectData}
        {...(isAuditClient(client) ? { auditClient: client } : {})}
        onOpenBoard={(boardId, mode) => void openBoard(boardId, mode)}
        onSetDefault={(boardId) => void setDefault(boardId)}
        onCreateBoard={() => setCreateDialogOpen(true)}
        onRenameBoard={renameBoardFromLibrary}
        onDuplicateBoard={duplicateBoardFromLibrary}
        onDeleteBoard={deleteBoardFromLibrary}
        {...(activeTab ? { activeBoardId: activeTab.boardId } : {})}
        {...(client.saveProjectNavigation ? { onSaveNavigation: async (navigation) => { await client.saveProjectNavigation!(projectId, navigation); await refreshProject() } } : {})}
      />
      <CreateBoardDialog
        open={createDialogOpen}
        fixedOpenMode="new"
        onCancel={() => setCreateDialogOpen(false)}
        onCreate={createBoard}
      />
      {workspaceCommands}
      <CreateBoardReferenceDialog
        open={createReferenceDialogOpen}
        boards={projectData?.boards ?? []}
        {...(activeTab ? { currentBoardId: activeTab.boardId } : {})}
        onCancel={() => {
          setCreateReferenceDialogOpen(false)
          setCreateReferencePlacement(undefined)
        }}
        onCreate={(input) => createReference(input, createReferencePlacement)}
      />
      <WorkspaceDecisionDialogs
        pendingCloseOpen={Boolean(pendingCloseTabId)}
        pendingCloseBusy={pendingCloseBusy}
        {...(pendingCloseError ? { pendingCloseError } : {})}
        onPendingCloseOpenChange={(open) => { if (!open && !pendingCloseBusy) { setPendingCloseTabId(undefined); setPendingCloseError(undefined) } }}
        onResolvePendingClose={(action) => void resolvePendingClose(action)}
        referenceRenameOpen={Boolean(referenceRename)}
        referenceRenameTitle={referenceRenameTitle}
        onReferenceRenameTitleChange={setReferenceRenameTitle}
        onReferenceRenameOpenChange={(open) => { if (!open) setReferenceRename(undefined) }}
        onSaveReferenceRename={saveReferenceRename}
      />
      <AppDropOverlay onDispatch={dispatchDrop} />
    </div>
  )
}
