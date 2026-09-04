import { createHash, randomUUID } from 'node:crypto'

import { mapFeishuNodes, mapFeishuTheme, type ImportCompatibilityReport, type InteropScene } from '@infinite-board/interop'
import { interopSceneToSnapshot } from '@infinite-board/tldraw-adapter'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository, type TransactionalAssetPut } from '../assets/asset-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { canAccessProject } from '../../privacy/board-access-policy.js'
import type { FeishuImportClient } from './import-feishu-service.js'

const inspectSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict()
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), projectId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('new'), projectId: z.string().min(1).max(256), title: z.string().trim().min(1).max(200) }).strict(),
])
const commitSchema = z.object({ sessionId: z.string().min(1).max(256), target: targetSchema, confirmed: z.literal(true) }).strict()

interface Media { bytes: Uint8Array; mime: string; sha256: string }
interface Session {
  id: string
  token: string
  scene: InteropScene
  report: ImportCompatibilityReport
  theme: ReturnType<typeof mapFeishuTheme>
  previewByteLength: number
  media: Map<string, Media>
  actorOpenId?: string
  retainedByteLength: number
  expiresAt: number
}

export interface FeishuImportLimits {
  maxNodes: number
  maxPreviewBytes: number
  maxMediaItemBytes: number
  maxTotalMediaBytes: number
  maxConcurrentInspects: number
  maxSessions: number
  maxRetainedSessionBytes: number
}

const DEFAULT_IMPORT_LIMITS: FeishuImportLimits = {
  maxNodes: 20_000,
  maxPreviewBytes: 8 * 1024 * 1024,
  maxMediaItemBytes: 20 * 1024 * 1024,
  maxTotalMediaBytes: 64 * 1024 * 1024,
  maxConcurrentInspects: 4,
  maxSessions: 32,
  maxRetainedSessionBytes: 256 * 1024 * 1024,
}

class FeishuImportQuotaError extends Error {
  constructor(readonly code: string, readonly statusCode: 413 | 429) {
    super(code)
    this.name = 'FeishuImportQuotaError'
  }
}

export interface FeishuImportRouteDependencies {
  connected(actorOpenId: string): boolean
  resolveWhiteboardToken(input: string, options: { signal?: AbortSignal; actorOpenId: string }): Promise<string>
  client: FeishuImportClient
  now?: () => string
  clock?: () => number
  id?: () => string
  sessionTtlMs?: number
  sessionStore?: FeishuImportSessionStore
  limits?: Partial<FeishuImportLimits>
}

export class FeishuImportSessionStore {
  private readonly sessions = new Map<string, Session>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private retainedByteLength = 0
  private readonly maxSessions: number
  private readonly maxRetainedBytes: number
  constructor(
    private readonly clock: () => number = Date.now,
    private readonly ttlMs = 10 * 60_000,
    limits: Pick<FeishuImportLimits, 'maxSessions' | 'maxRetainedSessionBytes'> = DEFAULT_IMPORT_LIMITS,
  ) {
    this.maxSessions = positiveLimit(limits.maxSessions, DEFAULT_IMPORT_LIMITS.maxSessions)
    this.maxRetainedBytes = positiveLimit(limits.maxRetainedSessionBytes, DEFAULT_IMPORT_LIMITS.maxRetainedSessionBytes)
  }
  assertCanCreate(): void {
    this.removeExpired()
    if (this.sessions.size >= this.maxSessions) {
      throw new FeishuImportQuotaError('FEISHU_IMPORT_SESSION_CAPACITY_EXCEEDED', 429)
    }
  }
  create(session: Omit<Session, 'expiresAt' | 'retainedByteLength'>): Session {
    this.removeExpired()
    if (this.sessions.has(session.id)) {
      throw new FeishuImportQuotaError('FEISHU_IMPORT_SESSION_ID_CONFLICT', 429)
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new FeishuImportQuotaError('FEISHU_IMPORT_SESSION_CAPACITY_EXCEEDED', 429)
    }
    const retainedByteLength = sessionByteLength(session)
    if (retainedByteLength > this.maxRetainedBytes || this.retainedByteLength + retainedByteLength > this.maxRetainedBytes) {
      throw new FeishuImportQuotaError('FEISHU_IMPORT_SESSION_BYTES_EXCEEDED', 413)
    }
    const stored = { ...session, retainedByteLength, expiresAt: this.clock() + this.ttlMs }
    this.sessions.set(stored.id, stored)
    this.retainedByteLength += retainedByteLength
    this.scheduleExpiry()
    return stored
  }
  take(id: string, actorOpenId?: string): Session | undefined {
    this.removeExpired()
    const session = this.sessions.get(id)
    if (actorOpenId !== undefined && session?.actorOpenId && session.actorOpenId !== actorOpenId) return undefined
    if (session) {
      this.sessions.delete(id)
      this.retainedByteLength -= session.retainedByteLength
    }
    this.scheduleExpiry()
    return session
  }
  delete(id: string, actorOpenId?: string): boolean {
    const session = this.sessions.get(id)
    if (actorOpenId !== undefined && session?.actorOpenId && session.actorOpenId !== actorOpenId) return false
    if (session) {
      session.media.clear()
      this.retainedByteLength -= session.retainedByteLength
    }
    const deleted = this.sessions.delete(id)
    this.scheduleExpiry()
    return deleted
  }
  removeExpired(): void {
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.clock()) {
      session.media.clear()
      this.sessions.delete(id)
      this.retainedByteLength -= session.retainedByteLength
    }
    this.scheduleExpiry()
  }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; for (const session of this.sessions.values()) session.media.clear(); this.sessions.clear(); this.retainedByteLength = 0 }
  get size(): number { return this.sessions.size }
  get totalRetainedByteLength(): number { return this.retainedByteLength }
  private scheduleExpiry(): void {
    if (this.timer) clearTimeout(this.timer)
    const next = Math.min(...[...this.sessions.values()].map((session) => session.expiresAt))
    if (!Number.isFinite(next)) { this.timer = undefined; return }
    this.timer = setTimeout(() => { this.timer = undefined; this.removeExpired() }, Math.max(0, next - this.clock()))
    this.timer.unref?.()
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : fallback
}

