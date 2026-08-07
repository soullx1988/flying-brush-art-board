import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  BaseBoxShapeUtil,
  createShapeId,
  DefaultFontFaces,
  HTMLContainer,
  Rectangle2d,
  StateNode,
  tlmenus,
  TldrawUiIcon,
  TldrawUiPopover,
  TldrawUiPopoverContent,
  TldrawUiPopoverTrigger,
  TldrawUiSlider,
  TldrawUiToolbar,
  TldrawUiToolbarButton,
  useEditor,
  useValue,
  type SvgExportContext,
  type TLPointerEventInfo,
  type TLStateNodeConstructor,
} from 'tldraw'

import { clearCanvasShapeInteractionTarget, setCanvasShapeInteractionTarget } from '../interaction-target.js'
import {
  getMindMapBranchClipboard,
  getMindMapStyleClipboard,
  setMindMapBranchClipboard,
  setMindMapStyleClipboard,
} from './clipboard.js'
import {
  addMindMapChild,
  addMindMapSibling,
  applyMindMapDrop,
  copyMindMapBranch,
  copyMindMapNodeVisualStyle,
  createMindMapProps,
  deleteMindMapBranch,
  duplicateMindMapBranch,
  getMindMapDropCandidate,
  getMindMapRoot,
  getMindMapRootAnchorDelta,
  getMindMapDescendantCounts,
  layoutMindMap,
  MIND_MAP_FONT_FAMILIES,
  MIND_MAP_FONT_SIZES,
  MIND_MAP_PALETTE_COLORS,
  mindMapColorWithOpacity,
  pasteMindMapBranch,
  pasteMindMapNodeVisualStyle,
  promoteMindMapNode,
  resolveMindMapNodeStyle,
  toggleMindMapCollapsed,
  updateMindMapNodeText,
  updateMindMapNodeStyle,
  type MindMapDropCandidate,
} from './operations.js'
import {
  MIND_MAP_PALETTE,
  MIND_MAP_SHAPE_TYPE,
  mindMapShapeMigrations,
  mindMapShapeProps,
  type MindMapNodeShape,
  type MindMapNodeStyle,
  type MindMapPaletteColor,
  type MindMapNode,
  type MindMapShape,
  type MindMapShapeProps,
} from './schema.js'

const MIND_MAP_DROP_TARGET_SLOP = 24

function sameMindMapDropCandidate(
  left: MindMapDropCandidate | undefined,
  right: MindMapDropCandidate | undefined,
): boolean {
  return left === right || Boolean(left && right
    && left.targetNodeId === right.targetNodeId
    && left.targetParentId === right.targetParentId
    && left.targetIndex === right.targetIndex
    && left.mode === right.mode
    && left.side === right.side)
}

function edgePath(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
  side: 'left' | 'right',
): string {
  const startX = side === 'right' ? from.x + from.w : from.x
  const endX = side === 'right' ? to.x : to.x + to.w
  const startY = from.y + from.h / 2
  const endY = to.y + to.h / 2
  const control = (startX + endX) / 2
  return `M ${startX} ${startY} C ${control} ${startY}, ${control} ${endY}, ${endX} ${endY}`
}

function navigationTarget(nodes: MindMapNode[], current: MindMapNode, key: string): string | undefined {
  const siblings = nodes.filter((node) => node.parentId === current.parentId).sort((a, b) => a.order - b.order)
  const index = siblings.findIndex((node) => node.id === current.id)
  if (key === 'ArrowUp') return siblings[index - 1]?.id
  if (key === 'ArrowDown') return siblings[index + 1]?.id
  const child = nodes.filter((node) => node.parentId === current.id).sort((a, b) => a.order - b.order)[0]?.id
  if (key === 'ArrowLeft') return current.side === 'left' ? child : current.parentId ?? undefined
  if (key === 'ArrowRight') return current.side === 'left' ? current.parentId ?? undefined : child
  return undefined
}

const EDGE_DASH_ARRAY = {
  solid: undefined,
  dashed: '10 7',
  dotted: '2 6',
} as const

