import {
  emptyBoardCommandMutations,
  referenceShapeMutation,
  type BoardCommandPlan,
  type BoardCommandScope,
  validPlan,
} from './command-plan.js'

export interface PlanUndoBoardCommandInput {
  boardId: string
  command: BoardCommandScope
}

export type UndoBoardCommandPlan = BoardCommandPlan

export function planUndoBoardCommand(input: PlanUndoBoardCommandInput): UndoBoardCommandPlan {
  const mutations = emptyBoardCommandMutations()
  mutations.references.remove = input.command.references
  mutations.shapes.remove = [
    ...input.command.normalShapeIds.map((shapeId) => ({ boardId: input.boardId, shapeId, role: 'normal' as const })),
    ...input.command.references.map(referenceShapeMutation),
  ]
  mutations.assetUsages.remove = input.command.assetUsages
  return validPlan(mutations, input.command)
}
