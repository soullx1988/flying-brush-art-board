import type { ProjectRecord } from './project.js'
import type { StoredBoard } from './board.js'
import {
  BoardReferenceGraphError,
  type BoardReferenceKind,
  type BoardReferenceRecord,
} from './board-reference.js'

export const MAX_EMBED_BOARD_LEVELS = 10

function sortedReferences(references: readonly BoardReferenceRecord[]): BoardReferenceRecord[] {
  return [...references].sort((left, right) => left.id.localeCompare(right.id))
}

function validateReferenceKind(kind: string): kind is BoardReferenceKind {
  return kind === 'embed' || kind === 'link'
}

function validateReferenceIdentity(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): Map<string, StoredBoard> {
  const boardById = new Map<string, StoredBoard>()

  for (const board of boards) {
    if (boardById.has(board.id)) {
      throw new BoardReferenceGraphError('BOARD_DUPLICATE_ID', { boardId: board.id })
    }
    boardById.set(board.id, board)
  }

  const referenceIds = new Set<string>()
  const sourceShapeKeys = new Set<string>()

  for (const reference of references) {
    if (!validateReferenceKind(reference.kind)) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_KIND_INVALID', { referenceId: reference.id })
    }
    if (referenceIds.has(reference.id)) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_DUPLICATE_ID', { referenceId: reference.id })
    }
    referenceIds.add(reference.id)

    const source = boardById.get(reference.sourceBoardId)
    if (!source) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_SOURCE_NOT_FOUND', {
        referenceId: reference.id,
        sourceBoardId: reference.sourceBoardId,
      })
    }

    const target = boardById.get(reference.targetBoardId)
    if (!target) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_TARGET_NOT_FOUND', {
        referenceId: reference.id,
        targetBoardId: reference.targetBoardId,
      })
    }

    if (source.projectId !== target.projectId || reference.projectId !== source.projectId) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_CROSS_PROJECT', {
        referenceId: reference.id,
        sourceBoardId: reference.sourceBoardId,
        targetBoardId: reference.targetBoardId,
      })
    }

    const sourceShapeKey = `${reference.sourceBoardId}\u0000${reference.shapeId}`
    if (sourceShapeKeys.has(sourceShapeKey)) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_DUPLICATE_SHAPE', {
        referenceId: reference.id,
        sourceBoardId: reference.sourceBoardId,
      })
    }
    sourceShapeKeys.add(sourceShapeKey)
  }

  return boardById
}

interface EmbedGraph {
  outgoing: Map<string, readonly BoardReferenceRecord[]>
  indegree: Map<string, number>
}

function buildEmbedGraph(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): EmbedGraph {
  const outgoing = new Map<string, BoardReferenceRecord[]>()
  const indegree = new Map<string, number>()

  for (const board of boards) {
    outgoing.set(board.id, [])
    indegree.set(board.id, 0)
  }

  for (const reference of references) {
    if (reference.kind !== 'embed') continue

    outgoing.get(reference.sourceBoardId)!.push(reference)
    indegree.set(reference.targetBoardId, (indegree.get(reference.targetBoardId) ?? 0) + 1)
  }

  for (const entries of outgoing.values()) {
    entries.sort((left, right) => {
      const byTarget = left.targetBoardId.localeCompare(right.targetBoardId)
      return byTarget === 0 ? left.id.localeCompare(right.id) : byTarget
    })
  }

  return { outgoing, indegree }
}

function topologicalOrder(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
  preferredRootBoardId?: string,
): string[] {
  const graph = buildEmbedGraph(boards, references)
  const ready = boards
    .map((board) => board.id)
    .filter((boardId) => graph.indegree.get(boardId) === 0)

  const compareReady = (left: string, right: string): number => {
    if (preferredRootBoardId === left) return -1
    if (preferredRootBoardId === right) return 1
    return left.localeCompare(right)
  }

  const result: string[] = []
  while (ready.length > 0) {
    ready.sort(compareReady)
    const boardId = ready.shift()!
    result.push(boardId)

    for (const reference of graph.outgoing.get(boardId) ?? []) {
      const targetId = reference.targetBoardId
      const nextIndegree = (graph.indegree.get(targetId) ?? 0) - 1
      graph.indegree.set(targetId, nextIndegree)
      if (nextIndegree === 0) ready.push(targetId)
    }
  }

  if (result.length !== boards.length) {
    throw new BoardReferenceGraphError('EMBED_CYCLE')
  }

  return result
}

function maxEmbedBoardLevelsFromValidGraph(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): number {
  if (boards.length === 0) return 0

  const order = topologicalOrder(boards, references)
  const graph = buildEmbedGraph(boards, references)
  const levels = new Map<string, number>(boards.map((board) => [board.id, 1]))

  for (const boardId of order) {
    const currentLevel = levels.get(boardId) ?? 1
    for (const reference of graph.outgoing.get(boardId) ?? []) {
      const nextLevel = currentLevel + 1
      const existingLevel = levels.get(reference.targetBoardId) ?? 1
      if (nextLevel > existingLevel) {
        levels.set(reference.targetBoardId, nextLevel)
      }
    }
  }

  return Math.max(...levels.values())
}

function assertEmbedDepthWithinLimit(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): void {
  const levels = maxEmbedBoardLevelsFromValidGraph(boards, references)
  if (levels > MAX_EMBED_BOARD_LEVELS) {
    throw new BoardReferenceGraphError('EMBED_DEPTH_LIMIT_EXCEEDED')
  }
}

export function assertBoardReferenceGraphValid(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): void {
  validateReferenceIdentity(boards, references)
  assertEmbedDepthWithinLimit(boards, references)
}

export function assertCanCreateBoardReference(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
  candidate: BoardReferenceRecord,
): void {
  assertBoardReferenceGraphValid(boards, [...references, candidate])
}

export function getInboundBoardReferences(
  references: readonly BoardReferenceRecord[],
  boardId: string,
): BoardReferenceRecord[] {
  return sortedReferences(references.filter((reference) => reference.targetBoardId === boardId))
}

export function getOutboundBoardReferences(
  references: readonly BoardReferenceRecord[],
  boardId: string,
): BoardReferenceRecord[] {
  return sortedReferences(references.filter((reference) => reference.sourceBoardId === boardId))
}

export function getMaxEmbedBoardLevels(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): number {
  validateReferenceIdentity(boards, references)
  return maxEmbedBoardLevelsFromValidGraph(boards, references)
}

export function stableTopologicalBoardOrder(
  project: ProjectRecord,
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): string[] {
  validateReferenceIdentity(boards, references)
  return topologicalOrder(boards, references, project.rootBoardId)
}

export function assertBoardCanBeDeleted(
  project: ProjectRecord,
  references: readonly BoardReferenceRecord[],
  boardId: string,
): void {
  if (boardId === project.rootBoardId) {
    throw new BoardReferenceGraphError('ROOT_BOARD_DELETE_FORBIDDEN', { boardId })
  }

  const inboundReferences = getInboundBoardReferences(
    references.filter((reference) => reference.projectId === project.id),
    boardId,
  )
  if (inboundReferences.length > 0) {
    throw new BoardReferenceGraphError('BOARD_REFERENCED', {
      boardId,
      inboundReferenceIds: inboundReferences.map((reference) => reference.id),
    })
  }
}
