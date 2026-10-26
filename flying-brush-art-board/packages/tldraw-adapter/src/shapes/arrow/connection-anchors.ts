export interface ConnectionBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface ConnectionPoint {
  x: number
  y: number
}

const DISTANCE_EPSILON = 1e-9

const CONNECTION_ANCHORS = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
] as const satisfies readonly ConnectionPoint[]

export function sameConnectionAnchor(
  a: ConnectionPoint,
  b: ConnectionPoint,
  epsilon = 0.001,
): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

function distanceSquared(
  bounds: ConnectionBounds,
  anchor: ConnectionPoint,
  point: ConnectionPoint,
): number {
  const x = bounds.x + bounds.w * anchor.x
  const y = bounds.y + bounds.h * anchor.y
  return (point.x - x) ** 2 + (point.y - y) ** 2
}

/** Returns the closest of the shape's top, right, bottom, and left midpoint anchors. */
export function getNearestConnectionAnchor(
  bounds: ConnectionBounds,
  point: ConnectionPoint,
  preferredAnchor?: ConnectionPoint,
): ConnectionPoint {
  const candidates = CONNECTION_ANCHORS.map((anchor) => ({
    anchor,
    distance: distanceSquared(bounds, anchor, point),
  }))
  const minimumDistance = Math.min(...candidates.map((candidate) => candidate.distance))
  const isNearest = (distance: number) => (
    Math.abs(distance - minimumDistance)
    <= DISTANCE_EPSILON * Math.max(1, minimumDistance)
  )

  if (preferredAnchor) {
    const preferredCandidate = candidates.find((candidate) => (
      sameConnectionAnchor(candidate.anchor, preferredAnchor)
    ))
    if (preferredCandidate && isNearest(preferredCandidate.distance)) {
      return { ...preferredCandidate.anchor }
    }
  }

  const nearest = candidates.find((candidate) => isNearest(candidate.distance)) ?? candidates[0]!
  return { ...nearest.anchor }
}
