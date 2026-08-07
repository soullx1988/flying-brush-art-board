import { BoardReferenceGraphError } from '@infinite-board/board-core'
import {
  BoardReferenceConsistencyError,
  assertBoardReferenceSemanticsUnchanged,
} from '@infinite-board/tldraw-adapter'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { BoardRepository, RevisionConflictError } from './board-repository.js'
import type { BoardDocumentCoordinator } from '../realtime/board-document-coordinator.js'
import type { BoardDeletionCoordinator } from '../realtime/board-deletion-coordinator.js'

const saveSnapshotSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    snapshot: z.unknown(),
  })
  .strict()

const boardPathParamsSchema = z.object({ boardId: z.string().trim().min(1) }).strict()
const renameBoardSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict()
const duplicateBoardSchema = z.object({ id: z.string().trim().min(1), title: z.string().trim().min(1).max(200) }).strict()

export function registerBoardRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  boards: BoardRepository,
  references: BoardReferenceRepository,
  onSnapshotCommitted?: (boardId: string, snapshot: unknown) => void | Promise<void>,
  coordinator?: BoardDocumentCoordinator,
  deletions?: BoardDeletionCoordinator,
): void {
  app.get('/api/boards/:boardId', async (request, reply) => {
    const params = boardPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const board = boards.get(params.data.boardId)
    return board ?? reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
  })

  // Compatibility read endpoint for clients that use the snapshot resource
  // for both loading and saving a Board.
  app.get('/api/boards/:boardId/snapshot', async (request, reply) => {
    const params = boardPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const board = boards.get(params.data.boardId)
    if (!board) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
    return { snapshot: board.tldrawSnapshot, revision: board.revision }
  })

  app.post('/api/boards/:boardId/duplicate', async (request, reply) => {
    const params = boardPathParamsSchema.safeParse(request.params)
    const input = duplicateBoardSchema.safeParse(request.body)
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    try {
      return reply.code(201).send(boards.duplicate(params.data.boardId, input.data))
    } catch (error) {
      if (error instanceof BoardReferenceConsistencyError) {
        return reply.code(409).send({ code: error.code })
      }
      if (error instanceof Error && error.message === 'BOARD_NOT_FOUND') return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
      throw error
    }
  })

  app.put('/api/boards/:boardId/snapshot', async (request, reply) => {
    const params = boardPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const input = saveSnapshotSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })

    try {
      const current = boards.get(params.data.boardId)
      if (!current) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
      let saved
      if (coordinator) {
        await coordinator.runCommand({
          boardId: params.data.boardId,
          actorOpenId: request.user?.openId ?? 'local-system',
          reason: 'snapshot-save',
          expectedRevision: input.data.expectedRevision,
          async mutate(snapshot) {
            assertBoardReferenceSemanticsUnchanged(snapshot, input.data.snapshot)
            return { snapshot: input.data.snapshot, result: undefined }
          },
        })
        saved = boards.get(params.data.boardId)!
      } else {
        assertBoardReferenceSemanticsUnchanged(current.tldrawSnapshot, input.data.snapshot)
        saved = boards.saveSnapshot(params.data.boardId, input.data.expectedRevision, input.data.snapshot)
      }
      if (!coordinator) await onSnapshotCommitted?.(saved.id, saved.tldrawSnapshot)
      return saved
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return reply.code(409).send({ code: 'REVISION_CONFLICT', currentRevision: error.currentRevision })
      }
      if (
        error instanceof BoardReferenceConsistencyError &&
        error.code === 'BOARD_REFERENCE_COMMAND_REQUIRED'
      ) {
        return reply.code(409).send({ code: error.code })
      }
      throw error
    }
  })

  app.patch('/api/boards/:boardId', async (request, reply) => {
    const params = boardPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const input = renameBoardSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    if (!boards.get(params.data.boardId)) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
    return boards.rename(params.data.boardId, input.data.title)
  })

  app.delete('/api/boards/:boardId', async (request, reply) => {
    const params = boardPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const boardId = params.data.boardId
    const board = boards.get(boardId)
    if (!board) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })

    try {
      if (deletions) {
        await deletions.deleteBoard(boardId, () => boards.remove(board.projectId, boardId))
      } else {
        boards.remove(board.projectId, boardId)
      }
      return reply.code(204).send()
    } catch (error) {
      if (!(error instanceof BoardReferenceGraphError)) throw error
      const project = projects.get(board.projectId)!
      if (error.code === 'ROOT_BOARD_DELETE_FORBIDDEN') {
        return reply.code(409).send({
          code: error.code,
          projectId: project.id,
          rootBoardId: project.rootBoardId,
        })
      }
      if (error.code === 'BOARD_REFERENCED') {
        return reply.code(409).send({
          code: error.code,
          inboundReferences: references.listInbound(boardId),
        })
      }
      throw error
    }
  })
}
