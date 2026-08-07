import type { StoredBoard } from '../board.js'
import { assertCanCreateBoardReference } from '../board-reference-graph.js'
import type { BoardReferenceRecord } from '../board-reference.js'
import {
  emptyBoardCommandMutations,
  invalidGraphPlan,
  invalidPlan,
  referenceShapeMutation,
  type BoardCommandPlan,
  validPlan,
} from './command-plan.js'

export interface PlanCreateEmbeddedBoardInput {
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  board: StoredBoard
  reference: BoardReferenceRecord
}

export type CreateEmbeddedBoardPlan = BoardCommandPlan

export function planCreateEmbeddedBoard(input: PlanCreateEmbeddedBoardInput): CreateEmbeddedBoardPlan {
  if (input.reference.kind !== 'embed' || input.reference.targetBoardId !== input.board.id) {
    return invalidPlan('EMBEDDED_BOARD_TARGET_MISMATCH', {
      boardId: input.board.id,
      referenceId: input.reference.id,
      targetBoardId: input.reference.targetBoardId,
    })
  }

  try {
    assertCanCreateBoardReference([...input.boards, input.board], input.references, input.reference)
  } catch (error) {
    return invalidGraphPlan(error)
  }

  const mutations = emptyBoardCommandMutations()
  mutations.boards.create = [input.board]
  mutations.references.create = [input.reference]
  mutations.shapes.create = [referenceShapeMutation(input.reference)]
  return validPlan(mutations)
}
