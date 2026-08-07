import { describe, expect, it } from 'vitest'

import {
  clearCanvasShapeInteractionTarget,
  getCanvasShapeInteractionTarget,
  setCanvasShapeInteractionTarget,
} from './interaction-target.js'

describe('canvas shape interaction target', () => {
  it('clears the target when a table or mind-map loses its active sub-target', () => {
    const editor = {} as Parameters<typeof setCanvasShapeInteractionTarget>[0]
    setCanvasShapeInteractionTarget(editor, {
      type: 'mind-map',
      shapeId: 'shape:mind-map',
      nodeId: 'node:child',
    })

    clearCanvasShapeInteractionTarget(editor)

    expect(getCanvasShapeInteractionTarget(editor)).toBeUndefined()
  })
})
