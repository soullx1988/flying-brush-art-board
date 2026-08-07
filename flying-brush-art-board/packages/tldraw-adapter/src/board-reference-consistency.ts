import type { BoardReferenceKind, BoardReferenceRecord } from '@infinite-board/board-core'

import { listBoardReferenceShapes } from './board-reference-snapshot-operations.js'

export type BoardReferenceConsistencyErrorCode =
  | 'BOARD_REFERENCE_SHAPE_MISSING'
  | 'BOARD_REFERENCE_EDGE_MISSING'
  | 'BOARD_REFERENCE_DUPLICATE_SHAPE'
  | 'BOARD_REFERENCE_DUPLICATE_REFERENCE_ID'
  | 'BOARD_REFERENCE_SEMANTICS_MISMATCH'
  | 'BOARD_REFERENCE_COMMAND_REQUIRED'

export class BoardReferenceConsistencyError extends Error {
  constructor(
    readonly code: BoardReferenceConsistencyErrorCode,
    readonly details: { referenceId?: string; shapeId?: string } = {},
  ) {
    super(code)
    this.name = 'BoardReferenceConsistencyError'
  }
}

interface ReferenceSemantics {
  shapeId: string
  referenceId: string
  targetBoardId: string
  kind: BoardReferenceKind
}

function shapeSemantics(snapshot: unknown): ReferenceSemantics[] {
  return listBoardReferenceShapes(snapshot).map((shape) => ({
    shapeId: String(shape.id),
    referenceId: shape.props.referenceId,
    targetBoardId: shape.props.targetBoardId,
    kind: shape.props.kind,
  }))
}

function semanticsKey(value: ReferenceSemantics): string {
  return `${value.shapeId}\u0000${value.referenceId}\u0000${value.targetBoardId}\u0000${value.kind}`
}

export function assertBoardReferenceSnapshotConsistent(
  snapshot: unknown,
  references: readonly BoardReferenceRecord[],
): void {
  const shapes = shapeSemantics(snapshot)
  const shapesById = new Map<string, ReferenceSemantics>()
  const shapesByReferenceId = new Map<string, ReferenceSemantics>()

  for (const shape of shapes) {
    if (shapesById.has(shape.shapeId)) {
      throw new BoardReferenceConsistencyError('BOARD_REFERENCE_DUPLICATE_SHAPE', { shapeId: shape.shapeId })
    }
    if (shapesByReferenceId.has(shape.referenceId)) {
      throw new BoardReferenceConsistencyError('BOARD_REFERENCE_DUPLICATE_REFERENCE_ID', {
        referenceId: shape.referenceId,
      })
    }
    shapesById.set(shape.shapeId, shape)
    shapesByReferenceId.set(shape.referenceId, shape)
  }

  const referenceIds = new Set<string>()
  for (const reference of references) {
    if (referenceIds.has(reference.id)) {
      throw new BoardReferenceConsistencyError('BOARD_REFERENCE_DUPLICATE_REFERENCE_ID', {
        referenceId: reference.id,
      })
    }
    referenceIds.add(reference.id)
    const shape = shapesById.get(reference.shapeId)
    if (!shape) {
      throw new BoardReferenceConsistencyError('BOARD_REFERENCE_SHAPE_MISSING', {
        referenceId: reference.id,
        shapeId: reference.shapeId,
      })
    }
    if (
      shape.referenceId !== reference.id ||
      shape.targetBoardId !== reference.targetBoardId ||
      shape.kind !== reference.kind
    ) {
      throw new BoardReferenceConsistencyError('BOARD_REFERENCE_SEMANTICS_MISMATCH', {
        referenceId: reference.id,
        shapeId: reference.shapeId,
      })
    }
  }

  for (const shape of shapes) {
    if (!referenceIds.has(shape.referenceId)) {
      throw new BoardReferenceConsistencyError('BOARD_REFERENCE_EDGE_MISSING', {
        referenceId: shape.referenceId,
        shapeId: shape.shapeId,
      })
    }
  }
}

export function assertBoardReferenceSemanticsUnchanged(before: unknown, after: unknown): void {
  const previous = shapeSemantics(before).map(semanticsKey).sort()
  const next = shapeSemantics(after).map(semanticsKey).sort()
  if (previous.length !== next.length || previous.some((value, index) => value !== next[index])) {
    throw new BoardReferenceConsistencyError('BOARD_REFERENCE_COMMAND_REQUIRED')
  }
}
