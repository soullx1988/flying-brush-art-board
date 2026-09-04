import { randomUUID } from 'node:crypto'

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createShapeId } from 'tldraw'
import { z } from 'zod'

import {
  MCP_GEO_TYPES,
  MCP_SHAPE_COLORS,
  type CanvasCommandService,
  type McpShapeBatchAction,
  type McpShapeCreateInput,
  type McpShapeUpdateInput,
} from '../../application/canvas-command-service.js'
import type { BoardApplicationService } from '../../application/board-service.js'
import type { CommentApplicationService } from '../../application/comment-service.js'
import type { McpCommandContext, McpConfirmationService, McpOperationService } from '../../application/operation-service.js'
import type { ProjectApplicationService } from '../../application/project-service.js'
import type { ExportApplicationService } from '../../application/export-service.js'
import type { AuditRepository } from '../audit/audit-repository.js'
import type { McpOAuthAccess, McpScope } from '../auth/mcp-oauth-repository.js'
import type { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import type { BoardReferenceService } from '../board-references/board-reference-service.js'
import type { BoardRepository } from '../boards/board-repository.js'
import type { ProjectRepository } from '../projects/project-repository.js'
import type { CommentRepository } from '../comments/comment-repository.js'
import type { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import {
  boardSnapshotAccessForActor,
  canAccessBoard,
  canAccessProject,
  canManageProject,
  projectPrivacyProjection,
} from '../../privacy/board-access-policy.js'
import { publicMcpError } from './mcp-errors.js'
import type { McpDownloadService } from './mcp-download-service.js'

const identifier = z.string().trim().min(1).max(200)
const title = z.string().trim().min(1).max(200)
const idempotencyKey = z.string().trim().min(1).max(200).optional()
const expectedRevision = z.number().int().nonnegative().optional()
const pagination = { cursor: identifier.optional(), limit: z.number().int().min(1).max(100).optional() }
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)
const dimension = z.number().finite().min(1).max(10_000)
const text = z.string().max(10_000)
const shapeColor = z.enum(MCP_SHAPE_COLORS)
const geoType = z.enum(MCP_GEO_TYPES)

const shapeCreateFields = {
  kind: z.enum(['text', 'note', 'geo', 'frame', 'line', 'arrow', 'image']),
  x: coordinate,
  y: coordinate,
  width: dimension.optional(),
  height: dimension.optional(),
  text: text.optional(),
  color: shapeColor.optional(),
  geo: geoType.optional(),
  rotation: z.number().finite().min(-3600).max(3600).optional(),
  fromShapeId: identifier.optional(),
  toShapeId: identifier.optional(),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  altText: z.string().max(1000).optional(),
}

const shapeUpdateFields = {
  shapeId: identifier,
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  text: text.optional(),
  color: shapeColor.optional(),
  rotation: z.number().finite().min(-3600).max(3600).optional(),
}

const shapeCreateSchema = z.object({ boardId: identifier, expectedRevision, idempotencyKey, ...shapeCreateFields }).strict()
const shapeUpdateSchema = z.object({ boardId: identifier, expectedRevision, idempotencyKey, ...shapeUpdateFields }).strict()
const shapeBatchActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ...shapeCreateFields }).strict(),
  z.object({ action: z.literal('update'), ...shapeUpdateFields }).strict(),
  z.object({ action: z.literal('delete'), shapeIds: z.array(identifier).min(1).max(100) }).strict(),
  z.object({ action: z.literal('group'), shapeIds: z.array(identifier).min(2).max(100) }).strict(),
  z.object({ action: z.literal('ungroup'), groupId: identifier }).strict(),
])

export interface McpToolRegistryDependencies {
  projects: ProjectApplicationService
  boards: BoardApplicationService
  canvas: CanvasCommandService
  operations: McpOperationService
  confirmations: McpConfirmationService
  references: BoardReferenceService
  referenceRepository: BoardReferenceRepository
  boardRepository: BoardRepository
  projectRepository: ProjectRepository
  commentRepository: CommentRepository
  assetRepository: AssetRepository
  assetUsages: AssetUsageRepository
  comments: CommentApplicationService
  audits: AuditRepository
  exports: ExportApplicationService
  downloads: McpDownloadService
  applyCommittedSnapshot?: (boardId: string, snapshot: unknown) => void | Promise<void>
}

export interface McpCaller {
  user: { openId: string; name: string }
  access: McpOAuthAccess
  requestId: string
  serverBaseUrl: string
}

function jsonResult(value: unknown) {
  const text = JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text }], structuredContent: value as Record<string, unknown> }
}

function errorResult(error: unknown) {
  return { ...jsonResult(publicMcpError(error)), isError: true }
}

function requireScope(caller: McpCaller, scope: McpScope): void {
  if (!caller.access.scopes.includes(scope)) {
    throw Object.assign(new Error('MCP_SCOPE_REQUIRED'), { code: 'MCP_SCOPE_REQUIRED', details: { requiredScope: scope } })
  }
}

function context(caller: McpCaller, key?: string): McpCommandContext {
  return {
    actorOpenId: caller.user.openId,
    actorName: caller.user.name,
    clientId: caller.access.id,
    requestId: caller.requestId,
    operationId: randomUUID(),
    ...(key ? { idempotencyKey: key } : {}),
  }
}

