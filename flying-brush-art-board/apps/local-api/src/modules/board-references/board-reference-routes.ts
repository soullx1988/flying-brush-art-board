import type { FastifyInstance } from 'fastify'

import type { LocalDatabase } from '../../db/schema.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import {
  boardReferenceDirectionQuerySchema,
  boardReferenceMutationPathParamsSchema,
  boardReferencePathParamsSchema,
  createBoardReferenceSchema,
  deleteBoardReferenceSchema,
  updateBoardReferenceSchema,
} from './board-reference-contracts.js'
import { BoardReferenceRepository } from './board-reference-repository.js'
import { BoardReferenceCommandError, BoardReferenceService } from './board-reference-service.js'
import type { BoardDocumentCoordinator } from '../realtime/board-document-coordinator.js'

function sendMutationError(reply: any, error: unknown) {
  if (error instanceof RevisionConflictError) {
    return reply.code(409).send({ code: 'REVISION_CONFLICT', currentRevision: error.currentRevision })
  }
  if (error instanceof BoardReferenceCommandError) {
    const statusCode =
      error.code === 'BOARD_NOT_FOUND' || error.code === 'BOARD_REFERENCE_NOT_FOUND' ? 404 : 409
    return reply.code(statusCode).send({ code: error.code, ...error.details })
  }
  throw error
}

export function registerBoardReferenceRoutes(
  app: FastifyInstance,
  database: LocalDatabase,
  boards: BoardRepository,
  references: BoardReferenceRepository,
  onSnapshotCommitted?: (boardId: string, snapshot: unknown) => void | Promise<void>,
  coordinator?: BoardDocumentCoordinator,
): void {
  const service = new BoardReferenceService(database, boards, references, { ...(coordinator ? { coordinator } : {}) })

  app.get('/api/boards/:boardId/references', async (request, reply) => {
    const params = boardReferencePathParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    }
    const query = boardReferenceDirectionQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: query.error.issues })
    }

    return query.data.direction === 'inbound'
      ? references.listInbound(params.data.boardId)
      : references.listOutbound(params.data.boardId)
  })

  app.post('/api/boards/:boardId/references', async (request, reply) => {
    const params = boardReferencePathParamsSchema.safeParse(request.params)
    const input = createBoardReferenceSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    }
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    try {
      const result = 'newBoard' in input.data
        ? await service.createEmbeddedBoard({
            sourceBoardId: params.data.boardId,
            shapeId: input.data.shapeId,
            expectedRevision: input.data.expectedRevision,
            ...(input.data.placement === undefined ? {} : { placement: input.data.placement }),
            board: {
              id: input.data.newBoard.id,
              projectId: '',
              title: input.data.newBoard.title,
              tldrawSnapshot: input.data.newBoard.tldrawSnapshot,
              revision: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          })
        : await service.create({
            sourceBoardId: params.data.boardId,
            targetBoardId: input.data.targetBoardId,
            shapeId: input.data.shapeId,
            kind: input.data.kind,
            expectedRevision: input.data.expectedRevision,
            ...(input.data.placement === undefined ? {} : { placement: input.data.placement }),
          })
      if (!coordinator) await onSnapshotCommitted?.(params.data.boardId, result.snapshot)
      return reply.code(201).send(result)
    } catch (error) {
      return sendMutationError(reply, error)
    }
  })

  app.patch('/api/references/:referenceId', async (request, reply) => {
    const params = boardReferenceMutationPathParamsSchema.safeParse(request.params)
    const input = updateBoardReferenceSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    }
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    try {
      const result = await service.update({
        referenceId: params.data.referenceId,
        expectedRevision: input.data.expectedRevision,
        ...(input.data.targetBoardId !== undefined ? { targetBoardId: input.data.targetBoardId } : {}),
        ...(input.data.kind !== undefined ? { kind: input.data.kind } : {}),
      })
      if (!coordinator) await onSnapshotCommitted?.(result.reference.sourceBoardId, result.snapshot)
      return result
    } catch (error) {
      return sendMutationError(reply, error)
    }
  })

  app.delete('/api/references/:referenceId', async (request, reply) => {
    const params = boardReferenceMutationPathParamsSchema.safeParse(request.params)
    const input = deleteBoardReferenceSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    }
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    try {
      const result = await service.remove({ referenceId: params.data.referenceId, ...input.data })
      if (!coordinator) await onSnapshotCommitted?.(result.reference.sourceBoardId, result.snapshot)
      return result
    } catch (error) {
      return sendMutationError(reply, error)
    }
  })
}
