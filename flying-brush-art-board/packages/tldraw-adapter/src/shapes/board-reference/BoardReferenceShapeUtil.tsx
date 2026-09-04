import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  type SvgExportContext,
  type TLResizeInfo,
} from 'tldraw'
import { useMemo, useSyncExternalStore } from 'react'

import { boardReferenceShapeMigrations } from './migrations.js'
import {
  BOARD_REFERENCE_SHAPE_TYPE,
  boardReferenceShapeProps,
  getBoardReferencePreviewMode,
  type BoardReferenceShape,
  type BoardReferencePreviewMode,
} from './schema.js'

export type BoardReferenceTitleResolver = (targetBoardId: string) => string | undefined
export interface BoardReferencePreview {
  title: string
  snapshot: unknown
}
export type BoardReferencePreviewResolver = (targetBoardId: string) => BoardReferencePreview | undefined
export type BoardReferenceOpenHandler = (shape: BoardReferenceShape) => void

export interface BoardReferenceThumbnailItem {
  id: string
  x: number
  y: number
  w: number
  h: number
  kind: 'rect' | 'ellipse' | 'image'
  color: string
  label?: string
  src?: string
}

export interface BoardReferenceThumbnailScene {
  items: BoardReferenceThumbnailItem[]
  totalCount: number
  viewBox: { x: number; y: number; w: number; h: number }
}

let titleResolver: BoardReferenceTitleResolver = () => undefined
let previewResolver: BoardReferencePreviewResolver = () => undefined
let openHandler: BoardReferenceOpenHandler | undefined
let resolverVersion = 0
const resolverListeners = new Set<() => void>()

function notifyResolverChanged(): void {
  resolverVersion += 1
  for (const listener of resolverListeners) listener()
}

function subscribeResolver(listener: () => void): () => void {
  resolverListeners.add(listener)
  return () => resolverListeners.delete(listener)
}

function resolverSnapshot(): number {
  return resolverVersion
}

export function setBoardReferenceTitleResolver(resolver: BoardReferenceTitleResolver): () => void {
  const previous = titleResolver
  titleResolver = resolver
  notifyResolverChanged()
  return () => {
    if (titleResolver === resolver) {
      titleResolver = previous
      notifyResolverChanged()
    }
  }
}

export function setBoardReferencePreviewResolver(resolver: BoardReferencePreviewResolver): () => void {
  const previous = previewResolver
  previewResolver = resolver
  notifyResolverChanged()
  return () => {
    if (previewResolver === resolver) {
      previewResolver = previous
      notifyResolverChanged()
    }
  }
}

export function setBoardReferenceOpenHandler(handler: BoardReferenceOpenHandler): () => void {
  const previous = openHandler
  openHandler = handler
  return () => {
    if (openHandler === handler) openHandler = previous
  }
}

const COLOR_MAP: Record<string, string> = {
  black: '#334155', grey: '#94a3b8', 'light-grey': '#cbd5e1', white: '#f8fafc',
  red: '#f87171', orange: '#fb923c', yellow: '#facc15', green: '#4ade80',
  blue: '#60a5fa', violet: '#a78bfa', purple: '#c084fc', pink: '#f472b6',
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object') return {}
  const value = snapshot as { store?: Record<string, unknown>; document?: { store?: Record<string, unknown> } }
  return value.document?.store ?? value.store ?? {}
}

function plainText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const parts: string[] = []
  const visit = (node: unknown) => {
    if (typeof node === 'string') return
    if (!node || typeof node !== 'object') return
    const candidate = node as { text?: unknown; content?: unknown }
    if (typeof candidate.text === 'string') parts.push(candidate.text)
    if (Array.isArray(candidate.content)) candidate.content.forEach(visit)
  }
  visit(value)
  const result = parts.join('').trim()
  return result || undefined
}

