import type { TLEditorSnapshot } from 'tldraw'

import {
  createImportCompatibilityReport,
  type ImportCompatibilityIssue,
} from '@infinite-board/interop/scene/compatibility-report'
import {
  parseInteropScene,
  type ConnectorEndpoint,
  type InteropElement,
  type InteropGeometry,
  type InteropScene,
  type MindMapBranch,
  type MindMapNodeStyle,
} from '@infinite-board/interop/scene/schema'

interface SnapshotEnvelope {
  store?: Record<string, unknown>
  document?: { store?: Record<string, unknown> }
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid tldraw snapshot')
  const envelope = snapshot as SnapshotEnvelope
  const store = envelope.document?.store ?? envelope.store
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw new Error('Invalid tldraw snapshot store')
  return store
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textFromRichText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text
  }
  if ('content' in value && Array.isArray((value as { content?: unknown }).content)) {
    return ((value as { content: unknown[] }).content).map(textFromRichText).join('')
  }
  return ''
}

function geometry(record: Record<string, unknown>): InteropGeometry {
  const props = objectValue(record.props)
  return {
    x: typeof record.x === 'number' ? record.x : 0,
    y: typeof record.y === 'number' ? record.y : 0,
    width: typeof props.w === 'number' ? props.w : 200,
    height: typeof props.h === 'number' ? props.h : 200,
    rotation: typeof record.rotation === 'number' ? record.rotation : 0,
  }
}

function base(record: Record<string, unknown>) {
  const parentId = typeof record.parentId === 'string' && record.parentId.startsWith('shape:')
    ? record.parentId
    : undefined
  const meta = objectValue(record.meta)
  return {
    id: String(record.id),
    geometry: geometry(record),
    ...(parentId ? { parentElementId: parentId } : {}),
    zIndex: typeof record.index === 'string' ? record.index : 'a1',
    style: structuredClone(objectValue(record.props)),
    ...('sourcePayload' in meta ? { sourcePayload: structuredClone(meta.sourcePayload) } : {}),
  }
}

function endpointFor(
  shapeId: string,
  terminal: 'start' | 'end',
  props: Record<string, unknown>,
  bindings: readonly Record<string, unknown>[],
): ConnectorEndpoint {
  const binding = bindings.find((candidate) =>
    candidate.typeName === 'binding'
      && candidate.type === 'arrow'
      && candidate.fromId === shapeId
      && objectValue(candidate.props).terminal === terminal,
  )
  if (binding && typeof binding.toId === 'string') return { elementId: binding.toId }
  const point = objectValue(props[terminal])
  return {
    x: typeof point.x === 'number' ? point.x : 0,
    y: typeof point.y === 'number' ? point.y : 0,
  }
}

function assetFor(record: Record<string, unknown>, store: Record<string, unknown>): Record<string, unknown> {
  const assetId = objectValue(record.props).assetId
  return typeof assetId === 'string' ? objectValue(store[assetId]) : {}
}

function tableCells(props: Record<string, unknown>): string[][] {
  if (!Array.isArray(props.rows)) return [['']]
  return props.rows.map((value) => {
    const row = objectValue(value)
    if (!Array.isArray(row.cells)) return []
    return row.cells.map((cell) => {
      const text = objectValue(cell).text
      return typeof text === 'string' ? text : ''
    })
  })
}

function mindMapNodeStyle(value: unknown): MindMapNodeStyle | undefined {
  const source = objectValue(value)
  return Object.keys(source).length ? structuredClone(source) as MindMapNodeStyle : undefined
}

function mindMapValue(props: Record<string, unknown>): {
  text: string
  children: MindMapBranch[]
  layout: 'right' | 'bilateral'
  rootShape?: 'rounded' | 'pill' | 'underline' | undefined
  rootStyle?: MindMapNodeStyle | undefined
  theme?: 'classic' | 'colorful' | 'minimal' | undefined
} {
  const nodes = Array.isArray(props.nodes) ? props.nodes.map(objectValue) : []
  const root = nodes.find((node) => node.parentId === null) ?? nodes[0]
  if (!root || typeof root.id !== 'string') return { text: '', children: [], layout: 'right' }
  const visit = (parentId: string, seen: Set<string>): MindMapBranch[] => nodes
    .filter((node) => node.parentId === parentId && typeof node.id === 'string' && !seen.has(node.id))
    .sort((left, right) => (typeof left.order === 'number' ? left.order : 0) - (typeof right.order === 'number' ? right.order : 0))
    .map((node) => {
      const id = node.id as string
      const nextSeen = new Set(seen).add(id)
      return {
        id,
        text: typeof node.text === 'string' ? node.text : '',
        ...(node.side === 'left' || node.side === 'right' ? { side: node.side } : {}),
        ...(typeof node.collapsed === 'boolean' ? { collapsed: node.collapsed } : {}),
        ...(node.shape === 'rounded' || node.shape === 'pill' || node.shape === 'underline' ? { shape: node.shape } : {}),
        ...(mindMapNodeStyle(node.style) ? { style: mindMapNodeStyle(node.style) } : {}),
        children: visit(id, nextSeen),
      }
    })
  return {
    text: typeof root.text === 'string' ? root.text : '',
    children: visit(root.id, new Set([root.id])),
    layout: props.layout === 'bilateral' ? 'bilateral' : 'right',
    ...(root.shape === 'rounded' || root.shape === 'pill' || root.shape === 'underline' ? { rootShape: root.shape } : {}),
    ...(mindMapNodeStyle(root.style) ? { rootStyle: mindMapNodeStyle(root.style) } : {}),
    ...(props.theme === 'classic' || props.theme === 'colorful' || props.theme === 'minimal' ? { theme: props.theme } : {}),
  }
}

