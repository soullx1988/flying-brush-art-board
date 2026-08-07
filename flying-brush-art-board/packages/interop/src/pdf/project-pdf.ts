import { createRequire } from 'node:module'

import {
  stableTopologicalBoardOrder,
  type BoardReferenceRecord,
  type ProjectRecord,
  type StoredBoard,
} from '@infinite-board/board-core'

export const MAX_PROJECT_PDF_BOARDS = 200
export const MAX_PROJECT_PDF_SHAPES = 20_000

const PAGE_WIDTH = 792
const PAGE_HEIGHT = 612
const PAGE_MARGIN = 36
const TITLE_HEIGHT = 34
const SNAPSHOT_PADDING = 24

export interface ProjectPdfInput {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  assets?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
}

export interface PdfShapeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ProjectPdfLink {
  referenceId: string
  shapeId: string
  kind: 'embed' | 'link'
  targetBoardId: string
  targetPageNo: number
}

export interface ProjectPdfPage {
  board: StoredBoard
  pageNo: number
  destination: string
  links: ProjectPdfLink[]
}

export interface ProjectPdfOutlineItem {
  boardId: string
  title: string
  pageNo: number
  children: ProjectPdfOutlineItem[]
}

export interface ProjectPdfPlan {
  pages: ProjectPdfPage[]
  pageByBoardId: Map<string, number>
  outline: ProjectPdfOutlineItem[]
}

export class ProjectPdfError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProjectPdfError'
  }
}

interface PdfOutline {
  addItem(title: string, options?: { pageNumber?: number; expanded?: boolean }): PdfOutline
}

interface PdfDocumentLike extends NodeJS.ReadableStream {
  outline: PdfOutline
  addPage(options?: { size?: [number, number]; margin?: number }): PdfDocumentLike
  addNamedDestination(name: string, ...args: unknown[]): PdfDocumentLike
  fontSize(size: number): PdfDocumentLike
  fillColor(color: string): PdfDocumentLike
  text(text: string, x: number, y: number, options?: Record<string, unknown>): PdfDocumentLike
  rect(x: number, y: number, width: number, height: number): PdfDocumentLike
  fill(color?: string): PdfDocumentLike
  goTo(x: number, y: number, width: number, height: number, destination: string): PdfDocumentLike
  end(): void
}

type PdfDocumentConstructor = new (options?: Record<string, unknown>) => PdfDocumentLike
type SvgToPdf = (
  document: PdfDocumentLike,
  svg: string,
  x: number,
  y: number,
  options?: Record<string, unknown>,
) => void

const require = createRequire(import.meta.url)

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  const value = objectValue(snapshot)
  const document = objectValue(value.document)
  return objectValue(document.store ?? value.store)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const MIND_MAP_PALETTE: Record<string, string> = {
  black: '#1f2329', gray: '#8f959e', purple: '#d46bfa', violet: '#9333ea',
  indigo: '#4e6ef2', blue: '#3b82f6', amber: '#f3a83b', orange: '#e76a24',
  teal: '#0f9f75', green: '#42b55d', coral: '#f87171', red: '#e53935',
}

function mindMapPaletteColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && MIND_MAP_PALETTE[value] ? MIND_MAP_PALETTE[value]! : fallback
}

function mindMapOpacity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
}

interface PointLike { x: number; y: number }

function manualArrowPoints(record: Record<string, unknown>): PointLike[] | undefined {
  if (record.type !== 'arrow') return undefined
  const props = objectValue(record.props)
  if (props.kind !== 'elbow') return undefined
  const manualRoute = objectValue(objectValue(record.meta).manualElbowRoute)
  if (manualRoute.version !== 1 || !Array.isArray(manualRoute.segments) || manualRoute.segments.length === 0) return undefined
  const segments = manualRoute.segments.map(objectValue)
  if (segments.some((segment, index) => (
    (segment.orientation !== 'horizontal' && segment.orientation !== 'vertical')
    || typeof segment.position !== 'number'
    || !Number.isFinite(segment.position)
    || (index > 0 && segments[index - 1]?.orientation === segment.orientation)
  ))) return undefined
  const start = objectValue(props.start)
  const end = objectValue(props.end)
  const startPoint = { x: finiteNumber(start.x, 0), y: finiteNumber(start.y, 0) }
  const endPoint = { x: finiteNumber(end.x, 200), y: finiteNumber(end.y, 120) }
  const resolved = segments.map((segment) => ({
    orientation: segment.orientation as 'horizontal' | 'vertical',
    position: segment.position as number,
  }))
  const first = resolved[0]!
  const last = resolved[resolved.length - 1]!
  first.position = first.orientation === 'horizontal' ? startPoint.y : startPoint.x
  last.position = last.orientation === 'horizontal' ? endPoint.y : endPoint.x
  const points: PointLike[] = [startPoint]
  for (let index = 0; index < resolved.length - 1; index += 1) {
    const left = resolved[index]!
    const right = resolved[index + 1]!
    const horizontal = left.orientation === 'horizontal' ? left : right
    const vertical = left.orientation === 'vertical' ? left : right
    points.push({ x: vertical.position, y: horizontal.position })
  }
  points.push(endPoint)
  return points
}

