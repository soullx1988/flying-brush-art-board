import type { StoredBoard } from '../board.js'
import { assertBoardReferenceGraphValid } from '../board-reference-graph.js'
import type { BoardReferenceRecord } from '../board-reference.js'
import {
  emptyBoardCommandMutations,
  invalidGraphPlan,
  invalidPlan,
  type BoardCommandPlan,
  validPlan,
} from './command-plan.js'

export interface PlanUpdateBoardReferenceInput {
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  reference: BoardReferenceRecord
}

export type UpdateBoardReferencePlan = BoardCommandPlan

export function planUpdateBoardReference(input: PlanUpdateBoardReferenceInput): UpdateBoardReferencePlan {
  const previous = input.references.find((reference) => reference.id === input.reference.id)
  if (!previous) return invalidPlan('BOARD_REFERENCE_NOT_FOUND', { referenceId: input.reference.id })

  if (
    previous.projectId !== input.reference.projectId ||
    previous.sourceBoardId !== input.reference.sourceBoardId ||
    previous.shapeId !== input.reference.shapeId ||
    previous.createdAt !== input.reference.createdAt
  ) {
    return invalidPlan('BOARD_REFERENCE_IMMUTABLE_FIELDS', { referenceId: input.reference.id })
  }

  const next: BoardReferenceRecord = {
    ...previous,
    targetBoardId: input.reference.targetBoardId,
    kind: input.reference.kind,
    updatedAt: new Date().toISOString(),
  }

  try {
    assertBoardReferenceGraphValid(
      input.boards,
      input.references.map((reference) => (reference.id === input.reference.id ? next : reference)),
    )
  } catch (error) {
    return invalidGraphPlan(error)
  }

  const mutations = emptyBoardCommandMutations()
  mutations.references.update = [{ before: previous, after: next }]
  return validPlan(mutations)
}