function sessionByteLength(session: Omit<Session, 'expiresAt' | 'retainedByteLength'>): number {
  const structural = JSON.stringify({
    id: session.id,
    token: session.token,
    scene: session.scene,
    report: session.report,
    theme: session.theme,
    actorOpenId: session.actorOpenId,
  })
  const structuralBytes = new TextEncoder().encode(structural).byteLength
  const mediaBytes = [...session.media.values()].reduce((total, entry) => total + entry.bytes.byteLength, 0)
  return structuralBytes + mediaBytes + session.previewByteLength
}

function rawNodeCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nodes = (value as { nodes?: unknown }).nodes
    if (Array.isArray(nodes)) return nodes.length
  }
  return 1
}

function mediaToken(element: InteropScene['elements'][number]): string | undefined {
  return element.type === 'image' && element.src.startsWith('feishu-media://') ? element.src.slice('feishu-media://'.length) : undefined
}

function fidelity(scene: InteropScene, report: ImportCompatibilityReport) {
  const downgraded = report.issues.filter((issue) => issue.code.endsWith('_DOWNGRADED')).flatMap((issue) => issue.elementId ? [issue.elementId] : [])
  const unsupported = scene.elements.filter((element) => element.type === 'unsupported').map((element) => element.id)
  const rasterized = scene.elements.filter((element) => element.type === 'image' || element.type === 'svg').map((element) => element.id)
  const excluded = new Set([...downgraded, ...unsupported, ...rasterized])
  return { editable: scene.elements.filter((element) => !excluded.has(element.id)).map((element) => element.id), downgraded, rasterized, unsupported }
}

