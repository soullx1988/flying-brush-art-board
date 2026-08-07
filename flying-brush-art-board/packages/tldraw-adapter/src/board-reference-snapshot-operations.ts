import type { BoardReferenceRecord } from '@infinite-board/board-core'

import { degradeBoardReferenceToVisualCard } from './migrations.js'
import {
  BOARD_REFERENCE_SHAPE_TYPE,
  isBoardReferenceShapeRecord,
  type BoardReferenceShape,
} from './shapes/board-reference/schema.js'

interface SnapshotEnvelope {
  store?: Record<string, unknown>
  document?: { store?: Record<string, unknown> }
}

export interface BoardReferenceShapePlacement {
  parentId?: string
  index?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

export const BOARD_REFERENCE_DEFAULT_WIDTH = 300
export const BOARD_REFERENCE_DEFAULT_HEIGHT = 168

function clone<T>(value: T): T {
  return structuredClone(value)
}

function getSnapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Board snapshot is invalid')
  const envelope = snapshot as SnapshotEnvelope
  const store = envelope.document?.store ?? envelope.store
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Board snapshot has no record store')
  }
  return store
}

function mutableSnapshot(snapshot: unknown): { snapshot: unknown; store: Record<string, unknown> } {
  const next = clone(snapshot)
  return { snapshot: next, store: getSnapshotStore(next) }
}

export function createBoardReferenceShape(
  reference: BoardReferenceRecord,
  titleFallback: string,
  placement: BoardReferenceShapePlacement = {},
): BoardReferenceShape & Record<string, unknown> {
  return {
    id: reference.shapeId as BoardReferenceShape['id'],
    typeName: 'shape',
    type: BOARD_REFERENCE_SHAPE_TYPE,
    parentId: (placement.parentId ?? 'page:page') as BoardReferenceShape['parentId'],
    index: (placement.index ?? 'a1') as BoardReferenceShape['index'],
    x: placement.x ?? 0,
    y: placement.y ?? 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      w: placement.w ?? BOARD_REFERENCE_DEFAULT_WIDTH,
      h: placement.h ?? BOARD_REFERENCE_DEFAULT_HEIGHT,
      referenceId: reference.id,
      targetBoardId: reference.targetBoardId,
      kind: reference.kind,
      titleFallback,
    },
  }
}

export function listBoardReferenceShapes(snapshot: unknown): Array<BoardReferenceShape & Record<string, unknown>> {
  try {
    return Object.values(getSnapshotStore(snapshot)).filter(isBoardReferenceShapeRecord)
  } catch {
    return []
  }
}

export function getBoardReferenceShape(
  snapshot: unknown,
  shapeId: string,
): (BoardReferenceShape & Record<string, unknown>) | undefined {
  const record = getSnapshotStore(snapshot)[shapeId]
  return isBoardReferenceShapeRecord(record) ? record : undefined
}

export function insertBoardReferenceShape(
  snapshot: unknown,
  reference: BoardReferenceRecord,
  titleFallback: string,
  placement?: BoardReferenceShapePlacement,
): unknown {
  const next = mutableSnapshot(snapshot)
  if (next.store[reference.shapeId]) throw new Error(`Shape ${reference.shapeId} already exists`)
  next.store[reference.shapeId] = createBoardReferenceShape(reference, titleFallback, placement)
  return next.snapshot
}

export function updateBoardReferenceShape(
  snapshot: unknown,
  reference: BoardReferenceRecord,
  titleFallback: string,
): unknown {
  const next = mutableSnapshot(snapshot)
  const current = next.store[reference.shapeId]
  if (!isBoardReferenceShapeRecord(current)) throw new Error(`Reference shape ${reference.shapeId} was not found`)
  current.props = {
    ...current.props,
    referenceId: reference.id,
    targetBoardId: reference.targetBoardId,
    kind: reference.kind,
    titleFallback,
  }
  return next.snapshot
}

export function removeBoardReferenceShape(snapshot: unknown, shapeId: string): unknown {
  const next = mutableSnapshot(snapshot)
  const current = next.store[shapeId]
  if (!isBoardReferenceShapeRecord(current)) throw new Error(`Reference shape ${shapeId} was not found`)
  delete next.store[shapeId]
  return next.snapshot
}

export function degradeBoardReferenceShape(
  snapshot: unknown,
  shapeId: string,
  originalBoardUrl: string,
): unknown {
  const next = mutableSnapshot(snapshot)
  const current = next.store[shapeId]
  if (!isBoardReferenceShapeRecord(current)) throw new Error(`Reference shape ${shapeId} was not found`)
  next.store[shapeId] = degradeBoardReferenceToVisualCard({
    ...current,
    props: {
      ...current.props,
      label: current.props.titleFallback,
      url: originalBoardUrl,
    },
  })
  return next.snapshot
}
