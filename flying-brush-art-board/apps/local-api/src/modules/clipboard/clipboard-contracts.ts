import { z } from 'zod'

const identifierSchema = z.string().trim().min(1)
const expectedRevisionSchema = z.number().int().nonnegative()
const sessionIdSchema = z.string().trim().min(1).max(200)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const referenceCandidateSchema = z
  .object({
    shapeId: identifierSchema,
    referenceId: identifierSchema,
    targetBoardId: identifierSchema,
    kind: z.enum(['embed', 'link']),
  })
  .strict()

export const clipboardPasteRequestSchema = z
  .object({
    payload: z.unknown(),
    expectedRevision: expectedRevisionSchema,
    sessionId: sessionIdSchema,
    placement: z.union([
      z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
      z.object({ viewportCenter: z.literal(true) }).strict(),
    ]),
  })
  .strict()

export const clipboardReplayRequestSchema = z
  .object({ expectedRevision: expectedRevisionSchema, sessionId: sessionIdSchema })
  .strict()

export const clipboardMaterializedPatchSchema = z
  .object({
    nextSnapshot: z.unknown(),
    idMap: z.record(z.string(), identifierSchema),
    assetBlobs: z.array(
      z
        .object({
          sha256: sha256Schema,
          mime: z.string().min(1),
          size: z.number().int().nonnegative(),
          bytes: z.instanceof(Uint8Array),
        })
        .strict(),
    ),
    assetUsages: z.array(
      z.object({ shapeId: identifierSchema, assetRecordId: identifierSchema, sha256: sha256Schema }).strict(),
    ),
    referenceCandidates: z.array(referenceCandidateSchema),
  })
  .strict()

export const materializedClipboardCommandRequestSchema = z
  .object({ expectedRevision: expectedRevisionSchema, patch: clipboardMaterializedPatchSchema })
  .strict()

export const clipboardCommandReceiptSchema = z
  .object({
    commandId: identifierSchema,
    boardId: identifierSchema,
    revision: expectedRevisionSchema,
    snapshot: z.unknown(),
    idMap: z.record(z.string(), identifierSchema),
    createdReferenceIds: z.array(identifierSchema),
  })
  .strict()

export type ClipboardPasteRequest = z.infer<typeof clipboardPasteRequestSchema>
export type ClipboardReplayRequest = z.infer<typeof clipboardReplayRequestSchema>
export type MaterializedClipboardCommandRequest = z.infer<typeof materializedClipboardCommandRequestSchema>
export type ClipboardCommandReceiptResponse = z.infer<typeof clipboardCommandReceiptSchema>
