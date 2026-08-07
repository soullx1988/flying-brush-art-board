import { randomUUID } from 'node:crypto'

import {
  createBindingId,
  createShapeId,
  getIndexAbove,
  toRichText,
  type TLRecord,
  type TLShape,
  type TLStore,
} from 'tldraw'
import {
  createBoardStore,
  getStoreSnapshot,
  loadSnapshotIntoStore,
} from '@infinite-board/tldraw-adapter'

import type { LocalDatabase } from '../db/schema.js'
import type { AssetRepository } from '../modules/assets/asset-repository.js'
import type { BoardRepository } from '../modules/boards/board-repository.js'
import type { BoardDocumentCoordinator } from '../modules/realtime/board-document-coordinator.js'
import type { McpCommandContext } from './operation-service.js'

export const MCP_SHAPE_COLORS = [
  'black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow',
  'orange', 'green', 'light-green', 'light-red', 'red', 'white',
] as const

export const MCP_GEO_TYPES = [
  'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon',
  'octagon', 'star', 'rhombus', 'rhombus-2', 'oval', 'trapezoid',
  'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'x-box', 'check-box',
] as const

export type McpShapeColor = (typeof MCP_SHAPE_COLORS)[number]
export type McpGeoType = (typeof MCP_GEO_TYPES)[number]
export type McpShapeKind = 'text' | 'note' | 'geo' | 'frame' | 'line' | 'arrow' | 'image'

export interface McpShapeCreateInput {
  kind: McpShapeKind
  x: number
  y: number
  width?: number
  height?: number
  text?: string
  color?: McpShapeColor
  geo?: McpGeoType
  rotation?: number
  fromShapeId?: string
  toShapeId?: string
  assetSha256?: string
  altText?: string
}

export interface McpShapeUpdateInput {
  shapeId: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  color?: McpShapeColor
  rotation?: number
}

export type McpShapeBatchAction =
  | ({ action: 'create' } & McpShapeCreateInput)
  | ({ action: 'update' } & McpShapeUpdateInput)
  | { action: 'delete'; shapeIds: string[] }
  | { action: 'group'; shapeIds: string[] }
  | { action: 'ungroup'; groupId: string }

export interface McpShapeSummary {
  id: string
  type: string
  x: number
  y: number
  rotation: number
  width?: number
  height?: number
  text?: string
  color?: string
  parentId?: string
  assetSha256?: string
}

interface PendingMutation {
  affectedIds: string[]
  commitActions: Array<() => void>
}

function mcpError(code: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(code), { code, ...(details ? { details } : {}) })
}

function richTextValue(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const node = value as { text?: unknown; content?: unknown }
  const own = typeof node.text === 'string' ? node.text : ''
  const nested = Array.isArray(node.content) ? node.content.map(richTextValue).join('') : ''
  return `${own}${nested}`
}

function recordSize(shape: TLShape): { width: number; height: number } {
  const props = shape.props as Record<string, unknown>
  const scale = typeof props.scale === 'number' ? props.scale : 1
  if (shape.type === 'note') {
    return { width: 200 * scale, height: (200 + (typeof props.growY === 'number' ? props.growY : 0)) * scale }
  }
  if (shape.type === 'text') {
    return { width: (typeof props.w === 'number' ? props.w : 200) * scale, height: 40 * scale }
  }
  if (shape.type === 'line') {
    const points = props.points && typeof props.points === 'object'
      ? Object.values(props.points as Record<string, unknown>).filter(
        (point): point is { x: number; y: number } => Boolean(
          point && typeof point === 'object'
          && typeof (point as { x?: unknown }).x === 'number'
          && typeof (point as { y?: unknown }).y === 'number',
        ),
      )
      : []
    if (points.length > 0) {
      const xs = points.map((point) => point.x)
      const ys = points.map((point) => point.y)
      return {
        width: (Math.max(...xs) - Math.min(...xs)) * scale,
        height: (Math.max(...ys) - Math.min(...ys)) * scale,
      }
    }
  }
  return {
    width: (typeof props.w === 'number' ? props.w : 100) * scale,
    height: (typeof props.h === 'number' ? props.h : 100) * scale,
  }
}

function textForShape(shape: TLShape): string | undefined {
  const props = shape.props as Record<string, unknown>
  if (typeof props.name === 'string' && props.name) return props.name
  const value = richTextValue(props.richText)
  return value || undefined
}

