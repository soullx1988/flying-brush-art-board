import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyExpress from '@fastify/express'

import { AssetRepository } from './modules/assets/asset-repository.js'
import { registerAssetRoutes } from './modules/assets/asset-routes.js'
import { registerBoardReferenceRoutes } from './modules/board-references/board-reference-routes.js'
import { BoardReferenceRepository } from './modules/board-references/board-reference-repository.js'
import { registerBoardRoutes } from './modules/boards/board-routes.js'
import { BoardRepository } from './modules/boards/board-repository.js'
import { registerClipboardCommandRoutes } from './modules/clipboard/clipboard-command-routes.js'
import { CommentRepository } from './modules/comments/comment-repository.js'
import { registerCommentRoutes } from './modules/comments/comment-routes.js'
import { EncryptedCredentialStore } from './modules/feishu/credential-store.js'
import { FeishuBoardClient } from './modules/feishu/board-client.js'
import { createMockFeishuOAuthProvider } from './modules/feishu/mock-oauth-provider.js'
import { registerFeishuOAuthRoutes } from './modules/feishu/oauth-routes.js'
import { FeishuOAuthService } from './modules/feishu/oauth-service.js'
import { registerFeishuImportRoutes, type FeishuImportRouteDependencies } from './modules/feishu/import-routes.js'
import { FeishuRealOAuthProvider } from './modules/feishu/real-oauth-provider.js'
import { FeishuWikiDocxClient } from './modules/feishu/wiki-docx-client.js'
import { resolveWhiteboardToken } from './modules/feishu/url-resolver.js'
import { IboardImportSessionStore, registerIboardRoutes } from './modules/files/iboard-routes.js'
import { registerPdfRoutes } from './modules/files/pdf-routes.js'
import { registerProjectRoutes } from './modules/projects/project-routes.js'
import { ProjectRepository } from './modules/projects/project-repository.js'
import { createDatabase, type LocalDatabase } from './db/schema.js'
import { registerAuthenticationPlugin, SESSION_COOKIE_NAME, type AuthenticationDependencies } from './modules/auth/auth-plugin.js'
import { registerAuthenticationRoutes, type AuthenticationRouteDependencies } from './modules/auth/auth-routes.js'
import { AuditRepository } from './modules/audit/audit-repository.js'
import { registerAuditPlugin } from './modules/audit/audit-plugin.js'
import { registerAuditRoutes } from './modules/audit/audit-routes.js'
import { createRealtimeRoomManager, registerRealtimeRoutes } from './modules/realtime/realtime-routes.js'
import { BoardDocumentCoordinator } from './modules/realtime/board-document-coordinator.js'
import { BoardOperationQueue } from './modules/realtime/board-operation-queue.js'
import { BoardDeletionCoordinator } from './modules/realtime/board-deletion-coordinator.js'
import { resolveAppDataDirectory } from './data-directory.js'
import { loadAuthGate } from './modules/auth/auth-gate.js'
import { registerMcpAuthentication } from './modules/auth/mcp-auth-plugin.js'
import { McpOAuthRepository } from './modules/auth/mcp-oauth-repository.js'
import { InfiniteBoardOAuthProvider } from './modules/auth/mcp-oauth-provider.js'
import { registerMcpOAuthRoutes } from './modules/auth/mcp-oauth-routes.js'
import { ProjectApplicationService } from './application/project-service.js'
import { BoardApplicationService } from './application/board-service.js'
import { CanvasCommandService } from './application/canvas-command-service.js'
import { CommentApplicationService } from './application/comment-service.js'
import { McpConfirmationService, McpOperationService } from './application/operation-service.js'
import { BoardReferenceService } from './modules/board-references/board-reference-service.js'
import { registerMcpPlugin } from './modules/mcp/mcp-plugin.js'
import { ApplicationEventHub } from './application/domain-event-publisher.js'
import { registerApplicationEventSocket } from './modules/realtime/application-event-socket.js'
import { ExportApplicationService } from './application/export-service.js'
import { McpDownloadService } from './modules/mcp/mcp-download-service.js'

