export interface ImportSource {
  kind: string
  importedAt: string
  sourceId?: string
}

export interface StoredBoard {
  id: string
  projectId: string
  title: string
  tldrawSnapshot: unknown
  sourceMetadata?: ImportSource
  revision: number
  createdAt: string
  updatedAt: string
}

export interface BoardHistoryEntry {
  entryId: string
  projectId: string
  boardId: string
  via?: {
    referenceId: string
    sourceBoardId: string
    targetBoardId: string
    shapeId: string
    kind: 'embed' | 'link'
  }
  viewState: {
    camera: unknown
    selectedShapeIds: string[]
    currentToolId: string
  }
}

export interface BoardTabSession {
  tabId: string
  projectId: string
  history: BoardHistoryEntry[]
  historyIndex: number
  lastKnownRevision: number
  pendingSnapshot?: unknown
  status: 'loading' | 'clean' | 'dirty' | 'saving' | 'error'
}

export interface BoardEditingLease {
  projectId: string
  boardId: string
  holderTabId: string
}
