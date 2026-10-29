import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { SelectionAll, Table as TableIcon, TreeStructure } from '@phosphor-icons/react'
import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  ArrowShapeKindStyle,
  AssetToolbarItem,
  clearArrowTargetState,
  createShapeId,
  DefaultActionsMenu,
  DefaultContextMenu,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultStylePanel,
  DefaultStylePanelContent,
  DefaultTextAlignStyle,
  DefaultContextMenuContent,
  DefaultToolbar,
  DistributeMenuItems,
  GroupOrUngroupMenuItem,
  ReorderMenuItems,
  RotateCWMenuItem,
  StackMenuItems,
  Tldraw,
  TldrawUiIcon,
  TldrawUiContextualToolbar,
  TldrawUiDropdownMenuContent,
  TldrawUiDropdownMenuRoot,
  TldrawUiDropdownMenuTrigger,
  TldrawUiMenuContextProvider,
  TldrawUiMenuActionItem,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  TldrawUiPopover,
  TldrawUiPopoverContent,
  TldrawUiPopoverTrigger,
  TldrawUiSlider,
  TldrawUiToolbar,
  TldrawUiToolbarButton,
  StylePanelButtonPicker,
  StylePanelSection,
  TextShapeUtil,
  ToolbarItem,
  ZoomOrRotateMenuItem,
  getColorStyleItems,
  getColorValue,
  getFontStyleItems,
  ReadonlySharedStyleMap,
  type Editor,
  type TLArrowShape,
  type TLAnyShapeUtilConstructor,
  type TLComponents,
  type TLDefaultColorStyle,
  type TLShape,
  type TLShapeId,
  type TLTextShape,
  type TLRichText,
  type TiptapEditor,
  type TLUiActionItem,
  type TLUiActionsMenuProps,
  type TLUiContextMenuProps,
  type TLUiOverrides,
  type TLStore,
  type TLUiStylePanelProps,
  type TLUiToolItem,
  type StyleProp,
  useEditor,
  useColorMode,
  useTools,
  useValue,
  tipTapDefaultExtensions,
} from 'tldraw'

import type { BoardReferenceKind } from '@infinite-board/board-core'
import { CommerceGeoShapeUtil } from '../commerce/CommerceDesignCanvas'
import { itemValueVisibility } from '../commerce/item-value-map'
import {
  boardReferenceShapeUtils,
  clearManualElbowRouteMeta,
  clearTableCells,
  copyMindMapBranch,
  copyMindMapNodeVisualStyle,
  deleteMindMapBranch,
  deleteTableColumn,
  deleteTableRow,
  distributeTableColumns,
  distributeTableRows,
  duplicateTableColumn,
  duplicateTableRow,
  duplicateMindMapBranch,
  getCanvasShapeInteractionTarget,
  getMindMapRoot,
  getMindMapRootAnchorDelta,
  getMindMapBranchClipboard,
  getMindMapStyleClipboard,
  insertTableColumn,
  insertTableRow,
  autoFitTableRows,
  mindMapShapeTools,
  mindMapShapeUtils,
  enhancedArrowShapeUtils,
  readManualElbowRoute,
  pasteMindMapBranch,
  pasteMindMapNodeVisualStyle,
  setMindMapBranchClipboard,
  setMindMapStyleClipboard,
  subscribeCanvasShapeInteractionTarget,
  setMindMapBranchSide,
  setMindMapLayout,
  setMindMapTheme,
  tableShapeTools,
  tableShapeUtils,
  toggleTableHeaderRow,
  updateTableCellStyles,
  toggleMindMapCollapsed,
  updateMindMapNodeStyle,
  resolveMindMapNodeStyle,
  addMindMapChild,
  addMindMapSibling,
  type MindMapShape,
  type MindMapNodeStyle,
  type MindMapPaletteColor,
  type TableShape,
  type TableCellStylePatch,
  type TableCellTextColor,
  type TableFontFamily,
  type TableTextAlign,
  setBoardReferenceOpenHandler,
  type BoardReferenceShape,
} from '@infinite-board/tldraw-adapter'
import { CommentDraftPin, CommentPendingPin, CommentPins } from '../comments/CommentPins'
import type { CommentThreadView } from '../comments/comment-client'
import type { TldrawUserIdentity } from '../auth/tldraw-user'
import { CANVAS_ASSET_URLS } from './tldraw-assets'
import {
  readCanvasToolStylePreference,
  writeCanvasToolStylePreference,
  writeTextBackgroundPreference,
  type CanvasToolStyleKind,
  type CanvasToolStylePreference,
  type TextBackgroundPreference,
  type TextFormatPreference,
} from './tool-style-preferences'

export const CANVAS_TLDRAW_OPTIONS = {
  maxShapesPerPage: 10_000,
  text: {
    tipTapConfig: {
      // The bundled Tiptap 3 StarterKit already registers underline.
      extensions: tipTapDefaultExtensions,
    },
  },
}

export interface CanvasLicenseEnvironment {
  VITE_TLDRAW_LICENSE_KEY?: unknown
}

/** Vite replaces import.meta.env in browser builds; the Node fallback keeps tests SSR-safe. */
export function getCanvasLicenseKey(
  environment: CanvasLicenseEnvironment | undefined = (import.meta as ImportMeta & { env?: CanvasLicenseEnvironment }).env,
): string | undefined {
  const viteKey = environment?.VITE_TLDRAW_LICENSE_KEY
  if (typeof viteKey === 'string' && viteKey.length > 0) return viteKey

  const nodeKey = typeof process !== 'undefined' ? process.env.VITE_TLDRAW_LICENSE_KEY : undefined
  return nodeKey || undefined
}

export interface CanvasEditorProps {
  /** Passed directly to tldraw; the value is never rendered or logged. */
  licenseKey?: string
  /** Authenticated identity used for collaboration labels and per-account canvas preferences. */
  tldrawUser?: TldrawUserIdentity
  store?: TLStore
  /** Changes whenever the active tab starts editing a different Board. */
  inputSessionKey?: string
  /**
   * When supplied, tldraw starts as read-only and this synchronous gate must
   * approve an edit intent before tldraw receives a mutable input event.
   */
  onEditIntent?: () => boolean
  /** 在 tldraw 原生粘贴处理前同步分流应用剪贴板和外部文本。 */
  onClipboardPaste?(input: {
    editor: Editor
    event: ClipboardEvent
    pasteAsPlainText: boolean
  }): boolean
  onMount?: (editor: Editor) => void
  onBoardReferenceOpen?(shape: BoardReferenceShape): void
  boardReferenceActions?: BoardReferenceActions
  referenceToolActive?: boolean
  onReferenceToolToggle?(): void
  onReferenceToolCancel?(): void
  onReferencePlace?(placement: { x: number; y: number }): void
  commentToolActive?: boolean
  pendingCommentAnchor?: { shapeId?: string; x: number; y: number; shapeOffsetX?: number; shapeOffsetY?: number }
  onCommentToolToggle?(): void
  onCommentCancel?(): void
  onCommentPlace?(anchor: { shapeId?: string; x: number; y: number; shapeOffsetX?: number; shapeOffsetY?: number }): void
  commentThreads?: readonly CommentThreadView[]
  onFocusCommentThread?(threadId: string): void
  onMoveCommentThread?(threadId: string, anchor: { x: number; y: number }): void
  onDeleteCommentThread?(threadId: string): void
  onBoardReferenceDrop?(event: { boardId: string; x: number; y: number }): void
}

export interface BoardReferenceActions {
  enter(shape: BoardReferenceShape): void
  openInNewTab(shape: BoardReferenceShape): void
  renameTarget(shape: BoardReferenceShape): void
  changeKind(shape: BoardReferenceShape, kind: BoardReferenceKind): void
  remove(shape: BoardReferenceShape): void
}

const BOARD_DRAG_TYPE = 'application/x-infinite-board-board-id'

function canGroupSelectedShapes(editor: Editor): boolean {
  if (editor.getIsReadonly() || !editor.isIn('select')) return false

  const selectedShapes = editor.getSelectedShapes()
  if (selectedShapes.length < 2) return false

  const selectedShapeIds = new Set(selectedShapes.map((shape) => shape.id))
  return selectedShapes.every((shape) => {
    if (editor.isShapeOrAncestorLocked(shape)) return false
    if (!editor.isShapeOfType(shape, 'arrow')) return true

    return editor.getBindingsFromShape(shape.id, 'arrow')
      .every((binding) => selectedShapeIds.has(binding.toId))
  })
}

function getSelectedGroupLayoutChildIds(editor: Editor): TLShapeId[] | undefined {
  const group = editor.getOnlySelectedShape()
  if (!group || group.type !== 'group' || editor.isShapeOrAncestorLocked(group)) return undefined

  const childIds = editor.getSortedChildIdsForParent(group.id)
  if (childIds.length < 2) return undefined
  if (childIds.some((id) => {
    const child = editor.getShape(id)
    return !child || editor.isShapeOrAncestorLocked(child)
  })) return undefined

  return childIds
}

function canUngroupSelectedGroup(editor: Editor, group: TLShape): boolean {
  if (group.type !== 'group') return false
  if (editor.isShapeOrAncestorLocked(group)) return false
  if (typeof editor.getShape !== 'function') return true
  return editor.getSortedChildIdsForParent(group.id).every((childId) => {
    const child = editor.getShape(childId)
    return Boolean(child) && !editor.isShapeOrAncestorLocked(child)
  })
}

function groupAwareLayoutAction(
  editor: Editor,
  action: TLUiActionItem,
  historyName: string,
  apply: (shapeIds: TLShapeId[]) => void,
): TLUiActionItem {
  return {
    ...action,
    onSelect(source) {
      const selectedShape = editor.getOnlySelectedShape()
      if (selectedShape?.type !== 'group') {
        action.onSelect(source)
        return
      }
      if (editor.getIsReadonly() || !editor.isIn('select')) return

      const childIds = getSelectedGroupLayoutChildIds(editor)
      if (!childIds) return
      editor.markHistoryStoppingPoint(historyName)
      editor.run(() => apply(childIds))
    },
  }
}

const TEXT_BACKGROUND_META_KEY = 'infiniteBoardTextBackground'
const PENDING_TEXT_FORMATS_META_KEY = 'infiniteBoardPendingTextFormats'
const TEXT_BACKGROUND_FILL_ITEMS = [
  { value: 'none', icon: 'fill-none' },
  { value: 'semi', icon: 'fill-semi' },
  { value: 'solid', icon: 'fill-solid' },
  { value: 'pattern', icon: 'fill-pattern' },
] as const
const TEXT_BACKGROUND_FILLS = new Set<TextBackgroundPreference['fill']>(['none', 'semi', 'solid', 'pattern'])

type TextBackgroundStyle = TextBackgroundPreference

type TextFormatMark = 'bold' | 'italic' | 'underline' | 'strike'
type RichTextNode = {
  type?: string
  text?: string
  marks?: Array<{ type?: string; [key: string]: unknown }>
  content?: RichTextNode[]
  [key: string]: unknown
}

const TEXT_FORMAT_MARK_ITEMS = [
  { mark: 'bold', icon: 'bold', label: '粗体', command: 'toggleBold' },
  { mark: 'italic', icon: 'italic', label: '斜体', command: 'toggleItalic' },
  { mark: 'underline', icon: 'underline', label: '下划线', command: 'toggleUnderline' },
  { mark: 'strike', icon: 'strike', label: '删除线', command: 'toggleStrike' },
] as const satisfies readonly { mark: TextFormatMark; icon: string; label: string; command: string }[]

function visitRichTextNodes(
  richText: TLRichText,
  visitor: (node: RichTextNode) => RichTextNode,
): TLRichText {
  const visit = (node: RichTextNode): RichTextNode => visitor({
    ...node,
    ...(node.content ? { content: node.content.map(visit) } : {}),
  })
  return visit(richText as unknown as RichTextNode) as unknown as TLRichText
}

function richTextMarkState(richText: TLRichText, mark: TextFormatMark): boolean {
  let hasText = false
  let everyTextNodeHasMark = true
  const visit = (node: RichTextNode) => {
    if (node.type === 'text' && typeof node.text === 'string' && node.text.length > 0) {
      hasText = true
      if (!node.marks?.some((candidate) => candidate.type === mark)) everyTextNodeHasMark = false
    }
    node.content?.forEach(visit)
  }
  visit(richText as unknown as RichTextNode)
  return hasText && everyTextNodeHasMark
}

