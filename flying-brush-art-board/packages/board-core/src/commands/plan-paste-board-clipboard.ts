import type { StoredBoard } from '../board.js'
import { assertBoardReferenceGraphValid } from '../board-reference-graph.js'
import type { BoardReferenceRecord } from '../board-reference.js'
import type { BoardClipboardPayload, ClipboardDowngradeReport } from '../clipboard.js'
import type { ProjectRecord } from '../project.js'
import {
  type BoardAssetUsage,
  type BoardCommandPlan,
  emptyBoardCommandMutations,
  invalidGraphPlan,
  invalidPlan,
  referenceShapeMutation,
  validPlan,
} from './command-plan.js'

export interface PlanPasteBoardClipboardInput {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  targetBoardId: string
  payload: BoardClipboardPayload
  createId: () => string
  createdAt?: string
  createdNormalShapeIds?: readonly string[]
  assetUsages?: readonly BoardAssetUsage[]
}

export interface PasteBoardClipboardPlan extends BoardCommandPlan {
  downgrade?: ClipboardDowngradeReport
}

export function planPasteBoardClipboard(input: PlanPasteBoardClipboardInput): PasteBoardClipboardPlan {
  if (!input.boards.some((board) => board.id === input.targetBoardId && board.projectId === input.project.id)) {
    return invalidPlan('BOARD_NOT_FOUND', { boardId: input.targetBoardId })
  }

  try {
    assertBoardReferenceGraphValid(input.boards, input.references)
  } catch (error) {
    return invalidGraphPlan(error)
  }

  const normalShapeIds = input.createdNormalShapeIds ?? []
  const assetUsages = input.assetUsages ?? []
  if (input.payload.sourceProjectId !== input.project.id) {
    const mutations = emptyBoardCommandMutations()
    mutations.shapes.create = normalShapeIds.map((shapeId) => ({ boardId: input.targetBoardId, shapeId, role: 'normal' as const }))
    mutations.assetUsages.create = assetUsages
    const commandScope = {
      normalShapeIds,
      referenceShapeIds: [],
      references: [],
      assetUsages,
    }
    return {
      ...validPlan(mutations, commandScope),
      downgrade: {
        code: 'CLIPBOARD_REFERENCE_DOWNGRADED_CROSS_PROJECT',
        shapeIds: input.payload.references.map((candidate) => candidate.shapeId),
      },
    }
  }

  const timestamp = input.createdAt ?? input.payload.copiedAt
  const createdReferences: BoardReferenceRecord[] = input.payload.references.map((candidate) => ({
    id: input.createId(),
    projectId: input.project.id,
    sourceBoardId: input.targetBoardId,
    targetBoardId: candidate.targetBoardId,
    shapeId: input.createId(),
    kind: candidate.kind,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))

  try {
    assertBoardReferenceGraphValid(input.boards, [...input.references, ...createdReferences])
  } catch (error) {
    return invalidGraphPlan(error)
  }

  const mutations = emptyBoardCommandMutations()
  mutations.references.create = createdReferences
  mutations.shapes.create = [
    ...normalShapeIds.map((shapeId) => ({ boardId: input.targetBoardId, shapeId, role: 'normal' as const })),
    ...createdReferences.map(referenceShapeMutation),
  ]
  mutations.assetUsages.create = assetUsages
  return validPlan(mutations, {
    normalShapeIds,
    referenceShapeIds: createdReferences.map((reference) => reference.shapeId),
    references: createdReferences,
    assetUsages,
  })
}