export { resolveAppDataDirectory } from './data-directory.js'

export interface BuildAppConfig {
  host?: string
  database?: LocalDatabase
  databasePath?: string
  dataDirectory?: string
  assetDirectory?: string
  maxAssetBytes?: number
  iboardImportSessionTtlMs?: number
  iboardImportMaxSessions?: number
  iboardImportMaxBytes?: number
  iboardImportSessionNow?: () => number
  iboardImportSessionStore?: IboardImportSessionStore
  environment?: Record<string, string | undefined>
  feishuOAuth?: { clientId: string; clientSecret: string }
  feishuImport?: Partial<FeishuImportRouteDependencies> & Pick<FeishuImportRouteDependencies, 'connected'>
  authentication?: AuthenticationRouteDependencies
  enableRealtime?: boolean
  auditRetentionDays?: number
  enableMcp?: boolean
  mcpAllowedHosts?: string[]
  mcpAllowedOrigins?: string[]
  mcpPublicUrl?: string
  mcpMaxRequestBytes?: number
  mcpMaxConcurrentRequests?: number
  mcpMaxRequestsPerMinute?: number
}

function assertLoopbackHost(host: unknown): asserts host is '127.0.0.1' | '::1' {
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('Loopback host required')
}

function resolveMcpPublicOrigin(
  configuredValue: string | undefined,
  environment: Record<string, string | undefined>,
  allowedHosts: string[],
  allowedOrigins: string[],
): URL {
  const value = configuredValue?.trim() || `http://127.0.0.1:${environment.PORT ?? '8787'}`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCP_PUBLIC_URL must be an absolute URL')
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('MCP_PUBLIC_URL must contain only the public web origin')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('MCP_PUBLIC_URL must use HTTP or HTTPS')
  const normalizedHost = url.host.toLocaleLowerCase('en-US')
  const normalizedHostname = url.hostname.toLocaleLowerCase('en-US')
  const hostAllowed = allowedHosts.some((entry) => {
    const candidate = entry.trim().toLocaleLowerCase('en-US').replace(/\.$/, '')
    return candidate === normalizedHost || candidate === normalizedHostname
  })
  if (!hostAllowed) throw new Error('MCP_PUBLIC_URL host is not in MCP_ALLOWED_HOSTS')
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
    throw new Error('MCP_PUBLIC_URL origin is not in MCP_ALLOWED_ORIGINS')
  }
  return new URL(url.origin)
}

