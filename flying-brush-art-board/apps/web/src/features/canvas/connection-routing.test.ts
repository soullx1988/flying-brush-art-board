import { describe, expect, it } from 'vitest'

import { getNearestConnectionAnchor } from './connection-routing'

const bounds = { x: 10, y: 20, w: 100, h: 60 }

describe('getNearestConnectionAnchor', () => {
  it('uses the closest midpoint rather than the dominant direction', () => {
    expect(getNearestConnectionAnchor(bounds, { x: 130, y: 100 })).toEqual({ x: 1, y: 0.5 })
  })

  it('keeps a preferred midpoint when the candidates are tied', () => {
    expect(getNearestConnectionAnchor(
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 50, y: 50 },
      { x: 0.5, y: 1 },
    )).toEqual({ x: 0.5, y: 1 })
  })

  it('selects the right midpoint even when the opposite endpoint is near a corner', () => {
    expect(getNearestConnectionAnchor(bounds, { x: 180, y: 50 })).toEqual({ x: 1, y: 0.5 })
    expect(getNearestConnectionAnchor(bounds, { x: 180, y: 100 })).toEqual({ x: 1, y: 0.5 })
  })

  it('selects the left midpoint for a horizontally opposite endpoint', () => {
    expect(getNearestConnectionAnchor(bounds, { x: -40, y: 35 })).toEqual({ x: 0, y: 0.5 })
  })

  it('selects the top and bottom edges for vertical endpoints', () => {
    expect(getNearestConnectionAnchor(bounds, { x: 60, y: -80 })).toEqual({ x: 0.5, y: 0 })
    expect(getNearestConnectionAnchor(bounds, { x: 60, y: 180 })).toEqual({ x: 0.5, y: 1 })
  })
})
