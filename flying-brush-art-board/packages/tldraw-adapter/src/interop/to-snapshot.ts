import {
  getIndices,
  toRichText,
  type TLEditorSnapshot,
} from 'tldraw'
import { b64Vecs } from '@tldraw/tlschema'

import type {
  ConnectorElement,
  InteropElement,
  InteropScene,
  MindMapBranch,
  MindMapElement,
  TableElement,
} from '@infinite-board/interop/scene/schema'

import { degradeBoardReferenceToVisualCard } from '../migrations.js'
import { createBoardReferenceShape } from '../board-reference-snapshot-operations.js'
import { createBoardStore } from '../store.js'
import { getStoreSnapshot } from '../snapshot.js'
import { createTableProps, normalizeTableProps } from '../shapes/table/operations.js'
import { withMindMapBounds } from '../shapes/mind-map/operations.js'
import type { MindMapNode, MindMapShapeProps } from '../shapes/mind-map/schema.js'

export interface InteropSceneToSnapshotContext {
  referencePolicy: 'preserve' | 'degrade'
  canResolveBoardReference?: (
    reference: Extract<InteropElement, { type: 'board-reference' }>,
  ) => boolean
  pageId?: string
}

const GEO_TYPES = new Set([
  'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon',
  'octagon', 'star', 'rhombus', 'oval', 'trapezoid', 'cloud', 'x-box',
  'check-box', 'heart', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-right',
])

function shapeId(id: string): string {
  return id.startsWith('shape:') ? id : `shape:interop-${encodeURIComponent(id)}`
}

function assetId(id: string): string {
  return `asset:interop-${encodeURIComponent(id)}`
}

function bindingId(id: string, terminal: 'start' | 'end'): string {
  return `binding:interop-${encodeURIComponent(id)}-${terminal}`
}

function marker(element: InteropElement): Record<string, unknown> {
  return { interopElement: structuredClone(element) }
}

function commonRecord(
  element: InteropElement,
  parentId: string,
): Record<string, unknown> {
  return {
    id: shapeId(element.id),
    typeName: 'shape',
    parentId,
    index: element.zIndex,
    x: element.geometry.x,
    y: element.geometry.y,
    rotation: element.geometry.rotation ?? 0,
    isLocked: false,
    opacity: 1,
    meta: marker(element),
  }
}

function geoProps(element: InteropElement, text = '', geo = 'rectangle') {
  return {
    w: Math.max(1, element.geometry.width),
    h: Math.max(1, element.geometry.height),
    geo: GEO_TYPES.has(geo) ? geo : 'rectangle',
    dash: 'draw',
    growY: 0,
    url: '',
    scale: 1,
    color: 'black',
    labelColor: 'black',
    fill: 'none',
    size: 'm',
    font: 'draw',
    align: 'middle',
    verticalAlign: 'middle',
    richText: toRichText(text),
  }
}

function connectorPoint(
  endpoint: ConnectorElement['start'],
  element: ConnectorElement,
  fallback: { x: number; y: number },
) {
  if (endpoint.x !== undefined && endpoint.y !== undefined) {
    return {
      x: endpoint.x - element.geometry.x,
      y: endpoint.y - element.geometry.y,
    }
  }
  return fallback
}

function tableProps(element: TableElement) {
  const rowCount = Math.max(1, element.cells.length)
  const columnCount = Math.max(1, ...element.cells.map((row) => row.length))
  let counter = 0
  const props = createTableProps(rowCount, columnCount, (prefix) => `${prefix}-${encodeURIComponent(element.id)}-${counter++}`)
  return normalizeTableProps({
    ...props,
    w: Math.max(1, element.geometry.width),
    h: Math.max(1, element.geometry.height),
    rows: props.rows.map((row, rowIndex) => ({
      ...row,
      cells: row.cells.map((cell, columnIndex) => ({
        ...cell,
        text: element.cells[rowIndex]?.[columnIndex] ?? '',
      })),
    })),
  })
}

