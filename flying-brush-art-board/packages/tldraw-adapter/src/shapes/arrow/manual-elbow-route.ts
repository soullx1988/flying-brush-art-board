import type { JsonObject, VecLike } from 'tldraw'

export const MANUAL_ELBOW_ROUTE_META_KEY = 'manualElbowRoute'
export const MANUAL_ELBOW_ROUTE_VERSION = 1 as const

export type ManualElbowSegmentOrientation = 'horizontal' | 'vertical'

export interface ManualElbowSegment {
  id: string
  orientation: ManualElbowSegmentOrientation
  /** y for horizontal segments, x for vertical segments. */
  position: number
}

export interface ManualElbowRouteV1 {
  version: typeof MANUAL_ELBOW_ROUTE_VERSION
  segments: ManualElbowSegment[]
}

export interface ResolvedManualElbowSegment extends ManualElbowSegment {
  start: VecLike
  end: VecLike
}

export interface ResolvedManualElbowRoute {
  route: ManualElbowRouteV1
  points: VecLike[]
  segments: ResolvedManualElbowSegment[]
}

export type ManualElbowSegmentIdFactory = (index: number) => string

const EPSILON = 0.01
// Keep the first/last elbow leg visibly clear of its connection point.
// This is the same 25px floor used by the desktop connection-point workflow.
export const MIN_MANUAL_ELBOW_LEG_LENGTH = 25
let nextRouteId = 0

