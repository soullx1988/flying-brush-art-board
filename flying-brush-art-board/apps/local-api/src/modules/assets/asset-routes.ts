import { Buffer } from 'node:buffer'

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { LocalDatabase } from '../../db/schema.js'
import { canAccessBoard } from '../../privacy/board-access-policy.js'
import type { BoardRepository } from '../boards/board-repository.js'
import type { ProjectRepository } from '../projects/project-repository.js'
import { AssetContentValidationError } from './asset-content-validation.js'
import { AssetRepository, AssetUsageRepository } from './asset-repository.js'

export const uploadAssetSchema = z
  .object({
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf']),
    base64: z.string().refine(isCanonicalBase64, 'Expected canonical Base64'),
  })
  .strict()

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false
  return Buffer.from(value, 'base64').toString('base64') === value
}

export function registerAssetRoutes(
  app: FastifyInstance,
  database: LocalDatabase,
  assets: AssetRepository,
  boards: BoardRepository,
  projects: ProjectRepository,
  maxAssetBytes: number,
): void {
  const usages = new AssetUsageRepository(database)
  app.get('/api/assets/:sha256', async (request, reply) => {
    const params = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const asset = assets.get(params.data.sha256)
    if (!asset) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' })
    const assetUsages = usages.listBySha256(params.data.sha256)
    const accessible = assets.hasUploadOwnership(params.data.sha256, request.user?.openId) || assetUsages.some((usage) => {
      const board = boards.get(usage.boardId)
      return Boolean(board && canAccessBoard(
        board,
        projects.get(board.projectId),
        request.user?.openId,
        projects.isMember(board.projectId, request.user?.openId),
      ))
    })
    if (!accessible) return reply.code(403).send({ code: 'ASSET_ACCESS_DENIED' })
    const bytes = assets.readBytes(params.data.sha256)
    if (!bytes) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' })

    reply.header('x-content-type-options', 'nosniff')
    // A browser profile may switch users. Never let a previously authorized
    // owner-only asset survive as an immutable cross-session cache entry.
    reply.header('cache-control', 'private, no-store')
    if (asset.mime === 'image/svg+xml') {
      reply.header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    }
    return reply.type(asset.mime).send(Buffer.from(bytes))
  })

  app.post('/api/assets', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const input = uploadAssetSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })

    const bytes = new Uint8Array(Buffer.from(input.data.base64, 'base64'))
    if (bytes.byteLength > maxAssetBytes) return reply.code(413).send({ code: 'ASSET_TOO_LARGE' })

    try {
      const stored = assets.putByHashWithResult(bytes, {
        mime: input.data.mime,
        createdAt: new Date().toISOString(),
        ownerOpenId: request.user.openId,
      })
      return reply.code(201).send({ ...stored.asset, created: stored.created })
    } catch (error) {
      if (error instanceof AssetContentValidationError) {
        return reply.code(422).send({ code: error.code, reason: error.reason })
      }
      throw error
    }
  })

  app.delete('/api/assets/:sha256', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ code: 'SESSION_EXPIRED' })
    const params = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const result = assets.removeUnusedOwnedBy(params.data.sha256, request.user.openId)
    if (result === 'not-owned') return reply.code(403).send({ code: 'ASSET_ACCESS_DENIED' })
    if (result === 'in-use') return reply.code(409).send({ code: 'ASSET_IN_USE' })
    return reply.code(204).send()
  })
}
