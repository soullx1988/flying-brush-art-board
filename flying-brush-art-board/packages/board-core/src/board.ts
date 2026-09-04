export interface ImportSource {
  kind: string
  importedAt: string
  sourceId?: string
}

export type BoardAccessLevel = 'project' | 'owner-only'

export interface StoredBoard {
  id: string
  projectId: string
  title: string
  tldrawSnapshot: unknown
  /** Missing only on legacy/in-memory callers; repositories always materialize it. */
  accessLevel?: BoardAccessLevel
  /** Required whenever accessLevel is owner-only. */
  ownerOpenId?: string
  /** Read/export projections use this to declare that the snapshot is an empty privacy placeholder. */
  snapshotAccess?: 'full' | 'projected' | 'redacted'
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
