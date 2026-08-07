import type { StoredBoard } from '../board.js'
import { assertBoardCanBeDeleted, getOutboundBoardReferences } from '../board-reference-graph.js'
import type { BoardReferenceRecord } from '../board-reference.js'
import type { ProjectRecord } from '../project.js'
import {
  emptyBoardCommandMutations,
  invalidGraphPlan,
  invalidPlan,
  type BoardCommandPlan,
  validPlan,
} from './command-plan.js'

export interface PlanDeleteBoardInput {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  boardId: string
}

export type DeleteBoardPlan = BoardCommandPlan

export function planDeleteBoard(input: PlanDeleteBoardInput): DeleteBoardPlan {
  const board = input.boards.find((candidate) => candidate.id === input.boardId)
  if (!board || board.projectId !== input.project.id) {
    return invalidPlan('BOARD_NOT_FOUND', { boardId: input.boardId })
  }
  if (input.boardId === input.project.rootBoardId) {
    return invalidPlan('ROOT_BOARD_DELETE_FORBIDDEN', {
      boardId: input.boardId,
      projectId: input.project.id,
      rootBoardId: input.project.rootBoardId,
    })
  }

  try {
    assertBoardCanBeDeleted(input.project, input.references, input.boardId)
  } catch (error) {
    return invalidGraphPlan(error)
  }

  const mutations = emptyBoardCommandMutations()
  mutations.boards.remove = [input.boardId]
  mutations.references.remove = getOutboundBoardReferences(
    input.references.filter((reference) => reference.projectId === input.project.id),
    input.boardId,
  )
  return validPlan(mutations)
}