function toggleRichTextMark(richText: TLRichText, mark: TextFormatMark): TLRichText {
  const nextActive = !richTextMarkState(richText, mark)
  return visitRichTextNodes(richText, (node) => {
    if (node.type !== 'text' || typeof node.text !== 'string') return node
    const marks = node.marks ?? []
    return {
      ...node,
      marks: nextActive
        ? (marks.some((candidate) => candidate.type === mark) ? marks : [...marks, { type: mark }])
        : marks.filter((candidate) => candidate.type !== mark),
    }
  })
}

const DEFAULT_TEXT_BACKGROUND_STYLE: TextBackgroundStyle = { color: 'yellow', fill: 'none' }
const DEFAULT_TEXT_FORMAT_PREFERENCE: TextFormatPreference = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
}

function textFormatPreferenceFromRichText(richText: TLRichText): TextFormatPreference {
  return {
    bold: richTextMarkState(richText, 'bold'),
    italic: richTextMarkState(richText, 'italic'),
    underline: richTextMarkState(richText, 'underline'),
    strike: richTextMarkState(richText, 'strike'),
  }
}

function applyPreferredRichTextMarks(
  richText: TLRichText,
  formats: TextFormatPreference,
): TLRichText {
  return visitRichTextNodes(richText, (node) => {
    if (node.type !== 'text' || typeof node.text !== 'string') return node
    const marks = [...(node.marks ?? [])]
    for (const item of TEXT_FORMAT_MARK_ITEMS) {
      if (formats[item.mark] && !marks.some((candidate) => candidate.type === item.mark)) {
        marks.push({ type: item.mark })
      }
    }
    return { ...node, marks }
  })
}

function hasRichTextContent(richText: TLRichText): boolean {
  let hasContent = false
  visitRichTextNodes(richText, (node) => {
    if (node.type === 'text' && typeof node.text === 'string' && node.text.length > 0) hasContent = true
    return node
  })
  return hasContent
}

function getTextBackgroundStyle(shape: TLTextShape): TextBackgroundStyle {
  const stored = shape.meta[TEXT_BACKGROUND_META_KEY]
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return DEFAULT_TEXT_BACKGROUND_STYLE
  }
  const value = stored as Record<string, unknown>
  return {
    color: typeof value.color === 'string' ? value.color as TLDefaultColorStyle : 'yellow',
    fill: typeof value.fill === 'string' && TEXT_BACKGROUND_FILLS.has(value.fill as TextBackgroundPreference['fill'])
      ? value.fill as TextBackgroundPreference['fill']
      : 'none',
  }
}

const CANVAS_TOOL_STYLE_PROPS = {
  arrow: [
    ArrowShapeKindStyle,
    DefaultColorStyle,
    DefaultFillStyle,
    DefaultDashStyle,
    DefaultSizeStyle,
    ArrowShapeArrowheadStartStyle,
    ArrowShapeArrowheadEndStyle,
    DefaultFontStyle,
  ],
  text: [
    DefaultColorStyle,
    DefaultSizeStyle,
    DefaultFontStyle,
    DefaultTextAlignStyle,
  ],
} satisfies Record<CanvasToolStyleKind, readonly StyleProp<any>[]>

const ARROW_SHAPE_STYLE_PROPS = [
  { style: DefaultColorStyle, prop: 'color' },
  { style: DefaultFillStyle, prop: 'fill' },
  { style: DefaultDashStyle, prop: 'dash' },
  { style: DefaultSizeStyle, prop: 'size' },
  { style: ArrowShapeArrowheadStartStyle, prop: 'arrowheadStart' },
  { style: ArrowShapeArrowheadEndStyle, prop: 'arrowheadEnd' },
  { style: DefaultFontStyle, prop: 'font' },
] as const

function validatedStyleValue<T>(style: StyleProp<T>, value: unknown): T | undefined {
  if (value === undefined) return undefined
  try {
    return style.validate(value)
  } catch {
    return undefined
  }
}

function defaultCanvasToolStylePreference(kind: CanvasToolStyleKind): CanvasToolStylePreference {
  return {
    styles: Object.fromEntries(CANVAS_TOOL_STYLE_PROPS[kind].map((style) => [
      style.id,
      style === ArrowShapeKindStyle ? 'elbow' : style.defaultValue,
    ])),
    opacity: 1,
    ...(kind === 'text' ? {
      background: DEFAULT_TEXT_BACKGROUND_STYLE,
      formats: DEFAULT_TEXT_FORMAT_PREFERENCE,
    } : {}),
  }
}

function activeCanvasToolStyleKind(editor: Editor): CanvasToolStyleKind | undefined {
  const toolId = editor.getCurrentToolId().split('.')[0]
  if (toolId === 'arrow' || toolId === 'text') return toolId
  if (toolId !== 'select') return undefined

  const selectedShapes = editor.getSelectedShapes()
  if (selectedShapes.length === 0) return undefined
  if (selectedShapes.every((shape) => shape.type === 'arrow')) return 'arrow'
  if (selectedShapes.every((shape) => shape.type === 'text')) return 'text'
  return undefined
}

function captureCanvasToolStylePreference(
  editor: Editor,
  kind: CanvasToolStyleKind,
  accountId?: string,
): CanvasToolStylePreference {
  const instance = editor.getInstanceState()
  const selectedShape = editor.getOnlySelectedShape()
  const formats = kind === 'text'
    ? selectedShape?.type === 'text'
      ? textFormatPreferenceFromRichText(selectedShape.props.richText)
      : readTextFormatPreference(editor, accountId)
    : undefined
  return {
    styles: Object.fromEntries(CANVAS_TOOL_STYLE_PROPS[kind].map((style) => [
      style.id,
      editor.getStyleForNextShape(style),
    ])),
    opacity: instance.opacityForNextShape,
    ...(kind === 'text' ? {
      ...(selectedShape?.type === 'text'
        ? { background: getTextBackgroundStyle(selectedShape) }
        : {}),
      ...(formats ? { formats } : {}),
    } : {}),
  }
}

function applyCanvasToolStylePreference(
  editor: Editor,
  kind: CanvasToolStyleKind,
  preference: CanvasToolStylePreference,
): void {
  const apply = () => {
    for (const style of CANVAS_TOOL_STYLE_PROPS[kind]) {
      const value = validatedStyleValue(style, preference.styles[style.id])
      if (value !== undefined) editor.setStyleForNextShapes(style, value)
    }
    editor.setOpacityForNextShapes(preference.opacity)
  }
  editor.run(apply)
}

function arrowShapePropsFromPreference(accountId: string | undefined): Partial<TLArrowShape['props']> {
  const preference = accountId
    ? readCanvasToolStylePreference(accountId, 'arrow') ?? defaultCanvasToolStylePreference('arrow')
    : defaultCanvasToolStylePreference('arrow')
  const props: Partial<TLArrowShape['props']> = {}
  for (const { style, prop } of ARROW_SHAPE_STYLE_PROPS) {
    const value = validatedStyleValue(style, preference.styles[style.id]) ?? style.defaultValue
    ;(props as Record<string, unknown>)[prop] = value
  }
  if (props.color !== undefined) props.labelColor = props.color
  return props
}

function arrowShapeOpacityFromPreference(accountId: string | undefined): number {
  if (!accountId) return 1
  return readCanvasToolStylePreference(accountId, 'arrow')?.opacity ?? 1
}

const canvasToolStyleAccountByEditor = new WeakMap<Editor, string>()
const canvasTextFormatPreferenceByEditor = new WeakMap<Editor, TextFormatPreference>()

function readTextFormatPreference(editor: Editor, accountId?: string): TextFormatPreference {
  return canvasTextFormatPreferenceByEditor.get(editor)
    ?? (accountId ? readCanvasToolStylePreference(accountId, 'text')?.formats : undefined)
    ?? DEFAULT_TEXT_FORMAT_PREFERENCE
}

function writeTextFormatPreference(
  editor: Editor,
  accountId: string | undefined,
  formats: TextFormatPreference,
): void {
  canvasTextFormatPreferenceByEditor.set(editor, formats)
  if (!accountId) return
  const current = readCanvasToolStylePreference(accountId, 'text')
    ?? defaultCanvasToolStylePreference('text')
  writeCanvasToolStylePreference(accountId, 'text', { ...current, formats })
}

function CanvasToolStylePreferenceBridge({ accountId }: { accountId?: string }) {
  const editor = useEditor()
  const suppressPersistenceRef = useRef(false)
  const releaseTimerRef = useRef<number | undefined>(undefined)
  const active = useValue(
    'active canvas tool style preference',
    () => {
      if (!accountId) return undefined
      const kind = activeCanvasToolStyleKind(editor)
      if (!kind) return undefined
      const preference = captureCanvasToolStylePreference(editor, kind, accountId)
      return { kind, preference, serialized: JSON.stringify(preference) }
    },
    [accountId, editor],
  )

  useLayoutEffect(() => {
    if (releaseTimerRef.current !== undefined) window.clearTimeout(releaseTimerRef.current)
    if (!accountId || !active?.kind) {
      suppressPersistenceRef.current = false
      return
    }

    suppressPersistenceRef.current = true
    applyCanvasToolStylePreference(
      editor,
      active.kind,
      readCanvasToolStylePreference(accountId, active.kind)
        ?? defaultCanvasToolStylePreference(active.kind),
    )
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = undefined
      suppressPersistenceRef.current = false
    }, 0)
    return () => {
      if (releaseTimerRef.current !== undefined) window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = undefined
    }
  }, [accountId, active?.kind, editor])

  useEffect(() => {
    if (!accountId || !active || suppressPersistenceRef.current) return
    const previous = active.kind === 'text'
      ? readCanvasToolStylePreference(accountId, 'text')
      : undefined
    if (active.kind === 'text' && active.preference.formats) {
      canvasTextFormatPreferenceByEditor.set(editor, active.preference.formats)
    }
    writeCanvasToolStylePreference(accountId, active.kind, {
      ...active.preference,
      ...(active.kind === 'text'
        ? {
          background: active.preference.background ?? previous?.background ?? DEFAULT_TEXT_BACKGROUND_STYLE,
          formats: active.preference.formats ?? previous?.formats ?? DEFAULT_TEXT_FORMAT_PREFERENCE,
        }
        : {}),
    })
  }, [accountId, active?.kind, active?.serialized])

  return null
}

class CanvasTextShapeUtil extends TextShapeUtil {
  override onBeforeCreate(shape: TLTextShape) {
    const accountId = canvasToolStyleAccountByEditor.get(this.editor)
    const background = accountId
      ? readCanvasToolStylePreference(accountId, 'text')?.background
      : undefined
    const formats = readTextFormatPreference(this.editor, accountId)
    const hasFormats = Object.values(formats).some(Boolean)
    const hasContent = hasRichTextContent(shape.props.richText)
    const hasPendingFormats = PENDING_TEXT_FORMATS_META_KEY in shape.meta
    if (!background && !hasFormats && !hasPendingFormats) return undefined

    const formattedRichText = hasContent && hasFormats
      ? applyPreferredRichTextMarks(shape.props.richText, formats)
      : undefined
    const { [PENDING_TEXT_FORMATS_META_KEY]: _pending, ...meta } = shape.meta
    return {
      ...shape,
      meta: {
        ...meta,
        ...(background ? { [TEXT_BACKGROUND_META_KEY]: background } : {}),
        ...(hasFormats && !hasContent ? { [PENDING_TEXT_FORMATS_META_KEY]: formats } : {}),
      } as unknown as TLTextShape['meta'],
      ...(formattedRichText ? {
        props: {
          ...shape.props,
          richText: formattedRichText,
        },
      } : {}),
    }
  }

  override onBeforeUpdate(previous: TLTextShape, next: TLTextShape) {
    const pending = previous.meta[PENDING_TEXT_FORMATS_META_KEY]
    let formattedNext = next
    if (
      pending
      && typeof pending === 'object'
      && !Array.isArray(pending)
      && hasRichTextContent(next.props.richText)
    ) {
      const formats: TextFormatPreference = {
        bold: pending.bold === true,
        italic: pending.italic === true,
        underline: pending.underline === true,
        strike: pending.strike === true,
      }
      const { [PENDING_TEXT_FORMATS_META_KEY]: _pending, ...meta } = next.meta
      formattedNext = {
        ...next,
        meta,
        props: {
          ...next.props,
          richText: applyPreferredRichTextMarks(next.props.richText, formats),
        },
      }
    }

    return super.onBeforeUpdate(previous, formattedNext)
      ?? (formattedNext === next ? undefined : formattedNext)
  }

