import { randomUUID } from 'node:crypto'

import {
  DEFAULT_IBOARD_MAX_ARCHIVE_BYTES,
  DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES,
  exportProjectToIboard,
  inspectAndDecodeIboard,
  measureIboardArchive,
  type DecodedIboardProject,
  type IboardAssetInputV1,
  type ImportInspection,
} from '@infinite-board/interop'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { commitIboardMerge } from './import-iboard-service.js'

interface IboardImportSession {
  sessionId: string
  fileName: string
  inspection: ImportInspection
  archive: Uint8Array
  decoded?: DecodedIboardProject
  committing: boolean
  expiresAt: number
  byteSize: number
}

export interface IboardImportSessionStoreOptions {
  ttlMs?: number
  maxSessions?: number
  maxBytes?: number
  now?: () => number
  measureArchive?: (bytes: Uint8Array) => number
  analyzeArchive?: typeof inspectAndDecodeIboard
}

const DEFAULT_IMPORT_SESSION_TTL_MS = 5 * 60 * 1000
const DEFAULT_IMPORT_MAX_SESSIONS = 8
// Logical quota for payload retained by created import sessions. Each compatible
// session is charged raw archive bytes plus the central-directory-declared
// uncompressed bytes. This is not a Node RSS or peak-working-set limit: Fastify
// request buffering, unzip/UTF-8/JSON.parse temporaries, and V8 object overhead
// are outside this quota.
export const DEFAULT_IBOARD_IMPORT_SESSION_MAX_BYTES =
  DEFAULT_IBOARD_MAX_ARCHIVE_BYTES + DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES

export class IboardImportSessionStore {
  private readonly sessions = new Map<string, IboardImportSession>()
  private readonly ttlMs: number
  private readonly maxSessions: number
  private readonly maxBytes: number
  private readonly now: () => number
  private readonly measureArchive: (bytes: Uint8Array) => number
  private readonly analyzeArchive: typeof inspectAndDecodeIboard
  private totalBytes = 0

  constructor(options: IboardImportSessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_IMPORT_SESSION_TTL_MS
    this.maxSessions = options.maxSessions ?? DEFAULT_IMPORT_MAX_SESSIONS
    this.maxBytes = options.maxBytes ?? DEFAULT_IBOARD_IMPORT_SESSION_MAX_BYTES
    this.now = options.now ?? Date.now
    this.measureArchive = options.measureArchive ?? ((bytes) => measureIboardArchive(bytes).retainedBytes)
    this.analyzeArchive = options.analyzeArchive ?? inspectAndDecodeIboard
    if (this.ttlMs <= 0 || this.maxSessions <= 0 || this.maxBytes <= 0) {
      throw new Error('IBOARD_IMPORT_SESSION_LIMIT_INVALID')
    }
  }

  create(bytes: Uint8Array, fileName: string): IboardImportSession {
    this.cleanupExpired()
    const { inspection, decoded } = this.analyzeArchive(bytes)
    const byteSize = decoded === undefined ? bytes.byteLength : this.reservedByteSize(bytes)
    if (decoded === undefined) {
      this.ensureRoomWithoutEviction(byteSize)
    } else {
      this.makeRoom(byteSize)
    }
    const now = this.now()
    const session: IboardImportSession = {
      sessionId: randomUUID(),
      fileName,
      inspection,
      archive: bytes,
      ...(decoded === undefined ? {} : { decoded }),
      committing: false,
      expiresAt: now + this.ttlMs,
      byteSize,
    }
    this.sessions.set(session.sessionId, session)
    this.totalBytes += session.byteSize
    return session
  }

  private reservedByteSize(bytes: Uint8Array): number {
    try {
      return this.measureArchive(bytes)
    } catch {
      // Decoding and preflight already confirmed compatibility, but retain a
      // conservative reservation when a separate central-directory measurement
      // cannot be obtained.
      return DEFAULT_IBOARD_IMPORT_SESSION_MAX_BYTES
    }
  }

  claim(sessionId: string): IboardImportSession | undefined {
    this.cleanupExpired()
    const session = this.sessions.get(sessionId)
    if (!session || session.committing) return undefined
    session.committing = true
    return session
  }

  release(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.committing = false
  }

  remove(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    this.sessions.delete(sessionId)
    this.totalBytes -= session.byteSize
    return true
  }

  dispose(): void {
    this.sessions.clear()
    this.totalBytes = 0
  }

  private cleanupExpired(): void {
    const now = this.now()
    for (const session of this.sessions.values()) {
      if (!session.committing && session.expiresAt <= now) this.remove(session.sessionId)
    }
  }

  private makeRoom(byteSize: number): void {
    if (byteSize > this.maxBytes) throw new Error('IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED')
    while (this.sessions.size >= this.maxSessions || this.totalBytes + byteSize > this.maxBytes) {
      const eviction = [...this.sessions.values()]
        .filter((session) => !session.committing)
        .sort((left, right) => left.expiresAt - right.expiresAt)[0]
      if (!eviction) throw new Error('IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED')
      this.remove(eviction.sessionId)
    }
  }