export function createBoardReferenceThumbnailScene(
  snapshot: unknown,
  limit = 80,
  previewMode: BoardReferencePreviewMode = 'content',
): BoardReferenceThumbnailScene {
  // Privacy is enforced before touching the target snapshot. This prevents a
  // future caller from accidentally extracting text, tables, or image sources.
  if (previewMode === 'private') {
    return { items: [], totalCount: 0, viewBox: { x: 0, y: 0, w: 320, h: 180 } }
  }
  const store = snapshotStore(snapshot)
  const records = Object.values(store).filter((record) => {
    if (!record || typeof record !== 'object') return false
    const value = record as { typeName?: unknown; type?: unknown }
    return value.typeName === 'shape' && value.type !== 'group'
  }) as Array<Record<string, unknown>>
  const items = records.slice(0, limit).flatMap((record) => {
    if (typeof record.id !== 'string' || typeof record.x !== 'number' || typeof record.y !== 'number') return []
    const props = record.props && typeof record.props === 'object' ? record.props as Record<string, unknown> : {}
    const w = typeof props.w === 'number' ? props.w : typeof props.width === 'number' ? props.width : 120
    const h = typeof props.h === 'number' ? props.h : typeof props.height === 'number' ? props.height : 72
    const semanticColor = record.type === 'trading-panel'
      ? 'blue'
      : record.type === 'table'
        ? 'violet'
        : record.type === 'board-reference'
          ? 'light-blue'
          : 'grey'
    const colorName = typeof props.color === 'string' ? props.color : typeof props.fill === 'string' ? props.fill : semanticColor
    const geo = typeof props.geo === 'string' ? props.geo : ''
    const text = plainText(props.richText) ?? plainText(props.text) ?? plainText(props.label) ?? plainText(props.title)
    const asset = typeof props.assetId === 'string' ? store[props.assetId] : undefined
    const assetProps = asset && typeof asset === 'object' && 'props' in asset && asset.props && typeof asset.props === 'object'
      ? asset.props as Record<string, unknown>
      : undefined
    const imageSrc = record.type === 'image' && typeof assetProps?.src === 'string' ? assetProps.src : undefined
    return [{
      id: record.id,
      x: record.x,
      y: record.y,
      w: Math.max(8, w),
      h: Math.max(8, h),
      kind: imageSrc ? 'image' as const : geo === 'ellipse' || geo === 'oval' ? 'ellipse' as const : 'rect' as const,
      color: COLOR_MAP[colorName] ?? '#94a3b8',
      ...(text ? { label: text.slice(0, 28) } : {}),
      ...(imageSrc ? { src: imageSrc } : {}),
    }]
  })
  if (items.length === 0) return { items: [], totalCount: records.length, viewBox: { x: 0, y: 0, w: 320, h: 180 } }
  const minX = Math.min(...items.map((item) => item.x))
  const minY = Math.min(...items.map((item) => item.y))
  const maxX = Math.max(...items.map((item) => item.x + item.w))
  const maxY = Math.max(...items.map((item) => item.y + item.h))
  const padding = Math.max(24, Math.max(maxX - minX, maxY - minY) * 0.08)
  return {
    items,
    totalCount: records.length,
    viewBox: { x: minX - padding, y: minY - padding, w: maxX - minX + padding * 2, h: maxY - minY + padding * 2 },
  }
}