function publicDimension(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function summary(shape: TLShape): McpShapeSummary {
  const props = shape.props as Record<string, unknown>
  const size = recordSize(shape)
  const assetId = typeof props.assetId === 'string' ? props.assetId : undefined
  const assetSha256 = assetId?.startsWith('asset:mcp-') ? assetId.slice('asset:mcp-'.length) : undefined
  const text = textForShape(shape)
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    width: publicDimension(size.width),
    height: publicDimension(size.height),
    ...(text ? { text } : {}),
    ...(typeof props.color === 'string' ? { color: props.color } : {}),
    ...(typeof shape.parentId === 'string' ? { parentId: shape.parentId } : {}),
    ...(assetSha256 ? { assetSha256 } : {}),
  }
}

function shapeRecords(store: TLStore): TLShape[] {
  return store.allRecords().filter((record): record is TLShape => record.typeName === 'shape')
}

function ensureDocumentRecords(store: TLStore): void {
  if (store.get('page:page' as never)) return
  const seed = getStoreSnapshot(createBoardStore())
  store.put(Object.values(seed.store) as TLRecord[])
}

function storeFromSnapshot(snapshot: unknown): TLStore {
  const store = createBoardStore()
  loadSnapshotIntoStore(store, snapshot)
  ensureDocumentRecords(store)
  return store
}

function nextIndex(store: TLStore): string {
  const last = shapeRecords(store).sort((left, right) => String(left.index).localeCompare(String(right.index))).at(-1)
  return String(getIndexAbove((last?.index ?? 'a0') as never))
}

function requireShape(store: TLStore, shapeId: string): TLShape {
  const record = store.get(shapeId as never) as TLRecord | undefined
  if (!record || record.typeName !== 'shape') throw mcpError('SHAPE_NOT_FOUND', { shapeId })
  if (record.type === 'board-reference') throw mcpError('BOARD_REFERENCE_COMMAND_REQUIRED', { shapeId })
  return record as TLShape
}

function center(shape: TLShape): { x: number; y: number } {
  const size = recordSize(shape)
  return { x: shape.x + size.width / 2, y: shape.y + size.height / 2 }
}

function baseShape(store: TLStore, input: McpShapeCreateInput, id = createShapeId()): Record<string, unknown> {
  return {
    id,
    parentId: 'page:page',
    index: nextIndex(store),
    type: input.kind,
    x: input.x,
    y: input.y,
    rotation: input.rotation ?? 0,
  }
}

