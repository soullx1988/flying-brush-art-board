import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProjectRecord, StoredBoard } from '@infinite-board/board-core'

import { createDatabase, type LocalDatabase } from '../db/schema.js'
import { AssetRepository } from '../modules/assets/asset-repository.js'
import { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import { BoardRepository } from '../modules/boards/board-repository.js'
import { ProjectRepository } from '../modules/projects/project-repository.js'
import type { TradingSnapshotState, TradingSource } from '../modules/trading/trading-source.js'
import { ExportApplicationService } from './export-service.js'

const now = '2026-08-10T02:04:00.000Z'

function tradingState(): TradingSnapshotState {
  return {
    revision: 'revision-mcp-pdf-uat',
    streamId: 'stream-mcp-pdf-uat',
    sequence: 11,
    snapshot: {
      status: 'ready',
      updatedAt: now,
      tradeDate: '2026-08-10',
      sourceLabel: 'MCP冻结快照',
      sourceGeneratedAt: '2026-08-10T02:03:00.000Z',
      availableAt: now,
      lastSuccessAt: now,
      lastErrorAt: null,
      errorActive: false,
      ageMs: 60_000,
      ageEvaluatedAt: now,
      freshness: 'CURRENT',
      sourceHealth: 'CURRENT',
      sourceHash: 'source-hash-mcp-pdf-uat',
      freshUntil: '2099-08-10T02:03:00.000Z',
      staleSince: null,
      themes: [],
      stocks: [{ code: '600002', name: 'MCP回归股份', score: 91, action: '观察', reason: '快照一致' }],
      announcements: [],
      services: [],
    },
    stocks: new Map(),
  }
}

function tradingBoardSnapshot() {
  return {
    store: {
      'page:data': { id: 'page:data', typeName: 'page', name: '数据', index: 'a1', meta: {} },
      'shape:pool': {
        id: 'shape:pool',
        typeName: 'shape',
        type: 'trading-panel',
        parentId: 'page:data',
        index: 'a1',
        x: 0,
        y: 0,
        props: { w: 720, h: 420, panelKind: 'stock-pool', title: '个人选股池' },
        meta: {},
      },
    },
  }
}

describe('ExportApplicationService PDF', () => {
  let database: LocalDatabase
  let directory: string

  afterEach(() => {
    database?.close()
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('freezes TradingSource once for the MCP export path and omits the private 心态 Board', async () => {
    database = createDatabase(':memory:')
    directory = mkdtempSync(join(tmpdir(), 'infinite-board-export-service-'))
    const projects = new ProjectRepository(database)
    const boards = new BoardRepository(database)
    const references = new BoardReferenceRepository(database)
    const assets = new AssetRepository(database, join(directory, 'assets'))
    const project: ProjectRecord = {
      id: 'project-mcp-pdf',
      title: 'MCP PDF项目',
      rootBoardId: 'board-data',
      formatVersion: 1,
      ownerOpenId: 'mcp-user',
      createdAt: now,
      updatedAt: now,
    }
    const projectBoards: StoredBoard[] = [
      {
        id: 'board-data',
        projectId: project.id,
        title: '数据',
        tldrawSnapshot: tradingBoardSnapshot(),
        accessLevel: 'project',
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'board-mindset',
        projectId: project.id,
        title: '心态',
        tldrawSnapshot: { store: {
          'shape:private': {
            id: 'shape:private', typeName: 'shape', type: 'text', parentId: 'page:mindset',
            index: 'a1', x: 0, y: 0, props: { w: 300, h: 80, text: '心态私密内容' }, meta: {},
          },
        } },
        accessLevel: 'owner-only',
        ownerOpenId: 'mcp-user',
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]
    database.transaction(() => {
      projects.create(project)
      for (const board of projectBoards) boards.create(board)
    })()
    const getSnapshot = vi.fn(async () => tradingState())
    const tradingSource = { getSnapshot } as Pick<TradingSource, 'getSnapshot'>
    const exports = new ExportApplicationService(database, projects, boards, references, assets, tradingSource)

    const result = await exports.projectPdf(project.id, 'mcp-user')
    const document = await getDocument({ data: result.bytes }).promise
    const content = await (await document.getPage(1)).getTextContent()
    const text = content.items.map((item) => 'str' in item ? item.str : '').join('')

    expect(getSnapshot).toHaveBeenCalledTimes(1)
    expect(document.numPages).toBe(1)
    expect(text).toContain('MCP回归股份')
    expect(text).not.toContain('心态私密内容')
  })
})
