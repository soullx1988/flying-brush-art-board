import { createHash, randomUUID } from 'node:crypto'

import { mapFeishuNodes, mapFeishuTheme, type ImportCompatibilityReport, type InteropScene, type InteropTheme } from '@infinite-board/interop'
import { interopSceneToSnapshot } from '@infinite-board/tldraw-adapter'

import type { LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository, type TransactionalAssetPut } from '../assets/asset-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'

export interface FeishuImportClient {
  listWhiteboardNodes(token: string, options?: { signal?: AbortSignal; actorOpenId?: string }): Promise<unknown>
  getWhiteboardTheme(token: string, options?: { signal?: AbortSignal; actorOpenId?: string }): Promise<unknown>
  downloadWhiteboardPreview(token: string, options?: { signal?: AbortSignal; actorOpenId?: string }): Promise<Uint8Array>
  downloadMedia(mediaToken: string, options?: { signal?: AbortSignal; actorOpenId?: string }): Promise<{ bytes: Uint8Array; mime: string; sha256: string }>
}

export interface ImportPreview {
  boardId: string
  projectId: string
  scene: InteropScene
  report: ImportCompatibilityReport
  theme: InteropTheme
  baseline: {
    previewByteLength: number
    bounds: { x: number; y: number; width: number; height: number }
    keyColors: string[]
  }
  fidelity: {
    editable: string[]
    downgraded: string[]
    rasterized: string[]
    unsupported: string[]
  }
}

export interface FeishuImportServiceOptions {
  database: LocalDatabase
  assets: AssetRepository
  client: FeishuImportClient
  now?: () => string
  id?: () => string
}

export class FeishuImportError extends Error {
  constructor(readonly code: string, readonly preview: Omit<ImportPreview, 'boardId'>) {
    super(code)
    this.name = 'FeishuImportError'
  }
}

function mediaToken(element: InteropScene['elements'][number]): string | undefined {
  if (element.type !== 'image' || !element.src.startsWith('feishu-media://')) return undefined
  return element.src.slice('feishu-media://'.length)
}

function bounds(scene: InteropScene) {
  if (scene.elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...scene.elements.map((element) => element.geometry.x))
  const top = Math.min(...scene.elements.map((element) => element.geometry.y))
  const right = Math.max(...scene.elements.map((element) => element.geometry.x + element.geometry.width))
  const bottom = Math.max(...scene.elements.map((element) => element.geometry.y + element.geometry.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function keyColors(scene: InteropScene, theme: InteropTheme): string[] {
  const colors = new Set<string>([theme.background, theme.primary, theme.text])
  for (const element of scene.elements) {
    for (const value of Object.values(element.style)) if (typeof value === 'string' && /^#[\da-f]{3,8}$/i.test(value)) colors.add(value.toLowerCase())
  }
  return [...colors]
}

function fidelity(scene: InteropScene, report: ImportCompatibilityReport): ImportPreview['fidelity'] {
  const downgraded = new Set(report.issues.filter((issue) => issue.code.endsWith('_DOWNGRADED')).map((issue) => issue.elementId).filter((id): id is string => Boolean(id)))
  const unsupported = scene.elements.filter((element) => element.type === 'unsupported').map((element) => element.id)
  const rasterized = scene.elements.filter((element) => element.type === 'image' || element.type === 'svg').map((element) => element.id)
  const excluded = new Set([...downgraded, ...unsupported, ...rasterized])
  return { editable: scene.elements.filter((element) => !excluded.has(element.id)).map((element) => element.id), downgraded: [...downgraded], rasterized, unsupported }
}

export function createImportFeishuService(options: FeishuImportServiceOptions) {
  return async function importFeishuBoard(input: { whiteboardToken: string; projectId?: string }): Promise<ImportPreview> {
    const projectId = input.projectId ?? new ProjectRepository(options.database).list()[0]?.id
    if (!projectId || !new ProjectRepository(options.database).get(projectId)) throw new Error('FEISHU_IMPORT_PROJECT_NOT_FOUND')

    const [rawNodes, rawTheme, previewImage] = await Promise.all([
      options.client.listWhiteboardNodes(input.whiteboardToken),
      options.client.getWhiteboardTheme(input.whiteboardToken),
      options.client.downloadWhiteboardPreview(input.whiteboardToken),
    ])
    const mapped = mapFeishuNodes(rawNodes)
    const theme = mapFeishuTheme(rawTheme)
    const downloaded = new Map<string, Awaited<ReturnType<FeishuImportClient['downloadMedia']>>>()
    const failed: string[] = []

    await Promise.all(mapped.value.elements.map(async (element) => {
      const token = mediaToken(element)
      if (!token || element.type !== 'image') return
      try {
        const media = await options.client.downloadMedia(token)
        const actualHash = createHash('sha256').update(media.bytes).digest('hex')
        if (actualHash !== media.sha256.toLowerCase()) throw new Error('FEISHU_MEDIA_HASH_MISMATCH')
        downloaded.set(element.id, media)
        element.src = `asset://${actualHash}`
        element.mimeType = media.mime
      } catch {
        failed.push(element.id)
        mapped.report.issues.push({ code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', message: 'Reconnect Feishu or verify docs:document.media:download, then retry the import.', severity: 'error', elementId: element.id, sourceType: 'image' })
      }
    }))
    mapped.value.compatibilityReport = mapped.report

    const previewWithoutBoard = {
      projectId, scene: mapped.value, report: mapped.report, theme,
      baseline: { previewByteLength: previewImage.byteLength, bounds: bounds(mapped.value), keyColors: keyColors(mapped.value, theme) },
      fidelity: fidelity(mapped.value, mapped.report),
    }
    if (failed.length > 0) throw new FeishuImportError('FEISHU_MEDIA_DOWNLOAD_FAILED', previewWithoutBoard)

    const suffix = (options.id ?? randomUUID)()
    const boardId = `board:feishu-${suffix}`
    const createdAt = (options.now ?? (() => new Date().toISOString()))()
    const rollbackFiles: Array<() => void> = []
    const transaction = options.database.transaction(() => {
      const materialized = new Map<string, TransactionalAssetPut>()
      for (const [elementId, media] of downloaded) {
        const put = options.assets.putByHashInTransaction(media.bytes, { mime: media.mime, createdAt })
        rollbackFiles.push(put.rollbackFile)
        materialized.set(elementId, put)
      }
      const snapshot = interopSceneToSnapshot(mapped.value, { referencePolicy: 'degrade' })
      new BoardRepository(options.database).create({
        id: boardId, projectId, title: `Feishu Board ${suffix}`, tldrawSnapshot: snapshot,
        sourceMetadata: { kind: 'feishu-whiteboard', sourceId: input.whiteboardToken, importedAt: createdAt },
        revision: 0, createdAt, updatedAt: createdAt,
      })
      const usages = new AssetUsageRepository(options.database)
      for (const [elementId, put] of materialized) usages.create({
        projectId, boardId, shapeId: `shape:interop-${encodeURIComponent(elementId)}`,
        assetRecordId: `asset:interop-${encodeURIComponent(elementId)}`, sha256: put.asset.sha256, createdAt,
      })
    })
    try { transaction() } catch (error) { for (const rollback of rollbackFiles) rollback(); throw error }
    return { boardId, ...previewWithoutBoard }
  }
}

export async function importFeishuBoard(
  input: { whiteboardToken: string; projectId?: string },
  options: FeishuImportServiceOptions,
): Promise<ImportPreview> {
  return createImportFeishuService(options)(input)
}
