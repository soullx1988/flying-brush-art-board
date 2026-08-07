import type { StoredBoard } from '../board.js'
import { assertCanCreateBoardReference } from '../board-reference-graph.js'
import type { BoardReferenceRecord } from '../board-reference.js'
import {
  emptyBoardCommandMutations,
  invalidGraphPlan,
  referenceShapeMutation,
  type BoardCommandPlan,
  validPlan,
} from './command-plan.js'

export interface PlanCreateBoardReferenceInput {
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  reference: BoardReferenceRecord
}

export type CreateBoardReferencePlan = BoardCommandPlan

export function planCreateBoardReference(input: PlanCreateBoardReferenceInput): CreateBoardReferencePlan {
  try {
    assertCanCreateBoardReference(input.boards, input.references, input.reference)
  } catch (error) {
    return invalidGraphPlan(error)
  }

  const mutations = emptyBoardCommandMutations()
  mutations.references.create = [input.reference]
  mutations.shapes.create = [referenceShapeMutation(input.reference)]
  return validPlan(mutations)
}
