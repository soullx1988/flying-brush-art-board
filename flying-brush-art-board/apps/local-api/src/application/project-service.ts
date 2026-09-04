import { randomUUID } from 'node:crypto'

import type { ProjectRecord, StoredBoard } from '@infinite-board/board-core'

import type { LocalDatabase } from '../db/schema.js'
import type { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import type { BoardRepository } from '../modules/boards/board-repository.js'
import type { ProjectRepository } from '../modules/projects/project-repository.js'
import type { McpCommandContext } from './operation-service.js'
import type { DomainEventPublisher } from './domain-event-publisher.js'
import type { BoardDeletionCoordinator } from '../modules/realtime/board-deletion-coordinator.js'

export interface ProjectSummary extends ProjectRecord {
  boardCount: number
  rootBoardTitle?: string
  boardTitles: string[]
}
export class ProjectApplicationService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly projects: ProjectRepository,
    private readonly boards: BoardRepository,
    private readonly references: BoardReferenceRepository,
    private readonly events?: DomainEventPublisher,
    private readonly now: () => Date = () => new Date(),
    private readonly deletions?: BoardDeletionCoordinator,
  ) {}

  list(input: { query?: string; cursor?: string; limit?: number } = {}): { projects: ProjectSummary[]; nextCursor?: string } {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const normalized = input.query?.trim().toLocaleLowerCase('zh-CN')
    const filtered = this.projects.list()
      .map((project) => this.summary(project))
      .filter((project) => !normalized || [project.title, project.rootBoardTitle, ...project.boardTitles]
        .some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalized)))
    const start = input.cursor ? Math.max(filtered.findIndex((project) => project.id === input.cursor) + 1, 0) : 0
    const page = filtered.slice(start, start + limit)
    return {
      projects: page,
      ...(filtered.length > start + limit && page.at(-1) ? { nextCursor: page.at(-1)!.id } : {}),
    }
  }

  get(projectId: string): { project: ProjectRecord; boards: StoredBoard[]; references: ReturnType<BoardReferenceRepository['listByProject']> } {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    return { project, boards: this.boards.listByProject(projectId), references: this.references.listByProject(projectId) }
  }

  create(input: { title: string; rootBoardTitle?: string }, context: McpCommandContext): { project: ProjectRecord; rootBoard: StoredBoard } {
    const timestamp = this.now().toISOString()
    const projectId = `project-${randomUUID()}`
    const boardId = `board-${randomUUID()}`
    const project: ProjectRecord = {
      id: projectId, title: input.title.trim(), rootBoardId: boardId, formatVersion: 1,
      ownerOpenId: context.actorOpenId,
      createdAt: timestamp, updatedAt: timestamp,
    }
    const rootBoard: StoredBoard = {
      id: boardId, projectId, title: input.rootBoardTitle?.trim() || '概览',
      tldrawSnapshot: { store: {} }, accessLevel: 'project', revision: 0, createdAt: timestamp, updatedAt: timestamp,
    }
    if (!project.title) throw Object.assign(new Error('VALIDATION_ERROR'), { code: 'VALIDATION_ERROR' })
    this.database.transaction(() => {
      this.projects.create(project)
      this.projects.markAutomation(project.id, `mcp:${context.clientId}`.slice(0, 100))
      this.boards.create(rootBoard)
    })()
    this.publish('project.created', context, project.id, undefined, `已创建项目“${project.title}”`)
    return { project: this.projects.get(project.id)!, rootBoard }
  }

  rename(projectId: string, title: string, context: McpCommandContext): ProjectRecord {
    if (!this.projects.get(projectId)) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const updated = this.projects.rename(projectId, title.trim())
    this.publish('project.renamed', context, projectId, undefined, `项目已重命名为“${updated.title}”`)
    return updated
  }

  setRootBoard(projectId: string, boardId: string, context: McpCommandContext): ProjectRecord {
    if (!this.projects.get(projectId)) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const updated = this.projects.setRootBoardId(projectId, boardId)
    this.publish('board.root_changed', context, projectId, boardId, '已更新项目根画板')
    return updated
  }

  deletePreview(projectId: string): Record<string, unknown> {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const marker = this.database.prepare(`SELECT template_key, template_version
      FROM workspace_bootstrap_markers WHERE project_id = ? ORDER BY template_key LIMIT 1`)
      .get(projectId) as { template_key: string; template_version: number } | undefined
    const counts = this.database.prepare(`SELECT
      (SELECT COUNT(*) FROM boards WHERE project_id=@id) AS board_count,
      (SELECT COUNT(*) FROM board_references WHERE project_id=@id) AS reference_count,
      (SELECT COUNT(*) FROM comment_threads WHERE project_id=@id) AS comment_count,
      (SELECT COUNT(*) FROM asset_usages WHERE project_id=@id) AS asset_usage_count`).get({ id: projectId }) as Record<string, number>
    return {
      project: { id: project.id, title: project.title },
      ...(marker ? {
        managedWorkspace: {
          protected: true,
          templateKey: marker.template_key,
          templateVersion: marker.template_version,
          consequence: '删除后会在下次进入时创建一套全新的个人交易工作台',
        },
      } : {}),
      ...counts,
    }
  }

  async remove(projectId: string, context: McpCommandContext): Promise<void> {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const boardIds = this.boards.listByProject(projectId).map((board) => board.id)
    // This application path is invoked only after the MCP one-time destructive
    // confirmation token has been consumed. Ordinary HTTP deletion remains blocked.
    const remove = () => this.projects.remove(projectId, { confirmedProtectedWorkspaceDelete: true })
    const removed = this.deletions ? await this.deletions.deleteProject(boardIds, remove) : remove()
    if (!removed) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    this.publish('project.deleted', context, projectId, undefined, `已删除项目“${project.title}”`)
  }

  private summary(project: ProjectRecord): ProjectSummary {
    const boards = this.boards.listByProject(project.id)
    return {
      ...project,
      boardCount: boards.length,
      ...(boards.find((board) => board.id === project.rootBoardId)?.title
        ? { rootBoardTitle: boards.find((board) => board.id === project.rootBoardId)!.title }
        : {}),
      boardTitles: boards.map((board) => board.title),
    }
  }

  private publish(type: string, context: McpCommandContext, projectId: string, boardId: string | undefined, summary: string): void {
    this.events?.publish({
      type, actorOpenId: context.actorOpenId, actorName: context.actorName, clientId: context.clientId,
      operationId: context.operationId, projectId, ...(boardId ? { boardId } : {}), summary,
      createdAt: this.now().toISOString(),
    })
  }
}
