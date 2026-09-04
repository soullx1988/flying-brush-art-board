import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Table as TableIcon, TreeStructure } from '@phosphor-icons/react'
import {
  ArrowShapeKindStyle,
  AssetToolbarItem,
  clearArrowTargetState,
  createShapeId,
  DefaultContextMenu,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultStylePanel,
  DefaultTextAlignStyle,
  DefaultContextMenuContent,
  DefaultToolbar,
  Tldraw,
  TldrawUiIcon,
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
  ToolbarItem,
  getColorStyleItems,
  getFontStyleItems,
  ReadonlySharedStyleMap,
  type Editor,
  type TLArrowShape,
  type TLAnyShapeUtilConstructor,
  type TLShapeId,
  type TLComponents,
  type TLUiContextMenuProps,
  type TLUiOverrides,
  type TLStore,
  type TLUiStylePanelProps,
  useEditor,
  useTools,
  useValue,
} from 'tldraw'

import type { BoardReferenceKind } from '@infinite-board/board-core'
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
  tradingPanelShapeUtils,
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
  type TradingPanelKind,
  type TradingPanelShape,
  setBoardReferenceOpenHandler,
  type BoardReferenceShape,
} from '@infinite-board/tldraw-adapter'
import { CommentDraftPin, CommentPendingPin, CommentPins } from '../comments/CommentPins'
import type { CommentThreadView } from '../comments/comment-client'
import { CANVAS_ASSET_URLS } from './tldraw-assets'

export const CANVAS_TLDRAW_OPTIONS = {
  createTextOnCanvasDoubleClick: false,
  maxShapesPerPage: 10_000,
} as const

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
  store?: TLStore
  /** Changes whenever the active tab starts editing a different Board. */
  inputSessionKey?: string
  /** On direct-entry routes, focus this template panel after the snapshot is ready. */
  initialTradingPanelKind?: TradingPanelKind
  /**
   * When supplied, tldraw starts as read-only and this synchronous gate must
   * approve an edit intent before tldraw receives a mutable input event.
   */
  onEditIntent?: () => boolean
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

interface TradingPanelViewPreset {
  id: TLShapeId
  label: string
}

const TRADING_TEMPLATE_KEY = 'shortline-trading-v1'
const TRADING_PANEL_VIEW_LABELS: Record<string, string> = {
  'today-overview': '今天怎么看',
  'market-overview': '市场主线',
  'yishui-inference': '义水推演',
  'stock-pool': '个人选股池',
  announcements: '公告观察',
  'system-status': '数据状态',
}

const TRADING_PANEL_VIEW_ORDER = ['market-overview', 'yishui-inference', 'stock-pool', 'announcements', 'system-status']
const TRADING_PANEL_FOCUS_TOP_GUTTER = 120
const TRADING_PANEL_FOCUS_BOTTOM_GUTTER = 72
const TRADING_PANEL_FOCUS_RIGHT_GUTTER = 180
const TRADING_TODAY_FOCUS_TOP_GUTTER = 12
const TRADING_TODAY_FOCUS_BOTTOM_GUTTER = 20
const TRADING_TODAY_FOCUS_RIGHT_GUTTER = 32
const TRADING_TODAY_FOCUS_CONTENT_WIDTH = 1860
const TRADING_TODAY_FOCUS_CONTENT_HEIGHT = 900
const TRADING_OVERVIEW_FOCUS_BOTTOM_GUTTER = 120
const TRADING_OVERVIEW_FOCUS_RIGHT_GUTTER = 180
const INITIAL_VIEW_EPSILON = 0.0001
const CANVAS_IDLE_STYLE_TOOLS = new Set(['draw', 'text', 'note', 'geo'])

const BOARD_DRAG_TYPE = 'application/x-infinite-board-board-id'