function createShapeInStore(
  store: TLStore,
  input: McpShapeCreateInput,
  assets: AssetRepository,
  database: LocalDatabase,
  board: { id: string; projectId: string },
): PendingMutation {
  const id = createShapeId()
  const color = input.color ?? (input.kind === 'note' ? 'yellow' : 'black')
  const width = input.width ?? (input.kind === 'text' ? 240 : 200)
  const height = input.height ?? (input.kind === 'frame' ? 300 : 120)
  let shape: TLShape
  const records: TLRecord[] = []
  const commitActions: Array<() => void> = []

  switch (input.kind) {
    case 'geo':
      shape = store.schema.types.shape.create({
        ...baseShape(store, input, id),
        props: {
          geo: input.geo ?? 'rectangle', dash: 'draw', url: '', w: width, h: height,
          growY: 0, scale: 1, labelColor: 'black', color, fill: 'none', size: 'm',
          font: 'draw', align: 'middle', verticalAlign: 'middle', richText: toRichText(input.text ?? ''),
        },
      } as never) as TLShape
      records.push(shape)
      break
    case 'text':
      shape = store.schema.types.shape.create({
        ...baseShape(store, input, id),
        props: { color, size: 'm', font: 'draw', textAlign: 'start', w: width, richText: toRichText(input.text ?? ''), scale: 1, autoSize: false },
      } as never) as TLShape
      records.push(shape)
      break
    case 'note':
      // A tldraw note has a scaled square as its minimum bounds and may grow
      // vertically for content. Treat a lone height as the requested square
      // size; when both dimensions are supplied, normalize height to at least
      // the width and return those actual rendered bounds in MCP summaries.
      {
        const noteWidth = input.width ?? input.height ?? 200
        const noteHeight = Math.max(input.height ?? noteWidth, noteWidth)
        const noteScale = noteWidth / 200
        shape = store.schema.types.shape.create({
          ...baseShape(store, input, id),
          props: {
            color, labelColor: 'black', size: 'm', font: 'draw', fontSizeAdjustment: null,
            align: 'middle', verticalAlign: 'middle', growY: Math.max(0, noteHeight / noteScale - 200), url: '',
            richText: toRichText(input.text ?? ''), scale: noteScale, textLastEditedBy: null,
          },
        } as never) as TLShape
        records.push(shape)
        break
      }
    case 'frame':
      shape = store.schema.types.shape.create({
        ...baseShape(store, input, id),
        props: { w: width, h: height, name: input.text ?? 'Frame', color },
      } as never) as TLShape
      records.push(shape)
      break
    case 'line':
      shape = store.schema.types.shape.create({
        ...baseShape(store, input, id),
        props: {
          color, dash: 'draw', size: 'm', spline: 'line', scale: 1,
          points: {
            a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
            a2: { id: 'a2', index: 'a2', x: width, y: height },
          },
        },
      } as never) as TLShape
      records.push(shape)
      break
    case 'arrow': { // Bindings are generated by the service; arbitrary binding records are never accepted.
      if (!input.fromShapeId || !input.toShapeId) throw mcpError('ARROW_ENDPOINTS_REQUIRED')
      const from = requireShape(store, input.fromShapeId)
      const to = requireShape(store, input.toShapeId)
      const start = center(from)
      const end = center(to)
      shape = store.schema.types.shape.create({
        ...baseShape(store, { ...input, x: start.x, y: start.y }, id),
        props: {
          kind: 'arc', labelColor: 'black', color, fill: 'none', dash: 'draw', size: 'm',
          arrowheadStart: 'none', arrowheadEnd: 'arrow', font: 'draw', start: { x: 0, y: 0 },
          end: { x: end.x - start.x, y: end.y - start.y }, bend: 0, richText: toRichText(input.text ?? ''),
          labelPosition: 0.5, scale: 1, elbowMidPoint: 0.5,
        },
      } as never) as TLShape
      const bindingProps = (terminal: 'start' | 'end') => ({
        terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none',
      })
      records.push(
        shape,
        store.schema.types.binding.create({ id: createBindingId(), type: 'arrow', fromId: id, toId: from.id, props: bindingProps('start') } as never),
        store.schema.types.binding.create({ id: createBindingId(), type: 'arrow', fromId: id, toId: to.id, props: bindingProps('end') } as never),
      )
      break
    }
    case 'image': { // MCP may reference an already-uploaded asset but never a server filesystem path.
      if (!input.assetSha256 || !/^[a-f0-9]{64}$/.test(input.assetSha256)) throw mcpError('ASSET_SHA256_REQUIRED')
      const asset = assets.get(input.assetSha256)
      if (!asset || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(asset.mime)) throw mcpError('ASSET_NOT_FOUND')
      const assetId = `asset:mcp-${input.assetSha256}`
      if (!store.get(assetId as never)) {
        records.push(store.schema.types.asset.create({
          id: assetId, type: 'image', props: {
            name: input.altText ?? input.assetSha256, src: `/api/assets/${input.assetSha256}`,
            w: width, h: height, mimeType: asset.mime, isAnimated: asset.mime === 'image/gif', fileSize: asset.size,
          }, meta: {},
        } as never))
      }
      shape = store.schema.types.shape.create({
        ...baseShape(store, input, id),
        props: { w: width, h: height, playing: true, url: '', assetId, crop: null, flipX: false, flipY: false, altText: input.altText ?? '' },
      } as never) as TLShape
      records.push(shape)
      const createdAt = new Date().toISOString()
      commitActions.push(() => database.prepare(`INSERT INTO asset_usages(project_id,board_id,shape_id,asset_record_id,sha256,created_at)
        VALUES (?,?,?,?,?,?)`).run(board.projectId, board.id, id, assetId, input.assetSha256, createdAt))
      break
    }
  }

  store.put(records)
  return { affectedIds: [id], commitActions }
}