function shapeBounds(record: Record<string, unknown>): PdfShapeBounds {
  const props = objectValue(record.props)
  const baseX = finiteNumber(record.x, 0)
  const baseY = finiteNumber(record.y, 0)
  if (record.type === 'arrow' || record.type === 'line') {
    const start = objectValue(props.start)
    const end = objectValue(props.end)
    const points = manualArrowPoints(record) ?? [
      { x: finiteNumber(start.x, 0), y: finiteNumber(start.y, 0) },
      { x: finiteNumber(end.x, 200), y: finiteNumber(end.y, 120) },
    ]
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxX = Math.max(...points.map((point) => point.x))
    const maxY = Math.max(...points.map((point) => point.y))
    return { x: baseX + minX, y: baseY + minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }
  return {
    x: baseX,
    y: baseY,
    width: Math.max(1, finiteNumber(props.w, 200)),
    height: Math.max(1, finiteNumber(props.h, 120)),
  }
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function richText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(richText).join('')
  const record = objectValue(value)
  if (typeof record.text === 'string') return record.text
  return record.content === undefined ? '' : richText(record.content)
}

function normalizedColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  const colors: Record<string, string> = {
    black: '#1f2937',
    grey: '#64748b',
    gray: '#64748b',
    red: '#dc2626',
    orange: '#ea580c',
    yellow: '#ca8a04',
    green: '#16a34a',
    blue: '#2563eb',
    violet: '#7c3aed',
    purple: '#7c3aed',
  }
  return colors[value.toLowerCase()] ?? fallback
}

function assetLookup(
  assets: ProjectPdfInput['assets'],
  key: string,
): string | undefined {
  if (!assets) return undefined
  return typeof (assets as { get?: unknown }).get === 'function'
    ? (assets as ReadonlyMap<string, string>).get(key)
    : (assets as Readonly<Record<string, string>>)[key]
}

function safeImageSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value.trim())
    ? value.trim()
    : undefined
}

interface SnapshotRender {
  svg: string
  viewBox: PdfShapeBounds
  shapeBoundsById: Map<string, PdfShapeBounds>
}

