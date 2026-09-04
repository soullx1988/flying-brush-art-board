import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { BoardRepository, ProtectedCoreMutationError } from '../boards/board-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { ProjectRepository, ProtectedWorkspaceDeleteError } from './project-repository.js'
import { BoardReferenceConsistencyError, assertBoardReferenceSnapshotConsistent } from '@infinite-board/tldraw-adapter'
import type { BoardDeletionCoordinator } from '../realtime/board-deletion-coordinator.js'
import { canAccessProject, canManageProject, projectPrivacyProjection } from '../../privacy/board-access-policy.js'

const createBoardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    tldrawSnapshot: z.unknown().optional(),
    accessLevel: z.enum(['project', 'owner-only']).optional(),
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
  automationProjectTag?: string,
): void {
  if (automationProjectTag !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(automationProjectTag)) {
    throw new Error('AUTOMATION_PROJECT_TAG_INVALID')
  }

  app.get('/api/projects', async (request) => projects.list()
    .filter((project) => canAccessProject(project, request.user?.openId, projects.isMember(project.id, request.user?.openId)))
    .map((project) => {
    const projectBoards = boards.listByProject(project.id)
    const projection = projectPrivacyProjection(
      projectBoards,
      references.listByProject(project.id),
      'aggregate',
      request.user?.openId,
    )
    return {
      ...project,
      boardCount: projection.boards.length,
      rootBoardTitle: projection.boards.find((board) => board.id === project.rootBoardId)?.title,
      boardTitles: projection.boards.map((board) => board.title),
    }
  }))

  app.post('/api/projects', async (request, reply) => {
    const input = createProjectSchema.safeParse(request.body)
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    }
    if (projects.get(input.data.id)) return reply.code(409).send({ code: 'PROJECT_ALREADY_EXISTS' })
    if (!request.user?.openId) return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })

    const automationHeader = request.headers['x-infinite-board-automation']
    if (automationHeader !== undefined
      && (typeof automationHeader !== 'string'
        || !automationProjectTag
        || automationHeader !== automationProjectTag)) {
      return reply.code(403).send({ code: 'AUTOMATION_MARKING_DENIED' })
    }

    const timestamp = new Date().toISOString()
    const project = {
      id: input.data.id,
      title: input.data.title,
      rootBoardId: input.data.rootBoard.id,
      formatVersion: 1,
      ownerOpenId: request.user.openId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const rootBoard = {
      id: input.data.rootBoard.id,
      projectId: project.id,
      title: input.data.rootBoard.title,
      tldrawSnapshot: { store: {} },
      accessLevel: 'project' as const,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    try {
      projects.create(project)
      if (automationHeader === automationProjectTag && automationProjectTag) {
        projects.markAutomation(project.id, automationProjectTag)
      }
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
    if (!canAccessProject(project, request.user?.openId, projects.isMember(project.id, request.user?.openId))) {
      return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    }

    const projection = projectPrivacyProjection(
      boards.listByProject(params.data.projectId),
      references.listByProject(params.data.projectId),
      'aggregate',
      request.user?.openId,
    )

    return {
      project,
      boards: projection.boards,
      references: projection.references,
    }
  })

  app.patch('/api/projects/:projectId', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    const input = renameProjectSchema.safeParse(request.body)
    if (!params.success || !input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    }
    const project = projects.get(params.data.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    if (!canManageProject(project, request.user?.openId)) return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    return projects.rename(params.data.projectId, input.data.title)
  })

  app.delete('/api/projects/:projectId', async (request, reply) => {
    const params = projectPathParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    const project = projects.get(params.data.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    if (!canManageProject(project, request.user?.openId)) return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    const boardIds = boards.listByProject(params.data.projectId).map((board) => board.id)
    let removed: boolean
    try {
      removed = deletions
        ? await deletions.deleteProject(boardIds, () => projects.remove(params.data.projectId))
        : projects.remove(params.data.projectId)
    } catch (error) {
      if (error instanceof ProtectedWorkspaceDeleteError) {
        return reply.code(409).send({
          code: error.code,
          projectId: error.projectId,
          templateKey: error.templateKey,
          templateVersion: error.templateVersion,
        })
      }
      throw error
    }
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
    const project = projects.get(projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    if (!canAccessProject(project, request.user?.openId, projects.isMember(project.id, request.user?.openId))) return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    if (input.data.accessLevel === 'owner-only' && !request.user?.openId) {
      return reply.code(403).send({ code: 'BOARD_ACCESS_DENIED' })
    }

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
      accessLevel: input.data.accessLevel ?? 'project',
      ...(input.data.accessLevel === 'owner-only' ? { ownerOpenId: request.user!.openId } : {}),
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
    const project = projects.get(params.data.projectId)
    if (!project) {
      return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    }
    if (!canManageProject(project, request.user?.openId)) return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    try {
      return projects.setRootBoardId(params.data.projectId, input.data.boardId)
    } catch (error) {
      if (error instanceof ProtectedCoreMutationError) {
        return reply.code(409).send({
          code: error.code,
          recordId: error.recordId,
          reason: error.reason,
          rootBoardId: project.rootBoardId,
        })
      }
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'BOARD_NOT_IN_PROJECT'
      return reply.code(400).send({ code })
    }
  })
}