function updateShapeInStore(store: TLStore, input: McpShapeUpdateInput): PendingMutation {
  const current = requireShape(store, input.shapeId)
  const props = { ...(current.props as Record<string, unknown>) }
  if (input.text !== undefined) {
    if (current.type === 'frame') props.name = input.text
    else if ('richText' in props) props.richText = toRichText(input.text)
    else throw mcpError('SHAPE_TEXT_UNSUPPORTED', { shapeId: current.id })
  }
  if (input.color !== undefined) {
    if ('color' in props) props.color = input.color
    else throw mcpError('SHAPE_COLOR_UNSUPPORTED', { shapeId: current.id })
  }
  if (input.width !== undefined) {
    if (current.type === 'note') props.scale = input.width / 200
    else if ('w' in props) props.w = input.width
    else throw mcpError('SHAPE_RESIZE_UNSUPPORTED', { shapeId: current.id })
  }
  if (input.height !== undefined) {
    if (current.type === 'note') props.growY = Math.max(0, input.height / (typeof props.scale === 'number' ? props.scale : 1) - 200)
    else if ('h' in props) props.h = input.height
    else throw mcpError('SHAPE_RESIZE_UNSUPPORTED', { shapeId: current.id })
  }
  store.put([{ ...current, ...(input.x === undefined ? {} : { x: input.x }), ...(input.y === undefined ? {} : { y: input.y }), ...(input.rotation === undefined ? {} : { rotation: input.rotation }), props } as TLRecord])
  return { affectedIds: [current.id], commitActions: [] }
}

function deleteShapesInStore(store: TLStore, shapeIds: string[], database: LocalDatabase): PendingMutation {
  const shapes = shapeIds.map((id) => requireShape(store, id))
  const idSet = new Set(shapeIds)
  const bindings = store.allRecords().filter((record) => record.typeName === 'binding' && (
    idSet.has(String((record as { fromId?: unknown }).fromId)) || idSet.has(String((record as { toId?: unknown }).toId))
  ))
  const assetIds = new Set(shapes.map((shape) => (shape.props as { assetId?: unknown }).assetId).filter((id): id is string => typeof id === 'string'))
  store.remove([...shapeIds, ...bindings.map((binding) => binding.id)] as never[])
  for (const assetId of assetIds) {
    const stillUsed = shapeRecords(store).some((shape) => (shape.props as { assetId?: unknown }).assetId === assetId)
    if (!stillUsed && store.get(assetId as never)) store.remove([assetId] as never[])
  }
  return {
    affectedIds: shapeIds,
    commitActions: [() => {
      const removeUsage = database.prepare('DELETE FROM asset_usages WHERE shape_id=?')
      for (const shapeId of shapeIds) removeUsage.run(shapeId)
    }],
  }
}

function groupShapesInStore(store: TLStore, shapeIds: string[]): PendingMutation {
  const shapes = shapeIds.map((id) => requireShape(store, id))
  if (shapes.length < 2) throw mcpError('SHAPE_GROUP_REQUIRES_MULTIPLE')
  if (new Set(shapes.map((shape) => shape.parentId)).size !== 1) throw mcpError('SHAPE_GROUP_PARENT_MISMATCH')
  const x = Math.min(...shapes.map((shape) => shape.x))
  const y = Math.min(...shapes.map((shape) => shape.y))
  const groupId = createShapeId()
  const group = store.schema.types.shape.create({
    id: groupId, type: 'group', parentId: shapes[0]!.parentId, index: nextIndex(store), x, y, props: {},
  } as never) as TLShape
  store.put([group, ...shapes.map((shape) => ({ ...shape, parentId: groupId, x: shape.x - x, y: shape.y - y } as TLRecord))])
  return { affectedIds: [groupId, ...shapeIds], commitActions: [] }
}

function ungroupShapeInStore(store: TLStore, groupId: string): PendingMutation {
  const group = requireShape(store, groupId)
  if (group.type !== 'group') throw mcpError('SHAPE_GROUP_REQUIRED', { shapeId: groupId })
  const children = shapeRecords(store).filter((shape) => shape.parentId === group.id)
  store.put(children.map((shape) => ({ ...shape, parentId: group.parentId, x: shape.x + group.x, y: shape.y + group.y } as TLRecord)))
  store.remove([group.id] as never[])
  return { affectedIds: [group.id, ...children.map((shape) => shape.id)], commitActions: [] }
}

