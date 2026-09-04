import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { collectClipboardPayload, materializeClipboardPayload } from '../../clipboard.js'
import {
  BoardReferenceCardContent,
  BoardReferenceShapeUtil,
  createBoardReferenceThumbnailScene,
  setBoardReferenceOpenHandler,
  setBoardReferencePreviewResolver,
} from './BoardReferenceShapeUtil.js'
import { boardReferenceShapeMigrations } from './migrations.js'
import type { BoardReferenceShape } from './schema.js'

function boardReferenceShape(
  props: Partial<BoardReferenceShape['props']> = {},
): BoardReferenceShape {
  return {
    id: 'shape:reference',
    type: 'board-reference',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: 'page:page',
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      w: 300,
      h: 168,
      referenceId: 'reference:one',
      targetBoardId: 'board:child',
      kind: 'embed',
      titleFallback: 'Child board',
      ...props,
    },
    typeName: 'shape',
  } as BoardReferenceShape
}

describe('board reference thumbnail scene', () => {
  it('builds a bounded, capped minimap from target Board shapes', () => {
    const scene = createBoardReferenceThumbnailScene({ store: {
      'shape:one': { id: 'shape:one', typeName: 'shape', type: 'geo', x: 10, y: 20, props: { w: 120, h: 80, geo: 'ellipse', color: 'blue', text: 'Launch' } },
      'shape:two': { id: 'shape:two', typeName: 'shape', type: 'note', x: 240, y: 160, props: { w: 180, h: 120, color: 'yellow', text: 'Research' } },
      'page:page': { id: 'page:page', typeName: 'page' },
    } }, 1)

    expect(scene.totalCount).toBe(2)
    expect(scene.items).toEqual([expect.objectContaining({ id: 'shape:one', kind: 'ellipse', color: '#60a5fa', label: 'Launch' })])
    expect(scene.viewBox.w).toBeGreaterThan(120)
    expect(scene.viewBox.h).toBeGreaterThan(80)
  })

  it('returns an empty placeholder scene for an empty Board', () => {
    expect(createBoardReferenceThumbnailScene({ store: {} })).toEqual({
      items: [], totalCount: 0, viewBox: { x: 0, y: 0, w: 320, h: 180 },
    })
  })

  it('uses the target Board image asset as the thumbnail content', () => {
    const scene = createBoardReferenceThumbnailScene({ store: {
      'asset:preview': { id: 'asset:preview', typeName: 'asset', type: 'image', props: { src: 'data:image/png;base64,preview' } },
      'shape:image': { id: 'shape:image', typeName: 'shape', type: 'image', x: 40, y: 60, props: { w: 320, h: 180, assetId: 'asset:preview' } },
    } })

    expect(scene.items).toEqual([
      expect.objectContaining({ id: 'shape:image', kind: 'image', src: 'data:image/png;base64,preview' }),
    ])
  })

  it('gives trading panels a semantic preview color and title', () => {
    const scene = createBoardReferenceThumbnailScene({ store: {
      'shape:panel': {
        id: 'shape:panel', typeName: 'shape', type: 'trading-panel', x: 0, y: 0,
        props: { w: 720, h: 420, title: '今天怎么看' },
      },
    } })

    expect(scene.items).toEqual([
      expect.objectContaining({ id: 'shape:panel', color: '#60a5fa', label: '今天怎么看' }),
    ])
  })

  it('does not inspect or extract any private snapshot content', () => {
    const snapshot = { store: {
      'shape:secret-text': {
        id: 'shape:secret-text', typeName: 'shape', type: 'text', x: 0, y: 0,
        props: { w: 240, h: 80, text: '恐惧导致追高' },
      },
      'shape:secret-table': {
        id: 'shape:secret-table', typeName: 'shape', type: 'table', x: 0, y: 100,
        props: { w: 500, h: 200, rows: [{ cells: [{ text: '个人心态正文' }] }] },
      },
    } }

    const scene = createBoardReferenceThumbnailScene(snapshot, 80, 'private')

    expect(scene).toEqual({
      items: [], totalCount: 0, viewBox: { x: 0, y: 0, w: 320, h: 180 },
    })
    expect(JSON.stringify(scene)).not.toContain('恐惧导致追高')
    expect(JSON.stringify(scene)).not.toContain('个人心态正文')
  })

})

