import { useCallback, useEffect } from 'react'

import type { BoardReferenceRecord } from '@infinite-board/board-core'

import type { UseWorkspaceTabsResult } from '../board-tabs/use-workspace-tabs'
import type { WorkspaceTab } from '../board-tabs/workspace-tabs'
import { currentReferenceTrail, projectBrowserHistoryState } from './navigation-state'

export interface BoardNavigationOptions {
  replace?: boolean
  state?: unknown
}

export type BoardNavigationNavigate = (path: string, options?: BoardNavigationOptions) => void

function referencePathIds(tab: WorkspaceTab): string[] {
  const entries = currentReferenceTrail(tab.session.history, tab.session.historyIndex)
  const referenceIds: string[] = []
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]
    const current = entries[index]
    if (!previous || !current?.via || current.via.sourceBoardId !== previous.boardId) return []
    referenceIds.push(current.via.referenceId)
  }
  return referenceIds
}

export function boardNavigationUrl(projectId: string, tab: WorkspaceTab): string {
  const path = `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(tab.boardId)}`
  const referenceIds = referencePathIds(tab)
  if (referenceIds.length === 0) return path
  const query = new URLSearchParams({ path: referenceIds.join(',') })
  return `${path}?${query.toString()}`
}

export function useBoardNavigation(
  projectId: string,
  workspace: UseWorkspaceTabsResult,
  navigate: BoardNavigationNavigate,
) {
  const commitTab = useCallback((tab: WorkspaceTab, replace = false) => {
    const entry = tab.session.history[tab.session.historyIndex]
    if (!entry) return
    navigate(boardNavigationUrl(projectId, tab), {
      replace,
      state: projectBrowserHistoryState(tab.tabId, entry),
    })
  }, [navigate, projectId])

  const enterReference = useCallback(async (
    tabId: string,
    reference: BoardReferenceRecord,
    mode: 'current' | 'new-tab',
  ) => {
    const tab = await workspace.enterReference(tabId, reference, mode)
    commitTab(tab)
    return tab
  }, [commitTab, workspace])

  const goToHistoryEntry = useCallback(async (tabId: string, index: number) => {
    const tab = await workspace.goToHistoryEntry(tabId, index)
    commitTab(tab)
    return tab
  }, [commitTab, workspace])

  const goBackAlongHistoryPath = useCallback(async (tabId: string) => {
    const tab = workspace.tabs.find((candidate) => candidate.tabId === tabId)
    if (!tab || tab.session.historyIndex === 0) {
      navigate(`/projects/${encodeURIComponent(projectId)}`)
      return undefined
    }
    const previous = await workspace.goBackAlongHistoryPath(tabId)
    if (previous) commitTab(previous, true)
    return previous
  }, [commitTab, navigate, projectId, workspace])

  const activateTab = useCallback(async (tabId: string) => {
    const tab = await workspace.activateTab(tabId)
    commitTab(tab, true)
    return tab
  }, [commitTab, workspace])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== 'ArrowLeft') {
        return
      }
      const activeTabId = workspace.activeTabId
      if (!activeTabId) return
      event.preventDefault()
      void goBackAlongHistoryPath(activeTabId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goBackAlongHistoryPath, workspace.activeTabId])

  return {
    activateTab,
    commitTab,
    enterReference,
    goBackAlongHistoryPath,
    goToHistoryEntry,
    projectHome: () => navigate(`/projects/${encodeURIComponent(projectId)}`),
  }
}
