import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { BoardRepository } from '../boards/board-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { ProjectRepository } from './project-repository.js'
import { BoardReferenceConsistencyError, assertBoardReferenceSnapshotConsistent } from '@infinite-board/tldraw-adapter'
import type { BoardDeletionCoordinator } from '../realtime/board-deletion-coordinator.js'

const createBoardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    tldrawSnapshot: z.unknown().optional(),
  })
  .strict()

const createProjectSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1).max(200),
    rootBoard: z
      .object({
        id: z.string().trim().min(1),
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
  })
  .strict()

const setRootBoardSchema = z.object({ boardId: z.string().trim().min(1) }).strict()
const renameProjectSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict()

const projectPathParamsSchema = z.object({ projectId: z.string().trim().min(1) }).strict()

export function registerProjectRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  boards: BoardRepository,
  references: BoardReferenceRepository,
  deletions?: BoardDeletionCoordinator,
): void {
  app.get('/api/projects', async () => projects.list().map((project) => {
    const projectBoards = boards.listByProject(project.id)
    return {
      ...project,
      boardCount: projectBoards.length,
      rootBoardTitle: projectBoards.find((board) => board.id === project.rootBoardId)?.title,
      boardTitles: projectBoards.map((board) => board.title),
    }
  }))

  app.post('/api/projects', async (request, reply) => {
    const input = createProjectSchema.safeParse(request.body)
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    if (projects.get(input.data.id)) return reply.code(409).send({ code: 'PROJECT_ALREADY_EXISTS' })

    const timestamp = new Date().toISOString()
    const project = {
      id: input.data.id,
      title: input.data.title,
      rootBoardId: input.data.rootBoard.id,
      formatVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const rootBoard = {
      id: input.data.rootBoard.id,
      projectId: project.id,
      title: input.data.rootBoard.title,
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    try {
      projects.create(project)
      const automationHeader = request.headers['x-infinite-board-automation']
      const automationTag = typeof automationHeader === 'string' ? automationHeader.trim().slice(0, 100) : ''
      if (automationTag) projects.markAutomation(project.id, automationTag)
      boards.create(rootBoard)
      return reply.code(201).send({ project, rootBoard })
    } catch (error) {
      projects.remove(project.id)
      throw error
    }
  })

  app.get('/api/projects/:projectId', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const project = projects.get(params.data.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })

    return {
      project,
      boards: boards.listByProject(params.data.projectId),
      references: references.listByProject(params.data.projectId),
    }
  })

  app.patch('/api/projects/:projectId', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    const input = renameProjectSchema.safeParse(request.body)
    if (!params.success || !input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    }
    if (!projects.get(params.data.projectId)) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    return projects.rename(params.data.projectId, input.data.title)
  })

  app.delete('/api/projects/:projectId', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const boardIds = boards.listByProject(params.data.projectId).map((board) => board.id)
    const removed = deletions
      ? await deletions.deleteProject(boardIds, () => projects.remove(params.data.projectId))
      : projects.remove(params.data.projectId)
    return removed
      ? reply.code(204).send()
      : reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
  })

  app.post('/api/projects/:projectId/boards', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const projectId = params.data.projectId
    const input = createBoardSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    if (!projects.get(projectId)) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })

    try {
      assertBoardReferenceSnapshotConsistent(input.data.tldrawSnapshot ?? { store: {} }, [])
    } catch (error) {
      if (error instanceof BoardReferenceConsistencyError) {
        return reply.code(409).send({ code: 'BOARD_REFERENCE_COMMAND_REQUIRED' })
      }
      throw error
    }

    const timestamp = new Date().toISOString()
    const board = boards.create({
      id: input.data.id,
      projectId,
      title: input.data.title,
      tldrawSnapshot: input.data.tldrawSnapshot ?? { store: {} },
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return reply.code(201).send(board)
  })

  app.put('/api/projects/:projectId/root-board', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    const input = setRootBoardSchema.safeParse(request.body)
    if (!params.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    }
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    if (!projects.get(params.data.projectId)) {
      return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    }
    try {
      return projects.setRootBoardId(params.data.projectId, input.data.boardId)
    } catch {
      return reply.code(400).send({ code: 'BOARD_NOT_IN_PROJECT' })
    }
  })
}
