import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import type { TradingSnapshotState, TradingSource } from '../trading/trading-source.js'

function frozenTradingState(): TradingSnapshotState {
  return {
    revision: 'revision-route-uat',
    streamId: 'stream-route-uat',
    sequence: 7,
    snapshot: {
      status: 'ready',
      updatedAt: '2026-08-10T02:04:00.000Z',
      tradeDate: '2026-08-10',
      sourceLabel: '接口冻结快照',
      sourceGeneratedAt: '2026-08-10T02:03:00.000Z',
      availableAt: '2026-08-10T02:04:00.000Z',
      lastSuccessAt: '2026-08-10T02:04:00.000Z',
      lastErrorAt: null,
      errorActive: false,
      ageMs: 60_000,
      ageEvaluatedAt: '2026-08-10T02:04:00.000Z',
      freshness: 'CURRENT',
      sourceHealth: 'CURRENT',
      sourceHash: 'source-hash-route-uat',
      freshUntil: '2099-08-10T02:03:00.000Z',
      staleSince: null,
      themes: [],
      stocks: [],
      announcements: [],
      services: [],
    },
    stocks: new Map(),
  }
}

describe('PDF export routes', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let app: Awaited<ReturnType<typeof buildApp>>
  let getTradingSnapshot: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-pdf-routes-'))
    getTradingSnapshot = vi.fn(async () => frozenTradingState())
    const tradingSource = {
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: getTradingSnapshot,
      getStock: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } as unknown as TradingSource
    app = await buildApp({ database, assetDirectory, tradingSource })
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: 'project-pdf',
        title: 'PDF project',
        rootBoard: { id: 'board-root', title: 'Root board' },
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/projects/project-pdf/boards',
      payload: { id: 'board-child', title: 'Child board', tldrawSnapshot: { store: {} } },
    })
  })

  afterEach(async () => {
    await app.close()
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  it('exports one Board as one page and a project as exactly its Board count', async () => {
    const boardResponse = await app.inject({ method: 'POST', url: '/api/boards/board-root/export.pdf' })
    const projectResponse = await app.inject({ method: 'POST', url: '/api/projects/project-pdf/export.pdf' })

    expect(boardResponse.statusCode).toBe(200)
    expect(boardResponse.headers['content-type']).toBe('application/pdf')
    expect((await getDocument({ data: new Uint8Array(boardResponse.rawPayload) }).promise).numPages).toBe(1)
    expect(projectResponse.statusCode).toBe(200)
    expect(projectResponse.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect((await getDocument({ data: new Uint8Array(projectResponse.rawPayload) }).promise).numPages).toBe(2)
    expect(getTradingSnapshot).toHaveBeenCalledTimes(2)
  })

  it('returns explicit missing-resource errors without a partial PDF body', async () => {
    const missingBoard = await app.inject({ method: 'POST', url: '/api/boards/missing/export.pdf' })
    const missingProject = await app.inject({ method: 'POST', url: '/api/projects/missing/export.pdf' })

    expect(missingBoard.statusCode).toBe(404)
    expect(missingBoard.json()).toEqual({ code: 'BOARD_NOT_FOUND' })
    expect(missingProject.statusCode).toBe(404)
    expect(missingProject.json()).toEqual({ code: 'PROJECT_NOT_FOUND' })
  })

  it('exports legacy projects whose private root is omitted by selecting a visible root', async () => {
    database.prepare("UPDATE board_access_policies SET access_level='owner-only',owner_open_id='another-user' WHERE board_id='board-root'").run()
    database.prepare("UPDATE projects SET root_board_id='board-root' WHERE id='project-pdf'").run()

    const response = await app.inject({ method: 'POST', url: '/api/projects/project-pdf/export.pdf' })

    expect(response.statusCode).toBe(200)
    const document = await getDocument({ data: new Uint8Array(response.rawPayload) }).promise
    expect(document.numPages).toBe(1)
    expect((await (await document.getPage(1)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' '))
      .toContain('Child board')
  })
})
