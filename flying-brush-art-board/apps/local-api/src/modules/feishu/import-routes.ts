import { createHash, randomUUID } from 'node:crypto'

import { mapFeishuNodes, mapFeishuTheme, type ImportCompatibilityReport, type InteropScene } from '@infinite-board/interop'
import { interopSceneToSnapshot } from '@infinite-board/tldraw-adapter'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository, type TransactionalAssetPut } from '../assets/asset-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
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
  expiresAt: number
}

export interface FeishuImportRouteDependencies {
  connected(): boolean
  resolveWhiteboardToken(input: string, options?: { signal?: AbortSignal }): Promise<string>
  client: FeishuImportClient
  now?: () => string
  clock?: () => number
  id?: () => string
  sessionTtlMs?: number
  sessionStore?: FeishuImportSessionStore
}

export class FeishuImportSessionStore {
  private readonly sessions = new Map<string, Session>()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly clock: () => number = Date.now, private readonly ttlMs = 10 * 60_000) {}
  create(session: Omit<Session, 'expiresAt'>): Session {
    this.removeExpired()
    const stored = { ...session, expiresAt: this.clock() + this.ttlMs }
    this.sessions.set(stored.id, stored)
    this.scheduleExpiry()
    return stored
  }
  take(id: string): Session | undefined {
    this.removeExpired()
    const session = this.sessions.get(id)
    if (session) this.sessions.delete(id)
    this.scheduleExpiry()
    return session
  }
  delete(id: string): boolean {
    const session = this.sessions.get(id)
    if (session) session.media.clear()
    const deleted = this.sessions.delete(id)
    this.scheduleExpiry()
    return deleted
  }
  removeExpired(): void {
    for (const [id, session] of this.sessions) if (session.expiresAt <= this.clock()) { session.media.clear(); this.sessions.delete(id) }
    this.scheduleExpiry()
  }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; for (const session of this.sessions.values()) session.media.clear(); this.sessions.clear() }
  get size(): number { return this.sessions.size }
  private scheduleExpiry(): void {
    if (this.timer) clearTimeout(this.timer)
    const next = Math.min(...[...this.sessions.values()].map((session) => session.expiresAt))
    if (!Number.isFinite(next)) { this.timer = undefined; return }
    this.timer = setTimeout(() => { this.timer = undefined; this.removeExpired() }, Math.max(0, next - this.clock()))
    this.timer.unref?.()
  }
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
  const sessions = dependencies.sessionStore ?? new FeishuImportSessionStore(dependencies.clock, dependencies.sessionTtlMs)
  const ids = dependencies.id ?? randomUUID
  const now = dependencies.now ?? (() => new Date().toISOString())

  app.post('/api/import/feishu/inspect', async (request, reply) => {
    if (!dependencies.connected()) return reply.code(401).send({ code: 'FEISHU_ACCOUNT_NOT_CONNECTED' })
    const input = inspectSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    const controller = new AbortController()
    let createdSessionId: string | undefined
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
      const token = await dependencies.resolveWhiteboardToken(input.data.url, { signal: controller.signal })
      const [rawNodes, rawTheme, preview] = await Promise.all([
        dependencies.client.listWhiteboardNodes(token, { signal: controller.signal }),
        dependencies.client.getWhiteboardTheme(token, { signal: controller.signal }),
        dependencies.client.downloadWhiteboardPreview(token, { signal: controller.signal }),
      ])
      controller.signal.throwIfAborted()
      const mapped = mapFeishuNodes(rawNodes)
      const media = new Map<string, Media>()
      for (const element of mapped.value.elements) {
        const token = mediaToken(element)
        if (!token) continue
        try {
          const downloaded = await dependencies.client.downloadMedia(token, { signal: controller.signal })
          const hash = createHash('sha256').update(downloaded.bytes).digest('hex')
          if (hash !== downloaded.sha256.toLowerCase()) throw new Error('FEISHU_MEDIA_HASH_MISMATCH')
          media.set(element.id, downloaded)
          if (element.type === 'image') { element.src = `asset://${hash}`; element.mimeType = downloaded.mime }
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.message === 'FEISHU_REQUEST_CANCELLED')) throw error
          mapped.report.issues.push({ code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', message: 'Reconnect Feishu or verify docs:document.media:download, then retry.', severity: 'error', elementId: element.id, sourceType: 'image' })
        }
      }
      controller.signal.throwIfAborted()
      mapped.value.compatibilityReport = mapped.report
      const sessionId = `feishu:${ids()}`
      const session = sessions.create({ id: sessionId, token, scene: mapped.value, report: mapped.report, theme: mapFeishuTheme(rawTheme), previewByteLength: preview.byteLength, media })
      createdSessionId = session.id
      return { sessionId, preview: { scene: session.scene, report: session.report, theme: session.theme, baseline: { previewByteLength: session.previewByteLength }, fidelity: fidelity(session.scene, session.report) } }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'FEISHU_IMPORT_INSPECT_FAILED'
      return reply.code(code.includes('TIMEOUT') ? 504 : 422).send({ code })
    }
  })

  app.post('/api/import/feishu/commit', async (request, reply) => {
    const input = commitSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    const session = sessions.take(input.data.sessionId)
    if (!session) return reply.code(404).send({ code: 'FEISHU_IMPORT_SESSION_NOT_FOUND' })
    if (session.report.issues.some((issue) => issue.severity === 'error')) return reply.code(409).send({ code: 'FEISHU_IMPORT_HAS_RESOURCE_ERRORS', report: session.report })
    const createdAt = now()
    const boardId = `board:feishu-${ids()}`
    const projectId = input.data.target.projectId
    const rollbackFiles: Array<() => void> = []
    try {
      database.transaction(() => {
        const projects = new ProjectRepository(database)
        if (input.data.target.kind === 'new') {
          if (projects.get(projectId)) throw new Error('FEISHU_IMPORT_PROJECT_EXISTS')
          projects.create({ id: projectId, title: input.data.target.title, rootBoardId: boardId, formatVersion: 1, createdAt, updatedAt: createdAt })
        } else if (!projects.get(projectId)) throw new Error('FEISHU_IMPORT_PROJECT_NOT_FOUND')
        const materialized = new Map<string, TransactionalAssetPut>()
        for (const [elementId, media] of session.media) {
          const put = assets.putByHashInTransaction(media.bytes, { mime: media.mime, createdAt })
          rollbackFiles.push(put.rollbackFile)
          materialized.set(elementId, put)
        }
        new BoardRepository(database).create({
          id: boardId, projectId, title: '导入的飞书白板', tldrawSnapshot: interopSceneToSnapshot(session.scene, { referencePolicy: 'degrade' }),
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
    const params = z.object({ sessionId: z.string().min(1) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    sessions.delete(params.data.sessionId)
    return reply.code(204).send()
  })
  app.addHook('onClose', async () => sessions.dispose())
}