describe('BoardReferenceShapeUtil', () => {
  it('opens a board reference on double click without emitting a no-op shape mutation', () => {
    const shape = boardReferenceShape()
    const open = vi.fn()
    const dispose = setBoardReferenceOpenHandler(open)

    const change = BoardReferenceShapeUtil.prototype.onDoubleClick(shape)

    expect(open).toHaveBeenCalledWith(shape)
    expect(change).toBeUndefined()
    dispose()
  })

  it('renders a private DOM card without resolving or embedding target content', () => {
    const shape = boardReferenceShape({ previewMode: 'private', titleFallback: '心态' })
    const resolvePreview = vi.fn(() => ({
      title: '不应读取的标题',
      snapshot: { store: {
        'shape:secret': { typeName: 'shape', type: 'text', props: { text: '极度恐惧' } },
      } },
    }))
    const dispose = setBoardReferencePreviewResolver(resolvePreview)

    try {
      const markup = renderToStaticMarkup(createElement(BoardReferenceCardContent, { shape }))

      expect(resolvePreview).not.toHaveBeenCalled()
      expect(markup).toContain('data-preview-mode="private"')
      expect(markup).toContain('私密画板 · 内容预览已隐藏')
      expect(markup).toContain('心态')
      expect(markup).not.toContain('极度恐惧')
      expect(markup).not.toContain('<svg')
      expect(markup).not.toContain('<text')
    } finally {
      dispose()
    }
  })

  it('keeps content previews available for legacy references without previewMode', () => {
    const shape = boardReferenceShape({ titleFallback: '数据' })
    const dispose = setBoardReferencePreviewResolver(() => ({
      title: '数据',
      snapshot: { store: {
        'shape:public': {
          id: 'shape:public', typeName: 'shape', type: 'geo', x: 0, y: 0,
          props: { w: 120, h: 80, color: 'blue', text: '公开摘要' },
        },
      } },
    }))

    try {
      const markup = renderToStaticMarkup(createElement(BoardReferenceCardContent, { shape }))

      expect(markup).toContain('data-preview-mode="content"')
      expect(markup).toContain('<svg')
      expect(markup).toContain('公开摘要')
    } finally {
      dispose()
    }
  })

  it('exports a private SVG card without resolving target content', () => {
    const shape = boardReferenceShape({ previewMode: 'private', titleFallback: '心态' })
    const resolvePreview = vi.fn(() => ({
      title: '不应读取的标题',
      snapshot: { store: {
        'shape:secret': { typeName: 'shape', type: 'text', props: { text: '个人心态正文' } },
      } },
    }))
    const dispose = setBoardReferencePreviewResolver(resolvePreview)

    try {
      const element = BoardReferenceShapeUtil.prototype.toSvg(shape, {} as never) as ReactElement
      const markup = renderToStaticMarkup(element)

      expect(resolvePreview).not.toHaveBeenCalled()
      expect(markup).toContain('data-preview-mode="private"')
      expect(markup).toContain('私密画板 · 内容预览已隐藏')
      expect(markup).toContain('心态')
      expect(markup).not.toContain('个人心态正文')
      expect(markup).not.toContain('不应读取的标题')
    } finally {
      dispose()
    }
  })

  it('preserves private preview semantics through clipboard materialization', () => {
    const shape = boardReferenceShape({ previewMode: 'private' })
    const payload = collectClipboardPayload({
      getShapeAndDescendantIds: () => new Set([shape.id]),
      store: { allRecords: () => [shape as unknown as Record<string, unknown>] },
    }, [shape.id], {
      sourceProjectId: 'project:source',
      sourceBoardId: 'board:source',
      copiedAt: '2026-08-08T08:00:00.000Z',
    })
    const materialized = materializeClipboardPayload(payload, {
      createId: () => 'shape:copied',
      targetSnapshot: { store: {} },
      assetBlobs: [],
    })
    const copied = (materialized.nextSnapshot as {
      store: Record<string, { props?: { previewMode?: unknown } }>
    }).store['shape:copied']

    expect(copied?.props?.previewMode).toBe('private')
  })

  it('migrates legacy references to content preview and can down-migrate cleanly', () => {
    const migration = boardReferenceShapeMigrations.sequence[0]!
    const props: Record<string, unknown> = {}

    expect('up' in migration && typeof migration.up === 'function').toBe(true)
    if (!('up' in migration) || typeof migration.up !== 'function') {
      throw new Error('Expected an up migration')
    }
    migration.up(props)
    expect(props.previewMode).toBe('content')
    const alreadyPrivate: Record<string, unknown> = { previewMode: 'private' }
    migration.up(alreadyPrivate)
    expect(alreadyPrivate.previewMode).toBe('private')

    expect('down' in migration && typeof migration.down === 'function').toBe(true)
    if (!('down' in migration) || typeof migration.down !== 'function') {
      throw new Error('Expected a down migration')
    }
    migration.down(props)
    expect(props).not.toHaveProperty('previewMode')
  })
})
