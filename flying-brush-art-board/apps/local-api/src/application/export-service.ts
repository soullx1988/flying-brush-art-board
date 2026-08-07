import { Buffer } from 'node:buffer'

import { exportProjectToIboard, type IboardAssetInputV1 } from '@infinite-board/interop'
import { renderProjectToPdf, type ProjectPdfInput } from '@infinite-board/interop/pdf/project-pdf'

import type { LocalDatabase } from '../db/schema.js'
import type { AssetRepository } from '../modules/assets/asset-repository.js'
import { AssetUsageRepository } from '../modules/assets/asset-repository.js'
import type { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import type { BoardRepository } from '../modules/boards/board-repository.js'
import type { ProjectRepository } from '../modules/projects/project-repository.js'

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object') return {}
  const value = snapshot as { store?: unknown; document?: { store?: unknown } }
  const store = value.document?.store ?? value.store
  return store && typeof store === 'object' && !Array.isArray(store) ? store as Record<string, unknown> : {}
}

export class ExportApplicationService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly projects: ProjectRepository,
    private readonly boards: BoardRepository,
    private readonly references: BoardReferenceRepository,
    private readonly assets: AssetRepository,
  ) {}

  projectIboard(projectId: string): { bytes: Uint8Array; fileName: string; mimeType: string } {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    return {
      bytes: exportProjectToIboard({
        project,
        boards: this.boards.listByProject(projectId),
        references: this.references.listByProject(projectId),
        assets: this.exportAssets(projectId),
      }),
      fileName: `${project.title.trim() || project.id}.iboard`,
      mimeType: 'application/vnd.infinite-board+zip',
    }
  }

  async projectPdf(projectId: string): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string }> {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const input: ProjectPdfInput = { project, boards: this.boards.listByProject(projectId), references: this.references.listByProject(projectId) }
    input.assets = this.pdfAssetSources(input)
    return { bytes: await renderProjectToPdf(input), fileName: `${project.title.trim() || project.id}.pdf`, mimeType: 'application/pdf' }
  }

  async boardPdf(boardId: string): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string }> {
    const board = this.boards.get(boardId)
    if (!board) throw Object.assign(new Error('BOARD_NOT_FOUND'), { code: 'BOARD_NOT_FOUND' })
    const project = this.projects.get(board.projectId)
    if (!project) throw Object.assign(new Error('PROJECT_NOT_FOUND'), { code: 'PROJECT_NOT_FOUND' })
    const input: ProjectPdfInput = { project: { ...project, rootBoardId: board.id }, boards: [board], references: [] }
    input.assets = this.pdfAssetSources(input)
    return { bytes: await renderProjectToPdf(input), fileName: `${board.title.trim() || board.id}.pdf`, mimeType: 'application/pdf' }
  }

  private exportAssets(projectId: string): IboardAssetInputV1[] {
    const usagesByHash = new Map<string, ReturnType<AssetUsageRepository['listByProject']>>()
    for (const usage of new AssetUsageRepository(this.database).listByProject(projectId)) {
      const usages = usagesByHash.get(usage.sha256) ?? []
      usages.push(usage)
      usagesByHash.set(usage.sha256, usages)
    }
    return [...usagesByHash.entries()].map(([sha256, usages]) => {
      const asset = this.assets.get(sha256)
      const bytes = this.assets.readBytes(sha256)
      if (!asset || !bytes) throw Object.assign(new Error('IBOARD_EXPORT_ASSET_MISSING'), { code: 'IBOARD_EXPORT_ASSET_MISSING' })
      return {
        sha256, mime: asset.mime, size: asset.size, bytes,
        usages: usages.map((usage) => ({ boardId: usage.boardId, shapeId: usage.shapeId, assetRecordId: usage.assetRecordId })),
      }
    })
  }

  private pdfAssetSources(input: Pick<ProjectPdfInput, 'boards'>): Map<string, string> {
    const result = new Map<string, string>()
    for (const board of input.boards) {
      for (const recordValue of Object.values(snapshotStore(board.tldrawSnapshot))) {
        if (!recordValue || typeof recordValue !== 'object') continue
        const record = recordValue as { id?: unknown; typeName?: unknown; props?: { src?: unknown } }
        if (record.typeName !== 'asset' || typeof record.props?.src !== 'string') continue
        const match = record.props.src.match(/^\/api\/assets\/([a-f0-9]{64})$/)
        if (!match?.[1]) continue
        const asset = this.assets.get(match[1])
        const bytes = this.assets.readBytes(match[1])
        if (!asset || !bytes || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime)) continue
        const source = `data:${asset.mime};base64,${Buffer.from(bytes).toString('base64')}`
        result.set(record.props.src, source)
        if (typeof record.id === 'string') result.set(record.id, source)
      }
    }
    return result
  }
}
