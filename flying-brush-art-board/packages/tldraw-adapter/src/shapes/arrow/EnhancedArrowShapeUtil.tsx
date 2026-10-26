/* eslint-disable react-hooks/rules-of-hooks */
import { Fragment, type ReactElement } from 'react'
import {
  ArrowShapeUtil,
  Group2d,
  PathBuilder,
  Polyline2d,
  Rectangle2d,
  RichTextLabel,
  RichTextSVG,
  SVGContainer,
  Vec,
  getArrowInfo,
  getDisplayValues,
  useValue,
  type Box,
  type Editor,
  type JsonObject,
  type SvgExportContext,
  type TLArrowShape,
  type TLHandle,
  type TLHandleDragInfo,
  type TLShapePartial,
  type VecLike,
} from 'tldraw'

import {
  MANUAL_ELBOW_ROUTE_META_KEY,
  createManualElbowRoute,
  dragManualElbowSegment,
  ensureMinimumTerminalLegs,
  manualSegmentHandleId,
  normalizeManualElbowRoute,
  readManualElbowRoute,
  resolveManualElbowRoute,
  segmentIdFromHandleId,
  simplifyOrthogonalPoints,
  withManualElbowRoute,
  withoutManualElbowRoute,
  type ManualElbowRouteV1,
  type ResolvedManualElbowRoute,
} from './manual-elbow-route.js'
import { getNearestConnectionAnchor, sameConnectionAnchor } from './connection-anchors.js'

interface ArrowDisplayValues {
  strokeColor: string
  strokeWidth: number
  fillColor: string
  patternFillFallbackColor: string
  labelColor: string
  labelFontFamily: string
  labelFontSize: number
  labelLineHeight: number
  labelPadding: number
  labelBorderRadius: number
}

const EPSILON = 0.01

function snapTerminalBindingToNearestConnectionAnchor(
  editor: Editor,
  arrow: TLArrowShape,
  terminal: 'start' | 'end',
  draggedHandle: VecLike,
  pointerPagePoint?: VecLike,
): void {
  const arrowTransform = editor.getShapePageTransform(arrow.id)
  if (!arrowTransform) return

  const binding = editor
    .getBindingsFromShape(arrow.id, 'arrow')
    .find((candidate) => candidate.props.terminal === terminal)
  if (!binding) return

  const targetShape = editor.getShape(binding.toId)
  if (!targetShape) return
  const targetTransform = editor.getShapePageTransform(targetShape)
  if (!targetTransform) return

  const targetBounds = editor.getShapeGeometry(targetShape).bounds
  const draggedPagePoint = pointerPagePoint ?? arrowTransform.applyToPoint(draggedHandle)
  const draggedTargetPoint = editor.getPointInShapeSpace(targetShape, draggedPagePoint)
  const normalizedAnchor = getNearestConnectionAnchor(
    targetBounds,
    draggedTargetPoint,
    binding.props.normalizedAnchor,
  )

  if (
    sameConnectionAnchor(normalizedAnchor, binding.props.normalizedAnchor)
    && binding.props.isPrecise === true
    && binding.props.isExact === false
    && binding.props.snap === 'edge-point'
  ) return

  editor.updateBinding({
    ...binding,
    props: {
      ...binding.props,
      normalizedAnchor,
      isPrecise: true,
      isExact: false,
      snap: 'edge-point',
    },
  })
}

function isNonEmptyRichText(shape: TLArrowShape): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit)
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.trim().length > 0) return true
    return visit(record.content)
  }
  return visit(shape.props.richText)
}

function pointAtDistanceRatio(points: readonly VecLike[], ratio: number): VecLike {
  const lengths: number[] = []
  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const length = Vec.Dist(points[index]!, points[index + 1]!)
    lengths.push(length)
    total += length
  }
  if (total <= EPSILON) return points[0] ?? { x: 0, y: 0 }
  let remaining = Math.max(0, Math.min(1, ratio)) * total
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!
    if (remaining <= length || index === lengths.length - 1) {
      const start = points[index]!
      const end = points[index + 1]!
      const t = length <= EPSILON ? 0 : remaining / length
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
    }
    remaining -= length
  }
  return points[points.length - 1]!
}

function routePath(points: readonly VecLike[]): PathBuilder {
  const path = new PathBuilder()
  const first = points[0] ?? { x: 0, y: 0 }
  path.moveTo(first.x, first.y, { offset: 0 })
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    path.lineTo(point.x, point.y, index === points.length - 1 ? { offset: 0 } : undefined)
  }
  return path
}

