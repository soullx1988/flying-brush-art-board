import { randomUUID } from 'node:crypto'

import type { BoardClipboardPayload } from '@infinite-board/board-core'
import { materializeClipboardPayload } from '@infinite-board/tldraw-adapter'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { LocalDatabase } from '../../db/schema.js'
import { AssetRepository } from '../assets/asset-repository.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import type { BoardOperationQueue } from '../realtime/board-operation-queue.js'
import {
  ClipboardCommandExpiredError,
  ClipboardReferenceInvalidError,
  ClipboardCommandService,
  StaleClipboardCommandError,
} from './clipboard-command-service.js'
import {
  clipboardPasteRequestSchema,
  clipboardReplayRequestSchema,
} from './clipboard-contracts.js'

const identifierSchema = z.string().trim().min(1)
const recordSchema = z.object({ id: identifierSchema, typeName: identifierSchema }).passthrough()
const referenceSchema = z
  .object({
    shapeId: identifierSchema,
    referenceId: identifierSchema,
    targetBoardId: identifierSchema,
    kind: z.enum(['embed', 'link']),
  })
  .strict()
const assetSchema = z
  .object({
    assetRecordId: identifierSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mime: identifierSchema,
    size: z.number().int().nonnegative(),
    record: recordSchema,
    sourceUrl: z.string().optional(),
  })
  .strict()

export const boardClipboardPayloadSchema = z
  .object({
    version: z.literal(1),
    sourceProjectId: identifierSchema,
    sourceBoardId: identifierSchema,
    shapes: z.array(recordSchema),
    bindings: z.array(recordSchema),
    references: z.array(referenceSchema),
    assets: z.array(assetSchema),
    copiedAt: z.string().datetime(),
  })
  .strict()

const boardParamsSchema = z.object({ boardId: identifierSchema }).strict()
const projectParamsSchema = z.object({ projectId: identifierSchema }).strict()
const commandParamsSchema = z.object({ commandId: identifierSchema }).strict()
const createBoardClipboardImportSchema = z
  .object({
    board: z.object({
      id: identifierSchema,
      title: z.string().trim().min(1).max(200),
      tldrawSnapshot: z.unknown(),
    }).strict(),
    payload: boardClipboardPayloadSchema,
    sessionId: identifierSchema,
  })
  .strict()

class ClipboardAssetNotFoundError extends Error {
  readonly code = 'CLIPBOARD_ASSET_NOT_FOUND'
}

function resolveStoredClipboardAssets(payload: BoardClipboardPayload, assets: AssetRepository): {
  payload: BoardClipboardPayload
  assetBlobs: Array<{ sha256: string; mime: string; size: number; bytes: Uint8Array }>
} {
  const resolved = payload.assets.map((asset) => {
    const stored = assets.get(asset.sha256)
    const bytes = assets.readBytes(asset.sha256)
    if (!stored || !bytes) throw new ClipboardAssetNotFoundError()
    return {
      asset: { ...asset, mime: stored.mime, size: stored.size },
      blob: { sha256: stored.sha256, mime: stored.mime, size: stored.size, bytes },
    }
  })
  return {
    payload: { ...payload, assets: resolved.map(({ asset }) => asset) },
    assetBlobs: resolved.map(({ blob }) => blob),
  }
}

function placedPayload(
  payload: BoardClipboardPayload,
  placement: { x: number; y: number } | { viewportCenter: true },
): BoardClipboardPayload {
  if ('viewportCenter' in placement || payload.shapes.length === 0) return payload

  const copiedShapeIds = new Set(
    payload.shapes.flatMap((shape) => {
      const id = (shape as { id?: unknown }).id
      return typeof id === 'string' ? [id] : []
    }),
  )
  const roots = payload.shapes.filter((shape) => {
    const parentId = (shape as { parentId?: unknown }).parentId
    return typeof parentId !== 'string' || !copiedShapeIds.has(parentId)
  }) as Array<Record<string, unknown>>
  const coordinates = roots.flatMap((shape) =>
    typeof shape.x === 'number' && typeof shape.y === 'number'
      ? [{ x: shape.x, y: shape.y }]
      : [],
  )
  if (coordinates.length === 0) return payload
  const left = Math.min(...coordinates.map(({ x }) => x))
  const top = Math.min(...coordinates.map(({ y }) => y))
  const offsetX = placement.x - left
  const offsetY = placement.y - top

  return {
    ...payload,
    shapes: payload.shapes.map((shape) => {
      const record = structuredClone(shape) as Record<string, unknown>
      if (!roots.some((root) => root.id === record.id)) return record
      if (typeof record.x === 'number') record.x += offsetX
      if (typeof record.y === 'number') record.y += offsetY
      return record
    }),
  }
}

function createRecordIdQueue(payload: BoardClipboardPayload): () => string {
  const prefixes = [...payload.shapes, ...payload.bindings, ...payload.assets.map((asset) => asset.record)].map(
    (record) => {
      const id = String((record as { id: string }).id)
      const separator = id.indexOf(':')
      return separator > 0 ? id.slice(0, separator) : String((record as { typeName: string }).typeName)
    },
  )
  let index = 0
  return () => `${prefixes[index++] ?? 'record'}:${randomUUID()}`
}