function nodeCssStyle(props: MindMapShapeProps, node: MindMapNode): CSSProperties {
  const style = resolveMindMapNodeStyle(props, node)
  const minimal = node.shape === 'underline' || (props.theme === 'minimal' && node.parentId !== null)
  const decorations = [style.underline ? 'underline' : '', style.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')
  return {
    backgroundColor: minimal ? 'transparent' : mindMapColorWithOpacity(style.fillColor, style.fillOpacity),
    borderColor: minimal ? 'transparent' : mindMapColorWithOpacity(style.borderColor, style.borderOpacity),
    ...(minimal ? {
      borderBottomColor: mindMapColorWithOpacity(style.borderColor, style.borderOpacity),
      borderBottomStyle: 'solid',
      borderBottomWidth: 3,
      borderRadius: 0,
    } : {}),
    color: mindMapColorWithOpacity(style.textColor, style.textOpacity),
    fontFamily: MIND_MAP_FONT_FAMILIES[style.fontFamily],
    fontSize: MIND_MAP_FONT_SIZES[style.fontSize],
    fontWeight: style.bold ? 700 : 500,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSynthesis: 'weight style',
    textDecoration: decorations || 'none',
    textAlign: style.textAlign,
  }
}

function keepTextEditing(event: ReactMouseEvent<HTMLElement>) {
  event.preventDefault()
}

function stopToolbarPointer(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation()
}

function MindMapColorPanel({
  label,
  color,
  opacity,
  onColor,
  onOpacity,
  onOpacityHistoryMark,
}: {
  label: string
  color: MindMapPaletteColor
  opacity: number
  onColor: (color: MindMapPaletteColor) => void
  onOpacity: (opacity: number) => void
  onOpacityHistoryMark: () => void
}) {
  return <div
    className="canvas-mind-map-style-panel"
    data-mind-map-toolbar-root
    data-mind-map-toolbar-panel
    onMouseDownCapture={keepTextEditing}
    onPointerDown={stopToolbarPointer}
  >
    <div className="canvas-mind-map-style-panel__title">{label}</div>
    <div className="canvas-mind-map-color-grid" role="radiogroup" aria-label={label}>
      {MIND_MAP_PALETTE.map((value) => <button
        key={value}
        type="button"
        className="canvas-mind-map-color-swatch"
        data-active={value === color ? 'true' : 'false'}
        aria-label={`${label}：${value}`}
        aria-checked={value === color}
        role="radio"
        style={{ backgroundColor: MIND_MAP_PALETTE_COLORS[value] }}
        onClick={() => onColor(value)}
      />)}
    </div>
    <div className="canvas-mind-map-opacity-row">
      <span>透明度</span>
      <TldrawUiSlider
        label="透明度"
        title={`${Math.round(opacity * 100)}%`}
        min={0}
        steps={100}
        value={Math.round(opacity * 100)}
        onHistoryMark={onOpacityHistoryMark}
        onValueChange={(value) => onOpacity(value / 100)}
      />
    </div>
  </div>
}

type MindMapToolbarProps = {
  shape: MindMapShape
  node: MindMapNode
  position: { x: number; y: number; w: number; h: number }
  zoom: number
  placement: 'top' | 'left'
  isEditing: boolean
  canPasteStyle: boolean
  onStylePatch: (patch: Partial<MindMapNodeStyle>, mark?: boolean) => void
  onShapeChange: (shape: MindMapNodeShape) => void
  onStyleHistoryMark: (name: string) => void
  onDuplicate: () => void
  onCopyStyle: () => void
  onPasteStyle: () => void
  onDelete: () => void
}

function MindMapNodeToolbar({
  shape,
  node,
  position,
  zoom,
  placement,
  isEditing,
  canPasteStyle,
  onStylePatch,
  onShapeChange,
  onStyleHistoryMark,
  onDuplicate,
  onCopyStyle,
  onPasteStyle,
  onDelete,
}: MindMapToolbarProps) {
  const editor = useEditor()
  const id = useId()
  const [openPanelName, setOpenPanelName] = useState<string | undefined>()
  const style = resolveMindMapNodeStyle(shape.props, node)
  const explicit = node.style ?? {}
  const legacyPalette: MindMapPaletteColor = node.color === 'violet'
    ? 'violet' : node.color === 'green' ? 'green' : node.color === 'orange' ? 'orange' : node.color === 'red' ? 'red' : node.color === 'blue' ? 'blue' : 'gray'
  const selectedFill = explicit.fillColor ?? (node.parentId === null || shape.props.theme === 'colorful' ? legacyPalette : 'gray')
  const selectedBorder = explicit.borderColor ?? legacyPalette
  const selectedEdge = explicit.edgeColor ?? 'gray'
  const popover = (name: string) => `mind-map-${name}-${shape.id}-${node.id}-${id}`
  const popoverControl = (name: string) => ({
    open: openPanelName === name,
    onOpenChange: (open: boolean) => {
      if (open) {
        setOpenPanelName(name)
        return
      }
      setOpenPanelName((current) => {
        if (current !== name) return current
        if (isEditing && document.activeElement?.classList.contains('canvas-mind-map-node--editing')) return current
        return undefined
      })
    },
  })
  const closePanel = () => {
    for (const name of ['shape', 'fill', 'edge', 'more']) {
      tlmenus.deleteOpenMenu(popover(name), editor.contextId)
    }
    setOpenPanelName(undefined)
  }
  const applyStylePatch = (patch: Partial<MindMapNodeStyle>, mark = true) => {
    onStylePatch(patch, mark)
    if (mark) closePanel()
  }
  const runAndClose = (action: () => void) => {
    action()
    closePanel()
  }
  useEffect(() => setOpenPanelName(undefined), [node.id])
  const panel = (children: ReactNode) => <div
    data-mind-map-toolbar-root
    data-mind-map-toolbar-panel
    onMouseDownCapture={keepTextEditing}
    onPointerDown={stopToolbarPointer}
  >{children}</div>

  return <div
    className="canvas-mind-map-toolbar"
    data-mind-map-toolbar-root
    data-testid="mind-map-node-toolbar"
    data-open-panel={openPanelName ?? ''}
    data-placement={placement}
    style={{
      left: placement === 'left' ? position.x - 10 : position.x + position.w / 2,
      top: placement === 'left' ? position.y + position.h / 2 : position.y - 10,
      transform: placement === 'left'
        ? `translate(-100%, -50%) scale(${1 / Math.max(0.05, zoom)})`
        : `translate(-50%, -100%) scale(${1 / Math.max(0.05, zoom)})`,
      transformOrigin: placement === 'left' ? '100% 50%' : '50% 100%',
    }}
    onMouseDownCapture={keepTextEditing}
    onPointerDown={stopToolbarPointer}
  >
    <TldrawUiToolbar label="思维导图节点样式" orientation="horizontal">
      <TldrawUiPopover id={popover('shape')} {...popoverControl('shape')}>
        <TldrawUiPopoverTrigger>
          <TldrawUiToolbarButton type="icon" title="节点形状" data-testid="mind-map-style-shape">
            <TldrawUiIcon icon="corners" label="节点形状" />
          </TldrawUiToolbarButton>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="center" sideOffset={6} autoFocusFirstButton={false}>
          {panel(<TldrawUiToolbar className="canvas-mind-map-choice-row" label="节点形状" orientation="horizontal">
            {([
              ['rounded', 'geo-rectangle', '圆角'],
              ['pill', 'geo-oval', '胶囊'],
              ['underline', 'underline', '下划线'],
            ] as const).map(([value, icon, label]) => <TldrawUiToolbarButton
              key={value}
              type="icon"
              title={label}
              isActive={(node.shape ?? 'rounded') === value}
              onClick={() => runAndClose(() => onShapeChange(value))}
            ><TldrawUiIcon icon={icon} label={label} /></TldrawUiToolbarButton>)}
          </TldrawUiToolbar>)}
        </TldrawUiPopoverContent>
      </TldrawUiPopover>

      <TldrawUiPopover id={popover('fill')} {...popoverControl('fill')}>
        <TldrawUiPopoverTrigger>
          <TldrawUiToolbarButton type="icon" title="节点填充" data-testid="mind-map-style-fill">
            <TldrawUiIcon icon="fill-solid" label="节点填充" />
          </TldrawUiToolbarButton>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="center" sideOffset={6} autoFocusFirstButton={false}>
          {panel(<div className="canvas-mind-map-composite-panel">
            <MindMapColorPanel
              label="节点填充"
              color={selectedFill}
              opacity={style.fillOpacity}
              onColor={(fillColor) => applyStylePatch({ fillColor })}
              onOpacity={(fillOpacity) => applyStylePatch({ fillOpacity }, false)}
              onOpacityHistoryMark={() => onStyleHistoryMark('mind_map_fill_opacity')}
            />
            <MindMapColorPanel
              label="节点边框"
              color={selectedBorder}
              opacity={style.borderOpacity}
              onColor={(borderColor) => applyStylePatch({ borderColor })}
              onOpacity={(borderOpacity) => applyStylePatch({ borderOpacity }, false)}
              onOpacityHistoryMark={() => onStyleHistoryMark('mind_map_border_opacity')}
            />
          </div>)}
        </TldrawUiPopoverContent>
      </TldrawUiPopover>

      <TldrawUiPopover id={popover('edge')} {...popoverControl('edge')}>
        <TldrawUiPopoverTrigger>
          <TldrawUiToolbarButton type="icon" title="分支线" data-testid="mind-map-style-edge">
            <TldrawUiIcon icon={`dash-${style.edgeDash}`} label="分支线" />
          </TldrawUiToolbarButton>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="center" sideOffset={6} autoFocusFirstButton={false}>
          {panel(<div className="canvas-mind-map-composite-panel">
            <MindMapColorPanel
              label="分支线颜色"
              color={selectedEdge}
              opacity={style.edgeOpacity}
              onColor={(edgeColor) => applyStylePatch({ edgeColor })}
              onOpacity={(edgeOpacity) => applyStylePatch({ edgeOpacity }, false)}
              onOpacityHistoryMark={() => onStyleHistoryMark('mind_map_edge_opacity')}
            />
            <TldrawUiToolbar className="canvas-mind-map-choice-row" label="分支线样式" orientation="horizontal">
              {(['solid', 'dashed', 'dotted'] as const).map((value) => <TldrawUiToolbarButton
                key={value}
                type="icon"
                title={value === 'solid' ? '实线' : value === 'dashed' ? '虚线' : '点线'}
                isActive={style.edgeDash === value}
                onClick={() => applyStylePatch({ edgeDash: value })}
              ><TldrawUiIcon icon={`dash-${value}`} label={value} /></TldrawUiToolbarButton>)}
              {([1, 2, 3, 4] as const).map((value) => <TldrawUiToolbarButton
                key={value}
                type="icon"
                title={`${value} 级粗细`}
                isActive={style.edgeWidth === value}
                onClick={() => applyStylePatch({ edgeWidth: value })}
              ><span className="canvas-mind-map-line-width">{value}</span></TldrawUiToolbarButton>)}
            </TldrawUiToolbar>
          </div>)}
        </TldrawUiPopoverContent>
      </TldrawUiPopover>

      <TldrawUiPopover id={popover('more')} {...popoverControl('more')}>
        <TldrawUiPopoverTrigger>
          <TldrawUiToolbarButton type="icon" title="更多" data-testid="mind-map-style-more">
            <TldrawUiIcon icon="dots-horizontal" label="更多" />
          </TldrawUiToolbarButton>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="top" align="end" sideOffset={6} autoFocusFirstButton={false}>
          {panel(<TldrawUiToolbar className="canvas-mind-map-more-menu" label="更多节点操作" orientation="vertical">
            {node.parentId ? <TldrawUiToolbarButton type="menu" title="创建分支副本 Ctrl+D" onClick={() => runAndClose(onDuplicate)}>
              <TldrawUiIcon icon="duplicate" label="创建分支副本" /><span>创建分支副本</span>
            </TldrawUiToolbarButton> : null}
            <TldrawUiToolbarButton type="menu" title="复制样式 Ctrl+Alt+C" onClick={() => runAndClose(onCopyStyle)}>
              <TldrawUiIcon icon="clipboard-copy" label="复制样式" /><span>复制样式</span>
            </TldrawUiToolbarButton>
            <TldrawUiToolbarButton type="menu" title="粘贴样式 Ctrl+Alt+V" disabled={!canPasteStyle} onClick={() => runAndClose(onPasteStyle)}>
              <TldrawUiIcon icon="clipboard-copied" label="粘贴样式" /><span>粘贴样式</span>
            </TldrawUiToolbarButton>
            {node.parentId ? <TldrawUiToolbarButton type="menu" title="删除" onClick={() => runAndClose(onDelete)}>
              <TldrawUiIcon icon="trash" label="删除" /><span>删除</span>
            </TldrawUiToolbarButton> : null}
          </TldrawUiToolbar>)}
        </TldrawUiPopoverContent>
      </TldrawUiPopover>
    </TldrawUiToolbar>
  </div>
}

function MindMapShapeComponent({ shape }: { shape: MindMapShape }) {
  const editor = useEditor()
  const isReadonly = useValue('mind map readonly', () => editor.getInstanceState().isReadonly, [editor])
  const isSelected = useValue('mind map selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
  const isEditingShape = useValue('mind map editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
  const zoom = useValue('mind map zoom', () => editor.getZoomLevel(), [editor])
  const root = getMindMapRoot(shape.props)
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>(root?.id)
  const [editingNodeId, setEditingNodeId] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [dragState, setDragState] = useState<{
    nodeId: string
    candidate?: MindMapDropCandidate
  }>()
  const [canPasteStyle, setCanPasteStyle] = useState(() => Boolean(getMindMapStyleClipboard(editor)))
  const [toolbarPlacement, setToolbarPlacement] = useState<'top' | 'left'>('top')
  const inputRef = useRef<HTMLInputElement>(null)
  const toolbarFocusTimerRef = useRef<number | undefined>(undefined)
  const editSessionMarkedRef = useRef(false)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const dragGhostRef = useRef<HTMLDivElement>(null)
  const dragFrameRef = useRef<number | undefined>(undefined)
  const dragSessionRef = useRef<{
    nodeId: string
    pointerId: number
    startClientX: number
    startClientY: number
    clientX: number
    clientY: number
    active: boolean
    candidate: MindMapDropCandidate | undefined
    draggedBranchIds: Set<string>
    targetRects: Map<string, { left: number; right: number; top: number; bottom: number; width: number; height: number }>
  } | undefined>(undefined)
  const layout = useMemo(() => layoutMindMap(shape.props), [shape.props])
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes])
  const nodesById = useMemo(() => new Map(shape.props.nodes.map((node) => [node.id, node])), [shape.props.nodes])
  const descendantCounts = useMemo(() => getMindMapDescendantCounts(shape.props), [shape.props])
  const draggedBranchIds = useMemo(() => {
    const result = new Set<string>()
    const draggedNodeId = dragState?.nodeId
    if (!draggedNodeId) return result
    const childrenByParent = new Map<string, string[]>()
    for (const node of shape.props.nodes) {
      if (node.parentId === null) continue
      const children = childrenByParent.get(node.parentId) ?? []
      children.push(node.id)
      childrenByParent.set(node.parentId, children)
    }
    const visit = (nodeId: string) => {
      result.add(nodeId)
      for (const childId of childrenByParent.get(nodeId) ?? []) visit(childId)
    }
    visit(draggedNodeId)
    return result
  }, [dragState?.nodeId, shape.props.nodes])

  useEffect(() => {
    if (isEditingShape && root && !editingNodeId && !isReadonly) {
      editSessionMarkedRef.current = false
      setActiveNodeId(root.id)
      setDraft(root.text)
      setEditingNodeId(root.id)
    }
  }, [editingNodeId, isEditingShape, isReadonly, root])

  useEffect(() => {
    if (editingNodeId) inputRef.current?.select()
  }, [editingNodeId])

  useEffect(() => {
    if (!isSelected) {
      setActiveNodeId(root?.id)
      setEditingNodeId(undefined)
      setDragState(undefined)
      dragSessionRef.current = undefined
      clearCanvasShapeInteractionTarget(editor, shape.id)
    }
  }, [editor, isSelected, root?.id, shape.id])

  useEffect(() => () => clearCanvasShapeInteractionTarget(editor, shape.id), [editor, shape.id])

  useEffect(() => () => {
    const view = editor.getContainer().ownerDocument.defaultView
    if (view && toolbarFocusTimerRef.current !== undefined) {
      view.clearTimeout(toolbarFocusTimerRef.current)
    }
    if (view && dragFrameRef.current !== undefined) {
      view.cancelAnimationFrame(dragFrameRef.current)
    }
  }, [editor])

  const updateProps = (
    props: MindMapShapeProps,
    mark: string,
    preserveRoot = false,
    recordHistory = true,
  ) => {
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    if (!current || editor.getInstanceState().isReadonly) return
    if (recordHistory) editor.markHistoryStoppingPoint(mark)
    if (!preserveRoot) {
      editor.updateShape<MindMapShape>({ id: current.id, type: current.type, props })
      return
    }
    const delta = getMindMapRootAnchorDelta(current.props, props)
    const cos = Math.cos(current.rotation)
    const sin = Math.sin(current.rotation)
    editor.updateShape<MindMapShape>({
      id: current.id,
      type: current.type,
      x: current.x + delta.x * cos - delta.y * sin,
      y: current.y + delta.x * sin + delta.y * cos,
      props,
    })
  }

  const activate = (nodeId: string, edit = false) => {
    const node = shape.props.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return
    editor.select(shape.id)
    setActiveNodeId(nodeId)
    setCanvasShapeInteractionTarget(editor, { type: 'mind-map', shapeId: shape.id, nodeId })
    if (edit && !isReadonly) {
      editSessionMarkedRef.current = false
      setDraft(node.text)
      setEditingNodeId(nodeId)
    }
  }

  const commit = () => {
    if (!editingNodeId || isReadonly) return
    const node = shape.props.nodes.find((candidate) => candidate.id === editingNodeId)
    if (node && node.text !== draft) updateProps(updateMindMapNodeText(shape.props, node.id, draft), `edit_mind_map_node:${node.id}`)
  }

  const restoreEditingFocus = (delay = 0) => {
    if (!editingNodeId) return
    const view = editor.getContainer().ownerDocument.defaultView
    if (!view) return
    if (toolbarFocusTimerRef.current !== undefined) view.clearTimeout(toolbarFocusTimerRef.current)
    toolbarFocusTimerRef.current = view.setTimeout(() => {
      toolbarFocusTimerRef.current = undefined
      inputRef.current?.focus({ preventScroll: true })
    }, delay)
  }

  useEffect(() => {
    if (!editingNodeId) return
    const document = editor.getContainer().ownerDocument
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('.canvas-mind-map-node--editing, [data-mind-map-toolbar-root], [data-mind-map-text-style-panel]')) return
      setCanvasShapeInteractionTarget(editor, { type: 'mind-map', shapeId: shape.id, nodeId: editingNodeId })
      setEditingNodeId(undefined)
      editor.setEditingShape(null)
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [editor, editingNodeId, shape.id])

  const propsWithDraft = () => {
    if (!editingNodeId) return shape.props
    const node = shape.props.nodes.find((candidate) => candidate.id === editingNodeId)
    return node && node.text !== draft
      ? updateMindMapNodeText(shape.props, node.id, draft)
      : shape.props
  }

  const updateDraft = (nodeId: string, value: string) => {
    if (isReadonly) return
    setDraft(value)
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    const node = current?.props.nodes.find((candidate) => candidate.id === nodeId)
    if (!current || !node || node.text === value) return
    if (!editSessionMarkedRef.current) {
      editor.markHistoryStoppingPoint(`edit_mind_map_node:${nodeId}`)
      editSessionMarkedRef.current = true
    }
    editor.updateShape<MindMapShape>({
      id: current.id,
      type: current.type,
      props: updateMindMapNodeText(current.props, nodeId, value),
    })
  }

  const addAndEdit = (kind: 'child' | 'sibling') => {
    if (!activeNodeId || isReadonly) return
    const currentProps = propsWithDraft()
    const result = kind === 'child'
      ? addMindMapChild(currentProps, activeNodeId)
      : addMindMapSibling(currentProps, activeNodeId)
    if (!result.nodeId) return
    updateProps(result.props, `add_mind_map_${kind}:${shape.id}`, true)
    setActiveNodeId(result.nodeId)
    setEditingNodeId(result.nodeId)
    editSessionMarkedRef.current = false
    setDraft('新主题')
  }

  const updateActiveNodeStyle = (patch: Partial<MindMapNodeStyle>, recordHistory = true) => {
    if (!activeNodeId || isReadonly) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    if (!current) return
    updateProps(
      updateMindMapNodeStyle(current.props, activeNodeId, { style: patch }),
      `style_mind_map_node:${activeNodeId}`,
      false,
      recordHistory,
    )
    restoreEditingFocus(recordHistory ? 0 : 250)
  }

  const changeActiveNodeShape = (nodeShape: MindMapNodeShape) => {
    if (!activeNodeId || isReadonly) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    if (!current) return
    updateProps(
      updateMindMapNodeStyle(current.props, activeNodeId, { shape: nodeShape }),
      `shape_mind_map_node:${activeNodeId}`,
    )
    restoreEditingFocus()
  }

  const deleteActiveBranch = () => {
    if (!activeNodeId || isReadonly) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    const node = current?.props.nodes.find((candidate) => candidate.id === activeNodeId)
    if (!current || !node?.parentId) return
    updateProps(deleteMindMapBranch(current.props, node.id), `delete_mind_map_branch:${node.id}`, true)
    setActiveNodeId(node.parentId)
  }

  const duplicateActiveBranch = () => {
    if (!activeNodeId || isReadonly) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    if (!current) return
    const result = duplicateMindMapBranch(current.props, activeNodeId)
    if (!result.nodeId) return
    updateProps(result.props, `duplicate_mind_map_branch:${activeNodeId}`, true)
    setActiveNodeId(result.nodeId)
  }

  const copyActiveNodeStyle = () => {
    if (!activeNodeId) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    if (!current) return
    const snapshot = copyMindMapNodeVisualStyle(current.props, activeNodeId)
    if (!snapshot) return
    setMindMapStyleClipboard(editor, snapshot)
    setCanPasteStyle(true)
  }

  const pasteActiveNodeStyle = () => {
    if (!activeNodeId || isReadonly) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    const snapshot = getMindMapStyleClipboard(editor)
    if (!current || !snapshot) return
    updateProps(
      pasteMindMapNodeVisualStyle(current.props, activeNodeId, snapshot),
      `paste_mind_map_style:${activeNodeId}`,
    )
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isReadonly) {
      event.preventDefault()
      event.stopPropagation()
      setEditingNodeId(undefined)
      editor.setEditingShape(null)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (editingNodeId) setCanvasShapeInteractionTarget(editor, {
        type: 'mind-map', shapeId: shape.id, nodeId: editingNodeId,
      })
      setEditingNodeId(undefined)
      editor.setEditingShape(null)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey && activeNodeId) {
        updateProps(promoteMindMapNode(propsWithDraft(), activeNodeId), `promote_mind_map_node:${activeNodeId}`, true)
        setEditingNodeId(undefined)
      } else addAndEdit('child')
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      addAndEdit('sibling')
    }
  }

  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, node: MindMapNode) => {
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      event.stopPropagation()
      const snapshot = copyMindMapNodeVisualStyle(shape.props, node.id)
      if (snapshot) {
        setMindMapStyleClipboard(editor, snapshot)
        setCanPasteStyle(true)
      }
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'v' && !isReadonly) {
      const snapshot = getMindMapStyleClipboard(editor)
      if (!snapshot) return
      event.preventDefault()
      event.stopPropagation()
      updateProps(pasteMindMapNodeVisualStyle(shape.props, node.id, snapshot), `paste_mind_map_style:${node.id}`)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && node.parentId && !isReadonly) {
      event.preventDefault()
      event.stopPropagation()
      const result = duplicateMindMapBranch(shape.props, node.id)
      if (!result.nodeId) return
      updateProps(result.props, `duplicate_mind_map_branch:${node.id}`, true)
      setActiveNodeId(result.nodeId)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      const snapshot = copyMindMapBranch(shape.props, node.id)
      if (!snapshot) return
      event.preventDefault()
      event.stopPropagation()
      setMindMapBranchClipboard(editor, snapshot)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !isReadonly) {
      const snapshot = getMindMapBranchClipboard(editor)
      if (!snapshot) return
      event.preventDefault()
      event.stopPropagation()
      const result = pasteMindMapBranch(shape.props, node.id, snapshot)
      if (!result.nodeId) return
      updateProps(result.props, `paste_mind_map_branch:${node.id}`, true)
      setActiveNodeId(result.nodeId)
      return
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      event.stopPropagation()
      activate(node.id, true)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && node.parentId && !isReadonly) {
      event.preventDefault()
      event.stopPropagation()
      updateProps(deleteMindMapBranch(shape.props, node.id), `delete_mind_map_branch:${node.id}`, true)
      setActiveNodeId(node.parentId)
      return
    }
    const target = navigationTarget(shape.props.nodes, node, event.key)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    activate(target)
  }

  const candidateAtPoint = (
    nodeId: string,
    clientX: number,
    clientY: number,
    targetRects: Map<string, { left: number; right: number; top: number; bottom: number; width: number; height: number }>,
    draggedIds: Set<string>,
  ) => {
    let nearest: { targetId: string; relativeX: number; relativeY: number; distance: number } | undefined
    for (const [targetId, rect] of targetRects) {
      if (draggedIds.has(targetId)) continue
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0
      if (dx > MIND_MAP_DROP_TARGET_SLOP || dy > MIND_MAP_DROP_TARGET_SLOP) continue
      const distance = dx * dx + dy * dy
      if (nearest && distance >= nearest.distance) continue
      nearest = {
        targetId,
        relativeX: (clientX - rect.left) / Math.max(1, rect.width),
        relativeY: (clientY - rect.top) / Math.max(1, rect.height),
        distance,
      }
    }
    return nearest ? getMindMapDropCandidate(
      shape.props,
      nodeId,
      nearest.targetId,
      nearest.relativeX,
      nearest.relativeY,
    ) : undefined
  }

  const scheduleDragGhostPosition = () => {
    const view = editor.getContainer().ownerDocument.defaultView
    if (!view || dragFrameRef.current !== undefined) return
    dragFrameRef.current = view.requestAnimationFrame(() => {
      dragFrameRef.current = undefined
      const session = dragSessionRef.current
      const ghost = dragGhostRef.current
      const currentShape = editor.getShape(shape.id) as MindMapShape | undefined
      if (!session?.active || !ghost || !currentShape) return
      const currentZoom = Math.max(0.05, editor.getZoomLevel())
      const point = editor.getPointInShapeSpace(
        currentShape,
        editor.screenToPage({ x: session.clientX, y: session.clientY }),
      )
      ghost.style.transform = `translate(${point.x + 12 / currentZoom}px, ${point.y + 12 / currentZoom}px) scale(${1 / currentZoom})`
    })
  }

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: MindMapNode) => {
    event.stopPropagation()
    activate(node.id)
    if (event.button !== 0 || isReadonly || !node.parentId || editingNodeId === node.id) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const branch = copyMindMapBranch(shape.props, node.id)
    dragSessionRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      active: false,
      candidate: undefined,
      draggedBranchIds: new Set(branch?.nodes.map((candidate) => candidate.id) ?? [node.id]),
      targetRects: new Map(),
    }
  }

  const handleNodePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY)
    if (!session.active && distance < 5) return
    event.preventDefault()
    event.stopPropagation()
    if (!session.active) {
      session.targetRects = new Map(Array.from(nodeRefs.current, ([nodeId, element]) => {
        const rect = element.getBoundingClientRect()
        return [nodeId, {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }]
      }))
    }
    session.active = true
    session.clientX = event.clientX
    session.clientY = event.clientY
    scheduleDragGhostPosition()
    const nextCandidate = candidateAtPoint(
      session.nodeId,
      event.clientX,
      event.clientY,
      session.targetRects,
      session.draggedBranchIds,
    )
    if (!sameMindMapDropCandidate(session.candidate, nextCandidate)) session.candidate = nextCandidate
    setDragState((current) => {
      if (current?.nodeId === session.nodeId && sameMindMapDropCandidate(current.candidate, session.candidate)) return current
      return {
        nodeId: session.nodeId,
        ...(session.candidate ? { candidate: session.candidate } : {}),
      }
    })
  }

  const endNodePointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, canceled = false) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.stopPropagation()
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    const view = editor.getContainer().ownerDocument.defaultView
    if (view && dragFrameRef.current !== undefined) view.cancelAnimationFrame(dragFrameRef.current)
    dragFrameRef.current = undefined
    dragSessionRef.current = undefined
    setDragState(undefined)
    if (canceled || !session.active || !session.candidate || isReadonly) return
    const current = editor.getShape(shape.id) as MindMapShape | undefined
    if (!current) return
    const next = applyMindMapDrop(current.props, session.nodeId, session.candidate)
    if (next === current.props) return
    updateProps(next, `move_mind_map_node:${session.nodeId}`, true)
    setActiveNodeId(session.nodeId)
  }

  const activeNode = shape.props.nodes.find((node) => node.id === activeNodeId)
  const activePosition = activeNodeId ? positions.get(activeNodeId) : undefined
  const dragSession = dragState ? dragSessionRef.current : undefined
  const ghostPoint = dragSession
    ? editor.getPointInShapeSpace(shape, editor.screenToPage({ x: dragSession.clientX, y: dragSession.clientY }))
    : undefined

  useLayoutEffect(() => {
    if (!activeNodeId || !isSelected || isReadonly || dragState) return
    const nodeElement = nodeRefs.current.get(activeNodeId)
    const toolbarElement = editor.getContainer().querySelector<HTMLElement>('[data-testid="mind-map-node-toolbar"]')
    const stylePanelElement = editor.getContainer().querySelector<HTMLElement>('.tlui-style-panel__wrapper')
    if (!nodeElement || !toolbarElement || !stylePanelElement) {
      setToolbarPlacement('top')
      return
    }
    const nodeRect = nodeElement.getBoundingClientRect()
    const toolbarRect = toolbarElement.getBoundingClientRect()
    const stylePanelRect = stylePanelElement.getBoundingClientRect()
    const topToolbarRect = {
      left: nodeRect.left + nodeRect.width / 2 - toolbarRect.width / 2,
      right: nodeRect.left + nodeRect.width / 2 + toolbarRect.width / 2,
      top: nodeRect.top - 10 - toolbarRect.height,
      bottom: nodeRect.top - 10,
    }
    const overlapsStylePanel = topToolbarRect.left < stylePanelRect.right
      && topToolbarRect.right > stylePanelRect.left
      && topToolbarRect.top < stylePanelRect.bottom
      && topToolbarRect.bottom > stylePanelRect.top
    setToolbarPlacement(overlapsStylePanel ? 'left' : 'top')
  }, [activeNodeId, dragState, editor, isReadonly, isSelected, shape.props, zoom])

  return (
    <HTMLContainer>
      <div
        className="canvas-mind-map-shape"
        data-theme={shape.props.theme ?? 'classic'}
        data-drag-active={dragState ? 'true' : 'false'}
        style={{ width: shape.props.w, height: shape.props.h }}
      >
        <svg className="canvas-mind-map-shape__edges" width={shape.props.w} height={shape.props.h} aria-hidden="true">
          {layout.edges.map((edge) => {
            const from = positions.get(edge.fromId)
            const to = positions.get(edge.toId)
            const targetNode = nodesById.get(edge.toId)
            if (!from || !to || !targetNode) return null
            const edgeStyle = resolveMindMapNodeStyle(shape.props, targetNode)
            return <path
              key={`${edge.fromId}-${edge.toId}`}
              d={edgePath(from, to, edge.side)}
              fill="none"
              stroke={mindMapColorWithOpacity(edgeStyle.edgeColor, edgeStyle.edgeOpacity)}
              strokeWidth={edgeStyle.edgeWidth}
              strokeDasharray={EDGE_DASH_ARRAY[edgeStyle.edgeDash]}
            />
          })}
        </svg>
        {layout.nodes.map((position) => {
          const node = nodesById.get(position.id)
          if (!node) return null
          const active = activeNodeId === node.id
          const dropMode = dragState?.candidate?.targetNodeId === node.id ? dragState.candidate.mode : undefined
          return <div
            key={node.id}
            ref={(element) => {
              if (element) nodeRefs.current.set(node.id, element)
              else nodeRefs.current.delete(node.id)
            }}
            className="canvas-mind-map-node-shell"
            data-mind-map-node-id={node.id}
            data-dragging={draggedBranchIds.has(node.id) ? 'true' : 'false'}
            data-drop-mode={dropMode}
            data-side={position.side}
            style={{ left: position.x, top: position.y, width: position.w, height: position.h }}
          >
            {editingNodeId === node.id ? (
              <input
                ref={inputRef}
                className="canvas-mind-map-node canvas-mind-map-node--editing"
                data-root={node.parentId === null ? 'true' : 'false'}
                data-color={node.color ?? (node.parentId === null ? 'blue' : 'gray')}
                data-shape={node.shape ?? 'rounded'}
                aria-label="编辑思维导图主题"
                value={draft}
                style={nodeCssStyle(shape.props, node)}
                onChange={(event) => updateDraft(node.id, event.currentTarget.value)}
                onBlur={(event) => {
                  const next = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null
                  if (next?.closest('[data-mind-map-toolbar-root], [data-mind-map-text-style-panel]')) {
                    return
                  }
                  commit()
                  setCanvasShapeInteractionTarget(editor, { type: 'mind-map', shapeId: shape.id, nodeId: node.id })
                  setEditingNodeId(undefined)
                  editor.setEditingShape(null)
                }}
                onKeyDown={handleEditorKeyDown}
              />
            ) : (
              <button
                type="button"
                className="canvas-mind-map-node"
                data-root={node.parentId === null ? 'true' : 'false'}
                data-active={active ? 'true' : 'false'}
                data-color={node.color ?? (node.parentId === null ? 'blue' : 'gray')}
                data-shape={node.shape ?? 'rounded'}
                tabIndex={active ? 0 : -1}
                style={nodeCssStyle(shape.props, node)}
                onPointerDown={(event) => handleNodePointerDown(event, node)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={(event) => endNodePointerDrag(event)}
                onPointerCancel={(event) => endNodePointerDrag(event, true)}
                onContextMenu={() => activate(node.id)}
                onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); activate(node.id, true) }}
                onKeyDown={(event) => handleNodeKeyDown(event, node)}
              ><span className="canvas-mind-map-node__label">{node.text}</span></button>
            )}
            {active && isSelected && !isReadonly ? <button
              type="button"
              className="canvas-mind-map-node__add"
              data-side={position.side}
              aria-label="新增子主题"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => addAndEdit('child')}
            >+</button> : null}
            {(descendantCounts.get(node.id) ?? 0) > 0 ? (
              <button
                type="button"
                className="canvas-mind-map-node__collapse"
                data-side={position.side}
                aria-label={node.collapsed ? '展开分支' : '折叠分支'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  if (isReadonly) return
                  updateProps(toggleMindMapCollapsed(shape.props, node.id), `toggle_mind_map_collapsed:${node.id}`, true)
                }}
              >{node.collapsed ? descendantCounts.get(node.id) : '−'}</button>
            ) : null}
          </div>
        })}
        {activeNode && activePosition && isSelected && !isReadonly && !dragState ? <MindMapNodeToolbar
          shape={shape}
          node={activeNode}
          position={activePosition}
          zoom={zoom}
          placement={toolbarPlacement}
          isEditing={editingNodeId === activeNode.id}
          canPasteStyle={canPasteStyle}
          onStylePatch={updateActiveNodeStyle}
          onShapeChange={changeActiveNodeShape}
          onStyleHistoryMark={(name) => editor.markHistoryStoppingPoint(`${name}:${activeNode.id}`)}
          onDuplicate={duplicateActiveBranch}
          onCopyStyle={copyActiveNodeStyle}
          onPasteStyle={pasteActiveNodeStyle}
          onDelete={deleteActiveBranch}
        /> : null}
        {dragState && ghostPoint ? <div
          ref={dragGhostRef}
          className="canvas-mind-map-drag-ghost"
          style={{
            left: 0,
            top: 0,
            transform: `translate(${ghostPoint.x + 12 / Math.max(0.05, zoom)}px, ${ghostPoint.y + 12 / Math.max(0.05, zoom)}px) scale(${1 / Math.max(0.05, zoom)})`,
          }}
        >
          {shape.props.nodes.find((node) => node.id === dragState.nodeId)?.text || '主题'}
          {(descendantCounts.get(dragState.nodeId) ?? 0) > 0 ? <span>+{descendantCounts.get(dragState.nodeId)}</span> : null}
        </div> : null}
      </div>
    </HTMLContainer>
  )
}

