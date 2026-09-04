import { Buffer } from 'node:buffer'

import {
  ProjectPdfError,
  renderProjectToPdf,
  type ProjectPdfInput,
} from '@infinite-board/interop/pdf/project-pdf'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { AssetRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import {
  tradingWorkbenchSnapshot,
  type TradingSource,
} from '../trading/trading-source.js'
import { canAccessBoard, canAccessProject, projectPrivacyProjection, projectWithProjectedRoot } from '../../privacy/board-access-policy.js'

const identifierParams = z.object({ boardId: z.string().trim().min(1) }).strict()
const projectParams = z.object({ projectId: z.string().trim().min(1) }).strict()

function contentDisposition(fileName: string): string {
  return `attachment; filename="export.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object') return {}
  const value = snapshot as { store?: unknown; document?: { store?: unknown } }
  const store = value.document?.store ?? value.store
  return store && typeof store === 'object' && !Array.isArray(store)
    ? store as Record<string, unknown>
    : {}
}

function assetSources(
  input: Pick<ProjectPdfInput, 'boards'>,
  assets: AssetRepository,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const board of input.boards) {
    for (const recordValue of Object.values(snapshotStore(board.tldrawSnapshot))) {
      if (!recordValue || typeof recordValue !== 'object') continue
      const record = recordValue as {
        id?: unknown
        typeName?: unknown
        props?: { src?: unknown }
      }
      if (record.typeName !== 'asset' || typeof record.props?.src !== 'string') continue
      const match = record.props.src.match(/^\/api\/assets\/([a-f0-9]{64})$/)
      if (!match?.[1]) continue
      const asset = assets.get(match[1])
      const bytes = assets.readBytes(match[1])
      if (!asset || !bytes || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime)) continue
      const source = `data:${asset.mime};base64,${Buffer.from(bytes).toString('base64')}`
      result.set(record.props.src, source)
      if (typeof record.id === 'string') result.set(record.id, source)
    }
  }
  return result
}

function sendPdfError(reply: Parameters<FastifyInstance['post']>[1] extends never ? never : any, error: unknown) {
  if (error instanceof ProjectPdfError) {
    return reply.code(413).send({ code: error.code })
  }
  throw error
}

export function registerPdfRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  boards: BoardRepository,
  references: BoardReferenceRepository,
  assets: AssetRepository,
  tradingSource?: Pick<TradingSource, 'getSnapshot'>,
): void {
  app.post('/api/boards/:boardId/export.pdf', async (request, reply) => {
    const params = identifierParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const board = boards.get(params.data.boardId)
    if (!board) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' })
    const project = projects.get(board.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    if (!canAccessBoard(board, project, request.user?.openId, projects.isMember(project.id, request.user?.openId))) {
      return reply.code(403).send({ code: 'BOARD_ACCESS_DENIED' })
    }
    try {
      const projection = projectPrivacyProjection(
        boards.listByProject(project.id),
        references.listByProject(project.id),
        'export',
        request.user?.openId,
      )
      const projectedBoard = projection.boards.find((candidate) => candidate.id === board.id)
      if (!projectedBoard) return reply.code(403).send({ code: 'BOARD_ACCESS_DENIED' })
      const frozenTradingSnapshot = tradingSource
        ? tradingWorkbenchSnapshot(await tradingSource.getSnapshot())
        : undefined
      const input: ProjectPdfInput = {
        project: { ...project, rootBoardId: board.id },
        boards: [projectedBoard],
        references: [],
        ...(frozenTradingSnapshot ? { tradingSnapshot: frozenTradingSnapshot } : {}),
      }
      input.assets = assetSources(input, assets)
      const bytes = await renderProjectToPdf(input)
      reply.header('content-disposition', contentDisposition(`${board.title}.pdf`))
      return reply.type('application/pdf').send(Buffer.from(bytes))
    } catch (error) {
      return sendPdfError(reply, error)
    }
  })

  app.post('/api/projects/:projectId/export.pdf', async (request, reply) => {
    const params = projectParams.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const project = projects.get(params.data.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })
    if (!canAccessProject(project, request.user?.openId, projects.isMember(project.id, request.user?.openId))) {
      return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
    }
    try {
      const projection = projectPrivacyProjection(
        boards.listByProject(project.id),
        references.listByProject(project.id),
        'export',
      )
      const frozenTradingSnapshot = tradingSource
        ? tradingWorkbenchSnapshot(await tradingSource.getSnapshot())
        : undefined
      const input: ProjectPdfInput = {
        project: projectWithProjectedRoot(project, projection.boards),
        boards: projection.boards,
        references: projection.references,
        ...(frozenTradingSnapshot ? { tradingSnapshot: frozenTradingSnapshot } : {}),
      }
      input.assets = assetSources(input, assets)
      const bytes = await renderProjectToPdf(input)
      reply.header('content-disposition', contentDisposition(`${project.title}.pdf`))
      return reply.type('application/pdf').send(Buffer.from(bytes))
    } catch (error) {
      return sendPdfError(reply, error)
    }
  })
}