function publicBoard(board: ReturnType<BoardApplicationService['get']>) {
  const { tldrawSnapshot: _snapshot, ...safe } = board
  return safe
}

function receipt<T>(result: { operationId: string; replayed: boolean; data: T; summary: string; affectedIds?: string[]; afterRevision?: number }) {
  return {
    operationId: result.operationId,
    ...(result.afterRevision === undefined ? {} : { revision: result.afterRevision }),
    affectedIds: result.affectedIds ?? [],
    summary: result.summary,
    warnings: [],
    replayed: result.replayed,
    data: result.data,
  }
}

function sanitizeAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAudit)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    /token|secret|password|credential/i.test(key) ? '[REDACTED]' : sanitizeAudit(entry),
  ]))
}

function compact<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> }
}

export function createInfiniteBoardMcpServer(deps: McpToolRegistryDependencies, caller: McpCaller): McpServer {
  const server = new McpServer({ name: 'infinite-board', version: '2.0.0' }, { capabilities: { logging: {} } })
  const canReadProject = (projectId: string) => {
    const project = deps.projectRepository.get(projectId)
    return Boolean(project && canAccessProject(
      project,
      caller.user.openId,
      deps.projectRepository.isMember(project.id, caller.user.openId),
    ))
  }
  const canReadBoard = (boardId: string) => {
    const board = deps.boardRepository.get(boardId)
    if (!board) return false
    return canAccessBoard(
      board,
      deps.projectRepository.get(board.projectId),
      caller.user.openId,
      deps.projectRepository.isMember(board.projectId, caller.user.openId),
    )
  }
  const requireProjectAccess = (projectId: string) => {
    if (!deps.projectRepository.get(projectId)) {
      throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    }
    if (!canReadProject(projectId)) {
      throw Object.assign(new Error('PROJECT_ACCESS_DENIED'), { code: 'PROJECT_ACCESS_DENIED' })
    }
  }
  const requireProjectManagement = (projectId: string) => {
    const project = deps.projectRepository.get(projectId)
    if (!project) {
      throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    }
    if (!canManageProject(project, caller.user.openId)) {
      throw Object.assign(new Error('PROJECT_ACCESS_DENIED'), { code: 'PROJECT_ACCESS_DENIED' })
    }
  }
  const requireBoardAccess = (boardId: string) => {
    if (!deps.boardRepository.get(boardId)) {
      throw Object.assign(new Error('BOARD_NOT_FOUND'), { code: 'BOARD_NOT_FOUND' })
    }
    if (!canReadBoard(boardId)) {
      throw Object.assign(new Error('BOARD_ACCESS_DENIED'), { code: 'BOARD_ACCESS_DENIED' })
    }
  }
  const requireFullBoardSnapshot = (boardId: string) => {
    requireBoardAccess(boardId)
    const board = deps.boardRepository.get(boardId)!
    const snapshotAccess = boardSnapshotAccessForActor(
      board,
      deps.boardRepository.listByProject(board.projectId),
      caller.user.openId,
    )
    if (snapshotAccess !== 'full') {
      throw Object.assign(new Error('BOARD_SNAPSHOT_PROJECTED_READ_ONLY'), {
        code: 'BOARD_SNAPSHOT_PROJECTED_READ_ONLY',
      })
    }
  }
  const requireCommentDeletion = (threadId: string) => {
    const thread = deps.commentRepository.getThread(threadId)
    if (!thread) {
      throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
    }
    requireBoardAccess(thread.boardId)
    const project = deps.projectRepository.get(thread.projectId)
    if (thread.createdBy !== caller.user.openId && (!project || !canManageProject(project, caller.user.openId))) {
      throw Object.assign(new Error('COMMENT_THREAD_DELETE_FORBIDDEN'), { code: 'COMMENT_THREAD_DELETE_FORBIDDEN' })
    }
  }
  const authorizeInput = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(authorizeInput)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.projectId === 'string') requireProjectAccess(record.projectId)
    for (const key of ['boardId', 'sourceBoardId', 'targetBoardId'] as const) {
      if (typeof record[key] === 'string') requireBoardAccess(record[key])
    }
    if (typeof record.referenceId === 'string') {
      const reference = deps.referenceRepository.get(record.referenceId)
      if (!reference) throw Object.assign(new Error('BOARD_REFERENCE_NOT_FOUND'), { code: 'BOARD_REFERENCE_NOT_FOUND' })
      requireBoardAccess(reference.sourceBoardId)
      requireBoardAccess(reference.targetBoardId)
    }
    if (typeof record.threadId === 'string') {
      const thread = deps.commentRepository.getThread(record.threadId)
      if (!thread) throw Object.assign(new Error('COMMENT_THREAD_NOT_FOUND'), { code: 'COMMENT_THREAD_NOT_FOUND' })
      requireBoardAccess(thread.boardId)
    }
    if (typeof record.messageId === 'string') {
      const thread = deps.commentRepository.getThreadByMessageId(record.messageId)
      if (!thread) throw Object.assign(new Error('COMMENT_MESSAGE_NOT_FOUND'), { code: 'COMMENT_MESSAGE_NOT_FOUND' })
      requireBoardAccess(thread.boardId)
    }
    if (typeof record.assetSha256 === 'string') {
      const usages = deps.assetUsages.listBySha256(record.assetSha256)
      const isUploadOwner = deps.assetRepository.hasUploadOwnership(record.assetSha256, caller.user.openId)
      if (!isUploadOwner && !usages.some((usage) => canReadBoard(usage.boardId))) {
        throw Object.assign(new Error('ASSET_ACCESS_DENIED'), { code: 'ASSET_ACCESS_DENIED' })
      }
    }
    Object.values(record).forEach(authorizeInput)
  }

  const directSnapshotTools = new Set([
    'board_inspect',
    'board_duplicate',
    'board_delete_preview',
    'board_delete_confirm',
  ])
  const sourceSnapshotTools = new Set([
    'board_create_embedded',
    'reference_create',
  ])
  const referenceSnapshotTools = new Set([
    'reference_update',
    'reference_delete_preview',
    'reference_delete_confirm',
  ])
  const enforceSnapshotProjectionBoundary = (toolName: string, value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    if ((toolName.startsWith('shape_') || directSnapshotTools.has(toolName)) && typeof record.boardId === 'string') {
      requireFullBoardSnapshot(record.boardId)
    }
    if (sourceSnapshotTools.has(toolName) && typeof record.sourceBoardId === 'string') {
      requireFullBoardSnapshot(record.sourceBoardId)
    }
    if (referenceSnapshotTools.has(toolName) && typeof record.referenceId === 'string') {
      const reference = deps.referenceRepository.get(record.referenceId)
      if (!reference) throw Object.assign(new Error('BOARD_REFERENCE_NOT_FOUND'), { code: 'BOARD_REFERENCE_NOT_FOUND' })
      requireFullBoardSnapshot(reference.sourceBoardId)
    }
  }

  const register = <T extends z.ZodTypeAny>(
    name: string,
    scope: McpScope,
    schema: T,
    description: string,
    annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean },
    handler: (input: z.output<T>) => unknown | Promise<unknown>,
  ) => server.registerTool(name, {
    description,
    inputSchema: schema,
    annotations: { ...annotations, openWorldHint: false },
  }, (async (input: z.output<T>) => {
    try {
      requireScope(caller, scope)
      enforceSnapshotProjectionBoundary(name, input)
      authorizeInput(input)
      return jsonResult(await handler(input as z.output<T>))
    } catch (error) {
      return errorResult(error)
    }
  }) as never)

  register('system_get_capabilities', 'project:read', z.object({}).strict(), '返回远程 MCP 的协议、限制、scope 和功能开关。', { readOnlyHint: true }, () => ({
    protocolVersion: LATEST_PROTOCOL_VERSION,
    sdk: '@modelcontextprotocol/sdk@1.30.0',
    transport: 'Streamable HTTP',
    serverVersion: '2.0.0',
    authentication: 'OAuth 2.1',
    scopes: caller.access.scopes,
    limits: { pageSize: 100, batchActions: 100, textLength: 10_000, requestBytes: 1_048_576 },
    features: { realtimeCanvasCommit: true, atomicEmbeddedBoardCreate: true, destructivePreviewConfirm: true, arbitraryServerPaths: false, arbitraryCodeExecution: false },
  }))
  register('system_get_current_user', 'project:read', z.object({}).strict(), '返回当前 OAuth 授权映射的白名单用户和客户端信息。', { readOnlyHint: true }, () => ({
    user: caller.user,
    client: {
      grantId: caller.access.id,
      oauthClientId: caller.access.oauthClientId,
      name: caller.access.clientName,
      scopes: caller.access.scopes,
      accessTokenExpiresAt: caller.access.accessTokenExpiresAt,
    },
  }))
  register('operation_get', 'project:read', z.object({ operationId: identifier }).strict(), '查询当前用户的一次 MCP 写操作状态。', { readOnlyHint: true }, ({ operationId }) => {
    const operation = deps.operations.get(operationId, caller.user.openId)
    if (!operation) throw Object.assign(new Error('MCP_OPERATION_NOT_FOUND'), { code: 'MCP_OPERATION_NOT_FOUND' })
    return operation
  })

  register('project_list', 'project:read', z.object({ query: z.string().max(200).optional(), ...pagination }).strict(), '分页查询项目及画板摘要，不返回 snapshot。', { readOnlyHint: true }, (input) => {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const query = input.query?.trim().toLocaleLowerCase('zh-CN')
    const visible = deps.projectRepository.list().filter((project) => canReadProject(project.id)).map((project) => {
      const projection = projectPrivacyProjection(
        deps.boardRepository.listByProject(project.id),
        deps.referenceRepository.listByProject(project.id),
        'aggregate',
        caller.user.openId,
      )
      const rootBoardTitle = projection.boards.find((board) => board.id === project.rootBoardId)?.title
      return {
        ...project,
        boardCount: projection.boards.length,
        ...(rootBoardTitle ? { rootBoardTitle } : {}),
        boardTitles: projection.boards.map((board) => board.title),
      }
    }).filter((project) => !query || [project.title, project.rootBoardTitle, ...project.boardTitles]
      .some((value) => value?.toLocaleLowerCase('zh-CN').includes(query)))
    const start = input.cursor ? Math.max(visible.findIndex((project) => project.id === input.cursor) + 1, 0) : 0
    const page = visible.slice(start, start + limit)
    return {
      projects: page,
      ...(visible.length > start + limit && page.at(-1) ? { nextCursor: page.at(-1)!.id } : {}),
    }
  })
  register('project_get', 'project:read', z.object({ projectId: identifier }).strict(), '查询单个项目、画板摘要和引用。', { readOnlyHint: true }, ({ projectId }) => {
    const value = deps.projects.get(projectId)
    const projection = projectPrivacyProjection(value.boards, value.references, 'aggregate', caller.user.openId)
    return { ...value, boards: projection.boards.map(publicBoard), references: projection.references }
  })
  register('project_create', 'project:write', z.object({ title, rootBoardTitle: title.optional(), idempotencyKey }).strict(), '创建项目和根画板。可用 idempotencyKey 安全重试。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'project_create', arguments: input, initialSummary: '正在创建项目', work: () => {
      const data = deps.projects.create(compact({ title: input.title, rootBoardTitle: input.rootBoardTitle }) as { title: string; rootBoardTitle?: string }, ctx)
      return { data, summary: `已创建项目“${data.project.title}”`, affectedIds: [data.project.id, data.rootBoard.id] }
    } }))
  })
  register('project_rename', 'project:write', z.object({ projectId: identifier, title, idempotencyKey }).strict(), '重命名项目。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    requireProjectManagement(input.projectId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'project_rename', arguments: input, projectId: input.projectId, initialSummary: '正在重命名项目', work: () => {
      const data = deps.projects.rename(input.projectId, input.title, ctx)
      return { data, summary: `项目已重命名为“${data.title}”`, affectedIds: [data.id] }
    } }))
  })
  register('project_set_root_board', 'project:write', z.object({ projectId: identifier, boardId: identifier, idempotencyKey }).strict(), '设置项目根画板。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    requireProjectManagement(input.projectId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'project_set_root_board', arguments: input, projectId: input.projectId, boardId: input.boardId, initialSummary: '正在设置根画板', work: () => {
      const data = deps.projects.setRootBoard(input.projectId, input.boardId, ctx)
      return { data, summary: '已设置根画板', affectedIds: [input.projectId, input.boardId] }
    } }))
  })
  register('project_delete_preview', 'project:write', z.object({ projectId: identifier }).strict(), '预览删除项目影响并生成 5 分钟一次性确认令牌；不会删除数据。', { readOnlyHint: false }, ({ projectId }) => {
    requireProjectManagement(projectId)
    return {
      preview: deps.projects.deletePreview(projectId),
      ...deps.confirmations.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'project_delete_confirm', targetId: projectId, request: { projectId } }),
    }
  })
  register('project_delete_confirm', 'project:write', z.object({ projectId: identifier, confirmationToken: z.string().min(20).max(200), idempotencyKey }).strict(), '使用一次性确认令牌删除项目。此操作不可逆。', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, async (input) => {
    requireProjectManagement(input.projectId)
    deps.confirmations.consume({ confirmationToken: input.confirmationToken, actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'project_delete_confirm', targetId: input.projectId, request: { projectId: input.projectId } })
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'project_delete_confirm', arguments: { projectId: input.projectId }, projectId: input.projectId, initialSummary: '正在删除项目', work: async () => {
      await deps.projects.remove(input.projectId, ctx)
      return { data: { deleted: true }, summary: '已删除项目', affectedIds: [input.projectId] }
    } }))
  })

  register('board_list', 'board:read', z.object({ projectId: identifier, query: z.string().max(200).optional(), ...pagination }).strict(), '分页查询项目画板，不返回 snapshot。', { readOnlyHint: true }, ({ projectId, ...input }) => {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const query = input.query?.trim().toLocaleLowerCase('zh-CN')
    const visible = deps.boardRepository.listByProject(projectId)
      .filter((board) => canReadBoard(board.id))
      .filter((board) => !query || board.title.toLocaleLowerCase('zh-CN').includes(query))
    const start = input.cursor ? Math.max(visible.findIndex((board) => board.id === input.cursor) + 1, 0) : 0
    const page = visible.slice(start, start + limit)
    return {
      boards: page.map(publicBoard),
      ...(visible.length > start + limit && page.at(-1) ? { nextCursor: page.at(-1)!.id } : {}),
    }
  })
  register('board_get', 'board:read', z.object({ boardId: identifier }).strict(), '查询画板元数据，不返回 snapshot。', { readOnlyHint: true }, ({ boardId }) => publicBoard(deps.boards.get(boardId)))
  register('board_inspect', 'board:read', z.object({ boardId: identifier }).strict(), '返回元素统计、文本摘要和包围盒，不返回完整 snapshot。', { readOnlyHint: true }, ({ boardId }) => deps.canvas.inspect(boardId))
  register('board_create', 'board:write', z.object({ projectId: identifier, title, idempotencyKey }).strict(), '创建空画板。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'board_create', arguments: input, projectId: input.projectId, initialSummary: '正在创建画板', work: () => {
      const data = deps.boards.create(input.projectId, input.title, ctx)
      return { data: publicBoard(data), summary: `已创建画板“${data.title}”`, affectedIds: [data.id] }
    } }))
  })
  register('board_duplicate', 'board:write', z.object({ boardId: identifier, title: title.optional(), idempotencyKey }).strict(), '复制画板及其出站引用。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const source = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'board_duplicate', arguments: input, projectId: source.projectId, boardId: source.id, initialSummary: '正在复制画板', work: () => {
      const data = deps.boards.duplicate(input.boardId, input.title, ctx)
      return { data: publicBoard(data), summary: `已复制画板“${source.title}”`, affectedIds: [data.id] }
    } }))
  })
  register('board_rename', 'board:write', z.object({ boardId: identifier, title, idempotencyKey }).strict(), '重命名画板。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const current = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'board_rename', arguments: input, projectId: current.projectId, boardId: current.id, initialSummary: '正在重命名画板', work: () => {
      const data = deps.boards.rename(input.boardId, input.title, ctx)
      return { data: publicBoard(data), summary: `画板已重命名为“${data.title}”`, affectedIds: [data.id] }
    } }))
  })
  register('board_delete_preview', 'board:write', z.object({ boardId: identifier }).strict(), '预览删除画板影响并生成一次性确认令牌。', { readOnlyHint: false }, ({ boardId }) => {
    const board = deps.boards.get(boardId)
    return { preview: deps.boards.deletePreview(boardId), ...deps.confirmations.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'board_delete_confirm', targetId: boardId, request: { boardId }, expectedRevision: board.revision }) }
  })
  register('board_delete_confirm', 'board:write', z.object({ boardId: identifier, expectedRevision: z.number().int().nonnegative(), confirmationToken: z.string().min(20).max(200), idempotencyKey }).strict(), '使用确认令牌删除非根且未被引用的画板。此操作不可逆。', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, async (input) => {
    deps.confirmations.consume({ confirmationToken: input.confirmationToken, actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'board_delete_confirm', targetId: input.boardId, request: { boardId: input.boardId }, expectedRevision: input.expectedRevision })
    const board = deps.boards.get(input.boardId)
    if (board.revision !== input.expectedRevision) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT', details: { currentRevision: board.revision } })
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'board_delete_confirm', arguments: { boardId: input.boardId, expectedRevision: input.expectedRevision }, projectId: board.projectId, boardId: board.id, initialSummary: '正在删除画板', work: async () => {
      await deps.boards.remove(board.id, ctx)
      return { data: { deleted: true }, summary: `已删除画板“${board.title}”`, affectedIds: [board.id], beforeRevision: board.revision }
    } }))
  })

  register('shape_list', 'board:read', z.object({ boardId: identifier, types: z.array(z.string().max(50)).max(20).optional(), text: z.string().max(200).optional(), region: z.object({ x: coordinate, y: coordinate, width: dimension, height: dimension }).strict().optional(), ...pagination }).strict(), '分页查询画布元素语义摘要。', { readOnlyHint: true }, ({ boardId, ...input }) => deps.canvas.list(boardId, compact(input)))
  register('shape_get', 'board:read', z.object({ boardId: identifier, shapeId: identifier }).strict(), '查询单个画布元素语义摘要。', { readOnlyHint: true }, ({ boardId, shapeId }) => deps.canvas.get(boardId, shapeId))
  register('shape_create', 'board:write', shapeCreateSchema, '创建受控的文本、便签、几何图形、Frame、线、绑定箭头或已上传图片。Shape ID 由服务端生成。尺寸以响应中的实际渲染边界为准：Text 高度由内容决定；Note 高度不小于宽度，仅传 height 时作为方形边长；Line 的 width/height 表示终点相对起点的跨度。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'shape_create', arguments: input, projectId: board.projectId, boardId: board.id, initialSummary: '正在创建画布元素', work: async () => {
      const data = await deps.canvas.create(input.boardId, input as McpShapeCreateInput, input.expectedRevision, ctx)
      return { data: data.shapes, summary: `已创建 ${data.affectedIds.length} 个元素`, affectedIds: data.affectedIds, beforeRevision: board.revision, afterRevision: data.revision }
    } }))
  })
  register('shape_update', 'board:write', shapeUpdateSchema, '修改普通画布元素的位置、尺寸、旋转、文本或颜色；引用元素必须用 reference_*。Text 高度由内容决定，Note 的实际高度不小于宽度，响应始终返回实际渲染边界。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'shape_update', arguments: input, projectId: board.projectId, boardId: board.id, initialSummary: '正在修改画布元素', work: async () => {
      const data = await deps.canvas.update(input.boardId, input as McpShapeUpdateInput, input.expectedRevision, ctx)
      return { data: data.shapes, summary: '已修改画布元素', affectedIds: data.affectedIds, beforeRevision: board.revision, afterRevision: data.revision }
    } }))
  })
  register('shape_delete', 'board:write', z.object({ boardId: identifier, shapeIds: z.array(identifier).min(1).max(100), expectedRevision, confirmationToken: z.string().min(20).max(200), idempotencyKey }).strict(), '使用 preview 令牌批量删除普通画布元素。', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    deps.confirmations.consume({ confirmationToken: input.confirmationToken, actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'shape_delete', targetId: input.boardId, request: { boardId: input.boardId, shapeIds: input.shapeIds }, ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }) })
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'shape_delete', arguments: { boardId: input.boardId, shapeIds: input.shapeIds, expectedRevision: input.expectedRevision }, projectId: board.projectId, boardId: board.id, initialSummary: '正在删除画布元素', work: async () => {
      const data = await deps.canvas.delete(input.boardId, input.shapeIds, input.expectedRevision, ctx)
      return { data: { deleted: data.affectedIds }, summary: `已删除 ${data.affectedIds.length} 个元素`, affectedIds: data.affectedIds, beforeRevision: board.revision, afterRevision: data.revision }
    } }))
  })
  register('shape_delete_preview', 'board:write', z.object({ boardId: identifier, shapeIds: z.array(identifier).min(1).max(100), expectedRevision: z.number().int().nonnegative() }).strict(), '预览批量删除元素并生成一次性确认令牌。', { readOnlyHint: false }, (input) => {
    const board = deps.boards.get(input.boardId)
    if (board.revision !== input.expectedRevision) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT', details: { currentRevision: board.revision } })
    const shapes = input.shapeIds.map((shapeId) => deps.canvas.get(input.boardId, shapeId).shape)
    return { preview: { boardId: input.boardId, revision: board.revision, shapes }, ...deps.confirmations.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'shape_delete', targetId: input.boardId, request: { boardId: input.boardId, shapeIds: input.shapeIds }, expectedRevision: input.expectedRevision }) }
  })
  register('shape_batch', 'board:write', z.object({ boardId: identifier, actions: z.array(shapeBatchActionSchema).min(1).max(100), expectedRevision, idempotencyKey }).strict(), '原子执行最多 100 个创建、修改、分组或取消分组动作；只保存一次 snapshot/checkpoint/revision。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    if (input.actions.some((action) => action.action === 'delete')) throw Object.assign(new Error('MCP_CONFIRMATION_REQUIRED'), { code: 'MCP_CONFIRMATION_REQUIRED', details: { action: 'Use shape_delete_preview + shape_delete for destructive batches.' } })
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'shape_batch', arguments: input, projectId: board.projectId, boardId: board.id, initialSummary: '正在原子批量修改画布', work: async () => {
      const data = await deps.canvas.batch(input.boardId, input.actions as McpShapeBatchAction[], input.expectedRevision, ctx)
      return { data: data.shapes, summary: `已原子提交 ${input.actions.length} 个动作`, affectedIds: data.affectedIds, beforeRevision: board.revision, afterRevision: data.revision }
    } }))
  })
  register('shape_layout', 'board:write', z.object({ boardId: identifier, shapeIds: z.array(identifier).min(1).max(100), mode: z.enum(['horizontal', 'vertical', 'grid', 'align_left', 'align_top', 'distribute_x', 'distribute_y', 'front', 'back']), gap: z.number().finite().min(0).max(5000).default(40), columns: z.number().int().min(1).max(20).default(4), expectedRevision, idempotencyKey }).strict(), '横排、竖排、网格、对齐、分布或调整普通元素层级。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'shape_layout', arguments: input, projectId: board.projectId, boardId: board.id, initialSummary: '正在布局画布元素', work: async () => {
      const data = await deps.canvas.layout(input.boardId, input.shapeIds, input.mode, input.gap, input.columns, input.expectedRevision, ctx)
      return { data: data.shapes, summary: `已布局 ${data.affectedIds.length} 个元素`, affectedIds: data.affectedIds, beforeRevision: board.revision, afterRevision: data.revision }
    } }))
  })

  register('reference_list', 'board:read', z.object({ boardId: identifier, direction: z.enum(['inbound', 'outbound']) }).strict(), '查询画板入站或出站引用。', { readOnlyHint: true }, ({ boardId, direction }) => ({
    references: direction === 'inbound'
      ? deps.referenceRepository.listInbound(boardId)
          .filter((reference) => canReadBoard(reference.sourceBoardId) && canReadBoard(reference.targetBoardId))
      : deps.referenceRepository.listOutbound(boardId)
          .filter((reference) => canReadBoard(reference.sourceBoardId) && canReadBoard(reference.targetBoardId)),
  }))
  register('board_create_embedded', 'board:write', z.object({ sourceBoardId: identifier, title, x: coordinate.optional(), y: coordinate.optional(), expectedRevision: z.number().int().nonnegative(), idempotencyKey }).strict(), '原子创建空白子画板及其嵌入引用，效果与网页“插入子画板”一致。画板 ID、引用 ID 和 Shape ID 均由服务端生成。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const source = deps.boards.get(input.sourceBoardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'board_create_embedded', arguments: input, projectId: source.projectId, boardId: source.id, initialSummary: '正在插入子画板', work: async () => {
      const timestamp = new Date().toISOString()
      const boardId = `board-${randomUUID()}`
      const data = await deps.references.createEmbeddedBoard({
        sourceBoardId: source.id,
        shapeId: createShapeId(),
        expectedRevision: input.expectedRevision,
        actorOpenId: caller.user.openId,
        ...(input.x === undefined || input.y === undefined ? {} : { placement: { x: input.x, y: input.y } }),
        board: {
          id: boardId,
          projectId: source.projectId,
          title: input.title,
          tldrawSnapshot: { store: {} },
          accessLevel: 'project',
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      })
      const board = deps.boards.get(boardId)
      return {
        data: { board: publicBoard(board), reference: data.reference, revision: data.revision },
        summary: `已插入子画板“${board.title}”`,
        affectedIds: [board.id, data.reference.id, data.reference.shapeId],
        beforeRevision: source.revision,
        afterRevision: data.revision,
      }
    } }))
  })
  register('reference_create', 'board:write', z.object({ sourceBoardId: identifier, targetBoardId: identifier, kind: z.enum(['embed', 'link']), x: coordinate.optional(), y: coordinate.optional(), expectedRevision: z.number().int().nonnegative(), idempotencyKey }).strict(), '创建受控画板引用，Shape ID 由服务端生成。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const source = deps.boards.get(input.sourceBoardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'reference_create', arguments: input, projectId: source.projectId, boardId: source.id, initialSummary: '正在创建画板引用', work: async () => {
      const data = await deps.references.create({ sourceBoardId: input.sourceBoardId, targetBoardId: input.targetBoardId, shapeId: createShapeId(), kind: input.kind, expectedRevision: input.expectedRevision, actorOpenId: caller.user.openId, ...(input.x === undefined || input.y === undefined ? {} : { placement: { x: input.x, y: input.y } }) })
      return { data: { reference: data.reference, revision: data.revision }, summary: '已创建画板引用', affectedIds: [data.reference.id, data.reference.shapeId], beforeRevision: source.revision, afterRevision: data.revision }
    } }))
  })
  register('reference_update', 'board:write', z.object({ referenceId: identifier, targetBoardId: identifier.optional(), kind: z.enum(['embed', 'link']).optional(), expectedRevision: z.number().int().nonnegative(), idempotencyKey }).strict(), '修改画板引用目标或类型。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const current = deps.referenceRepository.get(input.referenceId)
    if (!current) throw Object.assign(new Error('BOARD_REFERENCE_NOT_FOUND'), { code: 'BOARD_REFERENCE_NOT_FOUND' })
    const source = deps.boards.get(current.sourceBoardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'reference_update', arguments: input, projectId: current.projectId, boardId: current.sourceBoardId, initialSummary: '正在修改画板引用', work: async () => {
      const data = await deps.references.update(compact({ referenceId: input.referenceId, targetBoardId: input.targetBoardId, kind: input.kind, expectedRevision: input.expectedRevision, actorOpenId: caller.user.openId }) as { referenceId: string; targetBoardId?: string; kind?: 'embed' | 'link'; expectedRevision: number; actorOpenId?: string })
      return { data: { reference: data.reference, revision: data.revision }, summary: '已修改画板引用', affectedIds: [data.reference.id, data.reference.shapeId], beforeRevision: source.revision, afterRevision: data.revision }
    } }))
  })
  register('reference_delete_preview', 'board:write', z.object({ referenceId: identifier, expectedRevision: z.number().int().nonnegative() }).strict(), '预览删除引用并生成一次性确认令牌。', { readOnlyHint: false }, (input) => {
    const reference = deps.referenceRepository.get(input.referenceId)
    if (!reference) throw Object.assign(new Error('BOARD_REFERENCE_NOT_FOUND'), { code: 'BOARD_REFERENCE_NOT_FOUND' })
    const board = deps.boardRepository.get(reference.sourceBoardId)
    if (!board || board.revision !== input.expectedRevision) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT', details: { currentRevision: board?.revision } })
    return { preview: { reference, boardRevision: board.revision }, ...deps.confirmations.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'reference_delete_confirm', targetId: input.referenceId, request: { referenceId: input.referenceId }, expectedRevision: input.expectedRevision }) }
  })
  register('reference_delete_confirm', 'board:write', z.object({ referenceId: identifier, expectedRevision: z.number().int().nonnegative(), confirmationToken: z.string().min(20).max(200), idempotencyKey }).strict(), '使用确认令牌删除画板引用。', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, async (input) => {
    deps.confirmations.consume({ confirmationToken: input.confirmationToken, actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'reference_delete_confirm', targetId: input.referenceId, request: { referenceId: input.referenceId }, expectedRevision: input.expectedRevision })
    const reference = deps.referenceRepository.get(input.referenceId)
    if (!reference) throw Object.assign(new Error('BOARD_REFERENCE_NOT_FOUND'), { code: 'BOARD_REFERENCE_NOT_FOUND' })
    const source = deps.boards.get(reference.sourceBoardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'reference_delete_confirm', arguments: { referenceId: input.referenceId, expectedRevision: input.expectedRevision }, projectId: reference.projectId, boardId: reference.sourceBoardId, initialSummary: '正在删除画板引用', work: async () => {
      const data = await deps.references.remove({ referenceId: input.referenceId, expectedRevision: input.expectedRevision, actorOpenId: caller.user.openId })
      return { data: { deleted: true, revision: data.revision }, summary: '已删除画板引用', affectedIds: [reference.id, reference.shapeId], beforeRevision: source.revision, afterRevision: data.revision }
    } }))
  })

  register('comment_list', 'board:read', z.object({ boardId: identifier, status: z.enum(['open', 'resolved']).optional() }).strict(), '查询画板评论及回复。', { readOnlyHint: true }, ({ boardId, status }) => ({
    threads: deps.comments.list(boardId, status),
  }))
  register('comment_create', 'board:write', z.object({ boardId: identifier, body: z.string().trim().min(1).max(10_000), shapeId: identifier.optional(), x: coordinate.optional(), y: coordinate.optional(), idempotencyKey }).strict(), '创建画板或元素评论。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'comment_create', arguments: input, projectId: board.projectId, boardId: board.id, initialSummary: '正在创建评论', work: () => {
      const data = deps.comments.create(input.boardId, compact({ body: input.body, shapeId: input.shapeId, x: input.x, y: input.y }) as { body: string; shapeId?: string; x?: number; y?: number }, ctx)
      return { data, summary: '已创建评论', affectedIds: [data.thread.id, data.message.id] }
    } }))
  })
  register('comment_reply', 'board:write', z.object({ threadId: identifier, body: z.string().trim().min(1).max(10_000), idempotencyKey }).strict(), '回复评论。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'comment_reply', arguments: input, initialSummary: '正在回复评论', work: () => {
      const data = deps.comments.reply(input.threadId, input.body, ctx)
      return { data, summary: '已回复评论', affectedIds: [input.threadId, data.id] }
    } }))
  })
  for (const [name, status] of [['comment_resolve', 'resolved'], ['comment_reopen', 'open']] as const) {
    register(name, 'board:write', z.object({ threadId: identifier, idempotencyKey }).strict(), status === 'resolved' ? '解决评论。' : '重新打开评论。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
      const ctx = context(caller, input.idempotencyKey)
      return receipt(await deps.operations.execute({ context: ctx, toolName: name, arguments: input, initialSummary: '正在更新评论状态', work: () => {
        const data = deps.comments.setStatus(input.threadId, status, ctx)
        return { data, summary: status === 'resolved' ? '已解决评论' : '已重新打开评论', affectedIds: [input.threadId] }
      } }))
    })
  }
  register('comment_delete_preview', 'board:write', z.object({ threadId: identifier }).strict(), '预览删除评论并生成一次性确认令牌。', { readOnlyHint: false }, ({ threadId }) => {
    requireCommentDeletion(threadId)
    return {
      preview: deps.comments.deletePreview(threadId),
      ...deps.confirmations.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'comment_delete_confirm', targetId: threadId, request: { threadId } }),
    }
  })
  register('comment_delete_confirm', 'board:write', z.object({ threadId: identifier, confirmationToken: z.string().min(20).max(200), idempotencyKey }).strict(), '使用确认令牌删除评论。', { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, async (input) => {
    requireCommentDeletion(input.threadId)
    deps.confirmations.consume({ confirmationToken: input.confirmationToken, actorOpenId: caller.user.openId, clientId: caller.access.id, toolName: 'comment_delete_confirm', targetId: input.threadId, request: { threadId: input.threadId } })
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'comment_delete_confirm', arguments: { threadId: input.threadId }, initialSummary: '正在删除评论', work: () => {
      deps.comments.remove(input.threadId, ctx)
      return { data: { deleted: true }, summary: '已删除评论', affectedIds: [input.threadId] }
    } }))
  })

  register('audit_list', 'audit:read', z.object({ projectId: identifier.optional(), boardId: identifier.optional(), actorOpenId: identifier.optional(), action: z.string().max(100).optional(), startAt: z.string().datetime().optional(), endAt: z.string().datetime().optional(), cursor: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), '分页查询脱敏审计事件。', { readOnlyHint: true }, (input) => {
    const page = deps.audits.listPage(compact(input))
    return sanitizeAudit({
      ...page,
      events: page.events.filter((event) => event.actorOpenId === caller.user.openId || (event.boardId
        ? canReadBoard(event.boardId)
        : event.projectId ? canReadProject(event.projectId) : true)),
    })
  })

  register('export_board', 'export', z.object({ boardId: identifier, format: z.literal('pdf').default('pdf'), idempotencyKey }).strict(), '生成绑定当前用户和客户端、5 分钟有效的画板 PDF 下载链接；不内联二进制。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const board = deps.boards.get(input.boardId)
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'export_board', arguments: input, projectId: board.projectId, boardId: board.id, initialSummary: '正在准备画板导出', work: () => {
      const download = deps.downloads.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, produce: () => deps.exports.boardPdf(input.boardId, caller.user.openId) })
      const data = { downloadUrl: `${caller.serverBaseUrl}/mcp/download/${download.ticket}`, expiresAt: download.expiresAt, fileName: `${board.title}.pdf`, mimeType: 'application/pdf', authorization: 'Use the same OAuth access token.' }
      return { data, summary: '画板导出链接已生成', affectedIds: [board.id] }
    } }))
  })
  register('export_project', 'export', z.object({ projectId: identifier, format: z.enum(['iboard', 'pdf']).default('iboard'), idempotencyKey }).strict(), '生成绑定当前用户和客户端、5 分钟有效的项目下载链接；不内联二进制。', { readOnlyHint: false, idempotentHint: true }, async (input) => {
    const project = deps.projects.get(input.projectId).project
    const ctx = context(caller, input.idempotencyKey)
    return receipt(await deps.operations.execute({ context: ctx, toolName: 'export_project', arguments: input, projectId: project.id, initialSummary: '正在准备项目导出', work: () => {
      const extension = input.format === 'pdf' ? 'pdf' : 'iboard'
      const mimeType = input.format === 'pdf' ? 'application/pdf' : 'application/vnd.infinite-board+zip'
      const download = deps.downloads.create({ actorOpenId: caller.user.openId, clientId: caller.access.id, produce: () => input.format === 'pdf' ? deps.exports.projectPdf(project.id, caller.user.openId) : deps.exports.projectIboard(project.id, caller.user.openId) })
      const data = { downloadUrl: `${caller.serverBaseUrl}/mcp/download/${download.ticket}`, expiresAt: download.expiresAt, fileName: `${project.title}.${extension}`, mimeType, authorization: 'Use the same OAuth access token.' }
      return { data, summary: '项目导出链接已生成', affectedIds: [project.id] }
    } }))
  })

  return server
}