  backgroundComponent(shape: TLTextShape) {
    const colorMode = useColorMode()
    const background = getTextBackgroundStyle(shape)
    if (background.fill === 'none') return null

    const colors = this.editor.getCurrentTheme().colors[colorMode]
    const semi = getColorValue(colors, background.color, 'semi')
    const solid = getColorValue(colors, background.color, 'fill')
    const pattern = getColorValue(colors, background.color, 'pattern')

    return <div
      aria-hidden="true"
      data-testid={`text-background-${shape.id}`}
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 3,
        pointerEvents: 'none',
        backgroundColor: background.fill === 'solid' ? solid : semi,
        ...(background.fill === 'pattern' ? {
          backgroundImage: `radial-gradient(${pattern} 1px, transparent 1px)`,
          backgroundSize: '6px 6px',
        } : {}),
      }}
    />
  }

  override toSvg(shape: TLTextShape, ctx: Parameters<TextShapeUtil['toSvg']>[1]) {
    const text = super.toSvg(shape, ctx)
    const background = getTextBackgroundStyle(shape)
    if (background.fill === 'none') return text

    const bounds = this.editor.getShapeGeometry(shape).bounds
    const scale = shape.props.scale ?? 1
    const width = bounds.width / scale
    const height = bounds.height / scale
    const colors = this.editor.getCurrentTheme().colors[ctx.colorMode]
    const semi = getColorValue(colors, background.color, 'semi')
    const solid = getColorValue(colors, background.color, 'fill')
    const pattern = getColorValue(colors, background.color, 'pattern')
    const patternId = `text-background-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

    return <g>
      {background.fill === 'pattern' ? <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={semi} />
          <circle cx="1" cy="1" r="1" fill={pattern} />
        </pattern>
      </defs> : null}
      <rect
        width={width}
        height={height}
        rx="3"
        fill={background.fill === 'pattern' ? `url(#${patternId})` : background.fill === 'solid' ? solid : semi}
      />
      {text}
    </g>
  }
}

const CANVAS_UI_OVERRIDES = {
  actions(editor, actions) {
    const groupAction = actions.group
    if (!groupAction) return actions
    const ungroupAction = actions.ungroup

    return {
      ...actions,
      group: {
        ...groupAction,
        onSelect() {
          if (!canGroupSelectedShapes(editor)) return
          editor.markHistoryStoppingPoint('group')
          editor.groupShapes(editor.getSelectedShapeIds())
        },
      },
      ...(ungroupAction && typeof editor.getShape === 'function' ? {
        ungroup: {
          ...ungroupAction,
          onSelect(source) {
            const group = editor.getOnlySelectedShape()
            if (!group || !canUngroupSelectedGroup(editor, group)) return
            ungroupAction.onSelect(source)
          },
        },
      } : {}),
      'align-left': groupAwareLayoutAction(editor, actions['align-left']!, 'align left', (ids) => editor.alignShapes(ids, 'left')),
      'align-center-horizontal': groupAwareLayoutAction(editor, actions['align-center-horizontal']!, 'align center horizontal', (ids) => editor.alignShapes(ids, 'center-horizontal')),
      'align-right': groupAwareLayoutAction(editor, actions['align-right']!, 'align right', (ids) => editor.alignShapes(ids, 'right')),
      'stretch-horizontal': groupAwareLayoutAction(editor, actions['stretch-horizontal']!, 'stretch horizontal', (ids) => editor.stretchShapes(ids, 'horizontal')),
      'align-top': groupAwareLayoutAction(editor, actions['align-top']!, 'align top', (ids) => editor.alignShapes(ids, 'top')),
      'align-center-vertical': groupAwareLayoutAction(editor, actions['align-center-vertical']!, 'align center vertical', (ids) => editor.alignShapes(ids, 'center-vertical')),
      'align-bottom': groupAwareLayoutAction(editor, actions['align-bottom']!, 'align bottom', (ids) => editor.alignShapes(ids, 'bottom')),
      'stretch-vertical': groupAwareLayoutAction(editor, actions['stretch-vertical']!, 'stretch vertical', (ids) => editor.stretchShapes(ids, 'vertical')),
    }
  },
  tools(editor, tools) {
    return {
      ...tools,
      table: {
        id: 'table',
        label: '表格',
        icon: <TableIcon size={18} weight="regular" />,
        kbd: 'shift+t',
        onSelect() { editor.setCurrentTool('table') },
      },
      'mind-map': {
        id: 'mind-map',
        label: '思维导图',
        icon: <TreeStructure size={18} weight="regular" />,
        kbd: 'm',
        onSelect() { editor.setCurrentTool('mind-map') },
      },
    }
  },
  translations: {
    'zh-cn': {
      'action.copy-hovered-styles': '复制悬停样式',
      'action.frame-selection': '为所选内容创建分区',
      'action.group': '组合',
      'action.open-cursor-chat': '临时消息',
      'action.ungroup': '取消组合',
      'page-menu.max-pages-reached': '已达到最大页面数量',
      'page-menu.resize': '调整页面列表大小',
      'tool.frame': '分区',
    },
  },
} satisfies TLUiOverrides

type PenEraserToolId = 'draw' | 'eraser'

const lastPenEraserToolByEditor = new WeakMap<Editor, PenEraserToolId>()
const CANVAS_SHAPE_UTILS = [
  CommerceGeoShapeUtil,
  CanvasTextShapeUtil,
  ...enhancedArrowShapeUtils,
  ...boardReferenceShapeUtils,
  ...tableShapeUtils,
  ...mindMapShapeUtils,
] as TLAnyShapeUtilConstructor[]
const CANVAS_TOOLS = [...tableShapeTools, ...mindMapShapeTools]

const VISIBLE_CANVAS_TOOL_IDS = [
  'text',
  'note',
  'frame',
  'table',
  'mind-map',
  'asset',
  'arrow',
  'rectangle',
  'ellipse',
  'triangle',
  'diamond',
  'hexagon',
  'oval',
  'rhombus',
  'star',
  'cloud',
  'heart',
  'x-box',
  'check-box',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'arrow-right',
  'line',
  'highlight',
  'laser',
] as const

function PenEraserToolbarItem() {
  const editor = useEditor()
  const tools = useTools()
  const popoverId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const activeToolId = useValue(
    'active pen or eraser tool',
    () => editor.getCurrentToolId(),
    [editor],
  )
  const isPenEraserActive = activeToolId === 'draw' || activeToolId === 'eraser'
  const [displayedToolId, setDisplayedToolId] = useState<PenEraserToolId>(() =>
    isPenEraserActive ? activeToolId : (lastPenEraserToolByEditor.get(editor) ?? 'draw'),
  )

  useLayoutEffect(() => {
    if (activeToolId !== 'draw' && activeToolId !== 'eraser') return
    lastPenEraserToolByEditor.set(editor, activeToolId)
    if (displayedToolId !== activeToolId) setDisplayedToolId(activeToolId)
  }, [activeToolId, displayedToolId, editor])

  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
  }, [])

  const cancelLongPress = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    pointerStartRef.current = null
  }

  const startLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    cancelLongPress()
    longPressTriggeredRef.current = false
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      longPressTriggeredRef.current = true
      setMenuOpen(true)
    }, 450)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) cancelLongPress()
  }

  const selectTool = (toolId: PenEraserToolId) => {
    setDisplayedToolId(toolId)
    lastPenEraserToolByEditor.set(editor, toolId)
    tools[toolId]?.onSelect('toolbar')
    setMenuOpen(false)
  }

  const displayedLabel = displayedToolId === 'draw' ? '画笔' : '橡皮擦'
  const displayedIcon = displayedToolId === 'draw' ? 'tool-pencil' : 'tool-eraser'

  return (
    <div className="canvas-pen-eraser-tool" data-testid="tools.pen-eraser" data-value="pen-eraser">
      <TldrawUiPopover
        id={`canvas-pen-eraser-${popoverId}`}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        <TldrawUiPopoverTrigger>
          <TldrawUiToolbarButton
            type="tool"
            className="canvas-pen-eraser-tool__main"
            title={`${displayedLabel}（长按切换）`}
            tooltip={`${displayedLabel}（长按切换）`}
            aria-pressed={isPenEraserActive}
            isActive={isPenEraserActive}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-active-tool={displayedToolId}
            data-testid="tools.pen-eraser-button"
            onPointerDown={startLongPress}
            onPointerMove={handlePointerMove}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onClick={(event) => {
              event.preventDefault()
              if (longPressTriggeredRef.current) {
                longPressTriggeredRef.current = false
                return
              }
              selectTool(displayedToolId)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp') return
              event.preventDefault()
              setMenuOpen(true)
            }}
          >
            <TldrawUiIcon icon={displayedIcon} label={displayedLabel} />
          </TldrawUiToolbarButton>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="center" sideOffset={6}>
          <TldrawUiToolbar
            className="canvas-pen-eraser-menu"
            label="选择画笔或橡皮擦"
            orientation="horizontal"
          >
            <TldrawUiToolbarButton
              type="icon"
              title="画笔"
              tooltip="画笔"
              aria-pressed={displayedToolId === 'draw'}
              isActive={displayedToolId === 'draw'}
              data-testid="tools.pen-eraser.draw"
              onClick={() => selectTool('draw')}
            >
              <TldrawUiIcon icon="tool-pencil" label="画笔" />
            </TldrawUiToolbarButton>
            <TldrawUiToolbarButton
              type="icon"
              title="橡皮擦"
              tooltip="橡皮擦"
              aria-pressed={displayedToolId === 'eraser'}
              isActive={displayedToolId === 'eraser'}
              data-testid="tools.pen-eraser.eraser"
              onClick={() => selectTool('eraser')}
            >
              <TldrawUiIcon icon="tool-eraser" label="橡皮擦" />
            </TldrawUiToolbarButton>
          </TldrawUiToolbar>
        </TldrawUiPopoverContent>
      </TldrawUiPopover>
    </div>
  )
}

function CanvasToolbar({
  commentToolActive,
  onCommentToolToggle,
  referenceToolActive,
  onReferenceToolToggle,
}: Pick<CanvasEditorProps, 'commentToolActive' | 'onCommentToolToggle' | 'referenceToolActive' | 'onReferenceToolToggle'>) {
  const editor = useEditor()
  const selectExternalTool = (onToggle: () => void) => {
    editor.setCurrentTool?.('select')
    onToggle()
  }

  return (
    <DefaultToolbar minItems={10} maxItems={10}>
      {onCommentToolToggle ? (
        <TldrawUiToolbarButton
          type="tool"
          title="评论"
          tooltip="添加或查看评论"
          {...(commentToolActive === undefined ? {} : { isActive: commentToolActive })}
          onClick={() => selectExternalTool(onCommentToolToggle)}
        >
          <TldrawUiIcon icon="comment" label="评论" />
        </TldrawUiToolbarButton>
      ) : null}
      {onReferenceToolToggle ? (
        <TldrawUiToolbarButton
          type="tool"
          title="插入子画板"
          tooltip="插入子画板"
          aria-pressed={Boolean(referenceToolActive)}
          isActive={Boolean(referenceToolActive)}
          data-testid="tools.child-board"
          onClick={() => selectExternalTool(onReferenceToolToggle)}
        >
          <TldrawUiIcon icon="duplicate" label="插入子画板" />
        </TldrawUiToolbarButton>
      ) : null}
      <PenEraserToolbarItem />
      {VISIBLE_CANVAS_TOOL_IDS.map((tool) => (
        tool === 'asset'
          ? <AssetToolbarItem key={tool} />
          : <ToolbarItem key={tool} tool={tool} />
      ))}
    </DefaultToolbar>
  )
}

function CanvasExternalToolBridge({
  commentToolActive,
  referenceToolActive,
  onCommentCancel,
  onReferenceToolCancel,
}: {
  commentToolActive: boolean
  referenceToolActive: boolean
  onCommentCancel?: () => void
  onReferenceToolCancel?: () => void
}) {
  const editor = useEditor()
  const currentToolId = useValue('canvas external tool mutex', () => editor.getCurrentToolId(), [editor])

  useEffect(() => {
    if (currentToolId.startsWith('select')) return
    if (commentToolActive) onCommentCancel?.()
    if (referenceToolActive) onReferenceToolCancel?.()
  }, [commentToolActive, currentToolId, onCommentCancel, onReferenceToolCancel, referenceToolActive])

  return null
}

const MIND_MAP_TEXT_TO_TLDRAW_COLOR = {
  black: 'black',
  gray: 'grey',
  purple: 'light-violet',
  violet: 'violet',
  indigo: 'blue',
  blue: 'light-blue',
  amber: 'yellow',
  orange: 'orange',
  teal: 'green',
  green: 'light-green',
  coral: 'light-red',
  red: 'red',
} as const satisfies Record<MindMapPaletteColor, string>

const TLDRAW_TO_MIND_MAP_TEXT_COLOR = Object.fromEntries(
  Object.entries(MIND_MAP_TEXT_TO_TLDRAW_COLOR).map(([mindMapColor, tldrawColor]) => [tldrawColor, mindMapColor]),
) as Record<string, MindMapPaletteColor>

