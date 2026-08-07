import {
  emptyBoardCommandMutations,
  referenceShapeMutation,
  type BoardCommandPlan,
  type BoardCommandScope,
  validPlan,
} from './command-plan.js'

export interface PlanRedoBoardCommandInput {
  boardId: string
  command: BoardCommandScope
}

export type RedoBoardCommandPlan = BoardCommandPlan

export function planRedoBoardCommand(input: PlanRedoBoardCommandInput): RedoBoardCommandPlan {
  const mutations = emptyBoardCommandMutations()
  mutations.references.create = input.command.references
  mutations.shapes.create = [
    ...input.command.normalShapeIds.map((shapeId) => ({ boardId: input.boardId, shapeId, role: 'normal' as const })),
    ...input.command.references.map(referenceShapeMutation),
  ]
  mutations.assetUsages.create = input.command.assetUsages
  return validPlan(mutations, input.command)
}
