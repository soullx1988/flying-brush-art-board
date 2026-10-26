import { describe, expect, it } from 'vitest'

import {
  createManualElbowRoute,
  dragManualElbowSegment,
  ensureMinimumTerminalLegs,
  MIN_MANUAL_ELBOW_LEG_LENGTH,
  normalizeManualElbowRoute,
  readManualElbowRoute,
  resolveManualElbowRoute,
  withManualElbowRoute,
  withoutManualElbowRoute,
} from './manual-elbow-route.js'

const ids = (prefix = 'segment') => (index: number) => `${prefix}:${index}`

describe('manual elbow routes', () => {
  it('creates an alternating route and resolves terminal-following segments', () => {
    const route = createManualElbowRoute([
      { x: 0, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 80 }, { x: 120, y: 80 },
    ], ids())!
    const resolved = resolveManualElbowRoute(route, { x: 0, y: 20 }, { x: 140, y: 90 }, ids('new'))

    expect(route.segments.map((segment) => segment.orientation)).toEqual(['horizontal', 'vertical', 'horizontal'])
    expect(resolved.points).toEqual([
      { x: 0, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 90 }, { x: 140, y: 90 },
    ])
  })

  it('moves an interior segment only on its perpendicular axis', () => {
    const route = createManualElbowRoute([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 120, y: 80 },
    ], ids())!
    const moved = dragManualElbowSegment(route, 'segment:1', { x: 65, y: 999 }, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('new'))
    const resolved = resolveManualElbowRoute(moved, { x: 0, y: 0 }, { x: 120, y: 80 })

    expect(resolved.points).toEqual([
      { x: 0, y: 0 }, { x: 65, y: 0 }, { x: 65, y: 80 }, { x: 120, y: 80 },
    ])
  })

  it('adds a terminal leg when the first or last segment is moved', () => {
    const route = createManualElbowRoute([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 120, y: 80 },
    ], ids())!
    const firstMoved = dragManualElbowSegment(route, 'segment:0', { x: 10, y: 24 }, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('first'))
    const lastMoved = dragManualElbowSegment(route, 'segment:2', { x: 10, y: 110 }, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('last'))

    expect(resolveManualElbowRoute(firstMoved, { x: 0, y: 0 }, { x: 120, y: 80 }).points).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 25 }, { x: 40, y: 25 }, { x: 40, y: 80 }, { x: 120, y: 80 },
    ])
    expect(resolveManualElbowRoute(lastMoved, { x: 0, y: 0 }, { x: 120, y: 80 }).points).toEqual([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 110 }, { x: 120, y: 110 }, { x: 120, y: 80 },
    ])
  })

  it('keeps dragged terminal legs away from the connection points', () => {
    const route = createManualElbowRoute([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 120, y: 80 },
    ], ids())!
    const firstMoved = dragManualElbowSegment(route, 'segment:0', { x: 10, y: 1 }, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('first'))
    const lastMoved = dragManualElbowSegment(route, 'segment:2', { x: 10, y: 79 }, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('last'))

    expect(resolveManualElbowRoute(firstMoved, { x: 0, y: 0 }, { x: 120, y: 80 }).points[1]).toEqual({ x: 0, y: MIN_MANUAL_ELBOW_LEG_LENGTH })
    expect(resolveManualElbowRoute(lastMoved, { x: 0, y: 0 }, { x: 120, y: 80 }).points.at(-2)).toEqual({ x: 120, y: 80 - MIN_MANUAL_ELBOW_LEG_LENGTH })
  })

  it('applies the minimum terminal distance when dragging a straight route into an elbow', () => {
    const route = createManualElbowRoute([{ x: 0, y: 0 }, { x: 120, y: 0 }], ids())!
    const moved = dragManualElbowSegment(route, 'segment:0', { x: 60, y: 1 }, { x: 0, y: 0 }, { x: 120, y: 0 }, ids('new'))

    expect(resolveManualElbowRoute(moved, { x: 0, y: 0 }, { x: 120, y: 0 }).points).toEqual([
      { x: 0, y: 0 }, { x: 0, y: MIN_MANUAL_ELBOW_LEG_LENGTH }, { x: 120, y: MIN_MANUAL_ELBOW_LEG_LENGTH }, { x: 120, y: 0 },
    ])
  })

  it('constrains automatic routes with unbound point terminals', () => {
    const route = createManualElbowRoute([
      { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 80, y: 2 }, { x: 80, y: 0 },
    ], ids())!
    const constrained = ensureMinimumTerminalLegs(route, { x: 0, y: 0 }, { x: 80, y: 0 })
    expect(resolveManualElbowRoute(constrained, { x: 0, y: 0 }, { x: 80, y: 0 }).points).toEqual([
      { x: 0, y: 0 }, { x: 0, y: MIN_MANUAL_ELBOW_LEG_LENGTH }, { x: 80, y: MIN_MANUAL_ELBOW_LEG_LENGTH }, { x: 80, y: 0 },
    ])
  })

  it('simplifies zero-length turns and rejects malformed metadata', () => {
    const route = createManualElbowRoute([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 120, y: 80 },
    ], ids())!
    const collapsed = dragManualElbowSegment(route, 'segment:1', { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('drag'))
    const normalized = normalizeManualElbowRoute(collapsed, { x: 0, y: 0 }, { x: 120, y: 80 }, ids('normalized'))!

    expect(normalized.segments).toHaveLength(3)
    expect(resolveManualElbowRoute(normalized, { x: 0, y: 0 }, { x: 120, y: 80 }).points[1]).toEqual({ x: MIN_MANUAL_ELBOW_LEG_LENGTH, y: 0 })
    expect(readManualElbowRoute({ manualElbowRoute: { version: 2, segments: [] } })).toBeUndefined()
    expect(readManualElbowRoute({ manualElbowRoute: { version: 1, segments: [
      { id: 'a', orientation: 'horizontal', position: 0 },
      { id: 'b', orientation: 'horizontal', position: 10 },
    ] } })).toBeUndefined()
  })

  it('writes and clears route metadata without disturbing other metadata', () => {
    const route = createManualElbowRoute([{ x: 0, y: 0 }, { x: 40, y: 0 }], ids())!
    const meta = withManualElbowRoute({ source: 'test' }, route)

    expect(readManualElbowRoute(meta)).toEqual(route)
    expect(withoutManualElbowRoute(meta)).toEqual({ source: 'test' })
  })
})
