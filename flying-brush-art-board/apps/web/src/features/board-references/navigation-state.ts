import type { BoardHistoryEntry, BoardReferenceRecord } from '@infinite-board/board-core'

export interface NavigationHistoryState {
  history: BoardHistoryEntry[]
  historyIndex: number
}

export interface BrowserBoardHistoryState {
  tabId: string
  entryId: string
  projectId: string
  boardId: string
}

const DEFAULT_VIEW_STATE: BoardHistoryEntry['viewState'] = {
  camera: { x: 0, y: 0, z: 1 },
  selectedShapeIds: [],
  currentToolId: 'select',
}

function cloneValue<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : value
}

export function cloneHistoryEntry(
  source: BoardHistoryEntry,
  entryId = source.entryId,
): BoardHistoryEntry {
  return {
    ...source,
    entryId,
    viewState: {
      camera: cloneValue(source.viewState.camera),
      selectedShapeIds: [...source.viewState.selectedShapeIds],
      currentToolId: source.viewState.currentToolId,
    },
    ...(source.via ? { via: { ...source.via } } : {}),
  }
}

export function historyEntryFromReference(
  reference: BoardReferenceRecord,
  createEntryId: () => string,
): BoardHistoryEntry {
  return {
    entryId: createEntryId(),
    projectId: reference.projectId,
    boardId: reference.targetBoardId,
    via: {
      referenceId: reference.id,
      sourceBoardId: reference.sourceBoardId,
      targetBoardId: reference.targetBoardId,
      shapeId: reference.shapeId,
      kind: reference.kind,
    },
    viewState: cloneValue(DEFAULT_VIEW_STATE),
  }
}

export function appendReferenceEntry(
  history: readonly BoardHistoryEntry[],
  historyIndex: number,
  reference: BoardReferenceRecord,
  createEntryId: () => string,
): NavigationHistoryState {
  const sourceEntry = history[historyIndex]
  if (!sourceEntry) throw new Error(`History entry ${historyIndex} does not exist`)
  if (
    sourceEntry.projectId !== reference.projectId ||
    sourceEntry.boardId !== reference.sourceBoardId
  ) {
    throw new Error(`Reference ${reference.id} does not leave the current history entry`)
  }
  const nextHistory = history
    .slice(0, historyIndex + 1)
    .map((entry) => cloneHistoryEntry(entry))
  nextHistory.push(historyEntryFromReference(reference, createEntryId))
  return { history: nextHistory, historyIndex: nextHistory.length - 1 }
}

export function createReferenceTabHistory(
  sourceEntry: BoardHistoryEntry,
  reference: BoardReferenceRecord,
  createEntryId: () => string,
): NavigationHistoryState {
  if (
    sourceEntry.projectId !== reference.projectId ||
    sourceEntry.boardId !== reference.sourceBoardId
  ) {
    throw new Error(`Reference ${reference.id} does not leave the source history entry`)
  }
  const copiedSource = cloneHistoryEntry(sourceEntry, createEntryId())
  return {
    history: [copiedSource, historyEntryFromReference(reference, createEntryId)],
    historyIndex: 1,
  }
}

export function historyBreadcrumbEntries(
  history: readonly BoardHistoryEntry[],
  historyIndex: number,
): BoardHistoryEntry[] {
  if (historyIndex < 0 || historyIndex >= history.length) return []
  return history.slice(0, historyIndex + 1).map((entry) => cloneHistoryEntry(entry))
}

/** A direct open starts a new visible trail; the complete back history remains available. */
export function currentReferenceTrail(
  history: readonly BoardHistoryEntry[],
  historyIndex: number,
): BoardHistoryEntry[] {
  if (historyIndex < 0 || historyIndex >= history.length) return []
  let start = historyIndex
  while (start > 0) {
    const current = history[start]!
    const previous = history[start - 1]!
    if (!current.via || current.via.sourceBoardId !== previous.boardId || current.via.targetBoardId !== current.boardId) break
    start -= 1
  }
  return history.slice(start, historyIndex + 1).map((entry) => cloneHistoryEntry(entry))
}

export function findInboundReferences(
  boardId: string,
  references: readonly BoardReferenceRecord[],
): BoardReferenceRecord[] {
  return references
    .filter((reference) => reference.targetBoardId === boardId)
    .sort((left, right) =>
      left.sourceBoardId.localeCompare(right.sourceBoardId) ||
      left.shapeId.localeCompare(right.shapeId),
    )
}

export function validateSharedReferencePath(
  projectId: string,
  targetBoardId: string,
  referenceIds: readonly string[],
  references: readonly BoardReferenceRecord[],
): BoardReferenceRecord[] {
  if (referenceIds.length === 0) return []
  const referencesById = new Map(references.map((reference) => [reference.id, reference]))
  const path: BoardReferenceRecord[] = []
  for (const referenceId of referenceIds) {
    const reference = referencesById.get(referenceId)
    if (!reference || reference.projectId !== projectId) return []
    const previous = path.at(-1)
    if (previous && previous.targetBoardId !== reference.sourceBoardId) return []
    path.push(reference)
  }
  return path.at(-1)?.targetBoardId === targetBoardId ? path : []
}

export function projectBrowserHistoryState(
  tabId: string,
  entry: BoardHistoryEntry,
): BrowserBoardHistoryState {
  return {
    tabId,
    entryId: entry.entryId,
    projectId: entry.projectId,
    boardId: entry.boardId,
  }
}

export function isBrowserBoardHistoryState(value: unknown): value is BrowserBoardHistoryState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<BrowserBoardHistoryState>
  return (
    typeof state.tabId === 'string' &&
    typeof state.entryId === 'string' &&
    typeof state.projectId === 'string' &&
    typeof state.boardId === 'string'
  )
}