export function createManualElbowSegmentId(): string {
  nextRouteId += 1
  return `manual-segment-${Date.now().toString(36)}-${nextRouteId.toString(36)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function samePoint(left: VecLike, right: VecLike): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON
}

function segmentOrientation(start: VecLike, end: VecLike): ManualElbowSegmentOrientation | undefined {
  if (Math.abs(start.y - end.y) <= EPSILON && Math.abs(start.x - end.x) > EPSILON) return 'horizontal'
  if (Math.abs(start.x - end.x) <= EPSILON && Math.abs(start.y - end.y) > EPSILON) return 'vertical'
  return undefined
}

function segmentPosition(orientation: ManualElbowSegmentOrientation, start: VecLike, end: VecLike): number {
  return orientation === 'horizontal' ? (start.y + end.y) / 2 : (start.x + end.x) / 2
}

function endpointPosition(orientation: ManualElbowSegmentOrientation, point: VecLike): number {
  return orientation === 'horizontal' ? point.y : point.x
}

function clampTerminalPosition(
  position: number,
  endpoint: number,
  directionHint: number,
  minimum = MIN_MANUAL_ELBOW_LEG_LENGTH,
): number {
  if (Math.abs(position - endpoint) >= minimum) return position
  const direction = Math.sign(position - endpoint) || Math.sign(directionHint) || 1
  return endpoint + direction * minimum
}

function enforceMinimumTerminalLegs(
  segments: ManualElbowSegment[],
  start: VecLike,
  end: VecLike,
): void {
  if (segments.length < 2) return

  const first = segments[0]!
  const firstTurn = segments[1]!
  firstTurn.position = clampTerminalPosition(
    firstTurn.position,
    endpointPosition(firstTurn.orientation, start),
    endpointPosition(firstTurn.orientation, end) - endpointPosition(firstTurn.orientation, start),
  )

  const last = segments[segments.length - 1]!
  const lastTurn = segments[segments.length - 2]!
  lastTurn.position = clampTerminalPosition(
    lastTurn.position,
    endpointPosition(lastTurn.orientation, end),
    endpointPosition(lastTurn.orientation, start) - endpointPosition(lastTurn.orientation, end),
  )
}

export function ensureMinimumTerminalLegs(
  route: ManualElbowRouteV1,
  start: VecLike,
  end: VecLike,
): ManualElbowRouteV1 {
  const segments = route.segments.map((segment) => ({ ...segment }))
  enforceMinimumTerminalLegs(segments, start, end)
  return { version: MANUAL_ELBOW_ROUTE_VERSION, segments }
}

function opposite(orientation: ManualElbowSegmentOrientation): ManualElbowSegmentOrientation {
  return orientation === 'horizontal' ? 'vertical' : 'horizontal'
}

function intersection(left: ManualElbowSegment, right: ManualElbowSegment): VecLike {
  const horizontal = left.orientation === 'horizontal' ? left : right
  const vertical = left.orientation === 'vertical' ? left : right
  return { x: vertical.position, y: horizontal.position }
}

export function readManualElbowRoute(meta: unknown): ManualElbowRouteV1 | undefined {
  if (!isRecord(meta)) return undefined
  const candidate = meta[MANUAL_ELBOW_ROUTE_META_KEY]
  if (!isRecord(candidate) || candidate.version !== MANUAL_ELBOW_ROUTE_VERSION || !Array.isArray(candidate.segments)) {
    return undefined
  }
  if (candidate.segments.length === 0 || candidate.segments.length > 100) return undefined
  const ids = new Set<string>()
  const segments: ManualElbowSegment[] = []
  for (const [index, value] of candidate.segments.entries()) {
    if (!isRecord(value)) return undefined
    const { id, orientation, position } = value
    if (
      typeof id !== 'string'
      || id.length === 0
      || ids.has(id)
      || (orientation !== 'horizontal' && orientation !== 'vertical')
      || typeof position !== 'number'
      || !Number.isFinite(position)
      || (index > 0 && segments[index - 1]?.orientation === orientation)
    ) return undefined
    ids.add(id)
    segments.push({ id, orientation, position })
  }
  return { version: MANUAL_ELBOW_ROUTE_VERSION, segments }
}

export function withManualElbowRoute(meta: JsonObject, route: ManualElbowRouteV1): JsonObject {
  return { ...meta, [MANUAL_ELBOW_ROUTE_META_KEY]: route as unknown as JsonObject }
}

export function withoutManualElbowRoute(meta: JsonObject): JsonObject {
  if (!(MANUAL_ELBOW_ROUTE_META_KEY in meta)) return meta
  const { [MANUAL_ELBOW_ROUTE_META_KEY]: _manualRoute, ...rest } = meta
  return rest
}

export function simplifyOrthogonalPoints(points: readonly VecLike[]): VecLike[] {
  const deduplicated: VecLike[] = []
  for (const point of points) {
    const copy = { x: point.x, y: point.y }
    if (!deduplicated.length || !samePoint(deduplicated[deduplicated.length - 1]!, copy)) deduplicated.push(copy)
  }
  let changed = true
  while (changed && deduplicated.length > 2) {
    changed = false
    for (let index = 1; index < deduplicated.length - 1; index += 1) {
      const before = deduplicated[index - 1]!
      const current = deduplicated[index]!
      const after = deduplicated[index + 1]!
      if (
        (Math.abs(before.x - current.x) <= EPSILON && Math.abs(current.x - after.x) <= EPSILON)
        || (Math.abs(before.y - current.y) <= EPSILON && Math.abs(current.y - after.y) <= EPSILON)
      ) {
        deduplicated.splice(index, 1)
        changed = true
        break
      }
    }
  }
  return deduplicated
}

export function createManualElbowRoute(
  points: readonly VecLike[],
  id: ManualElbowSegmentIdFactory = () => createManualElbowSegmentId(),
): ManualElbowRouteV1 | undefined {
  const simplified = simplifyOrthogonalPoints(points)
  const segments: ManualElbowSegment[] = []
  for (let index = 0; index < simplified.length - 1; index += 1) {
    const start = simplified[index]!
    const end = simplified[index + 1]!
    const orientation = segmentOrientation(start, end)
    if (!orientation) return undefined
    segments.push({ id: id(index), orientation, position: segmentPosition(orientation, start, end) })
  }
  return segments.length ? { version: MANUAL_ELBOW_ROUTE_VERSION, segments } : undefined
}

function materializeTerminalCompatibleRoute(
  route: ManualElbowRouteV1,
  start: VecLike,
  end: VecLike,
  id: ManualElbowSegmentIdFactory,
): ManualElbowRouteV1 {
  if (route.segments.length !== 1) return route
  const only = route.segments[0]!
  const aligned = only.orientation === 'horizontal'
    ? Math.abs(start.y - end.y) <= EPSILON
    : Math.abs(start.x - end.x) <= EPSILON
  if (aligned) return route
  const perpendicular = opposite(only.orientation)
  const middlePosition = only.orientation === 'horizontal'
    ? (start.y + end.y) / 2
    : (start.x + end.x) / 2
  return {
    version: MANUAL_ELBOW_ROUTE_VERSION,
    segments: [
      { id: id(0), orientation: only.orientation, position: endpointPosition(only.orientation, start) },
      { id: id(1), orientation: perpendicular, position: only.orientation === 'horizontal' ? (start.x + end.x) / 2 : (start.y + end.y) / 2 },
      { id: id(2), orientation: only.orientation, position: middlePosition },
    ],
  }
}

export function resolveManualElbowRoute(
  input: ManualElbowRouteV1,
  start: VecLike,
  end: VecLike,
  id: ManualElbowSegmentIdFactory = () => createManualElbowSegmentId(),
): ResolvedManualElbowRoute {
  const route = materializeTerminalCompatibleRoute(input, start, end, id)
  const segments = route.segments.map((segment) => ({ ...segment }))
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  first.position = endpointPosition(first.orientation, start)
  last.position = endpointPosition(last.orientation, end)
  const points: VecLike[] = [{ x: start.x, y: start.y }]
  for (let index = 0; index < segments.length - 1; index += 1) {
    points.push(intersection(segments[index]!, segments[index + 1]!))
  }
  points.push({ x: end.x, y: end.y })
  return {
    route: { version: MANUAL_ELBOW_ROUTE_VERSION, segments },
    points,
    segments: segments.map((segment, index) => ({
      ...segment,
      start: points[index]!,
      end: points[index + 1]!,
    })),
  }
}

export function dragManualElbowSegment(
  input: ManualElbowRouteV1,
  segmentId: string,
  handle: VecLike,
  start: VecLike,
  end: VecLike,
  id: ManualElbowSegmentIdFactory = () => createManualElbowSegmentId(),
): ManualElbowRouteV1 {
  const route = resolveManualElbowRoute(input, start, end, id).route
  const index = route.segments.findIndex((segment) => segment.id === segmentId)
  if (index < 0) return route
  const segments = route.segments.map((segment) => ({ ...segment }))
  const segment = segments[index]!
  const position = segment.orientation === 'horizontal' ? handle.y : handle.x

  if (segments.length === 1) {
    const perpendicular = opposite(segment.orientation)
    const startPosition = endpointPosition(segment.orientation, start)
    const terminalPosition = clampTerminalPosition(
      position,
      startPosition,
      endpointPosition(segment.orientation, end) - startPosition,
    )
    return {
      version: MANUAL_ELBOW_ROUTE_VERSION,
      segments: [
        { id: id(0), orientation: perpendicular, position: endpointPosition(perpendicular, start) },
        { ...segment, position: terminalPosition },
        { id: id(2), orientation: perpendicular, position: endpointPosition(perpendicular, end) },
      ],
    }
  }
  segment.position = position
  if (index === 0) {
    segment.position = clampTerminalPosition(
      segment.position,
      endpointPosition(segment.orientation, start),
      endpointPosition(segment.orientation, end) - endpointPosition(segment.orientation, start),
    )
    segments.unshift({
      id: id(-1),
      orientation: opposite(segment.orientation),
      position: endpointPosition(opposite(segment.orientation), start),
    })
  } else if (index === segments.length - 1) {
    segment.position = clampTerminalPosition(
      segment.position,
      endpointPosition(segment.orientation, end),
      endpointPosition(segment.orientation, start) - endpointPosition(segment.orientation, end),
    )
    segments.push({
      id: id(segments.length),
      orientation: opposite(segment.orientation),
      position: endpointPosition(opposite(segment.orientation), end),
    })
  }
  return ensureMinimumTerminalLegs({ version: MANUAL_ELBOW_ROUTE_VERSION, segments }, start, end)
}

export function normalizeManualElbowRoute(
  route: ManualElbowRouteV1,
  start: VecLike,
  end: VecLike,
  id: ManualElbowSegmentIdFactory = () => createManualElbowSegmentId(),
): ManualElbowRouteV1 | undefined {
  const resolved = resolveManualElbowRoute(route, start, end, id)
  const points = simplifyOrthogonalPoints(resolved.points)
  const used = new Set<string>()
  return createManualElbowRoute(points, (index) => {
    const pointStart = points[index]!
    const pointEnd = points[index + 1]!
    const orientation = segmentOrientation(pointStart, pointEnd)
    const position = orientation ? segmentPosition(orientation, pointStart, pointEnd) : 0
    const match = route.segments.find((segment) =>
      !used.has(segment.id)
      && segment.orientation === orientation
      && Math.abs(segment.position - position) <= EPSILON)
    if (match) {
      used.add(match.id)
      return match.id
    }
    return id(index)
  })
}

export function manualSegmentHandleId(segmentId: string): string {
  return `manual-elbow-segment:${segmentId}`
}

export function segmentIdFromHandleId(handleId: string): string | undefined {
  const prefix = 'manual-elbow-segment:'
  return handleId.startsWith(prefix) ? handleId.slice(prefix.length) || undefined : undefined
}
