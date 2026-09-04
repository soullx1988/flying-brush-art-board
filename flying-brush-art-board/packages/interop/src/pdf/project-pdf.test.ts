import { createRequire } from 'node:module'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import type {
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'

import {
  MAX_PROJECT_PDF_BOARDS,
  MAX_PROJECT_PDF_SHAPES,
  createProjectPdfPlan,
  renderProjectToPdf,
  renderSnapshotToSvg,
  type ProjectPdfOutlineItem,
  type ProjectPdfTradingSnapshot,
} from './project-pdf.js'

const now = '2026-07-23T00:00:00.000Z'

function snapshot(boardId: string, references: readonly BoardReferenceRecord[] = []) {
  const store: Record<string, unknown> = {
    [`page:${boardId}`]: {
      id: `page:${boardId}`,
      typeName: 'page',
      name: boardId,
      index: 'a1',
      meta: {},
    },
    [`shape:${boardId}:title`]: {
      id: `shape:${boardId}:title`,
      typeName: 'shape',
      type: 'geo',
      parentId: `page:${boardId}`,
      index: 'a1',
      x: 20,
      y: 20,
      props: { w: 180, h: 80, geo: 'rectangle' },
      meta: {},
    },
  }
  for (const [index, reference] of references.entries()) {
    store[reference.shapeId] = {
      id: reference.shapeId,
      typeName: 'shape',
      type: 'board-reference',
      parentId: `page:${boardId}`,
      index: `a${index + 2}`,
      x: 40 + index * 240,
      y: 160,
      props: {
        w: 220,
        h: 120,
        referenceId: reference.id,
        targetBoardId: reference.targetBoardId,
        kind: reference.kind,
        titleFallback: reference.targetBoardId,
      },
      meta: {},
    }
  }
  return { store }
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link',
): BoardReferenceRecord {
  return {
    id,
    projectId: 'project-pdf',
    sourceBoardId,
    targetBoardId,
    shapeId: `shape:${id}`,
    kind,
    createdAt: now,
    updatedAt: now,
  }
}

function fixture() {
  const references = [
    reference('a-to-c', 'board-a', 'board-c', 'embed'),
    reference('b-to-c', 'board-b', 'board-c', 'embed'),
    reference('c-to-a', 'board-c', 'board-a', 'link'),
  ]
  const project: ProjectRecord = {
    id: 'project-pdf',
    title: 'PDF project',
    rootBoardId: 'board-a',
    formatVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
  const boards: StoredBoard[] = ['board-a', 'board-b', 'board-c'].map((id) => ({
    id,
    projectId: project.id,
    title: id.toUpperCase(),
    tldrawSnapshot: snapshot(id, references.filter((item) => item.sourceBoardId === id)),
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }))
  return { project, boards, references }
}

const frozenTradingSnapshot: ProjectPdfTradingSnapshot = {
  status: 'ready',
  updatedAt: '2026-08-10T02:04:00.000Z',
  tradeDate: '2026-08-10',
  sourceLabel: 'PDF快照源',
  revision: 'revision-pdf-uat',
  streamId: 'stream-pdf-uat',
  sequence: 42,
  sourceGeneratedAt: '2026-08-10T02:03:00.000Z',
  availableAt: '2026-08-10T02:04:00.000Z',
  freshness: 'CURRENT',
  sourceHealth: 'CURRENT',
  freshUntil: '2099-08-10T02:03:00.000Z',
  todayOverview: {
    currentPhase: 'auction_final',
    currentPhaseLabel: '09:25竞价复核',
    overallState: 'OBSERVATION_ONLY',
    canParticipate: false,
    participationSummary: '当前只允许人工复核，不产生交易动作。',
    unattendedAction: '保持观察，不产生新的交易动作。',
    focusFamily: '科技主线',
    focusSummary: '科技主线延续，今天先看芯片与竞价龙头承接。',
    phaseStatus: 'REVIEW_ONLY',
    marketDecision: 'PENDING',
    executionAuthority: 'REVIEW_ONLY',
    summaryLines: ['09:25 只复核冻结观察对象，不允许临时升级执行。'],
    decisionChain: [{
      id: 'step-auction',
      label: '竞价复核',
      status: 'READ_ONLY',
      summary: '竞价事实只作人工复核。',
    }],
    changes: [{ id: 'change-phase', label: '当前阶段', summary: '已进入竞价复核。' }],
    auction: {
      status: 'READY',
      leader: {
        code: '600001',
        name: '回归股份',
        auctionChangePct: 9.98,
        sealAmountCny: 125000000,
      },
    },
  },
  market: {
    environmentVerdict: '试运行环境',
    nodeVerdict: '回归节点',
    limitUpTotal: 31,
    limitDownTotal: 4,
    highestBoardLevel: 5,
    summaryLines: ['中文文本层必须可检索'],
  },
  themes: [{ name: 'PDF快照主线', heat: 88.5, structure: '梯队完整' }],
  stocks: [{
    code: '600001',
    name: '回归股份',
    score: 92.6,
    action: '观察',
    reason: '结构完整',
  }],
  announcements: [{
    id: 'announcement-pdf-uat',
    title: '回归公告标题',
    verificationStatus: 'VERIFIED',
    summary: '回归公告摘要',
    publishedAt: '2026-08-10T01:00:00.000Z',
    names: ['回归股份'],
    codes: ['600001'],
  }],
  readiness: {
    state: 'OBSERVATION_ONLY',
    executionEligible: false,
    observationEligible: true,
    reasonCount: 1,
  },
  services: [{ name: 'PDF桥接服务', status: 'CURRENT', detail: '单次快照注入' }],
}

function tradingPanelBoardSnapshot() {
  const panels = [
    { id: 'market', panelKind: 'market-overview', title: '市场环境与主线', x: 0, y: 0 },
    { id: 'stocks', panelKind: 'stock-pool', title: '个人选股池', x: 760, y: 0 },
    { id: 'announcements', panelKind: 'announcements', title: '公告观察源', x: 0, y: 460 },
    { id: 'system', panelKind: 'system-status', title: '数据源与生产就绪状态', x: 760, y: 460 },
  ]
  return {
    store: Object.fromEntries([
      ['page:trading-pdf', {
        id: 'page:trading-pdf', typeName: 'page', name: '数据画板', index: 'a1', meta: {},
      }],
      ...panels.map((panel, index) => [`shape:${panel.id}`, {
        id: `shape:${panel.id}`,
        typeName: 'shape',
        type: 'trading-panel',
        parentId: 'page:trading-pdf',
        index: `a${index + 1}`,
        x: panel.x,
        y: panel.y,
        props: { w: 720, h: 420, panelKind: panel.panelKind, title: panel.title },
        meta: {},
      }]),
    ]),
  }
}

function todayOverviewBoardSnapshot() {
  return {
    store: {
      'page:today-pdf': {
        id: 'page:today-pdf',
        typeName: 'page',
        name: '今天怎么看',
        index: 'a1',
        meta: {},
      },
      'shape:today': {
        id: 'shape:today',
        typeName: 'shape',
        type: 'trading-panel',
        parentId: 'page:today-pdf',
        index: 'a1',
        x: 0,
        y: 0,
        props: { w: 1480, h: 900, panelKind: 'today-overview', title: '今天怎么看' },
        meta: {},
      },
    },
  }
}

describe('project PDF', () => {
  it('accepts 200 Boards and rejects Board 201 before returning a partial PDF', async () => {
    const project = { ...fixture().project, rootBoardId: 'board-0' }
    const boards: StoredBoard[] = Array.from({ length: MAX_PROJECT_PDF_BOARDS }, (_, index) => {
      const id = `board-${index}`
      return {
        id,
        projectId: project.id,
        title: id,
        tldrawSnapshot: snapshot(id),
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }
    })

    const accepted = await renderProjectToPdf({ project, boards, references: [] })
    expect((await getDocument({ data: accepted }).promise).numPages).toBe(200)

    await expect(renderProjectToPdf({
      project,
      boards: [...boards, {
        ...boards[0]!,
        id: 'board-200',
        title: 'board-200',
        tldrawSnapshot: snapshot('board-200'),
      }],
      references: [],
    })).rejects.toThrow('PDF_BOARD_LIMIT_EXCEEDED')
  })

  it('accepts 20,000 shapes and rejects shape 20,001 in the shared PDF snapshot renderer', () => {
    const store: Record<string, unknown> = {
      'page:limit': { id: 'page:limit', typeName: 'page', name: 'Limit', index: 'a1', meta: {} },
    }
    for (let index = 0; index < MAX_PROJECT_PDF_SHAPES; index += 1) {
      store[`shape:${index}`] = {
        id: `shape:${index}`,
        typeName: 'shape',
        type: 'geo',
        parentId: 'page:limit',
        index: `a${index + 1}`,
        x: index % 100,
        y: Math.floor(index / 100),
        props: { w: 1, h: 1, geo: 'rectangle' },
        meta: {},
      }
    }

    expect(renderSnapshotToSvg({ store })).toContain('data-shape-id="shape:19999"')
    store['shape:20000'] = {
      id: 'shape:20000', typeName: 'shape', type: 'geo', parentId: 'page:limit',
      index: 'z1', x: 0, y: 0, props: { w: 1, h: 1, geo: 'rectangle' }, meta: {},
    }
    expect(() => renderSnapshotToSvg({ store })).toThrow('PDF_SHAPE_LIMIT_EXCEEDED')
  })

  it('rejects a project whose cumulative shape count exceeds 20,000 before rendering any page', async () => {
    const base = fixture()
    const store = (prefix: string) => Object.fromEntries(Array.from(
      { length: MAX_PROJECT_PDF_SHAPES / 2 + 1 },
      (_, index) => [`shape:${prefix}-${index}`, {
        id: `shape:${prefix}-${index}`,
        typeName: 'shape',
        type: 'geo',
        parentId: `page:${prefix}`,
        index: `a${index}`,
        x: index % 100,
        y: Math.floor(index / 100),
        props: { w: 1, h: 1, geo: 'rectangle' },
        meta: {},
      }],
    ))
    const boards: StoredBoard[] = [
      { ...base.boards[0]!, id: 'board-cumulative-a', tldrawSnapshot: { store: store('a') } },
      { ...base.boards[1]!, id: 'board-cumulative-b', tldrawSnapshot: { store: store('b') } },
    ]

    await expect(renderProjectToPdf({
      ...base,
      project: { ...base.project, rootBoardId: boards[0]!.id },
      boards,
      references: [],
    })).rejects.toThrow('PDF_PROJECT_SHAPE_LIMIT_EXCEEDED')
  })

  it('renders persisted manual elbow routes as orthogonal polylines', () => {
    const store = {
      'shape:manual-arrow': {
        id: 'shape:manual-arrow',
        typeName: 'shape',
        type: 'arrow',
        parentId: 'page:one',
        index: 'a1',
        x: 100,
        y: 80,
        props: {
          kind: 'elbow',
          dash: 'solid',
          color: 'blue',
          start: { x: 0, y: 20 },
          end: { x: 240, y: 140 },
          richText: { type: 'doc', content: [] },
        },
        meta: {
          manualElbowRoute: {
            version: 1,
            segments: [
              { id: 'one', orientation: 'horizontal', position: 20 },
              { id: 'two', orientation: 'vertical', position: 90 },
              { id: 'three', orientation: 'horizontal', position: 140 },
            ],
          },
        },
      },
    }

    const svg = renderSnapshotToSvg({ store })
    expect(svg).toContain('<polyline points="100,100 190,100 190,220 340,220"')
    expect(svg).not.toContain('data-shape-id="shape:manual-arrow" x1=')
  })

  it('maps every Board once before resolving all embed and link destinations', () => {
    const plan = createProjectPdfPlan(fixture())

    expect(plan.pages.map((page) => page.board.id)).toEqual(['board-a', 'board-b', 'board-c'])
    expect(plan.pageByBoardId).toEqual(new Map([
      ['board-a', 1],
      ['board-b', 2],
      ['board-c', 3],
    ]))
    expect(plan.pages.flatMap((page) => page.links).filter((link) => link.targetBoardId === 'board-c'))
      .toEqual([
        expect.objectContaining({ referenceId: 'a-to-c', targetPageNo: 3 }),
        expect.objectContaining({ referenceId: 'b-to-c', targetPageNo: 3 }),
      ])
    expect(plan.outline).toEqual([
      expect.objectContaining({ boardId: 'board-a', children: [expect.objectContaining({ boardId: 'board-c' })] }),
      expect.objectContaining({ boardId: 'board-b', children: [expect.objectContaining({ boardId: 'board-c' })] }),
    ])
  })

  it('expands a high-fanout shared embed subtree only at its first outline occurrence', () => {
    const project = { ...fixture().project, rootBoardId: 'parent-0' }
    const parentIds = Array.from({ length: 12 }, (_, index) => `parent-${index}`)
    const leafIds = Array.from({ length: 8 }, (_, index) => `leaf-${index}`)
    const boards: StoredBoard[] = [...parentIds, 'shared', ...leafIds].map((id) => ({
      id,
      projectId: project.id,
      title: id,
      tldrawSnapshot: snapshot(id),
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }))
    const references = [
      ...parentIds.map((parentId) => reference(`${parentId}-shared`, parentId, 'shared', 'embed')),
      ...leafIds.map((leafId) => reference(`shared-${leafId}`, 'shared', leafId, 'embed')),
    ]

    const plan = createProjectPdfPlan({ project, boards, references })
    const sharedOccurrences = plan.outline.flatMap((parent) =>
      parent.children.filter((child) => child.boardId === 'shared'),
    )
    const outlineNodeCount = (items: readonly ProjectPdfOutlineItem[]): number =>
      items.reduce((count, item) => count + 1 + outlineNodeCount(item.children), 0)

    expect(sharedOccurrences).toHaveLength(parentIds.length)
    expect(sharedOccurrences.filter((item) => item.children.length > 0)).toEqual([
      expect.objectContaining({ boardId: 'shared', children: leafIds.map((boardId) => expect.objectContaining({ boardId })) }),
    ])
    expect(sharedOccurrences.filter((item) => item.children.length === 0)).toHaveLength(parentIds.length - 1)
    expect(outlineNodeCount(plan.outline)).toBe(parentIds.length + parentIds.length + leafIds.length)
  })

  it('renders a valid PDF with one page per Board, shared internal destinations, and embed-only outline nesting', async () => {
    const bytes = await renderProjectToPdf(fixture())
    const document = await getDocument({ data: bytes }).promise

    expect(document.numPages).toBe(3)
    const firstAnnotations = await (await document.getPage(1)).getAnnotations()
    const secondAnnotations = await (await document.getPage(2)).getAnnotations()
    expect(firstAnnotations).toEqual([
      expect.objectContaining({ subtype: 'Link', dest: 'board-board-c' }),
    ])
    expect(secondAnnotations).toEqual([
      expect.objectContaining({ subtype: 'Link', dest: 'board-board-c' }),
    ])
    const outline = await document.getOutline()
    expect(outline?.map((item) => item.title)).toEqual(['BOARD-A', 'BOARD-B'])
    expect(outline?.[0]?.items.map((item) => item.title)).toEqual(['BOARD-C'])
    expect(outline?.[1]?.items.map((item) => item.title)).toEqual(['BOARD-C'])
  })

  it('fails the whole export when the SVG renderer throws instead of returning a blank page', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const modulePath = nodeRequire.resolve('svg-to-pdfkit')
    nodeRequire(modulePath)
    const cachedModule = nodeRequire.cache[modulePath]!
    const originalRenderer = cachedModule.exports
    cachedModule.exports = () => {
      throw new Error('synthetic SVG failure')
    }

    try {
      await expect(renderProjectToPdf(fixture())).rejects.toThrow('PDF_SVG_RENDER_FAILED:board-a')
    } finally {
      cachedModule.exports = originalRenderer
    }
  })

  it('renders every trading panel from the same frozen snapshot as native semantic SVG', () => {
    const svg = renderSnapshotToSvg(tradingPanelBoardSnapshot(), {}, frozenTradingSnapshot)

    expect(svg.match(/data-fact-state="CURRENT"/g)).toHaveLength(4)
    expect(svg).not.toContain('data-panel-kind="today-overview"')
    expect(svg).not.toContain('今天怎么看')
    expect(svg).toContain('data-panel-kind="market-overview"')
    expect(svg).toContain('市场环境与主线')
    expect(svg).toContain('PDF快照主线')
    expect(svg).toContain('个人选股池')
    expect(svg).toContain('回归股份 600001')
    expect(svg).toContain('公告观察源')
    expect(svg).toContain('回归公告标题')
    expect(svg).toContain('数据源与生产就绪状态')
    expect(svg).toContain('PDF桥接服务')
    expect(svg).not.toContain('<foreignObject')
  })

  it('renders the standalone today-overview board from the same frozen snapshot as native semantic SVG', () => {
    const svg = renderSnapshotToSvg(todayOverviewBoardSnapshot(), {}, frozenTradingSnapshot)

    expect(svg.match(/data-fact-state="CURRENT"/g)).toHaveLength(1)
    expect(svg).toContain('data-panel-kind="today-overview"')
    expect(svg).toContain('今天怎么看')
    expect(svg).toContain('当前只允许人工复核，不产生交易动作。')
    expect(svg).toContain('竞价事实只作人工复核。')
    expect(svg).toContain('如果我没空')
    expect(svg).toContain('保持观察，不产生新的交易动作。')
  })

  it('exports searchable Chinese text for Board titles and live trading facts', async () => {
    const project: ProjectRecord = {
      id: 'project-chinese-pdf',
      title: '中文PDF回归项目',
      rootBoardId: 'board-chinese-pdf',
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
    }
    const board: StoredBoard = {
      id: 'board-chinese-pdf',
      projectId: project.id,
      title: '中文PDF回归画板',
      tldrawSnapshot: tradingPanelBoardSnapshot(),
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }

    const bytes = await renderProjectToPdf({
      project,
      boards: [board],
      references: [],
      tradingSnapshot: frozenTradingSnapshot,
    })
    const document = await getDocument({ data: bytes }).promise
    const page = await document.getPage(1)
    const content = await page.getTextContent()
    const text = content.items.map((item) => 'str' in item ? item.str : '').join('')

    expect(text).toContain('中文PDF回归画板')
    expect(text).toContain('市场环境与主线')
    expect(text).toContain('PDF快照主线')
    expect(text).toContain('回归股份')
    expect(text).toContain('回归公告标题')
    expect(text).toContain('PDF桥接服务')
  })

  it('marks trading panels unavailable when no source snapshot was injected', () => {
    const svg = renderSnapshotToSvg(tradingPanelBoardSnapshot())

    expect(svg.match(/data-fact-state="UNAVAILABLE"/g)).toHaveLength(4)
    expect(svg).toContain('数据源暂不可用')
    expect(svg).not.toContain('回归股份')
    expect(svg).not.toContain('data-panel-kind="today-overview"')
  })

  it('renders snapshots as bounded SVG without copying executable asset URLs', () => {
    const svg = renderSnapshotToSvg({
      store: {
        'page:one': { id: 'page:one', typeName: 'page' },
        'asset:one': {
          id: 'asset:one', typeName: 'asset', type: 'image',
          props: { src: 'javascript:alert(1)', mimeType: 'image/png' },
        },
        'shape:one': {
          id: 'shape:one', typeName: 'shape', type: 'image', parentId: 'page:one',
          x: 5, y: 10, props: { w: 100, h: 60, assetId: 'asset:one' },
        },
      },
    }, {})

    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('viewBox="')
    expect(svg).not.toContain('javascript:')
  })

  it('renders editable table and mind-map styling into the server PDF SVG', () => {
    const svg = renderSnapshotToSvg({
      store: {
        'page:one': { id: 'page:one', typeName: 'page' },
        'shape:table': {
          id: 'shape:table', typeName: 'shape', type: 'table', parentId: 'page:one', x: 0, y: 0,
          props: {
            w: 240, h: 80,
            columns: [{ id: 'column:one', width: 1 }],
            rows: [{ id: 'row:one', height: 1, cells: [{ id: 'cell:one', text: 'Header', align: 'right', background: 'yellow', border: 'strong', header: true }] }],
          },
        },
        'shape:mind-map': {
          id: 'shape:mind-map', typeName: 'shape', type: 'mind-map', parentId: 'page:one', x: 300, y: 0,
          props: {
            w: 360, h: 180, layout: 'right', theme: 'colorful',
            nodes: [
              { id: 'root', parentId: null, text: 'Root', order: 0, side: 'right', collapsed: false, color: 'blue', shape: 'rounded' },
              {
                id: 'child', parentId: 'root', text: 'Child', order: 0, side: 'right', collapsed: false, color: 'violet', shape: 'pill',
                style: {
                  fillColor: 'purple', fillOpacity: 0.65, borderColor: 'red', borderOpacity: 0.7,
                  textColor: 'black', textOpacity: 0.8, fontSize: 'xl', fontFamily: 'serif',
                  textAlign: 'right', bold: false, italic: true, underline: true,
                  edgeColor: 'teal', edgeOpacity: 0.4, edgeDash: 'dashed', edgeWidth: 3,
                },
              },
            ],
          },
        },
      },
    }, {})

    expect(svg).toContain('fill="#fff6d8"')
    expect(svg).toContain('text-anchor="end"')
    expect(svg).toContain('font-weight="700"')
    expect(svg).toContain('fill="#d46bfa"')
    expect(svg).toContain('fill-opacity="0.65"')
    expect(svg).toContain('stroke="#0f9f75"')
    expect(svg).toContain('stroke-dasharray="10 7"')
    expect(svg).toContain('font-family="serif"')
    expect(svg).toContain('font-size="24"')
    expect(svg).toContain('font-style="italic"')
    expect(svg).toContain('text-decoration="underline"')
    expect(svg).toContain('rx="17"')
  })
})