function mappedElement(
  record: Record<string, unknown>,
  store: Record<string, unknown>,
  bindings: readonly Record<string, unknown>[],
): InteropElement | undefined {
  if (record.typeName !== 'shape' || typeof record.type !== 'string') return undefined
  const meta = objectValue(record.meta)
  const props = objectValue(record.props)
  const marked = meta.interopElement && typeof meta.interopElement === 'object'
    ? structuredClone(meta.interopElement) as InteropElement
    : undefined
  if (record.type === 'table') {
    const common = base(record)
    return {
      ...common,
      ...(marked?.type === 'table' ? {
        id: marked.id,
        ...(marked.parentElementId ? { parentElementId: marked.parentElementId } : {}),
        ...('sourcePayload' in marked ? { sourcePayload: structuredClone(marked.sourcePayload) } : {}),
      } : {}),
      type: 'table',
      cells: tableCells(props),
    }
  }
  if (record.type === 'mind-map') {
    const common = base(record)
    const value = mindMapValue(props)
    return {
      ...common,
      ...(marked?.type === 'mind-map' ? {
        id: marked.id,
        ...(marked.parentElementId ? { parentElementId: marked.parentElementId } : {}),
        ...('sourcePayload' in marked ? { sourcePayload: structuredClone(marked.sourcePayload) } : {}),
      } : {}),
      type: 'mind-map',
      ...value,
    }
  }
  if (meta.interopElement && typeof meta.interopElement === 'object') {
    if (
      marked?.type === 'board-reference'
      && typeof props.referenceId === 'string'
      && typeof props.targetBoardId === 'string'
      && (props.kind === 'embed' || props.kind === 'link')
    ) {
      return {
        ...marked,
        referenceId: props.referenceId,
        targetBoardId: props.targetBoardId,
        kind: props.kind,
        titleFallback: typeof props.titleFallback === 'string'
          ? props.titleFallback
          : marked.titleFallback,
      }
    }
    return marked
  }

  const common = base(record)
  switch (record.type) {
    case 'geo':
      return {
        ...common, type: 'shape', shape: typeof props.geo === 'string' ? props.geo : 'rectangle',
        text: textFromRichText(props.richText),
      }
    case 'text':
      return { ...common, type: 'text', text: textFromRichText(props.richText) }
    case 'note':
      return { ...common, type: 'sticky', text: textFromRichText(props.richText) }
    case 'arrow':
    case 'line':
      return {
        ...common,
        type: 'connector',
        start: endpointFor(String(record.id), 'start', props, bindings),
        end: endpointFor(String(record.id), 'end', props, bindings),
        text: textFromRichText(props.richText),
      }
    case 'frame':
      return { ...common, type: 'section', title: typeof props.name === 'string' ? props.name : '' }
    case 'draw': {
      const points = Array.isArray(props.segments)
        ? props.segments.flatMap((segment) => {
            const value = objectValue(segment)
            return Array.isArray(value.points)
              ? value.points.map((point) => {
                  const item = objectValue(point)
                  return {
                    x: typeof item.x === 'number' ? item.x : 0,
                    y: typeof item.y === 'number' ? item.y : 0,
                    ...(typeof item.z === 'number' ? { pressure: item.z } : {}),
                  }
                })
              : []
          })
        : []
      return { ...common, type: 'paint', points }
    }
    case 'image': {
      const asset = assetFor(record, store)
      const assetProps = objectValue(asset.props)
      const src = typeof assetProps.src === 'string' ? assetProps.src : ''
      const mimeType = typeof assetProps.mimeType === 'string' ? assetProps.mimeType : 'application/octet-stream'
      if (mimeType === 'image/svg+xml' && src.startsWith('data:image/svg+xml')) {
        const encoded = src.slice(src.indexOf(',') + 1)
        return { ...common, type: 'svg', svg: decodeURIComponent(encoded) }
      }
      return {
        ...common, type: 'image', src, mimeType,
        ...(typeof assetProps.name === 'string' && assetProps.name ? { name: assetProps.name } : {}),
      }
    }
    case 'board-reference':
      if (
        typeof props.referenceId === 'string'
        && typeof props.targetBoardId === 'string'
        && (props.kind === 'embed' || props.kind === 'link')
      ) {
        return {
          ...common,
          type: 'board-reference',
          referenceId: props.referenceId,
          targetBoardId: props.targetBoardId,
          kind: props.kind,
          titleFallback: typeof props.titleFallback === 'string' ? props.titleFallback : '',
        }
      }
      break
  }

  return {
    ...common,
    type: 'unsupported',
    sourceType: record.type,
    sourcePayload: 'sourcePayload' in meta
      ? structuredClone(meta.sourcePayload)
      : structuredClone(record),
  }
}

export function snapshotToInteropScene(snapshot: TLEditorSnapshot | unknown): InteropScene {
  const store = snapshotStore(snapshot)
  const records = Object.values(store).map(objectValue)
  const bindings = records.filter((record) => record.typeName === 'binding')
  const elements = records
    .map((record) => mappedElement(record, store, bindings))
    .filter((element): element is InteropElement => Boolean(element))
  const issues: ImportCompatibilityIssue[] = elements
    .filter((element) => element.type === 'unsupported')
    .map((element) => ({
      code: 'UNSUPPORTED_ELEMENT',
      message: `Unsupported tldraw element: ${element.sourceType}`,
      severity: 'warning',
      elementId: element.id,
      sourceType: element.sourceType,
    }))
  const scene: InteropScene = {
    formatVersion: 1,
    elements,
    compatibilityReport: createImportCompatibilityReport({
      issues,
      unsupportedElementCount: issues.length,
    }),
  }
  return parseInteropScene(scene)
}