export async function buildApp(config: BuildAppConfig = {}): Promise<FastifyInstance> {
  const host = config.host ?? '127.0.0.1'
  assertLoopbackHost(host)
  const authGate = loadAuthGate(config.environment ?? process.env)
  const environment = config.environment ?? process.env
  const mcpEnabled = config.enableMcp ?? environment.MCP_ENABLED === 'true'

  const dataDirectory = config.dataDirectory ?? resolveAppDataDirectory()
  const ownsDatabase = !config.database
  if (ownsDatabase) mkdirSync(dataDirectory, { recursive: true })
  const database = config.database ?? createDatabase(config.databasePath ?? join(dataDirectory, 'infinite-board.sqlite'))
  const assetDirectory = config.assetDirectory ?? join(dataDirectory, 'assets')
  const maxAssetBytes = config.maxAssetBytes ?? 20 * 1024 * 1024
  // Keep enough room for a small JSON envelope even when tests or callers
  // configure a deliberately tiny asset limit. The route then reports schema
  // errors as 400 and decoded-size violations as ASSET_TOO_LARGE (413).
  const app = Fastify({ logger: false, bodyLimit: Math.max(maxAssetBytes * 2, 1024) })
  await app.register(cookie)
  if (mcpEnabled) {
    await app.register(fastifyExpress)
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))) } catch (error) { done(error as Error, undefined) }
    })
  }
  const fastifyListen = app.listen.bind(app)
  app.listen = ((options: unknown, ...args: unknown[]) => {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new Error('Loopback host required')
    }

    const listenOptions = options as { host?: unknown }
    assertLoopbackHost(listenOptions.host ?? host)
    return Reflect.apply(fastifyListen, app, [{ ...listenOptions, host: listenOptions.host ?? host }, ...args])
  }) as FastifyInstance['listen']

  const projects = new ProjectRepository(database)
  const boards = new BoardRepository(database)
  const references = new BoardReferenceRepository(database)
  const assets = new AssetRepository(database, assetDirectory)
  const audits = new AuditRepository(database)
  audits.pruneOlderThan(config.auditRetentionDays ?? 80)
  const comments = new CommentRepository(database)
  const applicationEvents = new ApplicationEventHub()
  const boardOperationQueue = new BoardOperationQueue()
  const realtime = config.enableRealtime ? createRealtimeRoomManager(database, boards, boardOperationQueue) : undefined
  const boardDocuments = new BoardDocumentCoordinator(database, boards, realtime, boardOperationQueue)
  const boardDeletions = new BoardDeletionCoordinator(boardOperationQueue, realtime)

  app.get('/health', async () => {
    const row = database.prepare('SELECT 1 AS value').get() as { value: number }
    const databaseStatus = row.value === 1 ? 'ok' : 'error'
    const userDirectory = config.authentication
      ? await config.authentication.users.checkHealth().catch(() => 'error' as const)
      : 'not-configured' as const
    const realtimeStatus = config.enableRealtime ? 'ok' : 'disabled'
    return {
      status: databaseStatus === 'ok' && userDirectory !== 'error' ? 'ok' : 'error',
      database: databaseStatus,
      userDirectory,
      realtime: realtimeStatus,
    }
  })

  app.get('/auth/status', async () => ({
    authenticationEnabled: authGate.authenticationEnabled,
    whitelistEnabled: authGate.whitelistEnabled,
    mode: config.authentication ? 'feishu-session' : authGate.mode,
    user: authGate.mode === 'development-bypass' ? authGate.localUser : null,
  }))

  if (config.authentication) {
    registerAuthenticationPlugin(app, config.authentication satisfies AuthenticationDependencies)
    registerAuthenticationRoutes(app, {
      ...config.authentication,
      realtimeEnabled: config.enableRealtime === true,
      audit: audits,
    })
  } else if (authGate.authenticationEnabled) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(401).send({ code: 'FEISHU_LOGIN_REQUIRED' })
    })
  } else {
    app.addHook('onRequest', async (request) => {
      if (!request.url.startsWith('/api/') && !request.url.startsWith('/realtime/')) return
      request.user = {
        openId: authGate.localUser.id,
        name: authGate.localUser.name,
      }
    })
    app.get('/api/me', async () => ({
      openId: authGate.localUser.id,
      name: authGate.localUser.name,
      realtimeEnabled: config.enableRealtime === true,
    }))
    app.post('/api/auth/logout', async (_request, reply) => reply.code(204).send())
  }

  registerAuditPlugin(app, audits, boards, comments, references)

  if (config.enableRealtime) {
    await registerRealtimeRoutes(app, realtime!)
    registerApplicationEventSocket(app, applicationEvents)
  }

  registerProjectRoutes(app, projects, boards, references, boardDeletions)
  registerBoardRoutes(
    app,
    projects,
    boards,
    references,
    realtime?.applyCommittedSnapshot.bind(realtime),
    boardDocuments,
    boardDeletions,
  )
  registerBoardReferenceRoutes(app, database, boards, references, realtime?.applyCommittedSnapshot.bind(realtime), boardDocuments)
  registerAssetRoutes(app, assets, maxAssetBytes)
  registerClipboardCommandRoutes(
    app,
    database,
    boards,
    assets,
    realtime?.applyCommittedSnapshotWithinQueue.bind(realtime),
    boardOperationQueue,
  )
  registerCommentRoutes(app, boards, comments, {
    revalidate: config.authentication
      ? async (request) => {
          const token = request.cookies[SESSION_COOKIE_NAME]
          if (!token || !request.user) return false
          const session = config.authentication!.sessions.findAndRefresh(token)
          if (!session || session.openId !== request.user.openId) return false
          config.authentication!.users.invalidate(session.openId)
          try {
            await config.authentication!.users.requireAllowed(session.openId)
            return true
          } catch {
            return false
          }
        }
      : (request) => Boolean(request.user),
  })
  registerAuditRoutes(app, audits)

  if (mcpEnabled) {
    const allowedHosts = config.mcpAllowedHosts ?? (environment.MCP_ALLOWED_HOSTS?.split(',').map((value) => value.trim()).filter(Boolean) ?? ['127.0.0.1', 'localhost'])
    const allowedOrigins = config.mcpAllowedOrigins ?? (environment.MCP_ALLOWED_ORIGINS?.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean) ?? [])
    const publicOrigin = resolveMcpPublicOrigin(config.mcpPublicUrl ?? environment.MCP_PUBLIC_URL, environment, allowedHosts, allowedOrigins)
    const oauth = new McpOAuthRepository(database)
    oauth.pruneExpired()
    const ensureUserAllowed = async (openId: string) => {
      if (config.authentication) {
        await config.authentication.users.requireAllowed(openId)
        return
      }
      if (!('localUser' in authGate) || authGate.localUser.id !== openId) throw Object.assign(new Error('USER_NOT_ALLOWED'), { code: 'USER_NOT_ALLOWED' })
    }
    const oauthProvider = new InfiniteBoardOAuthProvider(oauth, publicOrigin, ensureUserAllowed)
    registerMcpOAuthRoutes(app, {
      repository: oauth,
      provider: oauthProvider,
      publicOrigin,
      audit: audits,
      ...(config.authentication ? { sessions: config.authentication.sessions, users: config.authentication.users } : {}),
      ...('localUser' in authGate ? { localUser: { openId: authGate.localUser.id, name: authGate.localUser.name } } : {}),
    })
    registerMcpAuthentication(app, {
      oauth,
      resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', publicOrigin).href,
      audit: audits,
      ...(config.authentication
        ? { users: config.authentication.users }
        : 'localUser' in authGate
          ? { localUser: { openId: authGate.localUser.id, name: authGate.localUser.name } }
          : {}),
    })
    const projectService = new ProjectApplicationService(database, projects, boards, references, applicationEvents, () => new Date(), boardDeletions)
    const boardService = new BoardApplicationService(database, projects, boards, references, applicationEvents, () => new Date(), boardDeletions)
    const canvasService = new CanvasCommandService(database, boards, boardDocuments, assets)
    const commentService = new CommentApplicationService(boards, comments, applicationEvents)
    const operationService = new McpOperationService(database, audits, applicationEvents)
    const confirmationService = new McpConfirmationService(database)
    operationService.pruneExpired()
    confirmationService.pruneExpired()
    const downloadService = new McpDownloadService()
    registerMcpPlugin(app, {
      dependencies: {
        projects: projectService,
        boards: boardService,
        canvas: canvasService,
        operations: operationService,
        confirmations: confirmationService,
        references: new BoardReferenceService(database, boards, references, { coordinator: boardDocuments }),
        referenceRepository: references,
        boardRepository: boards,
        comments: commentService,
        audits,
        exports: new ExportApplicationService(database, projects, boards, references, assets),
        downloads: downloadService,
        ...(realtime ? { applyCommittedSnapshot: realtime.applyCommittedSnapshot.bind(realtime) } : {}),
      },
      allowedHosts,
      allowedOrigins,
      ...(config.mcpMaxRequestBytes === undefined ? {} : { maxRequestBytes: config.mcpMaxRequestBytes }),
      ...(config.mcpMaxConcurrentRequests === undefined ? {} : { maxConcurrentRequests: config.mcpMaxConcurrentRequests }),
      ...(config.mcpMaxRequestsPerMinute === undefined ? {} : { maxRequestsPerMinute: config.mcpMaxRequestsPerMinute }),
    })
  }
  const iboardImportSessions = config.iboardImportSessionStore ?? new IboardImportSessionStore({
    ...(config.iboardImportSessionTtlMs === undefined ? {} : { ttlMs: config.iboardImportSessionTtlMs }),
    ...(config.iboardImportMaxSessions === undefined ? {} : { maxSessions: config.iboardImportMaxSessions }),
    ...(config.iboardImportMaxBytes === undefined ? {} : { maxBytes: config.iboardImportMaxBytes }),
    ...(config.iboardImportSessionNow === undefined ? {} : { now: config.iboardImportSessionNow }),
  })
  registerIboardRoutes(app, database, assets, iboardImportSessions)
  registerPdfRoutes(app, projects, boards, references, assets)
  const credentials = new EncryptedCredentialStore({ directory: dataDirectory })
  registerFeishuOAuthRoutes(app, new FeishuOAuthService({
    provider: config.feishuOAuth
      ? new FeishuRealOAuthProvider(config.feishuOAuth)
      : createMockFeishuOAuthProvider(),
    credentials,
  }))
  if (config.feishuImport?.client && config.feishuImport.resolveWhiteboardToken) {
    registerFeishuImportRoutes(app, database, assets, config.feishuImport as FeishuImportRouteDependencies)
  } else if (config.feishuImport) {
    registerFeishuImportRoutes(app, database, assets, {
      connected: config.feishuImport.connected,
      resolveWhiteboardToken: async () => { throw new Error('FEISHU_IMPORT_CLIENT_NOT_CONFIGURED') },
      client: {
        listWhiteboardNodes: async () => { throw new Error('FEISHU_IMPORT_CLIENT_NOT_CONFIGURED') },
        getWhiteboardTheme: async () => { throw new Error('FEISHU_IMPORT_CLIENT_NOT_CONFIGURED') },
        downloadWhiteboardPreview: async () => { throw new Error('FEISHU_IMPORT_CLIENT_NOT_CONFIGURED') },
        downloadMedia: async () => { throw new Error('FEISHU_IMPORT_CLIENT_NOT_CONFIGURED') },
      },
    })
  } else {
    const mockClient = {
      async listWhiteboardNodes() { return { nodes: [{ id: 'mock-title', type: 'text', x: 0, y: 0, width: 320, height: 48, text: 'Mock Feishu whiteboard' }] } },
      async getWhiteboardTheme() { return { backgroundColor: '#f6f7f9', primaryColor: '#3370ff' } },
      async downloadWhiteboardPreview() { return new Uint8Array([137, 80, 78, 71]) },
      async downloadMedia() { throw new Error('FEISHU_MOCK_MEDIA_NOT_FOUND') },
    }
    registerFeishuImportRoutes(app, database, assets, {
      connected: () => Boolean(credentials.read()),
      resolveWhiteboardToken: config.feishuOAuth
        ? (input, options) => resolveWhiteboardToken(input, new FeishuWikiDocxClient({ credentials }), options)
        : (input, options) => resolveWhiteboardToken(input, { resolveWhiteboardToken: async () => { throw new Error('FEISHU_MOCK_DOCUMENT_RESOLUTION_UNAVAILABLE') } }, options),
      client: config.feishuOAuth ? new FeishuBoardClient({ credentials }) : mockClient,
    })
  }

  if (ownsDatabase) {
    app.addHook('onClose', async () => {
      database.close()
    })
  }

  return app
}