function arrowheadPath(
  type: TLArrowShape['props']['arrowheadStart'],
  point: VecLike,
  adjacent: VecLike,
  strokeWidth: number,
): string | undefined {
  if (type === 'none') return undefined
  const segmentLength = Vec.Dist(point, adjacent)
  if (segmentLength <= EPSILON) return undefined
  const length = Math.max(strokeWidth, Math.min(strokeWidth * 3, segmentLength / 2))
  const dx = (adjacent.x - point.x) / segmentLength
  const dy = (adjacent.y - point.y) / segmentLength
  const interior = { x: point.x + dx * length, y: point.y + dy * length }
  const rotate = (source: VecLike, radians: number): VecLike => {
    const x = source.x - point.x
    const y = source.y - point.y
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return { x: point.x + x * cos - y * sin, y: point.y + x * sin + y * cos }
  }
  const left30 = rotate(interior, Math.PI / 6)
  const right30 = rotate(interior, -Math.PI / 6)
  const half = { x: (interior.x - point.x) / 2, y: (interior.y - point.y) / 2 }
  const perpendicular = { x: -half.y, y: half.x }

  switch (type) {
    case 'arrow':
      return `M ${left30.x} ${left30.y} L ${point.x} ${point.y} L ${right30.x} ${right30.y}`
    case 'triangle':
      return `M ${left30.x} ${left30.y} L ${right30.x} ${right30.y} L ${point.x} ${point.y} Z`
    case 'inverted':
      return `M ${point.x + perpendicular.x} ${point.y + perpendicular.y} L ${interior.x} ${interior.y} L ${point.x - perpendicular.x} ${point.y - perpendicular.y} Z`
    case 'bar':
      return `M ${point.x + perpendicular.x} ${point.y + perpendicular.y} L ${point.x - perpendicular.x} ${point.y - perpendicular.y}`
    case 'dot': {
      const center = { x: point.x + (interior.x - point.x) * 0.45, y: point.y + (interior.y - point.y) * 0.45 }
      const radius = Vec.Dist(center, point)
      return `M ${center.x - radius} ${center.y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
    }
    case 'diamond': {
      const back = { x: point.x + (interior.x - point.x) * 1.5, y: point.y + (interior.y - point.y) * 1.5 }
      const left = rotate(interior, Math.PI / 4)
      const right = rotate(interior, -Math.PI / 4)
      return `M ${back.x} ${back.y} L ${right.x} ${right.y} L ${point.x} ${point.y} L ${left.x} ${left.y} Z`
    }
    case 'square': {
      const back = { x: point.x + (interior.x - point.x) * 0.85, y: point.y + (interior.y - point.y) * 0.85 }
      const halfBack = { x: (back.x - point.x) / 2, y: (back.y - point.y) / 2 }
      const side = { x: -halfBack.y, y: halfBack.x }
      return `M ${point.x + side.x} ${point.y + side.y} L ${back.x + side.x} ${back.y + side.y} L ${back.x - side.x} ${back.y - side.y} L ${point.x - side.x} ${point.y - side.y} Z`
    }
  }
}

function isClosedArrowhead(type: TLArrowShape['props']['arrowheadStart']): boolean {
  return type !== 'none' && type !== 'arrow' && type !== 'bar'
}

function ManualArrowSvg({
  shape,
  route,
  displayValues,
}: {
  shape: TLArrowShape
  route: ResolvedManualElbowRoute
  displayValues: ArrowDisplayValues
}) {
  const strokeWidth = displayValues.strokeWidth * shape.props.scale
  const body = routePath(route.points).toSvg({
    style: shape.props.dash,
    strokeWidth,
    randomSeed: shape.id,
    props: { fill: 'none', stroke: displayValues.strokeColor, strokeLinecap: 'round', strokeLinejoin: 'round' },
  })
  const startPath = arrowheadPath(
    shape.props.arrowheadStart,
    route.points[0]!,
    route.points[1]!,
    strokeWidth,
  )
  const endPath = arrowheadPath(
    shape.props.arrowheadEnd,
    route.points[route.points.length - 1]!,
    route.points[route.points.length - 2]!,
    strokeWidth,
  )
  const head = (path: string | undefined, type: TLArrowShape['props']['arrowheadStart']) => path ? (
    <path
      d={path}
      fill={isClosedArrowhead(type) && shape.props.fill !== 'none' ? displayValues.fillColor : 'none'}
      stroke={displayValues.strokeColor}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ) : null

  return <g pointerEvents="none">{body}{head(startPath, shape.props.arrowheadStart)}{head(endPath, shape.props.arrowheadEnd)}</g>
}

export class EnhancedArrowShapeUtil extends ArrowShapeUtil {
  constructor(editor: Editor) {
    super(editor)
    this.options = {
      ...this.options,
      expandElbowLegLength: {
        s: 19.6,
        m: 25.2,
        l: 30.8,
        xl: 46.2,
      },
      minElbowLegLength: {
        s: 19.6,
        m: 25.2,
        l: 30.8,
        xl: 46.2,
      },
    }
  }

  private getAutomaticRoute(shape: TLArrowShape): ResolvedManualElbowRoute | undefined {
    const info = getArrowInfo(this.editor, shape)
    if (shape.props.kind !== 'elbow' || info?.type !== 'elbow' || !info.isValid) return undefined
    const points = simplifyOrthogonalPoints(info.route.points)
    const route = createManualElbowRoute(points, (index) => `auto-${index}`)
    if (!route) return undefined
    const constrained = ensureMinimumTerminalLegs(route, info.start.point, info.end.point)
    return resolveManualElbowRoute(constrained, info.start.point, info.end.point, (index) => `auto-${index}`)
  }

  private getManualRoute(shape: TLArrowShape): ResolvedManualElbowRoute | undefined {
    const route = readManualElbowRoute(shape.meta)
    if (!route || shape.props.kind !== 'elbow') return undefined
    const info = getArrowInfo(this.editor, shape)
    if (info?.type !== 'elbow' || !info.isValid) return undefined
    const constrained = ensureMinimumTerminalLegs(route, info.start.point, info.end.point)
    return resolveManualElbowRoute(constrained, info.start.point, info.end.point)
  }

  private getLabelBox(shape: TLArrowShape, route: ResolvedManualElbowRoute): Box | undefined {
    const nativeGeometry = super.getGeometry(shape)
    if (!(nativeGeometry instanceof Group2d) || nativeGeometry.children.length < 2) return undefined
    const bounds = nativeGeometry.children[1]!.bounds
    const center = pointAtDistanceRatio(route.points, shape.props.labelPosition)
    return bounds.clone().translate({ x: center.x - bounds.center.x, y: center.y - bounds.center.y })
  }

  override getGeometry(shape: TLArrowShape) {
    const route = this.getManualRoute(shape) ?? this.getAutomaticRoute(shape)
    if (!route) return super.getGeometry(shape)
    const body = new Polyline2d({ points: route.points.map((point) => Vec.From(point)) })
    const shouldShowLabel = this.editor.getEditingShapeId() === shape.id || isNonEmptyRichText(shape)
    const box = shouldShowLabel ? this.getLabelBox(shape, route) : undefined
    const label = box ? new Rectangle2d({ x: box.x, y: box.y, width: box.w, height: box.h, isFilled: true, isLabel: true }) : undefined
    return new Group2d({ children: label ? [body, label] : [body] })
  }

  override getHandles(shape: TLArrowShape): TLHandle[] {
    const native = super.getHandles(shape)
    if (
      shape.props.kind !== 'elbow'
      || shape.isLocked
      || this.editor.getIsReadonly()
      || this.editor.getOnlySelectedShapeId() !== shape.id
    ) return native
    const route = this.getManualRoute(shape) ?? this.getAutomaticRoute(shape)
    if (!route) return native
    const terminalHandles = native.filter((handle) => handle.id === 'start' || handle.id === 'end')
    const segmentHandles = route.segments
      .filter((segment) => Vec.Dist(segment.start, segment.end) > EPSILON)
      .map((segment, index): TLHandle => ({
        id: manualSegmentHandleId(segment.id),
        type: 'vertex',
        index: `a2${index.toString().padStart(3, '0')}` as TLHandle['index'],
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
      }))
    return [...terminalHandles, ...segmentHandles]
  }

  override onHandleDrag(shape: TLArrowShape, info: TLHandleDragInfo<TLArrowShape>) {
    const segmentId = segmentIdFromHandleId(info.handle.id)
    if (!segmentId) {
      const change = super.onHandleDrag(shape, info)
      if (info.handle.id === 'start' || info.handle.id === 'end') {
        const currentArrow = this.editor.getShape<TLArrowShape>(shape.id) ?? shape
        snapTerminalBindingToNearestConnectionAnchor(
          this.editor,
          currentArrow,
          info.handle.id,
          info.handle,
          info.isCreatingShape ? undefined : this.editor.inputs.currentPagePoint,
        )
      }
      return change
    }
    if (shape.props.kind !== 'elbow' || shape.isLocked || this.editor.getIsReadonly()) return
    const current = this.getManualRoute(shape) ?? this.getAutomaticRoute(shape)
    if (!current) return
    const next = dragManualElbowSegment(
      current.route,
      segmentId,
      info.handle,
      current.points[0]!,
      current.points[current.points.length - 1]!,
    )
    return { id: shape.id, type: shape.type, meta: withManualElbowRoute(shape.meta, next) }
  }

  override onHandleDragEnd(shape: TLArrowShape, info: TLHandleDragInfo<TLArrowShape>): TLShapePartial<TLArrowShape> | void {
    if (info.handle.id === 'start' || info.handle.id === 'end') {
      const currentArrow = this.editor.getShape<TLArrowShape>(shape.id) ?? shape
      snapTerminalBindingToNearestConnectionAnchor(
        this.editor,
        currentArrow,
        info.handle.id,
        info.handle,
        this.editor.inputs.currentPagePoint,
      )
      return
    }
    if (!segmentIdFromHandleId(info.handle.id)) return
    const current = this.getManualRoute(shape)
    if (!current) return
    const normalized = normalizeManualElbowRoute(
      current.route,
      current.points[0]!,
      current.points[current.points.length - 1]!,
    )
    return {
      id: shape.id,
      type: shape.type,
      meta: normalized ? withManualElbowRoute(shape.meta, normalized) : withoutManualElbowRoute(shape.meta),
    }
  }

  override onBeforeUpdate(previous: TLArrowShape, next: TLArrowShape): TLArrowShape | void {
    if (
      previous.props.kind === 'elbow'
      && next.props.kind !== 'elbow'
      && MANUAL_ELBOW_ROUTE_META_KEY in next.meta
    ) {
      return { ...next, meta: withoutManualElbowRoute(next.meta) }
    }
  }

  override component(shape: TLArrowShape): ReactElement | null {
    const route = this.getManualRoute(shape) ?? this.getAutomaticRoute(shape)
    if (!route) return super.component(shape)
    const displayValues = getDisplayValues(this, shape) as ArrowDisplayValues
    const geometry = this.editor.getShapeGeometry(shape)
    const labelBox = geometry instanceof Group2d && geometry.children.length > 1
      ? geometry.children[1]!.bounds
      : undefined
    const isSelected = useValue('manual arrow selected', () => this.editor.getOnlySelectedShapeId() === shape.id, [this.editor, shape.id])
    const isEditing = useValue('manual arrow editing', () => this.editor.getEditingShapeId() === shape.id, [this.editor, shape.id])
    const showLabel = Boolean(labelBox) && (isEditing || isNonEmptyRichText(shape))
    return (
      <Fragment>
        <SVGContainer style={{ minWidth: 50, minHeight: 50 }}>
          <ManualArrowSvg shape={shape} route={route} displayValues={displayValues} />
        </SVGContainer>
        {showLabel && labelBox ? (
          <RichTextLabel
            shapeId={shape.id}
            type="arrow"
            fontFamily={displayValues.labelFontFamily}
            fontSize={displayValues.labelFontSize}
            lineHeight={displayValues.labelLineHeight}
            textAlign="center"
            verticalAlign="middle"
            labelColor={displayValues.labelColor}
            richText={shape.props.richText}
            textWidth={(labelBox.w - displayValues.labelPadding * 2 * shape.props.scale) / shape.props.scale}
            isSelected={isSelected}
            padding={0}
            showTextOutline={this.options.showTextOutline}
            style={{ transform: `translate(${labelBox.center.x}px, ${labelBox.center.y}px)${shape.props.scale !== 1 ? ` scale(${shape.props.scale})` : ''}` }}
          />
        ) : null}
      </Fragment>
    )
  }

  override getIndicatorPath(shape: TLArrowShape) {
    const route = this.getManualRoute(shape) ?? this.getAutomaticRoute(shape)
    if (!route) return super.getIndicatorPath(shape)
    return routePath(route.points).toPath2D({ style: 'solid', strokeWidth: 1 })
  }

  override toSvg(shape: TLArrowShape, context: SvgExportContext): ReactElement {
    const route = this.getManualRoute(shape) ?? this.getAutomaticRoute(shape)
    if (!route) return super.toSvg(shape, context)
    const displayValues = getDisplayValues(this, shape, context.colorMode) as ArrowDisplayValues
    const labelBox = this.getLabelBox(shape, route)
    const scaleFactor = 1 / shape.props.scale
    return (
      <g transform={`scale(${scaleFactor})`}>
        <ManualArrowSvg shape={shape} route={route} displayValues={displayValues} />
        {labelBox && isNonEmptyRichText(shape) ? (
          <RichTextSVG
            fontSize={displayValues.labelFontSize * shape.props.scale}
            fontFamily={displayValues.labelFontFamily}
            lineHeight={displayValues.labelLineHeight}
            textAlign="center"
            verticalAlign="middle"
            labelColor={displayValues.labelColor}
            richText={shape.props.richText}
            bounds={labelBox.clone().expandBy(-displayValues.labelPadding * shape.props.scale)}
            padding={0}
            showTextOutline={this.options.showTextOutline}
          />
        ) : null}
      </g>
    )
  }
}

export const enhancedArrowShapeUtils = [EnhancedArrowShapeUtil] as const

export function clearManualElbowRouteMeta(meta: JsonObject): JsonObject {
  return withoutManualElbowRoute(meta)
}