function listTemplateTradingPanels(shapes: ReturnType<Editor['getCurrentPageShapes']>) {
  const firstByKind = new Map<string, (typeof shapes)[number]>()
  for (const shape of shapes) {
    if (shape.type !== 'trading-panel' || shape.meta?.template !== TRADING_TEMPLATE_KEY) continue
    const kind = String((shape.props as { panelKind?: unknown }).panelKind ?? '')
    if (!TRADING_PANEL_VIEW_ORDER.includes(kind) || firstByKind.has(kind)) continue
    firstByKind.set(kind, shape)
  }
  return TRADING_PANEL_VIEW_ORDER.flatMap((kind) => {
    const shape = firstByKind.get(kind)
    return shape ? [{ shape, kind }] : []
  })
}

function buildTradingPanelViewPresets(
  shapes: ReturnType<Editor['getCurrentPageShapes']>,
): TradingPanelViewPreset[] {
  return listTemplateTradingPanels(shapes).map(({ shape, kind }) => ({
    id: shape.id,
    label: TRADING_PANEL_VIEW_LABELS[kind]
      ?? String((shape.props as { title?: unknown }).title ?? '数据面板'),
  }))
}

function findTemplateTodayOverviewPanel(shapes: ReturnType<Editor['getCurrentPageShapes']>) {
  return shapes.find((shape) => (
    shape.type === 'trading-panel'
    && shape.meta?.template === TRADING_TEMPLATE_KEY
    && (shape.props as { panelKind?: unknown }).panelKind === 'today-overview'
  ))
}

function listTemplateBoardReferences(shapes: ReturnType<Editor['getCurrentPageShapes']>) {
  return shapes.filter((shape) => (
    shape.type === 'board-reference'
    && shape.meta?.template === TRADING_TEMPLATE_KEY
  ))
}

function mergeShapeBounds(
  editor: Pick<Editor, 'getShapePageBounds'>,
  shapes: ReturnType<Editor['getCurrentPageShapes']>,
) {
  let merged:
    | { x: number; y: number; w: number; h: number }
    | undefined
  for (const shape of shapes) {
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) continue
    if (!merged) {
      merged = { ...bounds }
      continue
    }
    const left = Math.min(merged.x, bounds.x)
    const top = Math.min(merged.y, bounds.y)
    const right = Math.max(merged.x + merged.w, bounds.x + bounds.w)
    const bottom = Math.max(merged.y + merged.h, bounds.y + bounds.h)
    merged = { x: left, y: top, w: right - left, h: bottom - top }
  }
  return merged
}

function isDefaultInitialCanvasView(editor: Editor): boolean {
  const camera = editor.getCamera()
  return Math.abs(camera.x) <= INITIAL_VIEW_EPSILON
    && Math.abs(camera.y) <= INITIAL_VIEW_EPSILON
    && Math.abs(camera.z - 1) <= INITIAL_VIEW_EPSILON
    && editor.getSelectedShapeIds().length === 0
    && editor.getCurrentToolId() === 'select'
}

function getTodayOverviewFocusBounds(bounds: { x: number; y: number; w: number; h: number }) {
  return {
    x: bounds.x,
    y: bounds.y - TRADING_TODAY_FOCUS_TOP_GUTTER,
    w: Math.min(bounds.w, TRADING_TODAY_FOCUS_CONTENT_WIDTH) + TRADING_TODAY_FOCUS_RIGHT_GUTTER,
    h: Math.min(bounds.h, TRADING_TODAY_FOCUS_CONTENT_HEIGHT) + TRADING_TODAY_FOCUS_TOP_GUTTER + TRADING_TODAY_FOCUS_BOTTOM_GUTTER,
  }
}

const CANVAS_UI_OVERRIDES = {
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
      'page-menu.max-pages-reached': '已达到最大页面数量',
      'page-menu.resize': '调整页面列表大小',
      'tool.frame': '分区',
    },
  },
} satisfies TLUiOverrides

type PenEraserToolId = 'draw' | 'eraser'