function flattenMindMapBranch(
  branch: MindMapBranch,
  parentId: string,
  side: 'left' | 'right',
  order: number,
  result: MindMapNode[],
) {
  const branchSide = branch.side ?? side
  result.push({
    id: branch.id,
    parentId,
    text: branch.text,
    order,
    side: branchSide,
    collapsed: branch.collapsed ?? false,
    ...(branch.shape ? { shape: branch.shape } : {}),
    ...(branch.style ? { style: structuredClone(branch.style) } : {}),
  })
  branch.children.forEach((child, index) => flattenMindMapBranch(child, branch.id, branchSide, index, result))
}

function mindMapProps(element: MindMapElement): MindMapShapeProps {
  const rootId = `${element.id}:root`
  const nodes: MindMapNode[] = [{
    id: rootId,
    parentId: null,
    text: element.text,
    order: 0,
    side: 'right',
    collapsed: false,
    ...(element.rootShape ? { shape: element.rootShape } : {}),
    ...(element.rootStyle ? { style: structuredClone(element.rootStyle) } : {}),
  }]
  ;(element.children ?? []).forEach((child, index) => {
    const side = child.side ?? (element.layout === 'bilateral' && index % 2 === 1 ? 'left' : 'right')
    flattenMindMapBranch(child, rootId, side, index, nodes)
  })
  return withMindMapBounds({
    w: Math.max(1, element.geometry.width),
    h: Math.max(1, element.geometry.height),
    layout: element.layout ?? 'right',
    nodes,
    ...(element.theme ? { theme: element.theme } : {}),
  })
}

function visualRecord(element: InteropElement, parentId: string): Record<string, unknown> {
  const common = commonRecord(element, parentId)
  switch (element.type) {
    case 'shape':
      return { ...common, type: 'geo', props: geoProps(element, element.text ?? '', element.shape) }
    case 'text':
      return {
        ...common,
        type: 'text',
        props: {
          color: 'black', size: 'm', w: Math.max(8, element.geometry.width), font: 'draw',
          textAlign: 'start', autoSize: false, scale: 1, richText: toRichText(element.text),
        },
      }
    case 'sticky':
      return {
        ...common,
        type: 'note',
        props: {
          color: 'black', richText: toRichText(element.text), size: 'm', font: 'draw',
          align: 'middle', verticalAlign: 'middle', labelColor: 'black', growY: 0,
          fontSizeAdjustment: 1, url: '', scale: 1, textLastEditedBy: null,
        },
      }
    case 'connector':
      return {
        ...common,
        type: 'arrow',
        props: {
          kind: 'arc', elbowMidPoint: 0.5, dash: 'draw', size: 'm', fill: 'none',
          color: 'black', labelColor: 'black', bend: 0,
          start: connectorPoint(element.start, element, { x: 0, y: 0 }),
          end: connectorPoint(element.end, element, {
            x: Math.max(2, element.geometry.width), y: element.geometry.height,
          }),
          arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: toRichText(element.text ?? ''),
          labelPosition: 0.5, font: 'draw', scale: 1,
        },
      }
    case 'section':
      return {
        ...common,
        type: 'frame',
        props: {
          w: Math.max(1, element.geometry.width), h: Math.max(1, element.geometry.height),
          name: element.title, color: 'black',
        },
      }
    case 'paint':
      return {
        ...common,
        type: 'draw',
        props: {
          segments: [{
            type: 'free',
            path: b64Vecs.encodePoints(element.points.map((point) => ({
              x: point.x, y: point.y, z: point.pressure ?? 0.5,
            }))),
          }],
          color: 'black', fill: 'none', dash: 'draw', size: 'm', isComplete: true,
          isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1,
        },
      }
    case 'table':
      return { ...common, type: 'table', props: tableProps(element) }
    case 'mind-map':
      return { ...common, type: 'mind-map', props: mindMapProps(element) }
    case 'unsupported':
      return { ...common, type: 'geo', props: geoProps(element, `Unsupported: ${element.sourceType}`) }
    case 'image':
    case 'svg':
      return {
        ...common,
        type: 'image',
        props: {
          w: Math.max(1, element.geometry.width), h: Math.max(1, element.geometry.height),
          assetId: assetId(element.id), playing: true, url: '', crop: null,
          flipX: false, flipY: false, altText: '',
        },
      }
    case 'board-reference':
      throw new Error('Board references are materialized separately')
  }
}