export function registerFeishuImportRoutes(app: FastifyInstance, database: LocalDatabase, assets: AssetRepository, dependencies: FeishuImportRouteDependencies): void {
  const limits: FeishuImportLimits = {
    maxNodes: positiveLimit(dependencies.limits?.maxNodes, DEFAULT_IMPORT_LIMITS.maxNodes),
    maxPreviewBytes: positiveLimit(dependencies.limits?.maxPreviewBytes, DEFAULT_IMPORT_LIMITS.maxPreviewBytes),
    maxMediaItemBytes: positiveLimit(dependencies.limits?.maxMediaItemBytes, DEFAULT_IMPORT_LIMITS.maxMediaItemBytes),
    maxTotalMediaBytes: positiveLimit(dependencies.limits?.maxTotalMediaBytes, DEFAULT_IMPORT_LIMITS.maxTotalMediaBytes),
    maxConcurrentInspects: positiveLimit(dependencies.limits?.maxConcurrentInspects, DEFAULT_IMPORT_LIMITS.maxConcurrentInspects),
    maxSessions: positiveLimit(dependencies.limits?.maxSessions, DEFAULT_IMPORT_LIMITS.maxSessions),
    maxRetainedSessionBytes: positiveLimit(dependencies.limits?.maxRetainedSessionBytes, DEFAULT_IMPORT_LIMITS.maxRetainedSessionBytes),
  }
  const sessions = dependencies.sessionStore ?? new FeishuImportSessionStore(dependencies.clock, dependencies.sessionTtlMs, limits)
  const ids = dependencies.id ?? randomUUID
  const now = dependencies.now ?? (() => new Date().toISOString())
  let activeInspects = 0

  app.post('/api/import/feishu/inspect', async (request, reply) => {
    const actorOpenId = request.user?.openId
    if (!actorOpenId) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    if (!dependencies.connected(actorOpenId)) return reply.code(401).send({ code: 'FEISHU_ACCOUNT_NOT_CONNECTED' })
    const input = inspectSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    const controller = new AbortController()
    let createdSessionId: string | undefined
    let transientMedia: Map<string, Media> | undefined
    let inspectSlotAcquired = false
    let listenersRemoved = false
    const removeLifecycleListeners = () => {
      if (listenersRemoved) return
      listenersRemoved = true
      request.raw.off('aborted', abortAndDiscard)
      reply.raw.off('finish', responseFinished)
      reply.raw.off('close', responseClosed)
    }
    const abortAndDiscard = () => {
      controller.abort()
      if (createdSessionId) sessions.delete(createdSessionId)
      removeLifecycleListeners()
    }
    const responseFinished = () => removeLifecycleListeners()
    const responseClosed = () => {
      if (!reply.raw.writableFinished) abortAndDiscard()
      else removeLifecycleListeners()
    }
    request.raw.once('aborted', abortAndDiscard)
    reply.raw.once('finish', responseFinished)
    reply.raw.once('close', responseClosed)
    try {
      sessions.assertCanCreate()
      if (activeInspects >= limits.maxConcurrentInspects) {
        throw new FeishuImportQuotaError('FEISHU_IMPORT_CONCURRENCY_EXCEEDED', 429)
      }
      activeInspects += 1
      inspectSlotAcquired = true
      const requestOptions = { signal: controller.signal, actorOpenId }
      const token = await dependencies.resolveWhiteboardToken(input.data.url, requestOptions)
      const rawNodes = await dependencies.client.listWhiteboardNodes(token, requestOptions)
      if (rawNodeCount(rawNodes) > limits.maxNodes) {
        throw new FeishuImportQuotaError('FEISHU_IMPORT_NODE_LIMIT_EXCEEDED', 413)
      }
      const [rawTheme, preview] = await Promise.all([
        dependencies.client.getWhiteboardTheme(token, requestOptions),
        dependencies.client.downloadWhiteboardPreview(token, requestOptions),
      ])
      if (preview.byteLength > limits.maxPreviewBytes) {
        throw new FeishuImportQuotaError('FEISHU_IMPORT_PREVIEW_TOO_LARGE', 413)
      }
      controller.signal.throwIfAborted()
      const mapped = mapFeishuNodes(rawNodes)
      const media = new Map<string, Media>()
      transientMedia = media
      let totalMediaBytes = 0
      for (const element of mapped.value.elements) {
        const token = mediaToken(element)
        if (!token) continue
        try {
          const downloaded = await dependencies.client.downloadMedia(token, requestOptions)
          if (downloaded.bytes.byteLength > limits.maxMediaItemBytes) {
            throw new FeishuImportQuotaError('FEISHU_IMPORT_MEDIA_TOO_LARGE', 413)
          }
          if (totalMediaBytes + downloaded.bytes.byteLength > limits.maxTotalMediaBytes) {
            throw new FeishuImportQuotaError('FEISHU_IMPORT_TOTAL_MEDIA_TOO_LARGE', 413)
          }
          const hash = createHash('sha256').update(downloaded.bytes).digest('hex')
          if (hash !== downloaded.sha256.toLowerCase()) throw new Error('FEISHU_MEDIA_HASH_MISMATCH')
          media.set(element.id, downloaded)
          totalMediaBytes += downloaded.bytes.byteLength
          if (element.type === 'image') { element.src = `asset://${hash}`; element.mimeType = downloaded.mime }
        } catch (error) {
          if (error instanceof FeishuImportQuotaError) throw error
          if (error instanceof Error && error.message === 'FEISHU_MEDIA_TOO_LARGE') {
            throw new FeishuImportQuotaError('FEISHU_IMPORT_MEDIA_TOO_LARGE', 413)
          }
          if (controller.signal.aborted || (error instanceof Error && error.message === 'FEISHU_REQUEST_CANCELLED')) throw error
          mapped.report.issues.push({ code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', message: 'Reconnect Feishu or verify docs:document.media:download, then retry.', severity: 'error', elementId: element.id, sourceType: 'image' })
        }
      }
      controller.signal.throwIfAborted()
      mapped.value.compatibilityReport = mapped.report
      const sessionId = `feishu:${ids()}`
      const session = sessions.create({
        id: sessionId,
        token,
        scene: mapped.value,
        report: mapped.report,
        theme: mapFeishuTheme(rawTheme),
        previewByteLength: preview.byteLength,
        media,
        actorOpenId,
      })
      createdSessionId = session.id
      transientMedia = undefined
      return { sessionId, preview: { scene: session.scene, report: session.report, theme: session.theme, baseline: { previewByteLength: session.previewByteLength }, fidelity: fidelity(session.scene, session.report) } }
    } catch (error) {
      controller.abort()
      transientMedia?.clear()
      const code = error instanceof Error ? error.message : 'FEISHU_IMPORT_INSPECT_FAILED'
      const statusCode = error instanceof FeishuImportQuotaError
        ? error.statusCode
        : code === 'FEISHU_PREVIEW_TOO_LARGE'
          ? 413
          : code.includes('TIMEOUT')
            ? 504
            : 422
      return reply.code(statusCode).send({ code })
    } finally {
      if (inspectSlotAcquired) activeInspects -= 1
    }
  })

  app.post('/api/import/feishu/commit', async (request, reply) => {
    const input = commitSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    if (!request.user?.openId) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const projects = new ProjectRepository(database)
    const projectId = input.data.target.projectId
    if (input.data.target.kind === 'new') {
      if (projects.get(projectId)) return reply.code(409).send({ code: 'FEISHU_IMPORT_PROJECT_EXISTS' })
    } else {
      const project = projects.get(projectId)
      if (!project) return reply.code(404).send({ code: 'FEISHU_IMPORT_PROJECT_NOT_FOUND' })
      if (!canAccessProject(project, request.user.openId, projects.isMember(project.id, request.user.openId))) {
        return reply.code(403).send({ code: 'PROJECT_ACCESS_DENIED' })
      }
    }
    const session = sessions.take(input.data.sessionId, request.user.openId)
    if (!session) return reply.code(404).send({ code: 'FEISHU_IMPORT_SESSION_NOT_FOUND' })
    if (session.report.issues.some((issue) => issue.severity === 'error')) return reply.code(409).send({ code: 'FEISHU_IMPORT_HAS_RESOURCE_ERRORS', report: session.report })
    const createdAt = now()
    const boardId = `board:feishu-${ids()}`
    const rollbackFiles: Array<() => void> = []
    try {
      database.transaction(() => {
        if (input.data.target.kind === 'new') {
          projects.create({
            id: projectId,
            title: input.data.target.title,
            rootBoardId: boardId,
            formatVersion: 1,
            ownerOpenId: request.user!.openId,
            createdAt,
            updatedAt: createdAt,
          })
        }
        const materialized = new Map<string, TransactionalAssetPut>()
        for (const [elementId, media] of session.media) {
          const put = assets.putByHashInTransaction(media.bytes, { mime: media.mime, createdAt })
          rollbackFiles.push(put.rollbackFile)
          materialized.set(elementId, put)
        }
        new BoardRepository(database).create({
          id: boardId, projectId, title: '导入的飞书白板', tldrawSnapshot: interopSceneToSnapshot(session.scene, { referencePolicy: 'degrade' }),
          accessLevel: 'project',
          sourceMetadata: { kind: 'feishu-whiteboard', sourceId: session.token, importedAt: createdAt, compatibilityReport: session.report } as never,
          revision: 0, createdAt, updatedAt: createdAt,
        })
        const usages = new AssetUsageRepository(database)
        for (const [elementId, put] of materialized) usages.create({ projectId, boardId, shapeId: `shape:interop-${encodeURIComponent(elementId)}`, assetRecordId: `asset:interop-${encodeURIComponent(elementId)}`, sha256: put.asset.sha256, createdAt })
      })()
      return { boardId, projectId, report: session.report }
    } catch (error) {
      for (const rollback of rollbackFiles) rollback()
      return reply.code(409).send({ code: error instanceof Error ? error.message : 'FEISHU_IMPORT_COMMIT_FAILED' })
    }
  })

  app.delete('/api/import/feishu/sessions/:sessionId', async (request, reply) => {
    if (!request.user?.openId) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const params = z.object({ sessionId: z.string().min(1) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    sessions.delete(params.data.sessionId, request.user?.openId)
    return reply.code(204).send()
  })
  app.addHook('onClose', async () => sessions.dispose())
}