function sendCommandError(reply: Parameters<FastifyInstance['post']>[1] extends never ? never : any, error: unknown) {
  if (error instanceof RevisionConflictError) {
    return reply.code(409).send({ code: 'REVISION_CONFLICT', currentRevision: error.currentRevision })
  }
  if (error instanceof ClipboardCommandExpiredError) {
    return reply.code(410).send({ code: error.code })
  }
  if (error instanceof StaleClipboardCommandError) {
    return reply.code(409).send({ code: error.code })
  }
  if (error instanceof ClipboardReferenceInvalidError) {
    return reply.code(409).send({ code: error.code, validation: error.validation })
  }
  if (error instanceof ClipboardAssetNotFoundError) {
    return reply.code(404).send({ code: error.code })
  }
  throw error
}

export function registerClipboardCommandRoutes(
  app: FastifyInstance,
  database: LocalDatabase,
  boards: BoardRepository,
  assets: AssetRepository,
  onSnapshotCommitted?: (boardId: string, snapshot: unknown) => void | Promise<void>,
  operationQueue?: BoardOperationQueue,
): void {
  const commands = new ClipboardCommandService(database, boards, assets)
  const runBoardMutation = <T>(boardId: string, operation: () => Promise<T> | T): Promise<T> =>
    operationQueue ? operationQueue.run(boardId, operation) : Promise.resolve().then(operation)

  app.post('/api/projects/:projectId/boards/clipboard-import', async (request, reply) => {
    const params = projectParamsSchema.safeParse(request.params)
    const input = createBoardClipboardImportSchema.safeParse(request.body)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(params.data.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })

    try {
      const receipt = await runBoardMutation(input.data.board.id, async () => {
        const resolved = resolveStoredClipboardAssets(
          input.data.payload as unknown as BoardClipboardPayload,
          assets,
        )
        const payload = resolved.payload
        const patch = materializeClipboardPayload(payload, {
          createId: createRecordIdQueue(payload),
          targetSnapshot: input.data.board.tldrawSnapshot,
          assetBlobs: resolved.assetBlobs,
        })
        const timestamp = new Date().toISOString()
        const result = commands.createBoardAndApplyMaterializedClipboardCommand({
          id: input.data.board.id,
          projectId: params.data.projectId,
          title: input.data.board.title,
          tldrawSnapshot: input.data.board.tldrawSnapshot,
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        }, patch, input.data.sessionId, {
          sourceProjectId: payload.sourceProjectId,
          sourceBoardId: payload.sourceBoardId,
          copiedAt: payload.copiedAt,
        })
        await onSnapshotCommitted?.(input.data.board.id, result.snapshot)
        return result
      })
      return reply.code(201).send({ board: boards.get(input.data.board.id), receipt })
    } catch (error) {
      return sendCommandError(reply, error)
    }
  })

  app.post('/api/boards/:boardId/clipboard/paste', async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params)
    const input = clipboardPasteRequestSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    }
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    const payload = boardClipboardPayloadSchema.safeParse(input.data.payload)
    if (!payload.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: payload.error.issues })
    }
    try {
      const receipt = await runBoardMutation(params.data.boardId, async () => {
        const board = boards.get(params.data.boardId)
        if (!board) throw new Error('BOARD_NOT_FOUND')
        const positionedPayload = placedPayload(
          payload.data as unknown as BoardClipboardPayload,
          input.data.placement,
        )
        const resolved = resolveStoredClipboardAssets(positionedPayload, assets)
        const patch = materializeClipboardPayload(resolved.payload, {
          createId: createRecordIdQueue(resolved.payload),
          targetSnapshot: board.tldrawSnapshot,
          assetBlobs: resolved.assetBlobs,
        })
        const result = commands.applyMaterializedClipboardCommand(
          board.id, input.data.expectedRevision, patch, input.data.sessionId,
          {
            sourceProjectId: resolved.payload.sourceProjectId,
            sourceBoardId: resolved.payload.sourceBoardId,
            copiedAt: resolved.payload.copiedAt,
          },
        )
        await onSnapshotCommitted?.(result.boardId, result.snapshot)
        return result
      })
      return reply.code(201).send(receipt)
    } catch (error) {
      if (error instanceof Error && error.message === 'BOARD_NOT_FOUND') return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
      return sendCommandError(reply, error)
    }
  })

  const registerReplay = (action: 'undo' | 'redo') => {
    app.post(`/api/clipboard/commands/:commandId/${action}`, async (request, reply) => {
      const params = commandParamsSchema.safeParse(request.params)
      const input = clipboardReplayRequestSchema.safeParse(request.body)
      if (!params.success) {
        return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
      }
      if (!input.success) {
        return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
      }
      try {
        const boardId = commands.getCommandBoardId(params.data.commandId, input.data.sessionId)
        const receipt = await runBoardMutation(boardId, async () => {
          const result = commands[action](params.data.commandId, input.data.expectedRevision, input.data.sessionId)
          await onSnapshotCommitted?.(result.boardId, result.snapshot)
          return result
        })
        return receipt
      } catch (error) {
        return sendCommandError(reply, error)
      }
    })
  }

  registerReplay('undo')
  registerReplay('redo')
}
