import { describe, expect, it } from 'vitest'

import { EnhancedArrowShapeUtil } from './shapes/arrow/EnhancedArrowShapeUtil.js'
import { boardStoreShapeUtils, createBoardStore, getTldrawLicenseKey } from './store.js'

describe('tldraw license key', () => {
  it('uses a Vite-injected key without requiring Node process globals', () => {
    expect(getTldrawLicenseKey({ VITE_TLDRAW_LICENSE_KEY: 'vite-license-key' })).toBe('vite-license-key')
  })
})

describe('board shape utils', () => {
  it('replaces the native arrow util exactly once in the shared board schema', () => {
    const arrowUtils = boardStoreShapeUtils.filter((shapeUtil) => shapeUtil.type === 'arrow')
    expect(arrowUtils).toEqual([EnhancedArrowShapeUtil])
    expect(() => createBoardStore()).not.toThrow()
  })
})