function assetRecord(element: Extract<InteropElement, { type: 'image' | 'svg' }>) {
  const src = element.type === 'image'
    ? element.src
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(element.svg)}`
  return {
    id: assetId(element.id),
    typeName: 'asset',
    type: 'image',
    props: {
      w: Math.max(1, element.geometry.width),
      h: Math.max(1, element.geometry.height),
      name: element.type === 'image' ? (element.name ?? '') : `${element.id}.svg`,
      isAnimated: false,
      mimeType: element.type === 'image' ? element.mimeType : 'image/svg+xml',
      src,
    },
    meta: {},
  }
}

function connectorBindings(element: ConnectorElement): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (const terminal of ['start', 'end'] as const) {
    const endpoint = element[terminal]
    if (!endpoint.elementId) continue
    result.push({
      id: bindingId(element.id, terminal),
      typeName: 'binding',
      type: 'arrow',
      fromId: shapeId(element.id),
      toId: shapeId(endpoint.elementId),
      props: {
        terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false,
        isPrecise: false, snap: 'none',
      },
      meta: {},
    })
  }
  return result
}

export function interopSceneToSnapshot(
  scene: InteropScene,
  context: InteropSceneToSnapshotContext,
): TLEditorSnapshot {
  const boardStore = createBoardStore()
  const baseSnapshot = getStoreSnapshot(boardStore)
  const baseRecords = Object.values(baseSnapshot.store).filter((record) => record.typeName === 'document')
  const pageId = context.pageId ?? 'page:interop'
  const indices = getIndices(scene.elements.length)
  const store: Record<string, unknown> = Object.fromEntries(baseRecords.map((record) => [record.id, record]))
  store[pageId] = { id: pageId, typeName: 'page', name: '导入画板', index: 'a1', meta: {} }

  for (const [elementIndex, element] of scene.elements.entries()) {
    const recordIndex = indices[elementIndex]!
    const parentId = element.parentElementId ? shapeId(element.parentElementId) : pageId
    if (element.type === 'board-reference') {
      const referenceShape = createBoardReferenceShape({
        id: element.referenceId,
        projectId: '',
        sourceBoardId: '',
        targetBoardId: element.targetBoardId,
        shapeId: shapeId(element.id),
        kind: element.kind,
        createdAt: '',
        updatedAt: '',
      }, element.titleFallback, {
        parentId,
        index: recordIndex,
        x: element.geometry.x,
        y: element.geometry.y,
        w: element.geometry.width,
        h: element.geometry.height,
      }) as unknown as Record<string, unknown>
      referenceShape.meta = marker(element)
      const canPreserve = context.referencePolicy === 'preserve'
        && (context.canResolveBoardReference?.(element) ?? true)
      const record = canPreserve
        ? referenceShape
        : degradeBoardReferenceToVisualCard(referenceShape)
      store[record.id as string] = record
      continue
    }

    const record = visualRecord(element, parentId)
    record.index = recordIndex
    store[record.id as string] = record
    if (element.type === 'image' || element.type === 'svg') {
      const asset = assetRecord(element)
      store[asset.id] = asset
    }
    if (element.type === 'connector') {
      for (const binding of connectorBindings(element)) store[binding.id as string] = binding
    }
  }

  return {
    document: { store, schema: boardStore.schema.serialize() } as TLEditorSnapshot['document'],
    session: {} as TLEditorSnapshot['session'],
  }
}