const MIND_MAP_TEXT_SIZE_ITEMS = [
  { value: 's', icon: 'size-small' },
  { value: 'm', icon: 'size-medium' },
  { value: 'l', icon: 'size-large' },
  { value: 'xl', icon: 'size-extra-large' },
] as const

const MIND_MAP_TEXT_ALIGN_ITEMS = [
  { value: 'start', icon: 'text-align-left' },
  { value: 'middle', icon: 'text-align-center' },
  { value: 'end', icon: 'text-align-right' },
] as const

const TABLE_TEXT_TO_TLDRAW_COLOR = {
  default: 'black',
  gray: 'grey',
  red: 'red',
  orange: 'orange',
  green: 'green',
  blue: 'blue',
  purple: 'violet',
} as const satisfies Record<TableCellTextColor, string>

const TLDRAW_TO_TABLE_TEXT_COLOR = Object.fromEntries(
  Object.entries(TABLE_TEXT_TO_TLDRAW_COLOR).map(([tableColor, tldrawColor]) => [tldrawColor, tableColor]),
) as Record<string, TableCellTextColor>

const TABLE_TEXT_SIZE_ITEMS = [
  { value: 's', icon: 'size-small' },
  { value: 'm', icon: 'size-medium' },
  { value: 'l', icon: 'size-large' },
  { value: 'xl', icon: 'size-extra-large' },
] as const
const TABLE_TEXT_SIZE_VALUES = { s: 12, m: 14, l: 18, xl: 24 } as const

const TABLE_TEXT_ALIGN_ITEMS = [
  { value: 'start', icon: 'text-align-left' },
  { value: 'middle', icon: 'text-align-center' },
  { value: 'end', icon: 'text-align-right' },
] as const

function TableTextStylePanel(props: TLUiStylePanelProps) {
  const editor = useEditor()
  const selectedShape = useValue('table style panel selected shape', () => editor.getOnlySelectedShape(), [editor])
  const isReadonly = useValue('table style panel readonly', () => editor.getInstanceState().isReadonly, [editor])
  const interactionTarget = useSyncExternalStore(
    (listener) => subscribeCanvasShapeInteractionTarget(editor, listener),
    () => getCanvasShapeInteractionTarget(editor),
    () => undefined,
  )
  const colors = useValue(
    'table text style colors',
    () => editor.getCurrentTheme().colors[editor.getColorMode()],
    [editor],
  )
  const fontItems = useValue(
    'table text style fonts',
    () => getFontStyleItems(editor.getCurrentTheme()),
    [editor],
  )
  const colorItems = useMemo(() => getColorStyleItems(colors), [colors])
  const tableShape = selectedShape?.type === 'table' ? selectedShape as TableShape : undefined
  const tableTarget = tableShape && interactionTarget?.type === 'table' && interactionTarget.shapeId === tableShape.id
    ? interactionTarget
    : undefined
  const tableCell = tableShape && tableTarget
    ? tableShape.props.rows.flatMap((row) => row.cells).find((cell) => cell.id === tableTarget.cellId)
    : undefined
  const cellIds = tableTarget?.cellIds?.length ? tableTarget.cellIds : tableTarget ? [tableTarget.cellId] : []
  const styleMap = useMemo(() => new ReadonlySharedStyleMap(), [])

  if (isReadonly || !tableShape || !tableTarget || !tableCell || cellIds.length === 0) return <DefaultStylePanel {...props} />

  const updateTextStyle = (patch: TableCellStylePatch, historyName: string, mark = true) => {
    const current = editor.getShape(tableShape.id) as TableShape | undefined
    if (!current || editor.getInstanceState().isReadonly) return
    if (mark) editor.markHistoryStoppingPoint(`${historyName}:${tableCell.id}`)
    const next = updateTableCellStyles(current.props, cellIds, patch)
    editor.updateShape<TableShape>({
      id: current.id,
      type: current.type,
      props: patch.fontSize === undefined ? next : autoFitTableRows(next),
    })
  }
  const historyMark = (name: string) => editor.markHistoryStoppingPoint(`${name}:${tableCell.id}`)
  const textColor = tableCell.textColor ?? 'default'
  const fontFamily = tableCell.fontFamily ?? 'sans'
  const textAlign = tableCell.align === 'center' ? 'middle' : tableCell.align === 'right' ? 'end' : 'start'

  return <DefaultStylePanel {...props} styles={styleMap}>
    <div data-table-text-style-panel>
      <StylePanelSection>
        <StylePanelButtonPicker
          title="颜色"
          uiType="color"
          style={DefaultColorStyle}
          items={colorItems}
          value={{ type: 'shared', value: TABLE_TEXT_TO_TLDRAW_COLOR[textColor] }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ textColor: TLDRAW_TO_TABLE_TEXT_COLOR[value] ?? 'default' }, 'table_text_color', false)}
        />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelButtonPicker
          title="字体"
          uiType="font"
          style={DefaultFontStyle}
          items={fontItems}
          value={{ type: 'shared', value: fontFamily }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ fontFamily: value as TableFontFamily }, 'table_text_font', false)}
        />
        <StylePanelButtonPicker
          title="大小"
          uiType="size"
          style={DefaultSizeStyle}
          items={TABLE_TEXT_SIZE_ITEMS}
          value={{ type: 'shared', value: Object.entries(TABLE_TEXT_SIZE_VALUES).find(([, size]) => size === (tableCell.fontSize ?? 14))?.[0] ?? 'm' }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ fontSize: TABLE_TEXT_SIZE_VALUES[value as keyof typeof TABLE_TEXT_SIZE_VALUES] ?? 14 }, 'table_text_size', false)}
        />
      </StylePanelSection>
      <StylePanelSection>
        <TldrawUiToolbar label="文字格式" orientation="horizontal">
          {([['bold', 'bold', tableCell.bold ?? false, '粗体'], ['italic', 'italic', tableCell.italic ?? false, '斜体'], ['underline', 'underline', tableCell.underline ?? false, '下划线'], ['strike', 'strike', tableCell.strike ?? false, '删除线']] as const)
            .map(([key, icon, active, label]) => <TldrawUiToolbarButton
              key={key}
              type="icon"
              title={label}
              isActive={active}
              data-testid={`table-style-${key}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => updateTextStyle({ [key]: !active }, `table_text_${key}`)}
            ><TldrawUiIcon icon={icon} label={label} /></TldrawUiToolbarButton>)}
        </TldrawUiToolbar>
        <StylePanelButtonPicker
          title="对齐"
          uiType="align"
          style={DefaultTextAlignStyle}
          items={TABLE_TEXT_ALIGN_ITEMS}
          value={{ type: 'shared', value: textAlign }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ align: value === 'middle' ? 'center' : value === 'end' ? 'right' : 'left' }, 'table_text_align', false)}
        />
      </StylePanelSection>
    </div>
  </DefaultStylePanel>
}

function TextBackgroundStylePanel({
  shape,
  accountId,
  ...props
}: TLUiStylePanelProps & { shape: TLTextShape; accountId?: string }) {
  const editor = useEditor()
  const editingShapeId = useValue(
    'text style panel editing shape',
    () => editor.getEditingShapeId?.(),
    [editor],
  )
  const richTextEditor = useValue<TiptapEditor | undefined>(
    'text style panel rich text editor',
    () => editor.getRichTextEditor?.() ?? undefined,
    [editor],
  )
  const [richTextRevision, setRichTextRevision] = useState(0)
  useEffect(() => {
    if (!richTextEditor) return
    const refresh = () => setRichTextRevision((revision) => revision + 1)
    richTextEditor.on('update', refresh)
    richTextEditor.on('selectionUpdate', refresh)
    return () => {
      richTextEditor.off('update', refresh)
      richTextEditor.off('selectionUpdate', refresh)
    }
  }, [richTextEditor])
  const isReadonly = useValue('text background style panel readonly', () => editor.getInstanceState().isReadonly, [editor])
  const colors = useValue(
    'text background style colors',
    () => editor.getCurrentTheme().colors[editor.getColorMode()],
    [editor],
  )
  const colorItems = useMemo(() => getColorStyleItems(colors), [colors])
  const background = getTextBackgroundStyle(shape)
  const isEditingThisShape = editingShapeId === shape.id && Boolean(richTextEditor)
  const isTextFormatActive = (mark: TextFormatMark) => {
    void richTextRevision
    if (isEditingThisShape && richTextEditor) return richTextEditor.isActive(mark)
    return richTextMarkState(shape.props.richText, mark)
  }

  useEffect(() => {
    if (!isEditingThisShape || !richTextEditor) return
    writeTextFormatPreference(editor, accountId, {
      bold: richTextEditor.isActive('bold'),
      italic: richTextEditor.isActive('italic'),
      underline: richTextEditor.isActive('underline'),
      strike: richTextEditor.isActive('strike'),
    })
  }, [accountId, editor, isEditingThisShape, richTextEditor, richTextRevision])

  const toggleTextFormat = (mark: TextFormatMark, command: string) => {
    const current = editor.getShape<TLTextShape>(shape.id)
    if (!current || current.type !== 'text' || editor.getInstanceState().isReadonly) return
    editor.markHistoryStoppingPoint(`text_format_${mark}:${shape.id}`)
    const nextFormat = !isTextFormatActive(mark)
    writeTextFormatPreference(editor, accountId, {
      ...readTextFormatPreference(editor, accountId),
      [mark]: nextFormat,
    })

    if (isEditingThisShape && richTextEditor) {
      const chain = richTextEditor.chain().focus() as unknown as Record<string, () => { run(): boolean }>
      const operation = chain[command]
      if (operation) operation().run()
      return
    }

    editor.updateShape<TLTextShape>({
      id: current.id,
      type: current.type,
      props: { richText: toggleRichTextMark(current.props.richText, mark) },
    })
  }

  if (isReadonly) return <DefaultStylePanel {...props} />

  const updateBackground = (patch: Partial<TextBackgroundStyle>) => {
    const current = editor.getShape<TLTextShape>(shape.id)
    if (!current || current.type !== 'text' || editor.getInstanceState().isReadonly) return
    const currentBackground = getTextBackgroundStyle(current)
    editor.updateShape<TLTextShape>({
      id: current.id,
      type: current.type,
      meta: {
        ...current.meta,
        [TEXT_BACKGROUND_META_KEY]: { ...currentBackground, ...patch },
      },
    })
    if (accountId) {
      writeTextBackgroundPreference(accountId, { ...currentBackground, ...patch })
    }
  }
  const historyMark = (name: string) => editor.markHistoryStoppingPoint(`${name}:${shape.id}`)

  return <DefaultStylePanel {...props}>
    <DefaultStylePanelContent />
    <StylePanelSection>
      <TldrawUiToolbar label="文字格式" orientation="horizontal">
        {TEXT_FORMAT_MARK_ITEMS.map(({ mark, icon, label, command }) => (
          <TldrawUiToolbarButton
            key={mark}
            type="icon"
            title={label}
            tooltip={label}
            isActive={isTextFormatActive(mark)}
            aria-pressed={isTextFormatActive(mark)}
            data-testid={`text-style-${mark}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => toggleTextFormat(mark, command)}
          >
            <TldrawUiIcon icon={icon} label={label} />
          </TldrawUiToolbarButton>
        ))}
      </TldrawUiToolbar>
    </StylePanelSection>
    <StylePanelSection>
      <StylePanelButtonPicker
        title="背景颜色"
        uiType="color"
        style={DefaultColorStyle}
        items={colorItems}
        value={{ type: 'shared', value: background.color }}
        onHistoryMark={() => historyMark('text_background_color')}
        onValueChange={(_, color) => updateBackground({
          color: color as TLDefaultColorStyle,
          ...(background.fill === 'none' ? { fill: 'semi' } : {}),
        })}
      />
      <StylePanelButtonPicker
        title="背景填充"
        uiType="fill"
        style={DefaultFillStyle}
        items={TEXT_BACKGROUND_FILL_ITEMS}
        value={{ type: 'shared', value: background.fill }}
        onHistoryMark={() => historyMark('text_background_fill')}
        onValueChange={(_, fill) => updateBackground({ fill: fill as TextBackgroundPreference['fill'] })}
      />
    </StylePanelSection>
  </DefaultStylePanel>
}

