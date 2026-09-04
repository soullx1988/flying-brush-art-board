import type {
  BoardAccessLevel,
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'

export const REDACTED_BOARD_SNAPSHOT = Object.freeze({ store: {} })

export function boardAccessLevel(board: Pick<StoredBoard, 'accessLevel'>): BoardAccessLevel {
  return board.accessLevel === 'owner-only' ? 'owner-only' : 'project'
}

export function canAccessProject(
  project: ProjectRecord,
  actorOpenId: string | undefined,
  isMember = false,
): boolean {
  if (!actorOpenId) return false
  // Pre-ownership projects remain usable by authenticated local users. Every
  // newly-created project has an owner policy and is fail-closed to others.
  return !project.ownerOpenId || project.ownerOpenId === actorOpenId || isMember
}

export function canManageProject(project: ProjectRecord, actorOpenId: string | undefined): boolean {
  if (!actorOpenId) return false
  return !project.ownerOpenId || project.ownerOpenId === actorOpenId
}

export function canAccessBoard(
  board: StoredBoard,
  project: ProjectRecord | undefined,
  actorOpenId: string | undefined,
  isProjectMember = false,
): boolean {
  if (!project || !canAccessProject(project, actorOpenId, isProjectMember)) return false
  if (boardAccessLevel(board) !== 'owner-only') return true
  return Boolean(actorOpenId && board.ownerOpenId && board.ownerOpenId === actorOpenId)
}

function projectReferencePreviews(
  snapshot: unknown,
  privateBoardIds: ReadonlySet<string>,
  omittedBoardIds: ReadonlySet<string>,
): { snapshot: unknown; omittedPrivateReference: boolean } {
  if (privateBoardIds.size === 0 || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { snapshot, omittedPrivateReference: false }
  }
  const cloned = structuredClone(snapshot) as {
    store?: Record<string, unknown>
    document?: { store?: Record<string, unknown> }
  }
  const store = cloned.document?.store ?? cloned.store
  if (!store) return { snapshot: cloned, omittedPrivateReference: false }
  let omittedPrivateReference = false
  for (const [recordId, value] of Object.entries(store)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as { typeName?: unknown; type?: unknown; props?: unknown }
    if (record.typeName !== 'shape' || record.type !== 'board-reference') continue
    if (!record.props || typeof record.props !== 'object' || Array.isArray(record.props)) continue
    const props = record.props as { targetBoardId?: unknown; previewMode?: unknown }
    if (typeof props.targetBoardId !== 'string' || !privateBoardIds.has(props.targetBoardId)) continue
    if (omittedBoardIds.has(props.targetBoardId)) {
      delete store[recordId]
      omittedPrivateReference = true
    }
    else props.previewMode = 'private'
  }
  return { snapshot: cloned, omittedPrivateReference }
}

function referenceProjectionForActor(
  board: StoredBoard,
  projectBoards: readonly StoredBoard[],
  actorOpenId?: string,
): { snapshot: unknown; snapshotAccess: 'full' | 'projected' } {
  const privateBoardIds = new Set(
    projectBoards.filter((candidate) => boardAccessLevel(candidate) === 'owner-only').map((candidate) => candidate.id),
  )
  const omittedBoardIds = new Set(
    projectBoards.filter((candidate) => privateBoardIds.has(candidate.id) && candidate.ownerOpenId !== actorOpenId)
      .map((candidate) => candidate.id),
  )
  const projection = projectReferencePreviews(board.tldrawSnapshot, privateBoardIds, omittedBoardIds)
  return {
    snapshot: projection.snapshot,
    snapshotAccess: projection.omittedPrivateReference ? 'projected' : 'full',
  }
}

export function boardSnapshotAccessForActor(
  board: StoredBoard,
  projectBoards: readonly StoredBoard[],
  actorOpenId?: string,
): 'full' | 'projected' {
  return referenceProjectionForActor(board, projectBoards, actorOpenId).snapshotAccess
}

function redactedBoard(board: StoredBoard): StoredBoard {
  return {
    ...board,
    tldrawSnapshot: REDACTED_BOARD_SNAPSHOT,
    snapshotAccess: 'redacted',
  }
}

export interface ProjectPrivacyProjection {
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
  redactedBoardIds: ReadonlySet<string>
}

/** Keeps export/navigation inputs structurally valid when legacy data points
 * the project root at a Board omitted by the current privacy projection. */
export function projectWithProjectedRoot(
  project: ProjectRecord,
  projectedBoards: readonly StoredBoard[],
): ProjectRecord {
  if (projectedBoards.some((board) => board.id === project.rootBoardId)) return project
  const fallback = projectedBoards[0]
  return fallback ? { ...project, rootBoardId: fallback.id } : project
}

/**
 * Default aggregate/export contract:
 * - owner-only Board rows remain as graph-preserving placeholders;
 * - their snapshot bodies are always replaced, even for the owner;
 * - every reference targeting them is forced to private preview;
 * - exports drop outbound edges from redacted Boards because their shapes are absent.
 */
export function projectPrivacyProjection(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
  mode: 'aggregate' | 'export',
  actorOpenId?: string,
): ProjectPrivacyProjection {
  const privateBoardIds = new Set(
    boards.filter((board) => boardAccessLevel(board) === 'owner-only').map((board) => board.id),
  )
  const omittedBoardIds = new Set(
    boards.filter((board) => privateBoardIds.has(board.id) && (!actorOpenId || board.ownerOpenId !== actorOpenId))
      .map((board) => board.id),
  )
  const projectedBoards = boards.filter((board) => !omittedBoardIds.has(board.id)).map((board) => {
    if (privateBoardIds.has(board.id)) return redactedBoard(board)
    const projection = projectReferencePreviews(board.tldrawSnapshot, privateBoardIds, omittedBoardIds)
    return {
      ...board,
      tldrawSnapshot: projection.snapshot,
      snapshotAccess: projection.omittedPrivateReference ? 'projected' as const : 'full' as const,
    }
  })
  return {
    boards: projectedBoards,
    references: references.filter((reference) => (
      !omittedBoardIds.has(reference.sourceBoardId)
      && !omittedBoardIds.has(reference.targetBoardId)
      && (mode !== 'export' || !privateBoardIds.has(reference.sourceBoardId))
    )),
    redactedBoardIds: privateBoardIds,
  }
}

/** Full single-Board reads remain available to its owner, while references to
 * owner-only targets are still rendered as private placeholders. */
export function boardReadProjection(
  board: StoredBoard,
  projectBoards: readonly StoredBoard[],
  actorOpenId?: string,
): StoredBoard {
  const projection = referenceProjectionForActor(board, projectBoards, actorOpenId)
  return {
    ...board,
    tldrawSnapshot: projection.snapshot,
    snapshotAccess: projection.snapshotAccess,
  }
}
