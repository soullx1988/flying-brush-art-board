import { describe, expect, it, vi } from 'vitest'

import {
  BoardReferenceShapeUtil,
  createBoardReferenceThumbnailScene,
  setBoardReferenceOpenHandler,
} from './BoardReferenceShapeUtil.js'
import type { BoardReferenceShape } from './schema.js'

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

})

describe('BoardReferenceShapeUtil', () => {
  it('opens a board reference on double click and handles the event inside tldraw', () => {
    const shape = {
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
      },
      typeName: 'shape',
    } as unknown as BoardReferenceShape
    const open = vi.fn()
    const dispose = setBoardReferenceOpenHandler(open)

    const change = BoardReferenceShapeUtil.prototype.onDoubleClick(shape)

    expect(open).toHaveBeenCalledWith(shape)
    expect(change).toEqual({ id: shape.id, type: shape.type, props: {} })
    dispose()
  })
})