function CanvasTextStylePanel({ accountId, ...props }: TLUiStylePanelProps & { accountId?: string }) {
  const editor = useEditor()
  const hasSelection = useValue(
    'canvas style panel has selection',
    () => editor.getSelectedShapeIds().length > 0,
    [editor],
  )
  const selectedShape = useValue('canvas style panel selected shape', () => editor.getOnlySelectedShape(), [editor])
  const currentToolId = useValue(
    'canvas style panel current tool',
    () => hasSelection ? 'select' : editor.getCurrentToolId(),
    [editor, hasSelection],
  )
  const interactionTarget = useSyncExternalStore(
    (listener) => subscribeCanvasShapeInteractionTarget(editor, listener),
    () => getCanvasShapeInteractionTarget(editor),
    () => undefined,
  )
  if (!hasSelection) {
    const toolId = currentToolId.split('.')[0]
    if (toolId === 'text') return <TextToolStylePanel {...props} {...(accountId ? { accountId } : {})} />
    if (toolId === 'arrow') return <DefaultStylePanel {...props} />
    return null
  }
  if (selectedShape?.type === 'text') return <TextBackgroundStylePanel
    {...props}
    shape={selectedShape}
    {...(accountId ? { accountId } : {})}
  />
  if (selectedShape?.type === 'table' && interactionTarget?.type === 'table' && interactionTarget.shapeId === selectedShape.id) {
    return <TableTextStylePanel {...props} />
  }
  return <MindMapTextStylePanel {...props} />
}