export function BoardReferenceCardContent({ shape }: { shape: BoardReferenceShape }) {
  useSyncExternalStore(subscribeResolver, resolverSnapshot, resolverSnapshot)
  const previewMode = getBoardReferencePreviewMode(shape.props)
  // Do not even resolve the target snapshot for a private reference. Keeping
  // the snapshot out of this render path is stronger than hiding extracted DOM.
  const preview = previewMode === 'private'
    ? undefined
    : previewResolver(shape.props.targetBoardId)
  const title = preview?.title ?? titleResolver(shape.props.targetBoardId) ?? shape.props.titleFallback
  const scene = useMemo(
    () => preview ? createBoardReferenceThumbnailScene(preview.snapshot, 80, previewMode) : undefined,
    [preview?.snapshot, previewMode],
  )
  const previewLabels = useMemo(
    () => Array.from(new Set(scene?.items.map((item) => item.label).filter((label): label is string => Boolean(label)) ?? [])).slice(0, 2),
    [scene],
  )
  return <>
    <div
      className="board-reference-shape__preview"
      data-preview-mode={previewMode}
      data-preview-state={previewMode === 'private' ? 'private' : !preview ? 'unavailable' : scene?.items.length ? 'ready' : 'empty'}
    >
      {previewMode === 'private' ? (
        <span aria-label="私密画板，内容预览已隐藏">私密画板 · 内容预览已隐藏</span>
      ) : scene?.items.length ? (
        <svg
          aria-label={`${title} 缩略图`}
          role="img"
          viewBox={`${scene.viewBox.x} ${scene.viewBox.y} ${scene.viewBox.w} ${scene.viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {scene.items.map((item) => item.kind === 'image' && item.src ? (
            <image key={item.id} href={item.src} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="xMidYMid slice" />
          ) : item.kind === 'ellipse' ? (
            <ellipse key={item.id} cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} fill={item.color} fillOpacity="0.72" />
          ) : (
            <g key={item.id}>
              <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={Math.min(12, item.h / 5)} fill={item.color} fillOpacity="0.72" />
              {item.label && item.w > 60 && item.h > 26 ? <text x={item.x + 8} y={item.y + Math.min(item.h - 8, 22)} fontSize="14" fill="#172033">{item.label}</text> : null}
            </g>
          ))}
        </svg>
      ) : <span>{preview ? '空白画板' : '预览不可用'}</span>}
      {previewMode === 'content' && previewLabels.length ? (
        <div className="board-reference-shape__preview-summary" aria-hidden="true">
          {previewLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
      ) : null}
      {scene && scene.totalCount > scene.items.length ? <small>+{scene.totalCount - scene.items.length}</small> : null}
    </div>
    <footer className="board-reference-shape__footer">
      <span className="board-reference-shape__kind">{shape.props.kind === 'embed' ? '子画板' : '画板链接'}</span>
      <strong>{title}</strong>
      {previewMode === 'private' ? <span aria-label="私密">锁定</span> : null}
    </footer>
  </>
}

export class BoardReferenceShapeUtil extends BaseBoxShapeUtil<BoardReferenceShape> {
  static override type = BOARD_REFERENCE_SHAPE_TYPE
  static override props = boardReferenceShapeProps
  static override migrations = boardReferenceShapeMigrations

  override getDefaultProps(): BoardReferenceShape['props'] {
    return {
      w: 300,
      h: 168,
      referenceId: '',
      targetBoardId: '',
      kind: 'link',
      titleFallback: '未命名画板',
      previewMode: 'content',
    }
  }

  override getGeometry(shape: BoardReferenceShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override canEdit() {
    return false
  }

  override onDoubleClick(shape: BoardReferenceShape) {
    openHandler?.(shape)
    // The callback itself handles navigation. Returning a partial would make
    // tldraw write a no-op shape update into the realtime room on every open.
  }

  override component(shape: BoardReferenceShape) {
    return (
      <HTMLContainer>
        <article
          className="board-reference-shape"
          data-reference-id={shape.props.referenceId}
          data-reference-kind={shape.props.kind}
          style={{ width: shape.props.w, height: shape.props.h }}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openHandler?.(shape)
          }}
        >
          <BoardReferenceCardContent shape={shape} />
        </article>
      </HTMLContainer>
    )
  }

  override toSvg(shape: BoardReferenceShape, _context: SvgExportContext) {
    const previewMode = getBoardReferencePreviewMode(shape.props)
    // Private export never resolves the target Board snapshot. Content export
    // keeps the existing minimap semantics through a native SVG representation.
    const preview = previewMode === 'private'
      ? undefined
      : previewResolver(shape.props.targetBoardId)
    const title = preview?.title ?? titleResolver(shape.props.targetBoardId) ?? shape.props.titleFallback
    const scene = preview ? createBoardReferenceThumbnailScene(preview.snapshot) : undefined
    const previewHeight = Math.max(24, shape.props.h - 48)

    if (previewMode !== 'private') {
      return (
        <g data-preview-mode="content" aria-label={`${title}，画板引用`}>
          <rect width={shape.props.w} height={shape.props.h} rx="12" fill="#f8fafc" stroke="#94a3b8" />
          {scene?.items.length ? (
            <svg
              x="0"
              y="0"
              width={shape.props.w}
              height={previewHeight}
              viewBox={`${scene.viewBox.x} ${scene.viewBox.y} ${scene.viewBox.w} ${scene.viewBox.h}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {scene.items.map((item) => item.kind === 'image' && item.src ? (
                <image key={item.id} href={item.src} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="xMidYMid slice" />
              ) : item.kind === 'ellipse' ? (
                <ellipse key={item.id} cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} fill={item.color} fillOpacity="0.72" />
              ) : (
                <g key={item.id}>
                  <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={Math.min(12, item.h / 5)} fill={item.color} fillOpacity="0.72" />
                  {item.label && item.w > 60 && item.h > 26 ? <text x={item.x + 8} y={item.y + Math.min(item.h - 8, 22)} fontSize="14" fill="#172033">{item.label}</text> : null}
                </g>
              ))}
            </svg>
          ) : (
            <text x="18" y={Math.max(24, previewHeight / 2)} fontSize="14" fill="#64748b">
              {preview ? '空白画板' : '预览不可用'}
            </text>
          )}
          <line x1="0" y1={previewHeight} x2={shape.props.w} y2={previewHeight} stroke="#cbd5e1" />
          <text x="18" y={shape.props.h - 18} fontSize="18" fontWeight="600" fill="#172033">{title}</text>
        </g>
      )
    }

    // SVG export uses its own redacted representation, so private text cannot
    // leak through export paths.
    return (
      <g data-preview-mode="private" aria-label={`${title}，私密画板`}>
        <rect width={shape.props.w} height={shape.props.h} rx="12" fill="#f8fafc" stroke="#94a3b8" />
        <rect x="18" y="18" width="22" height="18" rx="4" fill="#64748b" />
        <path d="M23 18v-4a6 6 0 0 1 12 0v4" fill="none" stroke="#64748b" strokeWidth="3" />
        <text x="52" y="33" fontSize="14" fill="#475569">私密画板 · 内容预览已隐藏</text>
        <text x="18" y={shape.props.h - 20} fontSize="18" fontWeight="600" fill="#172033">{title}</text>
      </g>
    )
  }

  override getIndicatorPath() {
    return undefined
  }

  override onResize(shape: BoardReferenceShape, info: TLResizeInfo<BoardReferenceShape>) {
    return resizeBox(shape, info)
  }

}

export const boardReferenceShapeUtils = [BoardReferenceShapeUtil] as const