function applyLayout(store: TLStore, shapeIds: string[], mode: string, gap: number, columns: number): string[] {
  const shapes = shapeIds.map((id) => requireShape(store, id))
  if (shapes.length === 0) return []
  const updates: TLShape[] = []
  if (mode === 'front' || mode === 'back') {
    const ordered = shapeRecords(store).sort((a, b) => String(a.index).localeCompare(String(b.index)))
    let index = mode === 'front' ? ordered.at(-1)?.index ?? ('a1' as never) : ('a0' as never)
    for (const shape of shapes) {
      index = getIndexAbove(index as never)
      updates.push({ ...shape, index })
    }
  } else if (mode === 'align_left' || mode === 'align_top') {
    const coordinate = mode === 'align_left' ? Math.min(...shapes.map((shape) => shape.x)) : Math.min(...shapes.map((shape) => shape.y))
    for (const shape of shapes) updates.push({ ...shape, ...(mode === 'align_left' ? { x: coordinate } : { y: coordinate }) })
  } else if (mode === 'distribute_x' || mode === 'distribute_y') {
    const sorted = [...shapes].sort((a, b) => mode === 'distribute_x' ? a.x - b.x : a.y - b.y)
    let cursor = mode === 'distribute_x' ? sorted[0]!.x : sorted[0]!.y
    for (const shape of sorted) {
      updates.push({ ...shape, ...(mode === 'distribute_x' ? { x: cursor } : { y: cursor }) })
      const size = recordSize(shape)
      cursor += (mode === 'distribute_x' ? size.width : size.height) + gap
    }
  } else {
    const originX = Math.min(...shapes.map((shape) => shape.x))
    const originY = Math.min(...shapes.map((shape) => shape.y))
    let cursorX = originX
    let cursorY = originY
    let rowHeight = 0
    shapes.forEach((shape, index) => {
      const size = recordSize(shape)
      if (mode === 'vertical') {
        updates.push({ ...shape, x: originX, y: cursorY })
        cursorY += size.height + gap
      } else if (mode === 'grid') {
        if (index > 0 && index % columns === 0) {
          cursorX = originX
          cursorY += rowHeight + gap
          rowHeight = 0
        }
        updates.push({ ...shape, x: cursorX, y: cursorY })
        cursorX += size.width + gap
        rowHeight = Math.max(rowHeight, size.height)
      } else {
        updates.push({ ...shape, x: cursorX, y: originY })
        cursorX += size.width + gap
      }
    })
  }
  store.put(updates)
  return shapes.map((shape) => shape.id)
}