export class MindMapShapeUtil extends BaseBoxShapeUtil<MindMapShape> {
  static override type = MIND_MAP_SHAPE_TYPE
  static override props = mindMapShapeProps
  static override migrations = mindMapShapeMigrations

  override getDefaultProps(): MindMapShapeProps { return createMindMapProps() }

  override getFontFaces(shape: MindMapShape) {
    const faces = new Set<(typeof DefaultFontFaces)[keyof typeof DefaultFontFaces]['normal']['normal']>()
    for (const node of shape.props.nodes) {
      const style = resolveMindMapNodeStyle(shape.props, node)
      const family = DefaultFontFaces[`tldraw_${style.fontFamily}`]
      faces.add(family[style.italic ? 'italic' : 'normal'][style.bold ? 'bold' : 'normal'])
    }
    return [...faces]
  }

  override getGeometry(shape: MindMapShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false })
  }

  override canEdit() { return true }
  override canResize() { return false }
  override component(shape: MindMapShape) { return <MindMapShapeComponent shape={shape} /> }
  override getIndicatorPath() { return undefined }

  override toSvg(shape: MindMapShape, _ctx: SvgExportContext) {
    const layout = layoutMindMap(shape.props)
    const positions = new Map(layout.nodes.map((node) => [node.id, node]))
    const descendantCounts = getMindMapDescendantCounts(shape.props)
    const svgFonts = {
      draw: 'tldraw_draw, sans-serif',
      sans: 'tldraw_sans, sans-serif',
      serif: 'tldraw_serif, serif',
      mono: 'tldraw_mono, monospace',
    } as const
    return <>
      {layout.edges.map((edge) => {
        const from = positions.get(edge.fromId)
        const to = positions.get(edge.toId)
        const node = shape.props.nodes.find((candidate) => candidate.id === edge.toId)
        if (!from || !to || !node) return null
        const style = resolveMindMapNodeStyle(shape.props, node)
        return <path
          key={`${edge.fromId}-${edge.toId}`}
          d={edgePath(from, to, edge.side)}
          fill="none"
          stroke={mindMapColorWithOpacity(style.edgeColor, style.edgeOpacity)}
          strokeWidth={style.edgeWidth}
          strokeDasharray={EDGE_DASH_ARRAY[style.edgeDash]}
        />
      })}
      {layout.nodes.map((position) => {
        const node = shape.props.nodes.find((candidate) => candidate.id === position.id)
        if (!node) return null
        const style = resolveMindMapNodeStyle(shape.props, node)
        const minimal = shape.props.theme === 'minimal' || node.shape === 'underline'
        const radius = node.shape === 'pill' ? position.h / 2 : node.shape === 'underline' ? 0 : 10
        const hiddenCount = descendantCounts.get(node.id) ?? 0
        const textX = style.textAlign === 'left'
          ? position.x + 12
          : style.textAlign === 'right' ? position.x + position.w - 12 : position.x + position.w / 2
        const textAnchor = style.textAlign === 'left' ? 'start' : style.textAlign === 'right' ? 'end' : 'middle'
        return <g key={node.id}>
          <rect
            x={position.x}
            y={position.y}
            width={position.w}
            height={position.h}
            rx={radius}
            fill={minimal ? 'transparent' : mindMapColorWithOpacity(style.fillColor, style.fillOpacity)}
            stroke={minimal ? 'transparent' : mindMapColorWithOpacity(style.borderColor, style.borderOpacity)}
          />
          {minimal ? <line x1={position.x} y1={position.y + position.h} x2={position.x + position.w} y2={position.y + position.h} stroke={mindMapColorWithOpacity(style.borderColor, style.borderOpacity)} strokeWidth="3" /> : null}
          <text
            x={textX}
            y={position.y + position.h / 2 + MIND_MAP_FONT_SIZES[style.fontSize] * 0.34}
            fill={mindMapColorWithOpacity(style.textColor, style.textOpacity)}
            fontFamily={svgFonts[style.fontFamily]}
            fontSize={MIND_MAP_FONT_SIZES[style.fontSize]}
            fontWeight={style.bold ? 700 : 500}
            fontStyle={style.italic ? 'italic' : 'normal'}
            style={{ fontSynthesis: 'weight style' }}
            textDecoration={[style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined}
            textAnchor={textAnchor}
          >
            {node.text.replace(/\s+/g, ' ').slice(0, 48)}
          </text>
          {node.collapsed && hiddenCount > 0 ? <text x={position.x + position.w - 16} y={position.y + position.h / 2 + 5} fill={mindMapColorWithOpacity(style.textColor, style.textOpacity)} textAnchor="middle" fontFamily={svgFonts[style.fontFamily]} fontSize="11">{hiddenCount}</text> : null}
        </g>
      })}
    </>
  }
}