function renderSnapshot(
  snapshot: unknown,
  assets: ProjectPdfInput['assets'],
): SnapshotRender {
  const store = snapshotStore(snapshot)
  const shapes = Object.values(store)
    .map(objectValue)
    .filter((record) => record.typeName === 'shape')
    .sort((left, right) => String(left.index ?? '').localeCompare(String(right.index ?? '')))
  if (shapes.length > MAX_PROJECT_PDF_SHAPES) {
    throw new ProjectPdfError('PDF_SHAPE_LIMIT_EXCEEDED')
  }

  const shapeBoundsById = new Map<string, PdfShapeBounds>()
  for (const shape of shapes) shapeBoundsById.set(String(shape.id), shapeBounds(shape))
  const bounds = [...shapeBoundsById.values()]
  const left = bounds.length > 0 ? Math.min(...bounds.map((item) => item.x)) : 0
  const top = bounds.length > 0 ? Math.min(...bounds.map((item) => item.y)) : 0
  const right = bounds.length > 0 ? Math.max(...bounds.map((item) => item.x + item.width)) : 960
  const bottom = bounds.length > 0 ? Math.max(...bounds.map((item) => item.y + item.height)) : 540
  const viewBox = {
    x: left - SNAPSHOT_PADDING,
    y: top - SNAPSHOT_PADDING,
    width: Math.max(1, right - left + SNAPSHOT_PADDING * 2),
    height: Math.max(1, bottom - top + SNAPSHOT_PADDING * 2),
  }

  const body = shapes.map((shape) => {
    const id = String(shape.id)
    const type = String(shape.type ?? '')
    const props = objectValue(shape.props)
    const geometry = shapeBoundsById.get(id)!
    const stroke = normalizedColor(props.color, '#334155')
    const fill = type === 'note' ? '#fef3c7' : type === 'board-reference' ? '#e0f2fe' : '#ffffff'
    const text = richText(props.richText) || String(props.name ?? props.titleFallback ?? '')
    const common = `data-shape-id="${escapeXml(id)}"`

    if (type === 'table') {
      const columns = Array.isArray(props.columns) ? props.columns.map(objectValue) : []
      const rows = Array.isArray(props.rows) ? props.rows.map(objectValue) : []
      const columnWeights = columns.map((column) => finiteNumber(column.width, 1 / Math.max(1, columns.length)))
      const rowWeights = rows.map((row) => finiteNumber(row.height, 1 / Math.max(1, rows.length)))
      let y = geometry.y
      const cells = rows.flatMap((row, rowIndex) => {
        const height = geometry.height * (rowWeights[rowIndex] ?? 0)
        const rowCells = Array.isArray(row.cells) ? row.cells.map(objectValue) : []
        let x = geometry.x
        const result = columns.map((_, columnIndex) => {
          const width = geometry.width * (columnWeights[columnIndex] ?? 0)
          const cell = rowCells[columnIndex] ?? {}
          const value = typeof cell.text === 'string' ? cell.text : ''
          const backgrounds: Record<string, string> = { gray: '#f2f3f5', blue: '#e8f1ff', yellow: '#fff6d8', green: '#e8f7ed', red: '#feeceb' }
          const align = cell.align === 'center' || cell.align === 'right' ? cell.align : 'left'
          const textX = align === 'left' ? x + 7 : align === 'right' ? x + width - 7 : x + width / 2
          const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
          const border = cell.border === 'none' ? 'none' : cell.border === 'strong' ? '#7d8797' : '#d7dce3'
          const svg = `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${backgrounds[String(cell.background)] ?? '#ffffff'}" stroke="${border}" stroke-width="${cell.border === 'strong' ? 2 : 1}"/><text x="${textX}" y="${y + Math.min(22, Math.max(14, height - 7))}" text-anchor="${anchor}" fill="#1f2633" font-family="sans-serif" font-size="12" font-weight="${cell.header ? 700 : 500}">${escapeXml(value.slice(0, 80))}</text></g>`
          x += width
          return svg
        })
        y += height
        return result
      }).join('')
      return `<g ${common}><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" fill="#ffffff" stroke="#8f98a8"/>${cells}</g>`
    }

    if (type === 'mind-map') {
      const nodes = Array.isArray(props.nodes) ? props.nodes.map(objectValue) : []
      const root = nodes.find((node) => node.parentId === null) ?? nodes[0]
      if (!root || typeof root.id !== 'string') return ''
      const depthOf = (node: Record<string, unknown>) => {
        let depth = 0
        let parentId = node.parentId
        const visited = new Set<string>()
        while (typeof parentId === 'string' && !visited.has(parentId)) {
          visited.add(parentId)
          depth += 1
          parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId
        }
        return depth
      }
      const nodeById = new Map(nodes.filter((node) => typeof node.id === 'string').map((node) => [node.id as string, node]))
      const isVisible = (node: Record<string, unknown>) => {
        let parentId = node.parentId
        const visited = new Set<string>()
        while (typeof parentId === 'string' && !visited.has(parentId)) {
          visited.add(parentId)
          const parent = nodeById.get(parentId)
          if (!parent) break
          if (parent.collapsed === true) return false
          parentId = parent.parentId
        }
        return true
      }
      const visibleNodes = nodes.filter((node) => typeof node.id === 'string' && isVisible(node))
      const rootX = geometry.x + geometry.width / 2 - 70
      const rootY = geometry.y + geometry.height / 2 - 20
      const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
      positions.set(root.id, { x: rootX, y: rootY, w: 140, h: 40 })
      const branches = visibleNodes.filter((node) => node.id !== root.id)
      branches.forEach((node, index) => {
        const depth = Math.max(1, depthOf(node))
        const side = props.layout === 'bilateral' && node.side === 'left' ? -1 : 1
        const x = side > 0 ? rootX + 140 + depth * 48 : rootX - 120 - depth * 48
        const y = geometry.y + ((index + 1) * geometry.height) / (branches.length + 1) - 17
        positions.set(node.id as string, { x, y, w: 120, h: 34 })
      })
      const edges = branches.map((node) => {
        const from = typeof node.parentId === 'string' ? positions.get(node.parentId) : undefined
        const to = positions.get(node.id as string)
        if (!from || !to) return ''
        const style = objectValue(node.style)
        const edgeColor = mindMapPaletteColor(style.edgeColor, '#8f959e')
        const edgeOpacity = mindMapOpacity(style.edgeOpacity)
        const edgeWidth = Math.max(1, Math.min(4, Math.round(finiteNumber(style.edgeWidth, 2))))
        const dash = style.edgeDash === 'dashed' ? '10 7' : style.edgeDash === 'dotted' ? '2 6' : undefined
        return `<line x1="${from.x + from.w / 2}" y1="${from.y + from.h / 2}" x2="${to.x + to.w / 2}" y2="${to.y + to.h / 2}" stroke="${edgeColor}" stroke-opacity="${edgeOpacity}" stroke-width="${edgeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      }).join('')
      const cards = visibleNodes.map((node) => {
        const position = positions.get(node.id as string)
        if (!position) return ''
        const isRoot = node.id === root.id
        const value = typeof node.text === 'string' ? node.text : ''
        const palettes: Record<string, [string, string]> = {
          blue: ['#3370ff', '#245bd7'], violet: ['#7f5af0', '#6842d8'], green: ['#28a745', '#20883a'],
          orange: ['#f59e0b', '#d47f00'], red: ['#e5484d', '#c9363b'], gray: ['#ffffff', '#9eb3d5'],
        }
        const palette = palettes[String(node.color)] ?? (isRoot ? palettes.blue! : palettes.gray!)
        const colorful = props.theme === 'colorful'
        const minimal = props.theme === 'minimal' || node.shape === 'underline'
        const style = objectValue(node.style)
        const fill = minimal ? 'transparent' : mindMapPaletteColor(style.fillColor, isRoot || colorful ? palette[0] : '#ffffff')
        const foreground = mindMapPaletteColor(style.textColor, isRoot || colorful ? '#ffffff' : '#1f2329')
        const border = mindMapPaletteColor(style.borderColor, palette[1])
        const fillOpacity = mindMapOpacity(style.fillOpacity)
        const borderOpacity = mindMapOpacity(style.borderOpacity)
        const textOpacity = mindMapOpacity(style.textOpacity)
        const radius = node.shape === 'pill' ? position.h / 2 : node.shape === 'underline' ? 0 : 9
        const underline = minimal ? `<line x1="${position.x}" y1="${position.y + position.h}" x2="${position.x + position.w}" y2="${position.y + position.h}" stroke="${border}" stroke-opacity="${borderOpacity}" stroke-width="3"/>` : ''
        const fontSizes: Record<string, number> = { s: 12, m: 14, l: 18, xl: 24 }
        const fontSize = fontSizes[String(style.fontSize)] ?? 14
        const fontFamilies: Record<string, string> = { draw: 'cursive', sans: 'sans-serif', serif: 'serif', mono: 'monospace' }
        const fontFamily = fontFamilies[String(style.fontFamily)] ?? 'sans-serif'
        const align = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left'
        const textX = align === 'left' ? position.x + 9 : align === 'right' ? position.x + position.w - 9 : position.x + position.w / 2
        const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
        const decoration = [style.underline === true ? 'underline' : '', style.strike === true ? 'line-through' : ''].filter(Boolean).join(' ')
        return `<g><rect x="${position.x}" y="${position.y}" width="${position.w}" height="${position.h}" rx="${radius}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${minimal ? 'none' : border}" stroke-opacity="${borderOpacity}"/>${underline}<text x="${textX}" y="${position.y + position.h / 2 + fontSize * 0.34}" text-anchor="${anchor}" fill="${foreground}" fill-opacity="${textOpacity}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${style.bold === false ? 500 : 700}" font-style="${style.italic === true ? 'italic' : 'normal'}"${decoration ? ` text-decoration="${decoration}"` : ''}>${escapeXml(value.slice(0, 48))}</text></g>`
      }).join('')
      return `<g ${common}>${edges}${cards}</g>`
    }

    if (type === 'image') {
      const asset = objectValue(store[String(props.assetId ?? '')])
      const assetProps = objectValue(asset.props)
      const originalSource = typeof assetProps.src === 'string' ? assetProps.src : ''
      const source = safeImageSource(
        assetLookup(assets, String(asset.id ?? ''))
        ?? assetLookup(assets, originalSource)
        ?? originalSource,
      )
      return source
        ? `<image ${common} x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" href="${escapeXml(source)}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect ${common} x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="8" fill="#e2e8f0" stroke="#94a3b8"/>`
    }

    if (type === 'text') {
      return `<text ${common} x="${geometry.x}" y="${geometry.y + 24}" fill="${stroke}" font-family="sans-serif" font-size="18">${escapeXml(text)}</text>`
    }

    if (type === 'arrow' || type === 'line') {
      const start = objectValue(props.start)
      const end = objectValue(props.end)
      const baseX = finiteNumber(shape.x, 0)
      const baseY = finiteNumber(shape.y, 0)
      const manualPoints = manualArrowPoints(shape)
      if (manualPoints) {
        const points = manualPoints.map((point) => `${baseX + point.x},${baseY + point.y}`).join(' ')
        const dash = props.dash === 'dashed' ? ' stroke-dasharray="10 6"' : props.dash === 'dotted' ? ' stroke-dasharray="2 6"' : ''
        const middle = manualPoints[Math.floor(manualPoints.length / 2)]!
        const label = text ? `<text x="${baseX + middle.x}" y="${baseY + middle.y - 8}" text-anchor="middle" fill="${stroke}" font-family="sans-serif" font-size="14">${escapeXml(text)}</text>` : ''
        return `<g ${common}><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${dash}/>${label}</g>`
      }
      return `<line ${common} x1="${baseX + finiteNumber(start.x, 0)}" y1="${baseY + finiteNumber(start.y, 0)}" x2="${baseX + finiteNumber(end.x, geometry.width)}" y2="${baseY + finiteNumber(end.y, geometry.height)}" stroke="${stroke}" stroke-width="2"/>`
    }

    const radius = type === 'board-reference' || type === 'note' ? 12 : 4
    return `<g ${common}><rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${geometry.x + 12}" y="${geometry.y + 30}" fill="#0f172a" font-family="sans-serif" font-size="16">${escapeXml(text)}</text></g>`
  }).join('')

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"><rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="#ffffff"/>${body}</svg>`,
    viewBox,
    shapeBoundsById,
  }
}

export function renderSnapshotToSvg(
  snapshot: unknown,
  assets: ProjectPdfInput['assets'] = {},
): string {
  return renderSnapshot(snapshot, assets).svg
}

function destinationName(boardId: string): string {
  return `board-${boardId.replace(/[^a-z0-9_.-]/gi, '-')}`
}

function outlineFor(
  pages: readonly ProjectPdfPage[],
  references: readonly BoardReferenceRecord[],
): ProjectPdfOutlineItem[] {
  const pageById = new Map(pages.map((page) => [page.board.id, page]))
  const children = new Map<string, string[]>(pages.map((page) => [page.board.id, []]))
  const childIdsBySource = new Map<string, Set<string>>(pages.map((page) => [page.board.id, new Set()]))
  const parentsByChild = new Map<string, Set<string>>(pages.map((page) => [page.board.id, new Set()]))
  for (const reference of references) {
    if (reference.kind !== 'embed') continue
    const childIds = childIdsBySource.get(reference.sourceBoardId)
    const parents = parentsByChild.get(reference.targetBoardId)
    if (childIds && parents && !childIds.has(reference.targetBoardId)) {
      childIds.add(reference.targetBoardId)
      parents.add(reference.sourceBoardId)
    }
  }
  for (const page of pages) {
    for (const parentId of parentsByChild.get(page.board.id) ?? []) {
      children.get(parentId)?.push(page.board.id)
    }
  }

  const expanded = new Set<string>()
  const build = (boardId: string): ProjectPdfOutlineItem => {
    const page = pageById.get(boardId)!
    const expandChildren = !expanded.has(boardId)
    expanded.add(boardId)
    return {
      boardId,
      title: page.board.title,
      pageNo: page.pageNo,
      children: expandChildren
        ? (children.get(boardId) ?? [])
          .map(build)
        : [],
    }
  }
  const embeddedTargets = new Set(
    [...parentsByChild.entries()].filter(([, parents]) => parents.size > 0).map(([boardId]) => boardId),
  )
  const roots = pages.filter((page) => !embeddedTargets.has(page.board.id))
  return (roots.length > 0 ? roots : pages).map((page) => build(page.board.id))
}

export function createProjectPdfPlan(input: ProjectPdfInput): ProjectPdfPlan {
  const boardIds = stableTopologicalBoardOrder(input.project, input.boards, input.references)
  const boardById = new Map(input.boards.map((board) => [board.id, board]))
  const pageByBoardId = new Map(boardIds.map((boardId, index) => [boardId, index + 1]))
  const pages = boardIds.map((boardId, index): ProjectPdfPage => ({
    board: boardById.get(boardId)!,
    pageNo: index + 1,
    destination: destinationName(boardId),
    links: input.references
      .filter((reference) => reference.sourceBoardId === boardId)
      .sort((left, right) => {
        const shape = left.shapeId.localeCompare(right.shapeId)
        return shape !== 0 ? shape : left.id.localeCompare(right.id)
      })
      .map((reference) => ({
        referenceId: reference.id,
        shapeId: reference.shapeId,
        kind: reference.kind,
        targetBoardId: reference.targetBoardId,
        targetPageNo: pageByBoardId.get(reference.targetBoardId)!,
      })),
  }))
  return {
    pages,
    pageByBoardId,
    outline: outlineFor(pages, input.references),
  }
}

function addOutline(parent: PdfOutline, items: readonly ProjectPdfOutlineItem[]): void {
  for (const item of items) {
    const child = parent.addItem(item.title, {
      pageNumber: item.pageNo - 1,
      expanded: item.children.length > 0,
    })
    addOutline(child, item.children)
  }
}

function collectPdf(document: PdfDocumentLike): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    document.on('data', (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)))
    document.on('error', reject)
    document.on('end', () => {
      const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(bytes)
    })
  })
}

