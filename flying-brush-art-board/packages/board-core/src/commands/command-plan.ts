import type { BoardCommandErrorDetails, BoardCommandValidation } from '../board-command.js'
import { BoardReferenceGraphError, type BoardReferenceRecord } from '../board-reference.js'

export interface BoardAssetUsage {
  shapeId: string
  assetRecordId: string
  sha256: string
}

export interface PlannedShapeMutation {
  boardId: string
  shapeId: string
  role: 'normal' | 'reference'
}

export interface BoardCommandMutations {
  boards: {
    create: readonly import('../board.js').StoredBoard[]
    remove: readonly string[]
  }
  references: {
    create: readonly BoardReferenceRecord[]
    update: ReadonlyArray<{ before: BoardReferenceRecord; after: BoardReferenceRecord }>
    remove: readonly BoardReferenceRecord[]
  }
  shapes: {
    create: readonly PlannedShapeMutation[]
    remove: readonly PlannedShapeMutation[]
  }
  assetUsages: {
    create: readonly BoardAssetUsage[]
    remove: readonly BoardAssetUsage[]
  }
}

export interface BoardCommandScope {
  normalShapeIds: readonly string[]
  referenceShapeIds: readonly string[]
  references: readonly BoardReferenceRecord[]
  assetUsages: readonly BoardAssetUsage[]
}

export interface BoardCommandPlan {
  validation: BoardCommandValidation
  mutations: BoardCommandMutations
  commandScope?: BoardCommandScope
}

export function emptyBoardCommandMutations(): BoardCommandMutations {
  return {
    boards: { create: [], remove: [] },
    references: { create: [], update: [], remove: [] },
    shapes: { create: [], remove: [] },
    assetUsages: { create: [], remove: [] },
  }
}

export function validPlan(mutations: BoardCommandMutations, commandScope?: BoardCommandScope): BoardCommandPlan {
  return commandScope === undefined
    ? { validation: { ok: true }, mutations }
    : { validation: { ok: true }, mutations, commandScope }
}

export function invalidPlan(
  code: string,
  details: BoardCommandErrorDetails = {},
): BoardCommandPlan {
  return {
    validation: { ok: false, error: { code, message: code, details } },
    mutations: emptyBoardCommandMutations(),
  }
}

export function invalidGraphPlan(error: unknown): BoardCommandPlan {
  if (error instanceof BoardReferenceGraphError) {
    return invalidPlan(error.code, error.details)
  }
  throw error
}

export function referenceShapeMutation(reference: BoardReferenceRecord): PlannedShapeMutation {
  return { boardId: reference.sourceBoardId, shapeId: reference.shapeId, role: 'reference' }
}
