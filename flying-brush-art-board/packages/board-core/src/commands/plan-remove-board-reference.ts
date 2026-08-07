import type { BoardReferenceRecord } from '../board-reference.js'
import {
  emptyBoardCommandMutations,
  invalidPlan,
  referenceShapeMutation,
  type BoardCommandPlan,
  validPlan,
} from './command-plan.js'

export interface PlanRemoveBoardReferenceInput {
  references: readonly BoardReferenceRecord[]
  referenceId: string
}

export type RemoveBoardReferencePlan = BoardCommandPlan

export function planRemoveBoardReference(input: PlanRemoveBoardReferenceInput): RemoveBoardReferencePlan {
  const reference = input.references.find((candidate) => candidate.id === input.referenceId)
  if (!reference) return invalidPlan('BOARD_REFERENCE_NOT_FOUND', { referenceId: input.referenceId })

  const mutations = emptyBoardCommandMutations()
  mutations.references.remove = [reference]
  mutations.shapes.remove = [referenceShapeMutation(reference)]
  return validPlan(mutations)
}