function TextToolStylePanel({ accountId, ...props }: TLUiStylePanelProps & { accountId?: string }) {
  const editor = useEditor()
  const [formats, setFormats] = useState(() => readTextFormatPreference(editor, accountId))

  const toggleFormat = (mark: TextFormatMark) => {
    const next = { ...formats, [mark]: !formats[mark] }
    setFormats(next)
    writeTextFormatPreference(editor, accountId, next)
  }

  return <DefaultStylePanel {...props}>
    <DefaultStylePanelContent />
    <StylePanelSection>
      <TldrawUiToolbar label="文字格式" orientation="horizontal">
        {TEXT_FORMAT_MARK_ITEMS.map(({ mark, icon, label }) => (
          <TldrawUiToolbarButton
            key={mark}
            type="icon"
            title={label}
            tooltip={label}
            isActive={formats[mark]}
            aria-pressed={formats[mark]}
            data-testid={`text-tool-style-${mark}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => toggleFormat(mark)}
          >
            <TldrawUiIcon icon={icon} label={label} />
          </TldrawUiToolbarButton>
        ))}
      </TldrawUiToolbar>
    </StylePanelSection>
  </DefaultStylePanel>
}

function MindMapTextStylePanel(props: TLUiStylePanelProps) {
  const editor = useEditor()
  const selectedShape = useValue('mind map style panel selected shape', () => editor.getOnlySelectedShape(), [editor])
  const isReadonly = useValue('mind map style panel readonly', () => editor.getInstanceState().isReadonly, [editor])
  const interactionTarget = useSyncExternalStore(
    (listener) => subscribeCanvasShapeInteractionTarget(editor, listener),
    () => getCanvasShapeInteractionTarget(editor),
    () => undefined,
  )
  const colors = useValue(
    'mind map text style colors',
    () => editor.getCurrentTheme().colors[editor.getColorMode()],
    [editor],
  )
  const fontItems = useValue(
    'mind map text style fonts',
    () => getFontStyleItems(editor.getCurrentTheme()),
    [editor],
  )
  const colorItems = useMemo(() => getColorStyleItems(colors), [colors])
  const mindMapShape = selectedShape?.type === 'mind-map' ? selectedShape as MindMapShape : undefined
  const mindMapNode = mindMapShape && interactionTarget?.type === 'mind-map' && interactionTarget.shapeId === mindMapShape.id
    ? mindMapShape.props.nodes.find((node) => node.id === interactionTarget.nodeId)
    : undefined
  const resolved = mindMapShape && mindMapNode ? resolveMindMapNodeStyle(mindMapShape.props, mindMapNode) : undefined
  const textColor = mindMapNode?.style?.textColor ?? (mindMapNode?.parentId === null ? 'gray' : 'black')
  const tldrawColor = MIND_MAP_TEXT_TO_TLDRAW_COLOR[textColor]
  const fontSize = resolved?.fontSize ?? 'm'
  const fontFamily = resolved?.fontFamily ?? 'sans'
  const textAlign = resolved?.textAlign === 'center' ? 'middle' : resolved?.textAlign === 'right' ? 'end' : 'start'
  const styleMap = useMemo(() => new ReadonlySharedStyleMap(), [])

  if (isReadonly || !mindMapShape || !mindMapNode || !resolved) return <DefaultStylePanel {...props} />

  const updateTextStyle = (patch: Partial<MindMapNodeStyle>, historyName: string, mark = true) => {
    const current = editor.getShape(mindMapShape.id) as MindMapShape | undefined
    if (!current || editor.getInstanceState().isReadonly) return
    if (mark) editor.markHistoryStoppingPoint(`${historyName}:${mindMapNode.id}`)
    editor.updateShape<MindMapShape>({
      id: current.id,
      type: current.type,
      props: updateMindMapNodeStyle(current.props, mindMapNode.id, { style: patch }),
    })
  }
  const historyMark = (name: string) => editor.markHistoryStoppingPoint(`${name}:${mindMapNode.id}`)

  return <DefaultStylePanel {...props} styles={styleMap}>
    <div data-mind-map-text-style-panel>
      <StylePanelSection>
        <StylePanelButtonPicker
          title="颜色"
          uiType="color"
          style={DefaultColorStyle}
          items={colorItems}
          value={{ type: 'shared', value: tldrawColor }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ textColor: TLDRAW_TO_MIND_MAP_TEXT_COLOR[value] ?? 'black' }, 'mind_map_text_color', false)}
        />
        <TldrawUiSlider
          label={`文字透明度 — ${Math.round(resolved.textOpacity * 100)}%`}
          title="透明度"
          min={0}
          steps={100}
          value={Math.round(resolved.textOpacity * 100)}
          onHistoryMark={() => historyMark('mind_map_text_opacity')}
          onValueChange={(value) => updateTextStyle({ textOpacity: value / 100 }, 'mind_map_text_opacity', false)}
        />
      </StylePanelSection>
      <StylePanelSection>
        <StylePanelButtonPicker
          title="字体"
          uiType="font"
          style={DefaultFontStyle}
          items={fontItems}
          value={{ type: 'shared', value: fontFamily }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ fontFamily: value as MindMapNodeStyle['fontFamily'] }, 'mind_map_text_font', false)}
        />
        <StylePanelButtonPicker
          title="大小"
          uiType="size"
          style={DefaultSizeStyle}
          items={MIND_MAP_TEXT_SIZE_ITEMS}
          value={{ type: 'shared', value: fontSize }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ fontSize: value }, 'mind_map_text_size', false)}
        />
      </StylePanelSection>
      <StylePanelSection>
        <TldrawUiToolbar label="文字格式" orientation="horizontal">
          {([['bold', 'bold', resolved.bold, '粗体'], ['italic', 'italic', resolved.italic, '斜体'], ['underline', 'underline', resolved.underline, '下划线'], ['strike', 'strike', resolved.strike, '删除线']] as const)
            .map(([key, icon, active, label]) => <TldrawUiToolbarButton
              key={key}
              type="icon"
              title={label}
              isActive={active}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => updateTextStyle({ [key]: !active }, `mind_map_text_${key}`)}
            ><TldrawUiIcon icon={icon} label={label} /></TldrawUiToolbarButton>)}
        </TldrawUiToolbar>
        <StylePanelButtonPicker
          title="对齐"
          uiType="align"
          style={DefaultTextAlignStyle}
          items={MIND_MAP_TEXT_ALIGN_ITEMS}
          value={{ type: 'shared', value: textAlign }}
          onHistoryMark={historyMark}
          onValueChange={(_, value) => updateTextStyle({ textAlign: value === 'middle' ? 'center' : value === 'end' ? 'right' : 'left' }, 'mind_map_text_align', false)}
        />
      </StylePanelSection>
    </div>
  </DefaultStylePanel>
}

function BoardReferenceContextMenu({
  actions,
  ...props
}: TLUiContextMenuProps & { actions?: BoardReferenceActions }) {
  const editor = useEditor()
  const shape = useValue(
    'selected canvas shape',
    () => editor.getOnlySelectedShape(),
    [editor],
  )
  const interactionTarget = useSyncExternalStore(
    (listener) => subscribeCanvasShapeInteractionTarget(editor, listener),
    () => getCanvasShapeInteractionTarget(editor),
    () => undefined,
  )

  const updateTable = (next: TableShape['props'], mark: string) => {
    if (!shape || shape.type !== 'table' || editor.getInstanceState().isReadonly) return
    editor.markHistoryStoppingPoint(mark)
    editor.updateShape<TableShape>({ id: shape.id, type: shape.type, props: next })
  }

  const updateMindMap = (next: MindMapShape['props'], mark: string) => {
    if (!shape || shape.type !== 'mind-map' || editor.getInstanceState().isReadonly) return
    editor.markHistoryStoppingPoint(mark)
    const mindMap = shape as MindMapShape
    const delta = getMindMapRootAnchorDelta(mindMap.props, next)
    const rotation = Number.isFinite(mindMap.rotation) ? mindMap.rotation : 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    editor.updateShape<MindMapShape>({
      id: mindMap.id,
      type: mindMap.type,
      x: (Number.isFinite(mindMap.x) ? mindMap.x : 0) + delta.x * cos - delta.y * sin,
      y: (Number.isFinite(mindMap.y) ? mindMap.y : 0) + delta.x * sin + delta.y * cos,
      props: next,
    })
  }

  const tableShape = shape?.type === 'table' ? shape as TableShape : undefined
  const tableTarget = tableShape && interactionTarget?.type === 'table' && interactionTarget.shapeId === tableShape.id
    ? interactionTarget
    : undefined
  const tableRowIndex = tableTarget ? tableShape?.props.rows.findIndex((row) => row.id === tableTarget.rowId) ?? -1 : -1
  const tableColumnIndex = tableTarget ? tableShape?.props.columns.findIndex((column) => column.id === tableTarget.columnId) ?? -1 : -1
  const tableCellIds = tableTarget?.cellIds?.length ? tableTarget.cellIds : tableTarget ? [tableTarget.cellId] : []
  const activeTableCell = tableShape && tableTarget
    ? tableShape.props.rows.flatMap((row) => row.cells).find((cell) => cell.id === tableTarget.cellId)
    : undefined
  const mindMapShape = shape?.type === 'mind-map' ? shape as MindMapShape : undefined
  const mindMapTarget = mindMapShape && interactionTarget?.type === 'mind-map' && interactionTarget.shapeId === mindMapShape.id
    ? interactionTarget
    : undefined
  const mindMapNode = mindMapTarget
    ? mindMapShape?.props.nodes.find((node) => node.id === mindMapTarget.nodeId)
    : getMindMapRoot(mindMapShape?.props ?? { w: 1, h: 1, layout: 'right', nodes: [] })
  const mindMapRoot = mindMapShape ? getMindMapRoot(mindMapShape.props) : undefined
  const manualArrowShape = shape?.type === 'arrow'
    && shape.props.kind === 'elbow'
    && readManualElbowRoute(shape.meta)
    ? shape as TLArrowShape
    : undefined

  return (
    <DefaultContextMenu {...props}>
      {shape?.type === 'board-reference' && actions ? (
        <TldrawUiMenuGroup id="board-reference">
          <TldrawUiMenuItem id="board-reference-enter" label="进入画板" readonlyOk onSelect={() => actions.enter(shape as BoardReferenceShape)} />
          <TldrawUiMenuItem id="board-reference-new-tab" label="在新标签页打开" readonlyOk onSelect={() => actions.openInNewTab(shape as BoardReferenceShape)} />
          <TldrawUiMenuItem id="board-reference-rename" label="重命名目标画板" readonlyOk onSelect={() => actions.renameTarget(shape as BoardReferenceShape)} />
          <TldrawUiMenuItem
            id="board-reference-kind"
            label={shape.props.kind === 'embed' ? '切换为普通链接' : '切换为嵌入画板'}
            readonlyOk
            onSelect={() => actions.changeKind(shape as BoardReferenceShape, shape.props.kind === 'embed' ? 'link' : 'embed')}
          />
          <TldrawUiMenuItem id="board-reference-remove" label="移除引用（目标画板会保留）" readonlyOk onSelect={() => actions.remove(shape as BoardReferenceShape)} />
        </TldrawUiMenuGroup>
      ) : null}
      {tableShape && tableTarget && tableRowIndex >= 0 && tableColumnIndex >= 0 ? (
        <TldrawUiMenuGroup id="table">
          <TldrawUiMenuItem id="table-row-before" label="在上方插入行" onSelect={() => updateTable(insertTableRow(tableShape.props, tableRowIndex), 'table_row_before')} />
          <TldrawUiMenuItem id="table-row-after" label="在下方插入行" onSelect={() => updateTable(insertTableRow(tableShape.props, tableRowIndex + 1), 'table_row_after')} />
          <TldrawUiMenuItem id="table-row-duplicate" label="复制所在行" onSelect={() => updateTable(duplicateTableRow(tableShape.props, tableRowIndex), 'table_row_duplicate')} />
          <TldrawUiMenuItem id="table-column-before" label="在左侧插入列" onSelect={() => updateTable(insertTableColumn(tableShape.props, tableColumnIndex), 'table_column_before')} />
          <TldrawUiMenuItem id="table-column-after" label="在右侧插入列" onSelect={() => updateTable(insertTableColumn(tableShape.props, tableColumnIndex + 1), 'table_column_after')} />
          <TldrawUiMenuItem id="table-column-duplicate" label="复制所在列" onSelect={() => updateTable(duplicateTableColumn(tableShape.props, tableColumnIndex), 'table_column_duplicate')} />
          <TldrawUiMenuItem id="table-delete-row" label="删除所在行" onSelect={() => updateTable(deleteTableRow(tableShape.props, tableTarget.rowId), 'table_delete_row')} />
          <TldrawUiMenuItem id="table-delete-column" label="删除所在列" onSelect={() => updateTable(deleteTableColumn(tableShape.props, tableTarget.columnId), 'table_delete_column')} />
          <TldrawUiMenuItem id="table-clear-cells" label={tableCellIds.length > 1 ? '清空所选单元格' : '清空单元格'} onSelect={() => updateTable(clearTableCells(tableShape.props, tableCellIds), 'table_clear_cells')} />
          <TldrawUiMenuItem id="table-distribute-columns" label="平均分布列宽" onSelect={() => updateTable(distributeTableColumns(tableShape.props), 'table_distribute_columns')} />
          <TldrawUiMenuItem id="table-distribute-rows" label="平均分布行高" onSelect={() => updateTable(distributeTableRows(tableShape.props), 'table_distribute_rows')} />
          <TldrawUiMenuItem id="table-auto-fit-rows" label="自适应行高" onSelect={() => updateTable(autoFitTableRows(tableShape.props), 'table_auto_fit_rows')} />
          <TldrawUiMenuItem
            id="table-cycle-align"
            label={`文本对齐：${activeTableCell?.align === 'center' ? '居中' : activeTableCell?.align === 'right' ? '右对齐' : '左对齐'}`}
            onSelect={() => updateTable(updateTableCellStyles(tableShape.props, tableCellIds, {
              align: activeTableCell?.align === 'left' || !activeTableCell?.align ? 'center' : activeTableCell.align === 'center' ? 'right' : 'left',
            }), 'table_cycle_align')}
          />
          <TldrawUiMenuItem
            id="table-cycle-background"
            label="切换单元格背景色"
            onSelect={() => {
              const colors = ['none', 'gray', 'blue', 'yellow', 'green', 'red'] as const
              const index = colors.indexOf(activeTableCell?.background ?? 'none')
              updateTable(updateTableCellStyles(tableShape.props, tableCellIds, { background: colors[(index + 1) % colors.length]! }), 'table_cycle_background')
            }}
          />
          <TldrawUiMenuItem
            id="table-cycle-border"
            label="切换边框样式"
            onSelect={() => {
              const borders = ['light', 'strong', 'none'] as const
              const index = borders.indexOf(activeTableCell?.border ?? 'light')
              updateTable(updateTableCellStyles(tableShape.props, tableCellIds, { border: borders[(index + 1) % borders.length]! }), 'table_cycle_border')
            }}
          />
          <TldrawUiMenuItem id="table-toggle-header" label="切换表头样式" onSelect={() => updateTable(toggleTableHeaderRow(tableShape.props, tableTarget.rowId), 'table_toggle_header')} />
        </TldrawUiMenuGroup>
      ) : null}
      {mindMapShape && mindMapNode ? (
        <TldrawUiMenuGroup id="mind-map">
          <TldrawUiMenuItem id="mind-map-add-child" label="新增子主题" onSelect={() => updateMindMap(addMindMapChild(mindMapShape.props, mindMapNode.id).props, 'mind_map_add_child')} />
          {mindMapNode.id !== mindMapRoot?.id ? <TldrawUiMenuItem id="mind-map-add-sibling" label="新增同级主题" onSelect={() => updateMindMap(addMindMapSibling(mindMapShape.props, mindMapNode.id).props, 'mind_map_add_sibling')} /> : null}
          {mindMapNode.id !== mindMapRoot?.id ? <TldrawUiMenuItem id="mind-map-delete-branch" label="删除该分支" onSelect={() => updateMindMap(deleteMindMapBranch(mindMapShape.props, mindMapNode.id), 'mind_map_delete_branch')} /> : null}
          <TldrawUiMenuItem id="mind-map-toggle-collapse" label={mindMapNode.collapsed ? '展开分支' : '折叠分支'} onSelect={() => updateMindMap(toggleMindMapCollapsed(mindMapShape.props, mindMapNode.id), 'mind_map_toggle_collapse')} />
          <TldrawUiMenuItem id="mind-map-toggle-layout" label={mindMapShape.props.layout === 'right' ? '切换为双向布局' : '切换为向右布局'} onSelect={() => updateMindMap(setMindMapLayout(mindMapShape.props, mindMapShape.props.layout === 'right' ? 'bilateral' : 'right'), 'mind_map_toggle_layout')} />
          {mindMapNode.parentId === mindMapRoot?.id && mindMapShape.props.layout === 'bilateral' ? <TldrawUiMenuItem id="mind-map-toggle-side" label={mindMapNode.side === 'right' ? '移到左侧' : '移到右侧'} onSelect={() => updateMindMap(setMindMapBranchSide(mindMapShape.props, mindMapNode.id, mindMapNode.side === 'right' ? 'left' : 'right'), 'mind_map_toggle_side')} /> : null}
          <TldrawUiMenuItem
            id="mind-map-copy-branch"
            label="复制分支"
            onSelect={() => {
              const snapshot = copyMindMapBranch(mindMapShape.props, mindMapNode.id)
              if (snapshot) setMindMapBranchClipboard(editor, snapshot)
            }}
          />
          {getMindMapBranchClipboard(editor) ? <TldrawUiMenuItem
            id="mind-map-paste-branch"
            label="粘贴为子分支"
            onSelect={() => {
              const snapshot = getMindMapBranchClipboard(editor)
              if (!snapshot) return
              updateMindMap(pasteMindMapBranch(mindMapShape.props, mindMapNode.id, snapshot).props, 'mind_map_paste_branch')
            }}
          /> : null}
          {mindMapNode.parentId ? <TldrawUiMenuItem
            id="mind-map-duplicate-branch"
            label="创建分支副本"
            kbd="Ctrl+D"
            onSelect={() => updateMindMap(duplicateMindMapBranch(mindMapShape.props, mindMapNode.id).props, 'mind_map_duplicate_branch')}
          /> : null}
          <TldrawUiMenuItem
            id="mind-map-copy-style"
            label="复制节点样式"
            kbd="Ctrl+Alt+C"
            onSelect={() => {
              const snapshot = copyMindMapNodeVisualStyle(mindMapShape.props, mindMapNode.id)
              if (snapshot) setMindMapStyleClipboard(editor, snapshot)
            }}
          />
          {getMindMapStyleClipboard(editor) ? <TldrawUiMenuItem
            id="mind-map-paste-style"
            label="粘贴节点样式"
            kbd="Ctrl+Alt+V"
            onSelect={() => {
              const snapshot = getMindMapStyleClipboard(editor)
              if (snapshot) updateMindMap(pasteMindMapNodeVisualStyle(mindMapShape.props, mindMapNode.id, snapshot), 'mind_map_paste_style')
            }}
          /> : null}
          <TldrawUiMenuItem
            id="mind-map-cycle-color"
            label="切换节点颜色"
            onSelect={() => {
              const colors = ['blue', 'violet', 'green', 'orange', 'red', 'gray'] as const
              const index = colors.indexOf(mindMapNode.color ?? (mindMapNode.id === mindMapRoot?.id ? 'blue' : 'gray'))
              updateMindMap(updateMindMapNodeStyle(mindMapShape.props, mindMapNode.id, { color: colors[(index + 1) % colors.length]! }), 'mind_map_cycle_color')
            }}
          />
          <TldrawUiMenuItem
            id="mind-map-cycle-shape"
            label="切换节点形状"
            onSelect={() => {
              const shapes = ['rounded', 'pill', 'underline'] as const
              const index = shapes.indexOf(mindMapNode.shape ?? 'rounded')
              updateMindMap(updateMindMapNodeStyle(mindMapShape.props, mindMapNode.id, { shape: shapes[(index + 1) % shapes.length]! }), 'mind_map_cycle_shape')
            }}
          />
          <TldrawUiMenuItem
            id="mind-map-cycle-theme"
            label="切换导图主题"
            onSelect={() => {
              const themes = ['classic', 'colorful', 'minimal'] as const
              const index = themes.indexOf(mindMapShape.props.theme ?? 'classic')
              updateMindMap(setMindMapTheme(mindMapShape.props, themes[(index + 1) % themes.length]!), 'mind_map_cycle_theme')
            }}
          />
        </TldrawUiMenuGroup>
      ) : null}
      {manualArrowShape ? (
        <TldrawUiMenuGroup id="manual-elbow-arrow">
          <TldrawUiMenuItem
            id="arrow-reset-routing"
            label="恢复自动布线"
            onSelect={() => {
              editor.markHistoryStoppingPoint('arrow_reset_routing')
              editor.updateShape<TLArrowShape>({
                id: manualArrowShape.id,
                type: manualArrowShape.type,
                meta: clearManualElbowRouteMeta(manualArrowShape.meta),
              })
            }}
          />
        </TldrawUiMenuGroup>
      ) : null}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  )
}

type ShapeConnectionHandle = {
  id: 'top' | 'right' | 'bottom' | 'left'
  label: string
  anchor: { x: number; y: number }
  display: { x: number; y: number }
  normalizedAnchor: { x: number; y: number }
}

const CONNECTION_HANDLE_OFFSET = 14
const MIN_CONNECTION_DRAG_DISTANCE = 8
const CONNECTED_SHAPE_ARROW_META_KEY = 'connectedShapeArrow'
const activeConnectionDrags = new WeakMap<Editor, () => void>()

function migrateConnectedShapeArrowsToElbows(editor: Editor): void {
  const updates = (editor.getCurrentPageShapes?.() ?? [])
    .filter((shape): shape is TLArrowShape => (
      shape.type === 'arrow'
      && shape.props.kind !== 'elbow'
      && (
        (shape.meta as Record<string, unknown>)[CONNECTED_SHAPE_ARROW_META_KEY] === true
        || (editor.getBindingsFromShape?.(shape, 'arrow')?.length ?? 0) >= 2
      )
    ))
    .map((shape) => {
      const meta = shape.meta as Record<string, unknown>
      return {
        id: shape.id,
        type: shape.type,
        props: { kind: 'elbow' as const },
        ...(meta[CONNECTED_SHAPE_ARROW_META_KEY] === true
          ? {}
          : { meta: { ...meta, [CONNECTED_SHAPE_ARROW_META_KEY]: true } }),
      }
    })
  if (updates.length > 0) editor.updateShapes(updates)
}

export function getShapeConnectionHandles(editor: Editor): ShapeConnectionHandle[] {
  const shape = editor.getOnlySelectedShape()
  const currentToolId = editor.getCurrentToolId()
  if (
    !shape
    || !currentToolId.startsWith('select')
    || editor.getInstanceState().isReadonly
    || !editor.canBindShapes({ fromShape: 'arrow', toShape: shape, binding: 'arrow' })
  ) return []

  const bounds = editor.getShapeGeometry(shape).bounds
  const transform = editor.getShapePageTransform(shape)
  const center = editor.pageToScreen(transform.applyToPoint(bounds.center))
  const edgePoints = [
    { id: 'top' as const, label: '从上边连接', point: { x: bounds.center.x, y: bounds.y }, normalizedAnchor: { x: 0.5, y: 0 } },
    { id: 'right' as const, label: '从右边连接', point: { x: bounds.maxX, y: bounds.center.y }, normalizedAnchor: { x: 1, y: 0.5 } },
    { id: 'bottom' as const, label: '从下边连接', point: { x: bounds.center.x, y: bounds.maxY }, normalizedAnchor: { x: 0.5, y: 1 } },
    { id: 'left' as const, label: '从左边连接', point: { x: bounds.x, y: bounds.center.y }, normalizedAnchor: { x: 0, y: 0.5 } },
  ]

  return edgePoints.map(({ id, label, point, normalizedAnchor }) => {
    const anchor = editor.pageToScreen(transform.applyToPoint(point))
    const dx = anchor.x - center.x
    const dy = anchor.y - center.y
    const length = Math.hypot(dx, dy) || 1
    return {
      id,
      label,
      anchor,
      normalizedAnchor,
      display: {
        x: anchor.x + dx / length * CONNECTION_HANDLE_OFFSET,
        y: anchor.y + dy / length * CONNECTION_HANDLE_OFFSET,
      },
    }
  })
}

function CanvasAlignMenuItems() {
  const editor = useEditor()
  const enabled = useValue(
    'group-aware align menu enabled',
    () => {
      if (!editor.isIn('select')) return false
      const unlockedSelectionCount = editor.getSelectedShapes()
        .filter((shape) => !editor.isShapeOrAncestorLocked(shape)).length
      return unlockedSelectionCount >= 2 || Boolean(getSelectedGroupLayoutChildIds(editor))
    },
    [editor],
  )

  return <>
    <TldrawUiMenuActionItem actionId="align-left" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="align-center-horizontal" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="align-right" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="stretch-horizontal" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="align-top" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="align-center-vertical" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="align-bottom" disabled={!enabled} />
    <TldrawUiMenuActionItem actionId="stretch-vertical" disabled={!enabled} />
  </>
}

function CanvasEditLinkMenuItem() {
  const editor = useEditor()
  const enabled = useValue(
    'canvas edit link enabled',
    () => {
      const shape = editor.getOnlySelectedShape()
      return Boolean(
        editor.isIn('select')
        && shape
        && shape.type !== 'embed'
        && 'url' in shape.props
        && !editor.isShapeOrAncestorLocked(shape)
      )
    },
    [editor],
  )

  return <TldrawUiMenuActionItem actionId="edit-link" disabled={!enabled} />
}

function CanvasActionsMenu({ children }: TLUiActionsMenuProps) {
  return <DefaultActionsMenu>
    {children ?? <>
      <CanvasAlignMenuItems />
      <DistributeMenuItems />
      <StackMenuItems />
      <ReorderMenuItems />
      <ZoomOrRotateMenuItem />
      <RotateCWMenuItem />
      <CanvasEditLinkMenuItem />
      <GroupOrUngroupMenuItem />
    </>}
  </DefaultActionsMenu>
}

/** 群组选中时提供与飞书一致的高频快捷操作，并复用原生右键菜单作为更多菜单。 */
export function GroupSelectionToolbar() {
  const editor = useEditor()
  const group = useValue(
    'selected group toolbar state',
    () => {
      const shape = editor.getOnlySelectedShape()
      if (
        !shape
        || shape.type !== 'group'
        || !editor.isIn('select.idle')
        || editor.getInstanceState().isReadonly
        || !canUngroupSelectedGroup(editor, shape)
      ) return undefined
      return {
        id: shape.id,
        childIds: editor.getSortedChildIdsForParent(shape.id),
      }
    },
    [editor],
  )
  const getSelectionBounds = useCallback(
    () => editor.getSelectionScreenBounds(),
    [editor],
  )

  if (!group || group.childIds.length === 0) return null

  return (
    <TldrawUiContextualToolbar
      className="canvas-group-selection-toolbar"
      getSelectionBounds={getSelectionBounds}
      label="群组快捷操作"
    >
      <TldrawUiToolbarButton
        type="icon"
        title="选取子元素（Enter）"
        data-testid="group-selection-toolbar.select-children"
        onClick={() => editor.setSelectedShapes(group.childIds)}
      >
        <SelectionAll size={18} aria-hidden="true" />
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="icon"
        title="取消组合（Ctrl+Shift+G）"
        data-testid="group-selection-toolbar.ungroup"
        onClick={() => {
          if (!canUngroupSelectedGroup(editor, editor.getOnlySelectedShape()!)) return
          editor.markHistoryStoppingPoint('ungroup')
          editor.ungroupShapes([group.id])
        }}
      >
        <TldrawUiIcon icon="ungroup" label="取消组合" />
      </TldrawUiToolbarButton>
      <TldrawUiDropdownMenuRoot id="group-selection-more">
        <TldrawUiDropdownMenuTrigger>
          <TldrawUiToolbarButton
            type="icon"
            title="更多操作"
            data-testid="group-selection-toolbar.more"
          >
            <TldrawUiIcon icon="dots-horizontal" label="更多操作" />
          </TldrawUiToolbarButton>
        </TldrawUiDropdownMenuTrigger>
        <TldrawUiDropdownMenuContent side="bottom" align="end" sideOffset={6}>
          <TldrawUiMenuContextProvider type="menu" sourceId="context-menu">
            <DefaultContextMenuContent />
          </TldrawUiMenuContextProvider>
        </TldrawUiDropdownMenuContent>
      </TldrawUiDropdownMenuRoot>
    </TldrawUiContextualToolbar>
  )
}

export function ShapeConnectionHandles({ accountId }: { accountId?: string } = {}) {
  const editor = useEditor()
  const handles = useValue(
    'selected shape connection handles',
    () => getShapeConnectionHandles(editor),
    [editor],
  )

  const startConnection = (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: ShapeConnectionHandle,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    activeConnectionDrags.get(editor)?.()

    const sourceShape = editor.getOnlySelectedShape()
    if (!sourceShape) return

    const pointerId = event.pointerId
    const arrowId = createShapeId()
    const startClientPoint = { x: event.clientX, y: event.clientY }
    const startPagePoint = editor.screenToPage(handle.anchor)
    let started = false
    let markId: string | undefined
    let finished = false
    let stopDragging = () => {}
    const ensureArrowCreated = () => {
      if (started) return Boolean(editor.getShape(arrowId))

      markId = editor.markHistoryStoppingPoint(`creating_connected_arrow:${arrowId}`)
      started = true
      editor.createShape({
        id: arrowId,
        type: 'arrow',
        x: startPagePoint.x,
        y: startPagePoint.y,
        opacity: arrowShapeOpacityFromPreference(accountId),
        meta: { [CONNECTED_SHAPE_ARROW_META_KEY]: true },
        props: {
          ...arrowShapePropsFromPreference(accountId),
          kind: 'elbow',
          scale: editor.getResizeScaleFactor(),
        },
      })

      if (!editor.getShape<TLArrowShape>(arrowId)) {
        editor.bailToMark(markId)
        markId = undefined
        started = false
        return false
      }

      editor.createBinding({
        type: 'arrow',
        fromId: arrowId,
        toId: sourceShape.id,
        props: {
          terminal: 'start',
          normalizedAnchor: handle.normalizedAnchor,
          isPrecise: true,
          isExact: false,
          snap: 'edge-point',
        },
      })
      return true
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      clearArrowTargetState(editor)
      if (activeConnectionDrags.get(editor) === stopDragging) {
        activeConnectionDrags.delete(editor)
      }
    }
    const updateArrowEnd = (clientX: number, clientY: number) => {
      if (!started) return
      const arrow = editor.getShape<TLArrowShape>(arrowId)
      if (!arrow) return
      const handles = editor.getShapeHandles(arrow)
      const endHandle = handles?.find((candidate) => candidate.id === 'end')
      if (!endHandle) return

      const pointInPageSpace = editor.screenToPage({ x: clientX, y: clientY })
      const pointInShapeSpace = editor.getPointInShapeSpace(arrow, pointInPageSpace)
      const change = editor.getShapeUtil<TLArrowShape>('arrow').onHandleDrag?.(arrow, {
        handle: { ...endHandle, x: pointInShapeSpace.x, y: pointInShapeSpace.y },
        isPrecise: true,
        isCreatingShape: true,
        initial: arrow,
      })
      if (change) editor.updateShapes([change])
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const dragDistance = Math.hypot(
        moveEvent.clientX - startClientPoint.x,
        moveEvent.clientY - startClientPoint.y,
      )
      if (dragDistance < MIN_CONNECTION_DRAG_DISTANCE) return
      if (!ensureArrowCreated()) return
      moveEvent.preventDefault()
      updateArrowEnd(moveEvent.clientX, moveEvent.clientY)
    }
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      const dragDistance = Math.hypot(
        upEvent.clientX - startClientPoint.x,
        upEvent.clientY - startClientPoint.y,
      )
      if (dragDistance < MIN_CONNECTION_DRAG_DISTANCE) {
        cleanup()
        if (started && !finished && markId) editor.bailToMark(markId)
        return
      }
      if (!ensureArrowCreated()) {
        cleanup()
        return
      }
      updateArrowEnd(upEvent.clientX, upEvent.clientY)
      cleanup()
      if (!editor.getShape(arrowId)) {
        if (markId) editor.bailToMark(markId)
        return
      }
      finished = true
      editor.select(arrowId)
    }
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      if (started && !finished && markId) editor.bailToMark(markId)
    }

    stopDragging = () => {
      cleanup()
      if (started && !finished && markId) editor.bailToMark(markId)
    }
    activeConnectionDrags.set(editor, stopDragging)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  if (handles.length === 0) return null

  return createPortal(
    <div className="shape-connection-handles" aria-label="元素连接锚点">
      {handles.map((handle) => (
        <button
          key={handle.id}
          type="button"
          className="shape-connection-handle"
          aria-label={handle.label}
          title={handle.label}
          style={{ left: handle.display.x, top: handle.display.y }}
          onPointerDown={(event) => startConnection(event, handle)}
        />
      ))}
    </div>,
    document.body,
  )
}

function CanvasCommentPins({
  threads,
  onFocusThread,
  onMoveThread,
  onDeleteThread,
  commentToolActive,
  pendingCommentAnchor,
}: {
  threads: readonly CommentThreadView[]
  onFocusThread(threadId: string): void
  onMoveThread(threadId: string, anchor: { x: number; y: number }): void
  onDeleteThread(threadId: string): void
  commentToolActive: boolean
  pendingCommentAnchor?: { shapeId?: string; x: number; y: number; shapeOffsetX?: number; shapeOffsetY?: number }
}) {
  const editor = useEditor()
  return <>
    <CommentPins
      editor={editor}
      threads={threads}
      onFocusThread={onFocusThread}
      onMoveThread={onMoveThread}
      onDeleteThread={onDeleteThread}
    />
    {pendingCommentAnchor ? <CommentPendingPin editor={editor} anchor={pendingCommentAnchor} /> : null}
    {commentToolActive ? <CommentDraftPin editor={editor} /> : null}
  </>
}

function isNonEditingShortcut(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  const key = event.key.toLowerCase()
  return key === 'c' || key === 'w' || key === 'tab'
}

export function CanvasEditor({
  licenseKey = getCanvasLicenseKey(),
  tldrawUser,
  store,
  inputSessionKey,
  onEditIntent,
  onClipboardPaste,
  onMount,
  onBoardReferenceOpen,
  boardReferenceActions,
  referenceToolActive = false,
  onReferenceToolToggle,
  onReferenceToolCancel,
  onReferencePlace,
  commentToolActive = false,
  pendingCommentAnchor,
  onCommentToolToggle,
  onCommentCancel,
  onCommentPlace,
  commentThreads = [],
  onFocusCommentThread,
  onMoveCommentThread,
  onDeleteCommentThread,
  onBoardReferenceDrop,
}: CanvasEditorProps) {
  const editorRef = useRef<Editor | undefined>(undefined)
  const inputEnabledRef = useRef(onEditIntent === undefined)
  const inputSessionKeyRef = useRef(inputSessionKey)
  const pasteAsPlainTextRef = useRef(false)
  const commentPointerId = useRef<number | undefined>(undefined)
  const referencePointerId = useRef<number | undefined>(undefined)
  const referenceDeleteGuardDisposerRef = useRef<(() => void) | undefined>(undefined)
  const contextMenuReplayRequestRef = useRef(0)
  const contextMenuReplayActiveRef = useRef(false)
  const componentPropsRef = useRef({
    boardReferenceActions,
    tldrawUser,
    commentThreads,
    commentToolActive,
    pendingCommentAnchor,
    onCommentToolToggle,
    onCommentCancel,
    referenceToolActive,
    onReferenceToolToggle,
    onReferenceToolCancel,
    onDeleteCommentThread,
    onFocusCommentThread,
    onMoveCommentThread,
  })
  componentPropsRef.current = {
    boardReferenceActions,
    tldrawUser,
    commentThreads,
    commentToolActive,
    pendingCommentAnchor,
    onCommentToolToggle,
    onCommentCancel,
    referenceToolActive,
    onReferenceToolToggle,
    onReferenceToolCancel,
    onDeleteCommentThread,
    onFocusCommentThread,
    onMoveCommentThread,
  }

  const isCommentPinTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest('.comment-pin'))

  const isCanvasTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest('.tl-canvas'))

  const isCanvasContextMenuTarget = (target: EventTarget | null, editor: Editor): boolean => {
    if (!(target instanceof Element) || target.closest('[data-testid="context-menu"]')) return false
    const canvas = editor.getContainer().querySelector('.tl-canvas')
    return Boolean(
      target.closest('.tl-canvas')
      || target.closest('.tlui-menu-click-capture')
      || target === canvas?.parentElement,
    )
  }

  const scheduleNativeContextMenuReplay = (event: React.MouseEvent<HTMLDivElement>) => {
    const editor = editorRef.current
    const requestAnimationFrame = editor?.timers?.requestAnimationFrame?.bind(editor.timers)
    const setTimeout = editor?.timers?.setTimeout?.bind(editor.timers)
    if (!editor || !requestAnimationFrame || contextMenuReplayActiveRef.current) return

    const requestId = ++contextMenuReplayRequestRef.current
    let replayRequested = false
    const nativeEvent = event.nativeEvent
    const pointerEvent = typeof PointerEvent !== 'undefined' && nativeEvent instanceof PointerEvent
      ? nativeEvent
      : undefined
    const eventInit: PointerEventInit = {
      bubbles: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 2,
      buttons: 0,
      pointerId: pointerEvent?.pointerId ?? 1,
      pointerType: pointerEvent?.pointerType ?? 'mouse',
      isPrimary: pointerEvent?.isPrimary ?? true,
    }

    const replayIfMissing = () => {
      if (requestId !== contextMenuReplayRequestRef.current || editorRef.current !== editor) {
        return
      }
      if (replayRequested) {
        return
      }
      if (editor.getContainer().querySelector('[data-testid="context-menu"]')) {
        return
      }
      replayRequested = true

      // A contextmenu can arrive while the native Radix root is still closing its
      // previous uncontrolled state. Clear tldraw's matching global state, wait
      // another frame for the native root to settle, then replay through its trigger.
      editor.menus.clearOpenMenus()
      requestAnimationFrame(() => {
        if (requestId !== contextMenuReplayRequestRef.current || editorRef.current !== editor) {
          return
        }
        const canvas = editor.getContainer().querySelector<HTMLElement>('.tl-canvas')
        const trigger = canvas?.parentElement
        if (!trigger || editor.getContainer().querySelector('[data-testid="context-menu"]')) {
          return
        }

        contextMenuReplayActiveRef.current = true
        try {
          const ContextMenuEvent = typeof PointerEvent === 'undefined' ? MouseEvent : PointerEvent
          trigger.dispatchEvent(new ContextMenuEvent('contextmenu', eventInit))
        } finally {
          contextMenuReplayActiveRef.current = false
        }
      })
    }

    requestAnimationFrame(() => requestAnimationFrame(replayIfMissing))
    // The old menu can remain mounted for a frame and close only after the fast
    // check. Recheck once after the close transition has settled.
    setTimeout?.(replayIfMissing, 80)
  }

  const components = useMemo<TLComponents>(() => ({
    ActionsMenu: CanvasActionsMenu,
    StylePanel: (props) => (
      <CanvasTextStylePanel
        {...props}
        {...(componentPropsRef.current.tldrawUser?.id
          ? { accountId: componentPropsRef.current.tldrawUser.id }
          : {})}
      />
    ),
    ContextMenu: (props) => (
      <BoardReferenceContextMenu
        {...props}
        {...(componentPropsRef.current.boardReferenceActions
          ? { actions: componentPropsRef.current.boardReferenceActions }
          : {})}
      />
    ),
    Toolbar: () => {
      const current = componentPropsRef.current
      return <CanvasToolbar
        commentToolActive={current.commentToolActive}
        {...(current.onCommentToolToggle ? { onCommentToolToggle: current.onCommentToolToggle } : {})}
        referenceToolActive={current.referenceToolActive}
        {...(current.onReferenceToolToggle ? { onReferenceToolToggle: current.onReferenceToolToggle } : {})}
      />
    },
    InFrontOfTheCanvas: () => {
      const current = componentPropsRef.current
      return <>
        <CanvasExternalToolBridge
          commentToolActive={current.commentToolActive}
          referenceToolActive={current.referenceToolActive}
          {...(current.onCommentCancel ? { onCommentCancel: current.onCommentCancel } : {})}
          {...(current.onReferenceToolCancel ? { onReferenceToolCancel: current.onReferenceToolCancel } : {})}
        />
        {current.tldrawUser?.id ? <CanvasToolStylePreferenceBridge accountId={current.tldrawUser.id} /> : null}
        <GroupSelectionToolbar />
        <ShapeConnectionHandles {...(current.tldrawUser?.id ? { accountId: current.tldrawUser.id } : {})} />
        {current.onFocusCommentThread && current.onMoveCommentThread && current.onDeleteCommentThread ? <CanvasCommentPins
          threads={current.commentThreads}
          onFocusThread={current.onFocusCommentThread}
          onMoveThread={current.onMoveCommentThread}
          onDeleteThread={current.onDeleteCommentThread}
          commentToolActive={current.commentToolActive}
          {...(current.pendingCommentAnchor ? { pendingCommentAnchor: current.pendingCommentAnchor } : {})}
        /> : null}
      </>
    },
  }), [])

  useEffect(() => {
    if (!onBoardReferenceOpen) return
    return setBoardReferenceOpenHandler(onBoardReferenceOpen)
  }, [onBoardReferenceOpen])

  useEffect(() => {
    if (!referenceToolActive) referencePointerId.current = undefined
  }, [referenceToolActive])

  useEffect(() => () => {
    referenceDeleteGuardDisposerRef.current?.()
    referenceDeleteGuardDisposerRef.current = undefined
  }, [])

  const setTldrawReadOnly = (isReadonly: boolean) => {
    editorRef.current?.updateInstanceState({ isReadonly })
  }

  const requestEditAccess = () => {
    if (!onEditIntent || inputEnabledRef.current) return true
    if (!onEditIntent()) {
      setTldrawReadOnly(true)
      return false
    }
    inputEnabledRef.current = true
    setTldrawReadOnly(false)
    return true
  }

  useEffect(() => {
    const sessionChanged = inputSessionKeyRef.current !== inputSessionKey
    if (sessionChanged) {
      inputSessionKeyRef.current = inputSessionKey
      inputEnabledRef.current = onEditIntent === undefined
    }
    if (sessionChanged && editorRef.current && onEditIntent) {
      requestEditAccess()
      return
    }
    setTldrawReadOnly(!inputEnabledRef.current)
  }, [inputSessionKey, onEditIntent])

  return (
    <div
      className="canvas-editor"
      aria-label="白板画布"
      data-reference-tool-active={referenceToolActive ? 'true' : 'false'}
      onPointerDownCapture={(event) => {
        // Any new pointer gesture supersedes a pending replay. A genuine right
        // click will schedule a fresh request from its later contextmenu event;
        // a right-button drag will not, so it remains canvas panning.
        contextMenuReplayRequestRef.current += 1
        if (isCommentPinTarget(event.target)) return
        if (referenceToolActive && onReferencePlace) {
          if (event.button !== 0 || !isCanvasTarget(event.target)) return
          if (!requestEditAccess()) return
          referencePointerId.current = event.pointerId
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (!commentToolActive || !onCommentPlace) {
          requestEditAccess()
          return
        }
        if (event.button !== 0 || !isCanvasTarget(event.target)) return
        if (!requestEditAccess()) return
        commentPointerId.current = event.pointerId
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerUpCapture={(event) => {
        if (isCommentPinTarget(event.target)) return
        if (!isCanvasTarget(event.target)) return
        if (referenceToolActive && referencePointerId.current === event.pointerId && onReferencePlace && editorRef.current) {
          referencePointerId.current = undefined
          event.preventDefault()
          event.stopPropagation()
          const point = editorRef.current.screenToPage({ x: event.clientX, y: event.clientY })
          onReferenceToolCancel?.()
          onReferencePlace({ x: point.x, y: point.y })
          return
        }
        if (commentPointerId.current !== event.pointerId || !onCommentPlace || !editorRef.current) return
        commentPointerId.current = undefined
        const point = editorRef.current.screenToPage({ x: event.clientX, y: event.clientY })
        const shape = editorRef.current.getShapeAtPoint(point)
        const localPoint = shape
          ? editorRef.current.getShapePageTransform(shape)?.clone().invert().applyToPoint(point)
          : undefined
        onCommentPlace({
          x: point.x,
          y: point.y,
          ...(shape ? { shapeId: shape.id } : {}),
          ...(localPoint ? { shapeOffsetX: localPoint.x, shapeOffsetY: localPoint.y } : {}),
        })
      }}
      onPasteCapture={(event) => {
        if (!requestEditAccess()) return
        const editor = editorRef.current
        const pasteAsPlainText = pasteAsPlainTextRef.current
        pasteAsPlainTextRef.current = false
        if (!editor || !onClipboardPaste?.({
          editor,
          event: event.nativeEvent,
          pasteAsPlainText,
        })) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragOverCapture={(event) => {
        if (event.dataTransfer.types.includes(BOARD_DRAG_TYPE)) event.preventDefault()
      }}
      onDropCapture={(event) => {
        const boardId = event.dataTransfer.getData(BOARD_DRAG_TYPE)
        if (boardId && onBoardReferenceDrop && editorRef.current) {
          if (!requestEditAccess()) return
          event.preventDefault()
          event.stopPropagation()
          const point = editorRef.current.screenToPage({ x: event.clientX, y: event.clientY })
          onBoardReferenceDrop({ boardId, x: point.x, y: point.y })
          return
        }
        requestEditAccess()
      }}
      onContextMenuCapture={(event) => {
        if (referenceToolActive && onReferenceToolCancel) {
          contextMenuReplayRequestRef.current += 1
          event.preventDefault()
          event.stopPropagation()
          onReferenceToolCancel()
          return
        }
        if (commentToolActive && onCommentCancel) {
          contextMenuReplayRequestRef.current += 1
          event.preventDefault()
          event.stopPropagation()
          onCommentCancel()
          return
        }
        const editor = editorRef.current
        if (!editor || !isCanvasContextMenuTarget(event.target, editor)) return
        if (isCanvasTarget(event.target)) {
          const point = editor.screenToPage({ x: event.clientX, y: event.clientY })
          const shape = editor.getShapeAtPoint(point)
          if (shape?.type === 'board-reference') editor.select(shape.id)
        }
        scheduleNativeContextMenuReplay(event)
      }}
      onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
          pasteAsPlainTextRef.current = event.shiftKey
        }
        if (event.key === 'Escape') {
          contextMenuReplayRequestRef.current += 1
          if (referenceToolActive && onReferenceToolCancel) {
            event.preventDefault()
            event.stopPropagation()
            onReferenceToolCancel()
            return
          }
        }
        if (!isNonEditingShortcut(event)) requestEditAccess()
      }}
      onKeyUpCapture={(event) => {
        if (event.key.toLowerCase() === 'v') pasteAsPlainTextRef.current = false
      }}
    >
      <Tldraw
        getShapeVisibility={itemValueVisibility}
        assetUrls={CANVAS_ASSET_URLS}
        options={CANVAS_TLDRAW_OPTIONS}
        overrides={CANVAS_UI_OVERRIDES}
        components={components}
        shapeUtils={CANVAS_SHAPE_UTILS}
        tools={CANVAS_TOOLS}
        {...(licenseKey ? { licenseKey } : {})}
        {...(store ? { store } : {})}
        locale="zh-cn"
        onMount={(editor) => {
          editorRef.current = editor
          if (tldrawUser?.id) canvasToolStyleAccountByEditor.set(editor, tldrawUser.id)
          else canvasToolStyleAccountByEditor.delete(editor)
          editor.user?.updateUserPreferences?.({ isPasteAtCursorMode: true })
          referenceDeleteGuardDisposerRef.current?.()
          referenceDeleteGuardDisposerRef.current = editor.sideEffects?.registerBeforeDeleteHandler(
            'shape',
            (shape, source) => {
              if (source !== 'user' || shape.type !== 'board-reference') return
              componentPropsRef.current.boardReferenceActions?.remove(shape as BoardReferenceShape)
              return false
            },
          )
          migrateConnectedShapeArrowsToElbows(editor)
          editor.setStyleForNextShapes?.(ArrowShapeKindStyle, 'elbow')
          onMount?.(editor)
          requestEditAccess()
          setTldrawReadOnly(!inputEnabledRef.current)
          if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
            ;(window as Window & { __INFINITE_BOARD_EDITOR__?: Editor }).__INFINITE_BOARD_EDITOR__ = editor
          }
        }}
      />
    </div>
  )
}
