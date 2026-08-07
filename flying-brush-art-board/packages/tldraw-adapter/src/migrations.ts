/** The tldraw release whose serialized schema this adapter accepts. */
export const TLDRAW_SCHEMA_VERSION = '5.2.5' as const

const VALID_GEO_TYPES = new Set([
  'cloud', 'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon',
  'hexagon', 'octagon', 'star', 'rhombus', 'rhombus-2', 'oval', 'trapezoid',
  'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'x-box', 'check-box',
  'heart',
])

const LEGACY_GEO_ALIASES: Record<string, string> = {
  circle: 'ellipse',
  pill: 'oval',
  rounded: 'rectangle',
}

const visualCardProps = {
  w: 280,
  h: 140,
  geo: 'rectangle',
  color: 'blue',
  fill: 'solid',
  dash: 'draw',
  growY: 0,
  url: '',
  scale: 1,
  size: 'm',
  font: 'draw',
  align: 'middle',
  verticalAlign: 'middle',
  labelColor: 'black',
  richText: { type: 'doc', content: [] },
}

/**
 * A .tldr file has no project-level reference table. Therefore a serialized
 * board reference can only be safely imported as a non-navigable visual card.
 */
export function degradeBoardReferenceToVisualCard(record: Record<string, unknown>) {
  const props = (record.props ?? {}) as Record<string, unknown>
  const label =
    typeof props.label === 'string'
      ? props.label
      : typeof props.titleFallback === 'string'
        ? props.titleFallback
        : 'Linked board'
  const url = typeof props.url === 'string' ? props.url : ''
  const text = url ? `${label}\n${url}` : label

  return {
    id: record.id,
    typeName: 'shape',
    type: 'geo',
    meta: {},
    parentId: record.parentId,
    index: record.index,
    x: typeof record.x === 'number' ? record.x : 0,
    y: typeof record.y === 'number' ? record.y : 0,
    rotation: typeof record.rotation === 'number' ? record.rotation : 0,
    isLocked: record.isLocked === true,
    opacity: typeof record.opacity === 'number' ? record.opacity : 1,
    props: {
      ...visualCardProps,
      url,
      richText: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    },
  }
}

export function migrateTldrawRecords(records: unknown[]): unknown[] {
  return records.map((record) => {
    if (
      record &&
      typeof record === 'object' &&
      (record as { type?: unknown }).type === 'board-reference'
    ) {
      return degradeBoardReferenceToVisualCard(record as Record<string, unknown>)
    }
    return upgradeLegacyInteropShapeRecord(record).record
  })
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function legacyTableProps(record: Record<string, unknown>, element: Record<string, unknown>) {
  const cells = Array.isArray(element.cells)
    ? element.cells.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [])
    : [['']]
  const rows = Math.max(1, cells.length)
  const columns = Math.max(1, ...cells.map((row) => row.length))
  let counter = 0
  const props = createTableProps(rows, columns, (prefix) => `${prefix}-legacy-${counter++}`)
  const oldProps = objectValue(record.props)
  return normalizeTableProps({
    ...props,
    w: typeof oldProps.w === 'number' ? oldProps.w : props.w,
    h: typeof oldProps.h === 'number' ? oldProps.h : props.h,
    rows: props.rows.map((row, rowIndex) => ({
      ...row,
      cells: row.cells.map((cell, columnIndex) => ({ ...cell, text: cells[rowIndex]?.[columnIndex] ?? '' })),
    })),
  }, (prefix) => `${prefix}-legacy-${counter++}`)
}

function legacyMindMapChildren(value: unknown, parentId: string, nodes: MindMapNode[], path: number[]) {
  if (!Array.isArray(value)) return
  value.forEach((candidate, index) => {
    const item = objectValue(candidate)
    if (typeof item.text !== 'string') return
    const id = typeof item.id === 'string' && item.id ? item.id : `${parentId}:legacy:${[...path, index].join('.')}`
    const side = item.side === 'left' ? 'left' as const : 'right' as const
    nodes.push({ id, parentId, text: item.text, order: index, side, collapsed: false })
    legacyMindMapChildren(item.children, id, nodes, [...path, index])
  })
}

function legacyMindMapProps(record: Record<string, unknown>, element: Record<string, unknown>) {
  const source = objectValue(element.sourcePayload)
  const rootId = `${String(record.id)}:root`
  const nodes: MindMapNode[] = [{
    id: rootId,
    parentId: null,
    text: typeof element.text === 'string' ? element.text : '中心主题',
    order: 0,
    side: 'right',
    collapsed: false,
  }]
  legacyMindMapChildren(Array.isArray(element.children) ? element.children : source.children, rootId, nodes, [])
  return withMindMapBounds({
    w: 1,
    h: 1,
    layout: element.layout === 'bilateral' ? 'bilateral' : 'right',
    nodes,
  })
}

export function upgradeLegacyInteropShapeRecord(record: unknown): { record: unknown; upgraded: boolean } {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { record, upgraded: false }
  const value = record as Record<string, unknown>
  if (value.typeName !== 'shape' || value.type !== 'geo') return { record, upgraded: false }
  const element = objectValue(objectValue(value.meta).interopElement)
  if (element.type === 'table') {
    return { record: { ...value, type: 'table', props: legacyTableProps(value, element) }, upgraded: true }
  }
  if (element.type === 'mind-map') {
    return { record: { ...value, type: 'mind-map', props: legacyMindMapProps(value, element) }, upgraded: true }
  }
  const props = objectValue(value.props)
  if (typeof props.geo === 'string' && !VALID_GEO_TYPES.has(props.geo)) {
    return {
      record: {
        ...value,
        props: { ...props, geo: LEGACY_GEO_ALIASES[props.geo] ?? 'rectangle' },
      },
      upgraded: true,
    }
  }
  return { record, upgraded: false }
}
import { createTableProps, normalizeTableProps } from './shapes/table/operations.js'
import { withMindMapBounds } from './shapes/mind-map/operations.js'
import type { MindMapNode } from './shapes/mind-map/schema.js'
