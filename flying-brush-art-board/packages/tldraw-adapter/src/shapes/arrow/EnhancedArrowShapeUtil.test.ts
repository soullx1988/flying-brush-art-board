import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArrowShapeUtil, type Editor, type TLArrowShape } from 'tldraw'

import { EnhancedArrowShapeUtil } from './EnhancedArrowShapeUtil.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function arrow(kind: 'arc' | 'elbow', meta: TLArrowShape['meta']): TLArrowShape {
  return {
    id: 'shape:arrow',
    typeName: 'shape',
    type: 'arrow',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: 'page:page',
    isLocked: false,
    opacity: 1,
    meta,
    props: { kind } as TLArrowShape['props'],
  } as unknown as TLArrowShape
}

describe('EnhancedArrowShapeUtil', () => {
  it('continues to own the native arrow type', () => {
    expect(EnhancedArrowShapeUtil.type).toBe('arrow')
  })

  it('keeps automatic elbow turns clear of connection points', () => {
    const util = new EnhancedArrowShapeUtil({} as Editor)

    expect(util.options.expandElbowLegLength).toEqual({
      s: 19.6, m: 25.2, l: 30.8, xl: 46.2,
    })
    expect(util.options.minElbowLegLength).toEqual({
      s: 19.6, m: 25.2, l: 30.8, xl: 46.2,
    })
  })

  it('clears persisted manual routes when switching away from elbow mode', () => {
    const util = new EnhancedArrowShapeUtil({} as Editor)
    const manualElbowRoute = {
      version: 1,
      segments: [{ id: 'one', orientation: 'horizontal', position: 10 }],
    }
    const next = util.onBeforeUpdate?.(
      arrow('elbow', { source: 'test', manualElbowRoute }),
      arrow('arc', { source: 'test', manualElbowRoute }),
    )

    expect(next?.meta).toEqual({ source: 'test' })
  })

  it('also removes unknown manual-route versions when switching to an arc', () => {
    const util = new EnhancedArrowShapeUtil({} as Editor)
    const next = util.onBeforeUpdate?.(
      arrow('elbow', { manualElbowRoute: { version: 99 } }),
      arrow('arc', { manualElbowRoute: { version: 99 } }),
    )

    expect(next?.meta).toEqual({})
  })

  it('snaps only the dragged terminal to the nearest connection midpoint', () => {
    const source = { id: 'shape:source', type: 'geo' }
    const target = { id: 'shape:target', type: 'geo' }
    const startBinding = {
      id: 'binding:start',
      type: 'arrow',
      fromId: 'shape:arrow',
      toId: source.id,
      props: {
        terminal: 'start',
        normalizedAnchor: { x: 0.5, y: 0 },
        isPrecise: true,
        isExact: false,
        snap: 'edge-point',
      },
    }
    const endBinding = {
      id: 'binding:end',
      type: 'arrow',
      fromId: 'shape:arrow',
      toId: target.id,
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
        isExact: false,
        snap: 'center',
      },
    }
    const updateBinding = vi.fn()
    const editor = {
      inputs: { currentPagePoint: { x: 120, y: 80 } },
      getBindingsFromShape: vi.fn(() => [startBinding, endBinding]),
      getShape: vi.fn((id: string) => id === source.id ? source : id === target.id ? target : undefined),
      getShapeGeometry: vi.fn(() => ({ bounds: { x: 0, y: 0, w: 100, h: 60 } })),
      getShapePageTransform: vi.fn(() => ({ applyToPoint: (point: { x: number; y: number }) => point })),
      getPointInShapeSpace: vi.fn((_shape: unknown, point: { x: number; y: number }) => point),
      updateBinding,
    } as unknown as Editor
    const util = new EnhancedArrowShapeUtil(editor)
    const nativeChange = { id: 'shape:arrow', type: 'arrow', props: { end: { x: 120, y: 80 } } }
    const superDrag = vi.spyOn(ArrowShapeUtil.prototype, 'onHandleDrag').mockReturnValue(nativeChange as never)

    const result = util.onHandleDrag(arrow('elbow', {}), {
      handle: { id: 'end', type: 'vertex', index: 'a3', x: 50, y: 60 },
      isPrecise: true,
      isCreatingShape: false,
      initial: arrow('elbow', {}),
    } as never)

    expect(superDrag).toHaveBeenCalledOnce()
    expect(result).toBe(nativeChange)
    expect(updateBinding).toHaveBeenCalledTimes(1)
    expect(updateBinding).toHaveBeenCalledWith(expect.objectContaining({
      id: endBinding.id,
      props: expect.objectContaining({
        normalizedAnchor: { x: 1, y: 0.5 },
        isPrecise: true,
        isExact: false,
        snap: 'edge-point',
      }),
    }))
    expect(updateBinding.mock.calls[0]?.[0]).not.toMatchObject({ id: startBinding.id })
  })

  it('keeps a preferred terminal midpoint when the drag is exactly equidistant', () => {
    const target = { id: 'shape:target', type: 'geo' }
    const endBinding = {
      id: 'binding:end',
      type: 'arrow',
      fromId: 'shape:arrow',
      toId: target.id,
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 0.5, y: 1 },
        isPrecise: true,
        isExact: false,
        snap: 'edge-point',
      },
    }
    const updateBinding = vi.fn()
    const editor = {
      inputs: { currentPagePoint: { x: 50, y: 50 } },
      getBindingsFromShape: vi.fn(() => [endBinding]),
      getShape: vi.fn((id: string) => id === target.id ? target : undefined),
      getShapeGeometry: vi.fn(() => ({ bounds: { x: 0, y: 0, w: 100, h: 100 } })),
      getShapePageTransform: vi.fn(() => ({ applyToPoint: (point: { x: number; y: number }) => point })),
      getPointInShapeSpace: vi.fn((_shape: unknown, point: { x: number; y: number }) => point),
      updateBinding,
    } as unknown as Editor
    const util = new EnhancedArrowShapeUtil(editor)
    const superDrag = vi.spyOn(ArrowShapeUtil.prototype, 'onHandleDrag').mockReturnValue(undefined)

    util.onHandleDrag(arrow('elbow', {}), {
      handle: { id: 'end', type: 'vertex', index: 'a3', x: 50, y: 50 },
      isPrecise: true,
      isCreatingShape: false,
      initial: arrow('elbow', {}),
    } as never)

    expect(updateBinding).not.toHaveBeenCalled()
  })

  it('reapplies the nearest cursor midpoint when a terminal drag ends', () => {
    const target = { id: 'shape:target', type: 'geo' }
    const endBinding = {
      id: 'binding:end',
      type: 'arrow',
      fromId: 'shape:arrow',
      toId: target.id,
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 1, y: 0.5 },
        isPrecise: true,
        isExact: false,
        snap: 'edge-point',
      },
    }
    const updateBinding = vi.fn()
    const editor = {
      inputs: { currentPagePoint: { x: 50, y: 70 } },
      getBindingsFromShape: vi.fn(() => [endBinding]),
      getShape: vi.fn(() => target),
      getShapeGeometry: vi.fn(() => ({ bounds: { x: 0, y: 0, w: 100, h: 60 } })),
      getShapePageTransform: vi.fn(() => ({ applyToPoint: (point: { x: number; y: number }) => point })),
      getPointInShapeSpace: vi.fn((_shape: unknown, point: { x: number; y: number }) => point),
      updateBinding,
    } as unknown as Editor
    const util = new EnhancedArrowShapeUtil(editor)

    util.onHandleDragEnd(arrow('elbow', {}), {
      handle: { id: 'end', type: 'vertex', index: 'a3', x: 100, y: 30 },
      isPrecise: true,
      isCreatingShape: false,
      initial: arrow('elbow', {}),
    } as never)

    expect(updateBinding).toHaveBeenCalledWith(expect.objectContaining({
      id: endBinding.id,
      props: expect.objectContaining({ normalizedAnchor: { x: 0.5, y: 1 } }),
    }))
  })
})