const lastPenEraserToolByEditor = new WeakMap<Editor, PenEraserToolId>()
const CANVAS_SHAPE_UTILS = [
  ...enhancedArrowShapeUtils,
  ...boardReferenceShapeUtils,
  ...tableShapeUtils,
  ...mindMapShapeUtils,
  ...tradingPanelShapeUtils,
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
  return (
    <DefaultToolbar minItems={10} maxItems={10}>
      {onCommentToolToggle ? (
        <TldrawUiToolbarButton
          type="tool"
          title="评论"
          tooltip="添加或查看评论"
          {...(commentToolActive === undefined ? {} : { isActive: commentToolActive })}
          onClick={onCommentToolToggle}
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
          onClick={onReferenceToolToggle}
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

function CanvasTextStylePanel(props: TLUiStylePanelProps) {
  const editor = useEditor()
  const selectedShape = useValue('canvas style panel selected shape', () => editor.getOnlySelectedShape(), [editor])
  const isReadonly = useValue('canvas style panel readonly', () => editor.getInstanceState().isReadonly, [editor])
  const currentToolId = useValue('canvas style panel current tool', () => editor.getCurrentToolId(), [editor])
  const interactionTarget = useSyncExternalStore(
    (listener) => subscribeCanvasShapeInteractionTarget(editor, listener),
    () => getCanvasShapeInteractionTarget(editor),
    () => undefined,
  )
  if (!selectedShape) {
    if (isReadonly || !CANVAS_IDLE_STYLE_TOOLS.has(currentToolId)) return null
    return <DefaultStylePanel {...props} />
  }
  if (selectedShape?.type === 'table' && interactionTarget?.type === 'table' && interactionTarget.shapeId === selectedShape.id) {
    return <TableTextStylePanel {...props} />
  }
  if (selectedShape?.type === 'mind-map') {
    return <MindMapTextStylePanel {...props} />
  }
  if (isReadonly) return null
  return <DefaultStylePanel {...props} />
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
  onTradingPanelViewsChange,
  ...props
}: TLUiContextMenuProps & {
  actions?: BoardReferenceActions
  onTradingPanelViewsChange?(views: TradingPanelViewPreset[]): void
}) {
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
  const tradingPanelShape = shape?.type === 'trading-panel' ? shape as TradingPanelShape : undefined
  const pageShapes = typeof editor.getCurrentPageShapes === 'function'
    ? editor.getCurrentPageShapes()
    : []
  const hasOtherYishuiPanel = Boolean(tradingPanelShape && pageShapes.some((candidate) => (
    candidate.id !== tradingPanelShape.id
    && candidate.type === 'trading-panel'
    && (candidate.props as { panelKind?: unknown }).panelKind === 'yishui-inference'
  )))
  const yishuiReplacementDisabled = tradingPanelShape?.props.panelKind === 'yishui-inference'
    || hasOtherYishuiPanel
  const updateTradingPanel = (panelKind: TradingPanelKind, title: string) => {
    if (!tradingPanelShape || editor.getInstanceState().isReadonly) return
    if (tradingPanelShape.props.panelKind === panelKind) return
    if (panelKind === 'yishui-inference' && hasOtherYishuiPanel) return
    editor.markHistoryStoppingPoint(`trading_panel_kind:${panelKind}`)
    editor.updateShape<TradingPanelShape>({
      id: tradingPanelShape.id,
      type: tradingPanelShape.type,
      props: { panelKind, title },
    })
    if (typeof editor.getCurrentPageShapes === 'function') {
      onTradingPanelViewsChange?.(buildTradingPanelViewPresets(editor.getCurrentPageShapes()))
    }
  }
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
          {shape.meta?.protectedCore !== true ? <>
            <TldrawUiMenuItem
              id="board-reference-kind"
              label={shape.props.kind === 'embed' ? '切换为普通链接' : '切换为嵌入画板'}
              readonlyOk
              onSelect={() => actions.changeKind(shape as BoardReferenceShape, shape.props.kind === 'embed' ? 'link' : 'embed')}
            />
            <TldrawUiMenuItem id="board-reference-remove" label="移除引用（目标画板会保留）" readonlyOk onSelect={() => actions.remove(shape as BoardReferenceShape)} />
          </> : null}
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
      {tradingPanelShape && tradingPanelShape.meta?.protectedCore !== true ? (
        <TldrawUiMenuGroup id="trading-panel">
          <TldrawUiMenuItem id="trading-panel-today" label="显示今天怎么看" onSelect={() => updateTradingPanel('today-overview', '今天怎么看')} />
          <TldrawUiMenuItem id="trading-panel-market" label="显示市场环境与主线" onSelect={() => updateTradingPanel('market-overview', '市场环境与主线')} />
          <TldrawUiMenuItem
            id="trading-panel-yishui"
            label="替换此面板为义水推演"
            disabled={yishuiReplacementDisabled}
            onSelect={() => updateTradingPanel('yishui-inference', '义水北路推演画板')}
          />
          <TldrawUiMenuItem id="trading-panel-pool" label="显示个人选股池" onSelect={() => updateTradingPanel('stock-pool', '个人选股池')} />
          <TldrawUiMenuItem id="trading-panel-announcements" label="显示公告观察源" onSelect={() => updateTradingPanel('announcements', '公告观察源')} />
          <TldrawUiMenuItem id="trading-panel-system" label="显示数据源状态" onSelect={() => updateTradingPanel('system-status', '数据源与生产就绪状态')} />
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
const activeConnectionDrags = new WeakMap<Editor, () => void>()

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

export function ShapeConnectionHandles() {
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
    const markId = editor.markHistoryStoppingPoint(`creating_connected_arrow:${arrowId}`)
    const startPagePoint = editor.screenToPage(handle.anchor)
    editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: startPagePoint.x,
      y: startPagePoint.y,
      props: {
        kind: 'elbow',
        scale: editor.getResizeScaleFactor(),
      },
    })

    const createdArrow = editor.getShape<TLArrowShape>(arrowId)
    if (!createdArrow) {
      editor.bailToMark(markId)
      return
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

    let finished = false
    let stopDragging = () => {}
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

      const endBinding = editor
        .getBindingsFromShape(arrowId, 'arrow')
        .find((binding) => binding.props.terminal === 'end')
      if (endBinding) {
        editor.updateBinding({
          ...endBinding,
          props: {
            ...endBinding.props,
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isPrecise: false,
            isExact: false,
            snap: 'center',
          },
        })
      }
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      updateArrowEnd(moveEvent.clientX, moveEvent.clientY)
    }
    const finish = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      updateArrowEnd(upEvent.clientX, upEvent.clientY)
      const dragDistance = Math.hypot(
        upEvent.clientX - handle.anchor.x,
        upEvent.clientY - handle.anchor.y,
      )
      cleanup()
      if (dragDistance < MIN_CONNECTION_DRAG_DISTANCE || !editor.getShape(arrowId)) {
        editor.bailToMark(markId)
        return
      }
      finished = true
      editor.select(arrowId)
    }
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      editor.bailToMark(markId)
    }

    stopDragging = () => {
      cleanup()
      if (!finished) editor.bailToMark(markId)
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
  store,
  inputSessionKey,
  initialTradingPanelKind,
  onEditIntent,
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
  const [tradingPanelViews, setTradingPanelViews] = useState<TradingPanelViewPreset[]>([])
  const [activeTradingPanelView, setActiveTradingPanelView] = useState<TLShapeId | 'overview'>('overview')
  const inputEnabledRef = useRef(onEditIntent === undefined)
  const inputSessionKeyRef = useRef(inputSessionKey)
  const initialTradingPanelKindRef = useRef(initialTradingPanelKind)
  const commentPointerId = useRef<number | undefined>(undefined)
  const referencePointerId = useRef<number | undefined>(undefined)
  const referenceDeleteGuardDisposerRef = useRef<(() => void) | undefined>(undefined)
  const contextMenuReplayRequestRef = useRef(0)
  const contextMenuReplayActiveRef = useRef(false)
  const initialViewportFitAllowedRef = useRef(true)
  const initialViewportFitGenerationRef = useRef(0)
  const initialViewportFitTimerRef = useRef<number | undefined>(undefined)
  const initialViewportFitSubscriptionRef = useRef<(() => void) | undefined>(undefined)
  const componentPropsRef = useRef({
    boardReferenceActions,
    onTradingPanelViewsChange: setTradingPanelViews,
    commentThreads,
    commentToolActive,
    pendingCommentAnchor,
    onCommentToolToggle,
    referenceToolActive,
    onReferenceToolToggle,
    onDeleteCommentThread,
    onFocusCommentThread,
    onMoveCommentThread,
  })
  componentPropsRef.current = {
    boardReferenceActions,
    onTradingPanelViewsChange: setTradingPanelViews,
    commentThreads,
    commentToolActive,
    pendingCommentAnchor,
    onCommentToolToggle,
    referenceToolActive,
    onReferenceToolToggle,
    onDeleteCommentThread,
    onFocusCommentThread,
    onMoveCommentThread,
  }
  initialTradingPanelKindRef.current = initialTradingPanelKind

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
    StylePanel: CanvasTextStylePanel,
    ContextMenu: (props) => (
      <BoardReferenceContextMenu
        {...props}
        {...(componentPropsRef.current.boardReferenceActions
          ? { actions: componentPropsRef.current.boardReferenceActions }
          : {})}
        onTradingPanelViewsChange={componentPropsRef.current.onTradingPanelViewsChange}
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
        <ShapeConnectionHandles />
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

  useLayoutEffect(() => {
    if (!onBoardReferenceOpen) return
    return setBoardReferenceOpenHandler(onBoardReferenceOpen)
  }, [onBoardReferenceOpen])

  useEffect(() => {
    if (!referenceToolActive) referencePointerId.current = undefined
  }, [referenceToolActive])

  const cancelInitialViewportFit = () => {
    initialViewportFitGenerationRef.current += 1
    if (initialViewportFitTimerRef.current !== undefined) {
      window.clearTimeout(initialViewportFitTimerRef.current)
      initialViewportFitTimerRef.current = undefined
    }
  }

  const scheduleInitialTradingTemplateFit = (editor: Editor, sessionKey: string | undefined) => {
    cancelInitialViewportFit()
    const generation = initialViewportFitGenerationRef.current
    const schedule = editor.timers?.setTimeout?.bind(editor.timers) ?? window.setTimeout

    const scanTradingTemplate = (remainingAttempts: number) => {
      initialViewportFitTimerRef.current = undefined
      if (
        generation !== initialViewportFitGenerationRef.current
        || inputSessionKeyRef.current !== sessionKey
        || editorRef.current !== editor
      ) return

      const initialShapes = editor.getCurrentPageShapes()
      const tradingPanels = listTemplateTradingPanels(initialShapes)
      if (tradingPanels.length > 0) {
        setTradingPanelViews(buildTradingPanelViewPresets(initialShapes))
        const requestedPanel = initialTradingPanelKindRef.current
          ? tradingPanels.find((panel) => panel.kind === initialTradingPanelKindRef.current)
          : undefined
        if (requestedPanel) {
          if (initialViewportFitAllowedRef.current && isDefaultInitialCanvasView(editor)) {
            const bounds = editor.getShapePageBounds(requestedPanel.shape)
            setActiveTradingPanelView(requestedPanel.shape.id)
            if (bounds) editor.zoomToBounds({
              x: bounds.x,
              y: bounds.y - TRADING_PANEL_FOCUS_TOP_GUTTER,
              w: bounds.w + TRADING_PANEL_FOCUS_RIGHT_GUTTER,
              h: bounds.h + TRADING_PANEL_FOCUS_TOP_GUTTER + TRADING_PANEL_FOCUS_BOTTOM_GUTTER,
            }, { inset: 48, immediate: true })
          }
          return
        }
        if (initialTradingPanelKindRef.current && remainingAttempts > 0) {
          initialViewportFitTimerRef.current = schedule(
            () => scanTradingTemplate(remainingAttempts - 1),
            150,
          )
          return
        }
        if (
          tradingPanels.length === TRADING_PANEL_VIEW_ORDER.length
          && initialViewportFitAllowedRef.current
          && isDefaultInitialCanvasView(editor)
        ) {
          const bounds = editor.getShapePageBounds(tradingPanels[0]!.shape)
          setActiveTradingPanelView(tradingPanels[0]!.shape.id)
          if (bounds) editor.zoomToBounds({
            x: bounds.x,
            y: bounds.y - TRADING_PANEL_FOCUS_TOP_GUTTER,
            w: bounds.w + TRADING_PANEL_FOCUS_RIGHT_GUTTER,
            h: bounds.h + TRADING_PANEL_FOCUS_TOP_GUTTER + TRADING_PANEL_FOCUS_BOTTOM_GUTTER,
          }, { inset: 48, immediate: true })
        }
        return
      }

      const todayOverviewPanel = findTemplateTodayOverviewPanel(initialShapes)
      if (todayOverviewPanel) {
        setTradingPanelViews([])
        setActiveTradingPanelView('overview')
        if (initialViewportFitAllowedRef.current && isDefaultInitialCanvasView(editor)) {
          const bounds = editor.getShapePageBounds(todayOverviewPanel)
            if (bounds) editor.zoomToBounds(getTodayOverviewFocusBounds(bounds), { inset: 48, immediate: true })
        }
        return
      }

      const templateReferences = listTemplateBoardReferences(initialShapes)
      if (templateReferences.length > 0) {
        setTradingPanelViews([])
        setActiveTradingPanelView('overview')
        if (
          templateReferences.length === 5
          && initialViewportFitAllowedRef.current
          && isDefaultInitialCanvasView(editor)
        ) {
          const bounds = mergeShapeBounds(editor, templateReferences)
          if (bounds) editor.zoomToBounds({
            x: bounds.x,
            y: bounds.y,
            w: bounds.w + TRADING_OVERVIEW_FOCUS_RIGHT_GUTTER,
            h: bounds.h + TRADING_OVERVIEW_FOCUS_BOTTOM_GUTTER,
          }, { inset: 48, immediate: true })
        }
        return
      }

      if (initialShapes.length > 0) {
        setTradingPanelViews([])
        setActiveTradingPanelView('overview')
        return
      }

      if (remainingAttempts > 0) {
        initialViewportFitTimerRef.current = schedule(
          () => scanTradingTemplate(remainingAttempts - 1),
          150,
        )
      }
    }

    initialViewportFitTimerRef.current = schedule(() => scanTradingTemplate(8), 250)
  }

  const takeViewportControl = () => {
    initialViewportFitAllowedRef.current = false
    cancelInitialViewportFit()
  }

  useEffect(() => () => {
    const mountedEditor = editorRef.current
    cancelInitialViewportFit()
    initialViewportFitSubscriptionRef.current?.()
    initialViewportFitSubscriptionRef.current = undefined
    referenceDeleteGuardDisposerRef.current?.()
    referenceDeleteGuardDisposerRef.current = undefined
    editorRef.current = undefined
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
      const debugWindow = window as Window & { __INFINITE_BOARD_EDITOR__?: Editor }
      if (debugWindow.__INFINITE_BOARD_EDITOR__ === mountedEditor) {
        delete debugWindow.__INFINITE_BOARD_EDITOR__
      }
    }
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

  const focusTradingPanel = (shapeId?: TLShapeId) => {
    const editor = editorRef.current
    if (!editor) return
    if (!shapeId) {
      setActiveTradingPanelView('overview')
      editor.zoomToFit({ animation: { duration: 180 } })
      return
    }
    const bounds = editor.getShapePageBounds(shapeId)
    if (bounds) {
      setActiveTradingPanelView(shapeId)
      editor.zoomToBounds({
        x: bounds.x,
        y: bounds.y - TRADING_PANEL_FOCUS_TOP_GUTTER,
        w: bounds.w + TRADING_PANEL_FOCUS_RIGHT_GUTTER,
        h: bounds.h + TRADING_PANEL_FOCUS_TOP_GUTTER + TRADING_PANEL_FOCUS_BOTTOM_GUTTER,
      }, {
        inset: 48,
        animation: { duration: 180 },
      })
    }
  }

  useEffect(() => {
    const sessionChanged = inputSessionKeyRef.current !== inputSessionKey
    if (sessionChanged) {
      cancelInitialViewportFit()
      inputSessionKeyRef.current = inputSessionKey
      inputEnabledRef.current = onEditIntent === undefined
      initialViewportFitAllowedRef.current = true
      setTradingPanelViews([])
      setActiveTradingPanelView('overview')
      const editor = editorRef.current
      if (editor && typeof (editor as Partial<Editor>).getCurrentPageShapes === 'function') {
        scheduleInitialTradingTemplateFit(editor, inputSessionKey)
      }
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
        // Initial snapshots may arrive shortly after tldraw mounts. Once the
        // user starts a gesture, a delayed initial zoom must never move the
        // camera underneath that gesture and invalidate its screen points.
        takeViewportControl()
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
      onPasteCapture={() => {
        takeViewportControl()
        requestEditAccess()
      }}
      onWheelCapture={() => {
        takeViewportControl()
      }}
      onDragOverCapture={(event) => {
        if (event.dataTransfer.types.includes(BOARD_DRAG_TYPE)) event.preventDefault()
      }}
      onDropCapture={(event) => {
        takeViewportControl()
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
        takeViewportControl()
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
    >
      {tradingPanelViews.length > 0 ? (
        <nav
          className="trading-panel-view-switcher"
          aria-label="数据画板阅读视图"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => focusTradingPanel()}
            aria-label="数据视图：全景"
            aria-pressed={activeTradingPanelView === 'overview'}
          >
            全景
          </button>
          {tradingPanelViews.map((view) => (
            <button
              type="button"
              key={view.id}
              onClick={() => focusTradingPanel(view.id)}
              aria-label={`数据视图：${view.label}`}
              aria-pressed={activeTradingPanelView === view.id}
            >
              {view.label}
            </button>
          ))}
        </nav>
      ) : null}
      <Tldraw
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
          cancelInitialViewportFit()
          initialViewportFitSubscriptionRef.current?.()
          initialViewportFitSubscriptionRef.current = undefined
          editorRef.current = editor
          initialViewportFitAllowedRef.current = true
          referenceDeleteGuardDisposerRef.current?.()
          referenceDeleteGuardDisposerRef.current = editor.sideEffects?.registerBeforeDeleteHandler(
            'shape',
            (shape, source) => {
              if (source !== 'user') return
              if (shape.meta?.protectedCore === true) return false
              if (shape.type !== 'board-reference') return
              componentPropsRef.current.boardReferenceActions?.remove(shape as BoardReferenceShape)
              return false
            },
          )
          editor.setStyleForNextShapes?.(ArrowShapeKindStyle, 'elbow')
          if (
            typeof (editor as Partial<Editor>).getCurrentPageShapes === 'function'
          ) {
            scheduleInitialTradingTemplateFit(editor, inputSessionKeyRef.current)
            initialViewportFitSubscriptionRef.current = editor.store?.listen?.(
              () => scheduleInitialTradingTemplateFit(editor, inputSessionKeyRef.current),
              { scope: 'document' },
            )
          }
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
