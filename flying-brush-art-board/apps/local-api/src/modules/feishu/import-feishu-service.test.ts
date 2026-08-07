import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { createImportFeishuService } from './import-feishu-service.js'

const now = '2026-07-23T00:00:00.000Z'

describe('importFeishuBoard', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let assets: AssetRepository

  beforeEach(() => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'feishu-import-'))
    assets = new AssetRepository(database, assetDirectory)
    new ProjectRepository(database).create({ id: 'project', title: 'Project', rootBoardId: 'root', formatVersion: 1, createdAt: now, updatedAt: now })
    new BoardRepository(database).create({ id: 'root', projectId: 'project', title: 'Root', tldrawSnapshot: { store: {} }, revision: 0, createdAt: now, updatedAt: now })
  })

  afterEach(() => { database.close(); rmSync(assetDirectory, { recursive: true, force: true }) })

  it('downloads resources into the content-addressed store and creates exactly one Board without inferred references', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const client = {
      listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [
        { id: 'image', type: 'image', x: 10, y: 20, width: 100, height: 80, mediaToken: 'media', mimeType: 'image/png' },
        { id: 'link', type: 'text', x: 0, y: 0, width: 200, height: 20, text: 'https://example.feishu.cn/board/other' },
      ] }),
      getWhiteboardTheme: vi.fn().mockResolvedValue({ backgroundColor: '#f6f7f9', primaryColor: '#3370ff' }),
      downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array([9])),
      downloadMedia: vi.fn().mockResolvedValue({ bytes, mime: 'image/png', sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' }),
    }
    const importFeishuBoard = createImportFeishuService({ database, assets, client, now: () => now, id: () => 'imported' })
    const result = await importFeishuBoard({ whiteboardToken: 'board_token', projectId: 'project' })

    expect(result.boardId).toBe('board:feishu-imported')
    expect(result.theme).toMatchObject({ background: '#f6f7f9', primary: '#3370ff' })
    expect(result.scene.elements.find((element) => element.type === 'image')).toMatchObject({ src: 'asset://039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' })
    expect(new BoardRepository(database).listByProject('project')).toHaveLength(2)
    expect(new AssetUsageRepository(database).listByProject('project')).toHaveLength(1)
    expect(new BoardReferenceRepository(database).listByProject('project')).toEqual([])
    expect(readdirSync(assetDirectory)).toEqual(['039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'])
  })

  it('preserves an actionable media failure report and leaves no partial Board or asset', async () => {
    const client = {
      listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [{ id: 'image', type: 'image', x: 0, y: 0, width: 10, height: 10, mediaToken: 'missing', mimeType: 'image/png' }] }),
      getWhiteboardTheme: vi.fn().mockResolvedValue({}),
      downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
      downloadMedia: vi.fn().mockRejectedValue(new Error('offline')),
    }
    const importFeishuBoard = createImportFeishuService({ database, assets, client, now: () => now, id: () => 'failed' })
    const before = new BoardRepository(database).listByProject('project')

    await expect(importFeishuBoard({ whiteboardToken: 'board_token', projectId: 'project' })).rejects.toMatchObject({
      code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', preview: { report: { issues: expect.arrayContaining([expect.objectContaining({ code: 'FEISHU_MEDIA_DOWNLOAD_FAILED', elementId: 'image' })]) } },
    })
    expect(new BoardRepository(database).listByProject('project')).toEqual(before)
    expect(new AssetUsageRepository(database).listByProject('project')).toEqual([])
    expect(readdirSync(assetDirectory)).toEqual([])
  })
})
