import { describe, expect, it } from 'vitest'
import type { Editor, TLArrowShape } from 'tldraw'

import { EnhancedArrowShapeUtil } from './EnhancedArrowShapeUtil.js'

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
})