export async function renderProjectToPdf(input: ProjectPdfInput): Promise<Uint8Array> {
  if (input.boards.length === 0) throw new ProjectPdfError('PDF_PROJECT_EMPTY')
  if (input.boards.length > MAX_PROJECT_PDF_BOARDS) {
    throw new ProjectPdfError('PDF_BOARD_LIMIT_EXCEEDED')
  }
  const plan = createProjectPdfPlan(input)
  const PDFDocument = require('pdfkit') as PdfDocumentConstructor
  const svgToPdf = require('svg-to-pdfkit') as SvgToPdf
  const document = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: { Title: input.project.title, Creator: 'Infinite Board' },
  })
  const output = collectPdf(document)
  const contentX = PAGE_MARGIN
  const contentY = PAGE_MARGIN + TITLE_HEIGHT
  const contentWidth = PAGE_WIDTH - PAGE_MARGIN * 2
  const contentHeight = PAGE_HEIGHT - contentY - PAGE_MARGIN

  for (const page of plan.pages) {
    document.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 })
    document.addNamedDestination(page.destination, 'Fit')
    document.fontSize(20).fillColor('#0f172a').text(page.board.title, PAGE_MARGIN, PAGE_MARGIN, {
      width: contentWidth,
      height: TITLE_HEIGHT,
      ellipsis: true,
    })
    const rendered = renderSnapshot(page.board.tldrawSnapshot, input.assets)
    try {
      svgToPdf(document, rendered.svg, contentX, contentY, {
        width: contentWidth,
        height: contentHeight,
        preserveAspectRatio: 'xMidYMid meet',
        assumePt: true,
      })
    } catch {
      document.rect(contentX, contentY, contentWidth, contentHeight).fill('#f8fafc')
    }

    const scale = Math.min(
      contentWidth / rendered.viewBox.width,
      contentHeight / rendered.viewBox.height,
    )
    const offsetX = contentX + (contentWidth - rendered.viewBox.width * scale) / 2
    const offsetY = contentY + (contentHeight - rendered.viewBox.height * scale) / 2
    for (const link of page.links) {
      const bounds = rendered.shapeBoundsById.get(link.shapeId)
      if (!bounds) continue
      const targetPage = plan.pages[link.targetPageNo - 1]
      if (!targetPage) continue
      document.goTo(
        offsetX + (bounds.x - rendered.viewBox.x) * scale,
        offsetY + (bounds.y - rendered.viewBox.y) * scale,
        Math.max(1, bounds.width * scale),
        Math.max(1, bounds.height * scale),
        targetPage.destination,
      )
    }
  }
  addOutline(document.outline, plan.outline)
  document.end()
  return output
}