export class CanvasCommandService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly boards: BoardRepository,
    private readonly coordinator: BoardDocumentCoordinator,
    private readonly assets: AssetRepository,
  ) {}

  list(boardId: string, input: { types?: string[]; text?: string; region?: { x: number; y: number; width: number; height: number }; cursor?: string; limit?: number } = {}) {
    const board = this.requireBoard(boardId)
    const store = storeFromSnapshot(board.tldrawSnapshot)
    const query = input.text?.toLocaleLowerCase('zh-CN')
    const filtered = shapeRecords(store).filter((shape) => {
      if (shape.type === 'board-reference') return false
      if (input.types?.length && !input.types.includes(shape.type)) return false
      if (query && !textForShape(shape)?.toLocaleLowerCase('zh-CN').includes(query)) return false
      if (input.region) {
        const size = recordSize(shape)
        const right = shape.x + size.width
        const bottom = shape.y + size.height
        const regionRight = input.region.x + input.region.width
        const regionBottom = input.region.y + input.region.height
        if (right < input.region.x || shape.x > regionRight || bottom < input.region.y || shape.y > regionBottom) return false
      }
      return true
    }).sort((left, right) => String(left.index).localeCompare(String(right.index)))
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const start = input.cursor ? Math.max(filtered.findIndex((shape) => shape.id === input.cursor) + 1, 0) : 0
    const page = filtered.slice(start, start + limit)
    return { revision: board.revision, shapes: page.map(summary), ...(filtered.length > start + limit && page.at(-1) ? { nextCursor: page.at(-1)!.id } : {}) }
  }

  get(boardId: string, shapeId: string): { revision: number; shape: McpShapeSummary } {
    const board = this.requireBoard(boardId)
    return { revision: board.revision, shape: summary(requireShape(storeFromSnapshot(board.tldrawSnapshot), shapeId)) }
  }

  inspect(boardId: string): Record<string, unknown> {
    const board = this.requireBoard(boardId)
    const store = storeFromSnapshot(board.tldrawSnapshot)
    const shapes = shapeRecords(store)
    const summaries = shapes.map(summary)
    const typeCounts = Object.fromEntries([...new Set(summaries.map((shape) => shape.type))].map((type) => [type, summaries.filter((shape) => shape.type === type).length]))
    const minX = summaries.length ? Math.min(...summaries.map((shape) => shape.x)) : 0
    const minY = summaries.length ? Math.min(...summaries.map((shape) => shape.y)) : 0
    const maxX = summaries.length ? Math.max(...summaries.map((shape) => shape.x + (shape.width ?? 0))) : 0
    const maxY = summaries.length ? Math.max(...summaries.map((shape) => shape.y + (shape.height ?? 0))) : 0
    return {
      board: { id: board.id, projectId: board.projectId, title: board.title, revision: board.revision },
      shapeCount: summaries.length,
      typeCounts,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      textSummary: summaries.map((shape) => shape.text).filter(Boolean).slice(0, 100),
    }
  }

  create(boardId: string, input: McpShapeCreateInput, expectedRevision: number | undefined, context: McpCommandContext) {
    return this.mutate(boardId, expectedRevision, context, 'MCP 创建画布元素', (store, board) => createShapeInStore(store, input, this.assets, this.database, board))
  }

  update(boardId: string, input: McpShapeUpdateInput, expectedRevision: number | undefined, context: McpCommandContext) {
    return this.mutate(boardId, expectedRevision, context, 'MCP 修改画布元素', (store) => updateShapeInStore(store, input))
  }

  delete(boardId: string, shapeIds: string[], expectedRevision: number | undefined, context: McpCommandContext) {
    return this.mutate(boardId, expectedRevision, context, 'MCP 删除画布元素', (store) => deleteShapesInStore(store, shapeIds, this.database))
  }

  batch(boardId: string, actions: McpShapeBatchAction[], expectedRevision: number | undefined, context: McpCommandContext) {
    return this.mutate(boardId, expectedRevision, context, 'MCP 原子批量修改画布', (store, board) => {
      const affectedIds: string[] = []
      const commitActions: Array<() => void> = []
      for (const action of actions) {
        const result = action.action === 'create'
          ? createShapeInStore(store, action, this.assets, this.database, board)
          : action.action === 'update'
            ? updateShapeInStore(store, action)
            : action.action === 'delete'
              ? deleteShapesInStore(store, action.shapeIds, this.database)
              : action.action === 'group'
                ? groupShapesInStore(store, action.shapeIds)
                : ungroupShapeInStore(store, action.groupId)
        affectedIds.push(...result.affectedIds)
        commitActions.push(...result.commitActions)
      }
      return { affectedIds, commitActions }
    })
  }

  layout(boardId: string, shapeIds: string[], mode: string, gap: number, columns: number, expectedRevision: number | undefined, context: McpCommandContext) {
    return this.mutate(boardId, expectedRevision, context, 'MCP 布局画布元素', (store) => ({
      affectedIds: applyLayout(store, shapeIds, mode, gap, columns), commitActions: [],
    }))
  }

  private async mutate(
    boardId: string,
    expectedRevision: number | undefined,
    context: McpCommandContext,
    reason: string,
    operation: (store: TLStore, board: { id: string; projectId: string }) => PendingMutation,
  ): Promise<{ revision: number; affectedIds: string[]; shapes: McpShapeSummary[] }> {
    const board = this.requireBoard(boardId)
    const committed = await this.coordinator.runCommand({
      boardId,
      actorOpenId: context.actorOpenId,
      reason,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      mutate: async (snapshot) => {
        const store = storeFromSnapshot(snapshot)
        const result = operation(store, board)
        return {
          snapshot: getStoreSnapshot(store),
          result: result.affectedIds,
          commit: () => result.commitActions.forEach((action) => action()),
        }
      },
    })
    const store = storeFromSnapshot(committed.snapshot)
    return {
      revision: committed.revision,
      affectedIds: committed.result,
      shapes: committed.result.map((id) => {
        const record = store.get(id as never) as TLRecord | undefined
        return record?.typeName === 'shape' ? summary(record as TLShape) : { id, type: 'deleted', x: 0, y: 0, rotation: 0 }
      }),
    }
  }

  private requireBoard(boardId: string) {
    const board = this.boards.get(boardId)
    if (!board) throw mcpError('BOARD_NOT_FOUND', { boardId })
    return board
  }
}
