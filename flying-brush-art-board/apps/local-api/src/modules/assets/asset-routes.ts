import { Buffer } from 'node:buffer'

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { AssetRepository } from './asset-repository.js'

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
  assets: AssetRepository,
  maxAssetBytes: number,
): void {
  app.get('/api/assets/:sha256', async (request, reply) => {
    const params = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    const asset = assets.get(params.data.sha256)
    const bytes = assets.readBytes(params.data.sha256)
    if (!asset || !bytes) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' })

    reply.header('x-content-type-options', 'nosniff')
    reply.header('cache-control', 'public, max-age=31536000, immutable')
    if (asset.mime === 'image/svg+xml') {
      reply.header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    }
    return reply.type(asset.mime).send(Buffer.from(bytes))
  })

  app.post('/api/assets', async (request, reply) => {
    const input = uploadAssetSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues })

    const bytes = new Uint8Array(Buffer.from(input.data.base64, 'base64'))
    if (bytes.byteLength > maxAssetBytes) return reply.code(413).send({ code: 'ASSET_TOO_LARGE' })

    const stored = assets.putByHashWithResult(bytes, { mime: input.data.mime, createdAt: new Date().toISOString() })
    return reply.code(201).send({ ...stored.asset, created: stored.created })
  })

  app.delete('/api/assets/:sha256', async (request, reply) => {
    const params = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: params.error.issues })
    if (!assets.removeIfUnused(params.data.sha256)) return reply.code(404).send({ code: 'ASSET_NOT_FOUND_OR_IN_USE' })
    return reply.code(204).send()
  })
}
