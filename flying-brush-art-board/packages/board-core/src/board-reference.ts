export type BoardReferenceKind = 'embed' | 'link'

export interface BoardReferenceRecord {
  id: string
  projectId: string
  sourceBoardId: string
  targetBoardId: string
  shapeId: string
  kind: BoardReferenceKind
  createdAt: string
  updatedAt: string
}

export type BoardReferenceGraphErrorCode =
  | 'BOARD_DUPLICATE_ID'
  | 'BOARD_REFERENCE_SOURCE_NOT_FOUND'
  | 'BOARD_REFERENCE_TARGET_NOT_FOUND'
  | 'BOARD_REFERENCE_CROSS_PROJECT'
  | 'BOARD_REFERENCE_DUPLICATE_ID'
  | 'BOARD_REFERENCE_DUPLICATE_SHAPE'
  | 'BOARD_REFERENCE_KIND_INVALID'
  | 'EMBED_CYCLE'
  | 'EMBED_DEPTH_LIMIT_EXCEEDED'
  | 'BOARD_REFERENCED'
  | 'ROOT_BOARD_DELETE_FORBIDDEN'

export interface BoardReferenceGraphErrorDetails {
  boardId?: string
  referenceId?: string
  sourceBoardId?: string
  targetBoardId?: string
  inboundReferenceIds?: readonly string[]
}

export class BoardReferenceGraphError extends Error {
  readonly code: BoardReferenceGraphErrorCode
  readonly details: BoardReferenceGraphErrorDetails

  constructor(code: BoardReferenceGraphErrorCode, details: BoardReferenceGraphErrorDetails = {}) {
    super(code)
    this.name = 'BoardReferenceGraphError'
    this.code = code
    this.details = details
  }
}
