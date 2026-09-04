import { useEffect, useReducer } from 'react'

import type { BoardReferenceRecord } from '@infinite-board/board-core'

import type {
  BoardSessionFlushResult,
} from '../boards/board-session'
import type {
  CloseTabDecision,
  CloseTabResult,
  EditableInputResult,
  WorkspaceEditor,
  WorkspaceReferenceSource,
  WorkspaceTab,
} from './workspace-tabs'
import { WorkspaceTabs } from './workspace-tabs'

export interface UseWorkspaceTabsResult {
  tabs: readonly WorkspaceTab[]
  activeTabId: string | undefined
  activeEditor: WorkspaceEditor | undefined
  openBoardInCurrentTab(boardId: string): Promise<WorkspaceTab>
  openBoardInNewTab(boardId: string, source?: WorkspaceReferenceSource): Promise<WorkspaceTab>
  activateTab(tabId: string): Promise<WorkspaceTab>
  closeTab(tabId: string, decision?: CloseTabDecision): Promise<CloseTabResult>
  leaveWorkspace(): Promise<void>
  reorderTab(sourceTabId: string, targetTabId: string): void
  acquireEditingLease(tabId: string): EditableInputResult
  syncBeforeStructuralCommand(tabId: string): Promise<BoardSessionFlushResult>
  adoptCommandCommit(tabId: string, snapshot: unknown, revision: number): void
  retryTabSave(tabId: string): Promise<BoardSessionFlushResult>
  reloadTabFromServer(tabId: string): Promise<void>
  copyTabRecovery(tabId: string): Promise<boolean>
  enterReferenceTarget(
    boardId: string,
    source: WorkspaceReferenceSource,
  ): Promise<WorkspaceTab>
  enterReference(
    tabId: string,
    reference: BoardReferenceRecord,
    mode: 'current' | 'new-tab',
  ): Promise<WorkspaceTab>
  goBackAlongHistoryPath(tabId: string): Promise<WorkspaceTab | undefined>
  goToHistoryEntry(tabId: string, index: number): Promise<WorkspaceTab>
}

export function useWorkspaceTabs(workspace: WorkspaceTabs): UseWorkspaceTabsResult {
  const [, renderNextState] = useReducer((version: number) => version + 1, 0)

  useEffect(() => workspace.subscribe(renderNextState), [workspace])

  return {
    tabs: workspace.tabs,
    activeTabId: workspace.activeTabId,
    activeEditor: workspace.getActiveEditor(),
    openBoardInCurrentTab: (boardId) => workspace.openBoardInCurrentTab(boardId),
    openBoardInNewTab: (boardId, source) => workspace.openBoardInNewTab(boardId, source),
    activateTab: (tabId) => workspace.activateTab(tabId),
    closeTab: (tabId, decision) => workspace.closeTab(tabId, decision),
    leaveWorkspace: () => workspace.leaveWorkspace(),
    reorderTab: (sourceTabId, targetTabId) => workspace.reorderTab(sourceTabId, targetTabId),
    acquireEditingLease: (tabId) => workspace.acquireEditingLease(tabId),
    syncBeforeStructuralCommand: (tabId) => workspace.syncBeforeStructuralCommand(tabId),
    adoptCommandCommit: (tabId, snapshot, revision) =>
      workspace.adoptCommandCommit(tabId, snapshot, revision),
    retryTabSave: (tabId) => workspace.retryTabSave(tabId),
    reloadTabFromServer: (tabId) => workspace.reloadTabFromServer(tabId),
    copyTabRecovery: (tabId) => workspace.copyTabRecovery(tabId),
    enterReferenceTarget: (boardId, source) =>
      workspace.enterReferenceTarget(boardId, source),
    enterReference: (tabId, reference, mode) =>
      workspace.enterReference(tabId, reference, mode),
    goBackAlongHistoryPath: (tabId) => workspace.goBackAlongHistoryPath(tabId),
    goToHistoryEntry: (tabId, index) => workspace.goToHistoryEntry(tabId, index),
  }
}
