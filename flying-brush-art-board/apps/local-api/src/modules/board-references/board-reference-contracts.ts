import { z } from 'zod'

export const boardReferenceDirectionSchema = z.enum(['inbound', 'outbound'])

export const boardReferenceIdSchema = z.string().trim().min(1)
export const boardReferenceExpectedRevisionSchema = z.number().int().nonnegative()
export const boardReferencePlacementSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict()

export const boardReferenceDirectionQuerySchema = z
  .object({
    direction: boardReferenceDirectionSchema,
  })
  .strict()

const createExistingBoardReferenceSchema = z
  .object({
    targetBoardId: boardReferenceIdSchema,
    shapeId: boardReferenceIdSchema,
    kind: z.enum(['embed', 'link']),
    expectedRevision: boardReferenceExpectedRevisionSchema,
    placement: boardReferencePlacementSchema.optional(),
  })
  .strict()

const createEmbeddedBoardReferenceSchema = z
  .object({
    newBoard: z
      .object({
        id: boardReferenceIdSchema,
        title: z.string().trim().min(1).max(200),
        tldrawSnapshot: z.unknown(),
      })
      .strict(),
    shapeId: boardReferenceIdSchema,
    kind: z.literal('embed'),
    expectedRevision: boardReferenceExpectedRevisionSchema,
    placement: boardReferencePlacementSchema.optional(),
  })
  .strict()

export const createBoardReferenceSchema = z.union([
  createExistingBoardReferenceSchema,
  createEmbeddedBoardReferenceSchema,
])

export const updateBoardReferenceSchema = z
  .object({
    targetBoardId: boardReferenceIdSchema.optional(),
    kind: z.enum(['embed', 'link']).optional(),
    expectedRevision: boardReferenceExpectedRevisionSchema,
  })
  .strict()

export const deleteBoardReferenceSchema = z
  .object({
    expectedRevision: boardReferenceExpectedRevisionSchema,
  })
  .strict()

export const boardReferencePathParamsSchema = z.object({ boardId: boardReferenceIdSchema }).strict()
export const boardReferenceMutationPathParamsSchema = z.object({ referenceId: boardReferenceIdSchema }).strict()

export const boardReferenceRecordSchema = z
  .object({
    id: boardReferenceIdSchema,
    projectId: boardReferenceIdSchema,
    sourceBoardId: boardReferenceIdSchema,
    targetBoardId: boardReferenceIdSchema,
    shapeId: boardReferenceIdSchema,
    kind: z.enum(['embed', 'link']),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

export const boardReferenceMutationResponseSchema = z
  .object({
    reference: boardReferenceRecordSchema,
    boardId: boardReferenceIdSchema,
    revision: boardReferenceExpectedRevisionSchema,
    snapshot: z.unknown(),
  })
  .strict()

export type BoardReferenceDirection = z.infer<typeof boardReferenceDirectionSchema>
export type CreateBoardReferenceRequest = z.infer<typeof createBoardReferenceSchema>
export type UpdateBoardReferenceRequest = z.infer<typeof updateBoardReferenceSchema>
export type DeleteBoardReferenceRequest = z.infer<typeof deleteBoardReferenceSchema>
export type BoardReferenceMutationResponse = z.infer<typeof boardReferenceMutationResponseSchema>
