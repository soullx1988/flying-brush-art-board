import { describe, expect, it } from 'vitest'

import { getNearestConnectionAnchor, sameConnectionAnchor } from './connection-anchors.js'

const bounds = { x: 0, y: 0, w: 100, h: 60 }

describe('getNearestConnectionAnchor', () => {
  it('uses the closest midpoint rather than the dominant direction', () => {
    // The right midpoint is closer than the bottom midpoint even though the
    // point is farther from the center vertically after normalizing by size.
    expect(getNearestConnectionAnchor(bounds, { x: 120, y: 80 })).toEqual({ x: 1, y: 0.5 })
  })

  it('uses the preferred anchor for an exact tie', () => {
    expect(getNearestConnectionAnchor(
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 50, y: 50 },
      { x: 0.5, y: 1 },
    )).toEqual({ x: 0.5, y: 1 })
  })

  it('uses a stable top-first order when a tie has no valid preference', () => {
    expect(getNearestConnectionAnchor(
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 50, y: 50 },
      { x: 0.25, y: 0.25 },
    )).toEqual({ x: 0.5, y: 0 })
  })

  it('recognizes only the four normalized midpoint anchors as preferred points', () => {
    expect(sameConnectionAnchor({ x: 1, y: 0.5 }, { x: 1, y: 0.5 })).toBe(true)
    expect(sameConnectionAnchor({ x: 0.25, y: 0.25 }, { x: 0.5, y: 0 })).toBe(false)
  })
})
