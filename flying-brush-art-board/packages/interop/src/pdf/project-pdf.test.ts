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