class MindMapShapeToolIdle extends StateNode {
  static override id = 'idle'
  private createdShapeId: MindMapShape['id'] | undefined

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  override onPointerDown(_info: TLPointerEventInfo) {
    const props = createMindMapProps()
    const point = this.editor.inputs.getOriginPagePoint()
    const id = createShapeId()
    this.editor.markHistoryStoppingPoint(`create_mind_map:${id}`)
    this.editor.createShape<MindMapShape>({
      id,
      type: MIND_MAP_SHAPE_TYPE,
      x: point.x - props.w / 2,
      y: point.y - props.h / 2,
      props,
    })
    if (!this.editor.getShape(id)) return
    this.editor.select(id)
    this.createdShapeId = id
  }

  override onPointerUp() {
    const id = this.createdShapeId
    this.createdShapeId = undefined
    if (!id || !this.editor.getShape(id)) return
    this.editor.setCurrentTool('select.idle')
    this.editor.select(id)
    this.editor.setEditingShape(id)
  }

  override onCancel() {
    this.createdShapeId = undefined
    this.editor.setCurrentTool('select.idle')
  }
}

export class MindMapShapeTool extends StateNode {
  static override id = MIND_MAP_SHAPE_TYPE
  static override initial = 'idle'
  static override children(): TLStateNodeConstructor[] {
    return [MindMapShapeToolIdle]
  }
}

export const mindMapShapeUtils = [MindMapShapeUtil] as const
export const mindMapShapeTools = [MindMapShapeTool] as const