  private ensureRoomWithoutEviction(byteSize: number): void {
    if (
      byteSize > this.maxBytes ||
      this.sessions.size >= this.maxSessions ||
      this.totalBytes + byteSize > this.maxBytes
    ) {
      throw new Error('IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED')
    }
  }
}

const commitSchema = z.object({
  sessionId: z.string().uuid(),
  targetProjectId: z.string().min(1),
  mode: z.literal('merge'),
  openImportedRootInNewTab: z.literal(true),
}).strict()

const sessionParamsSchema = z.object({ sessionId: z.string().uuid() }).strict()
const projectParamsSchema = z.object({ projectId: z.string().trim().min(1) }).strict()

function fileNameFromHeader(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 780) return 'import.iboard'
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length > 0 && decoded.length <= 260 ? decoded : 'import.iboard'
  } catch {
    return 'import.iboard'
  }
}

function publicSession(session: IboardImportSession) {
  return {
    sessionId: session.sessionId,
    fileName: session.fileName,
    inspection: session.inspection,
  }
}

function rfc5987FileName(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function exportAssets(database: LocalDatabase, assets: AssetRepository, projectId: string): IboardAssetInputV1[] {
  const usagesByHash = new Map<string, ReturnType<AssetUsageRepository['listByProject']>>()
  for (const usage of new AssetUsageRepository(database).listByProject(projectId)) {
    const usages = usagesByHash.get(usage.sha256) ?? []
    usages.push(usage)
    usagesByHash.set(usage.sha256, usages)
  }

  return [...usagesByHash.entries()].map(([sha256, usages]) => {
    const asset = assets.get(sha256)
    const bytes = assets.readBytes(sha256)
    if (!asset || !bytes) throw new Error(`IBOARD_EXPORT_ASSET_MISSING:${sha256}`)
    return {
      sha256,
      mime: asset.mime,
      size: asset.size,
      bytes,
      usages: usages.map((usage) => ({
        boardId: usage.boardId,
        shapeId: usage.shapeId,
        assetRecordId: usage.assetRecordId,
      })),
    }
  })
}

export function registerIboardRoutes(
  app: FastifyInstance,
  database: LocalDatabase,
  assets: AssetRepository,
  sessions = new IboardImportSessionStore(),
): void {
  app.addHook('onClose', async () => {
    sessions.dispose()
  })

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  )

  app.get('/api/projects/:projectId/export.iboard', async (request, reply) => {
    const params = projectParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })

    const project = new ProjectRepository(database).get(params.data.projectId)
    if (!project) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' })

    try {
      const archive = exportProjectToIboard({
        project,
        boards: new BoardRepository(database).listByProject(project.id),
        references: new BoardReferenceRepository(database).listByProject(project.id),
        assets: exportAssets(database, assets, project.id),
      })
      const downloadName = `${project.title.trim() || project.id}.iboard`
      return reply
        .header('content-type', 'application/vnd.infinite-board+zip')
        .header('content-disposition', `attachment; filename*=UTF-8''${rfc5987FileName(downloadName)}`)
        .send(Buffer.from(archive))
    } catch (error) {
      return reply.code(409).send({
        code: 'IBOARD_EXPORT_FAILED',
        cause: error instanceof Error ? error.message : 'UNKNOWN',
      })
    }
  })

  app.post('/api/import/iboard/inspect', {
    bodyLimit: DEFAULT_IBOARD_MAX_ARCHIVE_BYTES,
  }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(400).send({ code: 'IBOARD_IMPORT_BYTES_REQUIRED' })
    }
    let session: IboardImportSession
    try {
      session = sessions.create(
        new Uint8Array(request.body.buffer, request.body.byteOffset, request.body.byteLength),
        fileNameFromHeader(request.headers['x-iboard-file-name']),
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED') {
        return reply.code(413).send({ code: error.message })
      }
      throw error
    }
    return reply.code(201).send(publicSession(session))
  })

  app.post('/api/import/iboard/commit', async (request, reply) => {
    const input = commitSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })
    const session = sessions.claim(input.data.sessionId)
    if (!session) return reply.code(404).send({ code: 'IBOARD_IMPORT_SESSION_NOT_FOUND' })
    if (!session.decoded) {
      sessions.release(session.sessionId)
      return reply.code(409).send({
        code: 'IBOARD_IMPORT_INCOMPATIBLE',
        inspection: session.inspection,
      })
    }

    try {
      const result = await commitIboardMerge(session.decoded, {
        targetProjectId: input.data.targetProjectId,
        database,
        assets,
        namespace: session.sessionId,
      })
      sessions.remove(session.sessionId)
      const { idMap: _idMap, ...publicResult } = result
      return reply.code(201).send(publicResult)
    } catch (error) {
      sessions.release(session.sessionId)
      if (error instanceof Error && error.message === 'IBOARD_TARGET_PROJECT_NOT_FOUND') {
        return reply.code(404).send({ code: error.message })
      }
      return reply.code(409).send({
        code: 'IBOARD_IMPORT_COMMIT_FAILED',
        cause: error instanceof Error ? error.message : 'UNKNOWN',
        action: '当前项目未发生变化；请解决冲突后重试。',
      })
    }
  })

  app.delete('/api/import/sessions/:sessionId', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    sessions.remove(params.data.sessionId)
    return reply.code(204).send()
  })
}
