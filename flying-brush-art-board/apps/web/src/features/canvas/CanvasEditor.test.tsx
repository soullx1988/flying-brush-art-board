import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BoardSession } from '../boards/board-session'
import {
  addMindMapChild,
  createMindMapProps,
  createTableProps,
  getMindMapRoot,
  setCanvasShapeInteractionTarget,
} from '@infinite-board/tldraw-adapter'

let mountedProps: {
  assetUrls?: { translations?: Record<string, string> }
  onMount?: (editor: unknown) => void
  options?: { maxShapesPerPage?: number }
  overrides?: { translations?: Record<string, Record<string, string>> }
  shapeUtils?: Array<{ type?: string }>
  components?: {
    Toolbar?: (() => React.ReactNode) | null
    StylePanel?: ((props: Record<string, unknown>) => React.ReactNode) | null
    InFrontOfTheCanvas?: (() => React.ReactNode) | null
    ContextMenu?: ((props: { children?: React.ReactNode; disabled?: boolean }) => React.ReactNode) | null
  }
} | undefined
let onMockTldrawPointerDown: (() => void) | undefined
let hookEditor: Record<string, ReturnType<typeof vi.fn>> | undefined
let hookTools: Record<string, { onSelect: ReturnType<typeof vi.fn> }> | undefined

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  mountedProps = undefined
  onMockTldrawPointerDown = undefined
  hookEditor = undefined
  hookTools = undefined
})

vi.mock('tldraw', async (importOriginal) => ({
  ...(await importOriginal<typeof import('tldraw')>()),
  useEditor: () => hookEditor,
  useTools: () => hookTools,
  useValue: (_name: string, getValue: () => unknown) => getValue(),
  DefaultToolbar: ({
    children,
    minItems,
    maxItems,
  }: {
    children: React.ReactNode
    minItems?: number
    maxItems?: number
  }) => <div data-testid="default-toolbar" data-min-items={minItems} data-max-items={maxItems}>{children}</div>,
  AssetToolbarItem: () => <button type="button" data-tool-id="asset">asset</button>,
  ToolbarItem: ({ tool }: { tool: string }) => (
    <button type="button" data-tool-id={tool}>
      {tool === 'arrow' ? '连接线' : tool === 'frame' ? '分区' : tool}
    </button>
  ),
  TldrawUiToolbarButton: ({
    children,
    isActive,
    tooltip: _tooltip,
    type: _type,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean; tooltip?: string }) => (
    <button type="button" data-isactive={isActive ? 'true' : 'false'} {...props}>{children}</button>
  ),
  TldrawUiIcon: ({ icon, label }: { icon: string; label: string }) => <span data-icon={icon}>{label}</span>,
  TldrawUiPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TldrawUiPopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TldrawUiPopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TldrawUiToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DefaultStylePanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="style-panel">{children}</div>,
  StylePanelSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StylePanelButtonPicker: ({ title, onValueChange }: { title: string; onValueChange?: (event: unknown, value: string) => void }) => (
    <button type="button" data-style-picker={title} onClick={() => onValueChange?.({}, 'start')}>{title}</button>
  ),
  TldrawUiSlider: ({ label, onValueChange }: { label: string; onValueChange?: (value: number) => void }) => (
    <button type="button" data-style-slider={label} onClick={() => onValueChange?.(50)}>{label}</button>
  ),
  DefaultContextMenu: ({ children }: { children: React.ReactNode }) => <div data-testid="native-context-menu">{children}</div>,
  DefaultContextMenuContent: () => <div data-testid="default-context-menu-content" />,
  TldrawUiMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TldrawUiMenuItem: ({ id, label, onSelect, readonlyOk }: { id: string; label: string; onSelect(): void; readonlyOk?: boolean }) => {
    const getIsReadonly = hookEditor?.getIsReadonly as (() => boolean) | undefined
    return getIsReadonly?.() && !readonlyOk
      ? null
      : <button type="button" data-testid={`context-menu.${id}`} onClick={onSelect}>{label}</button>
  },
  Tldraw: (props: {
    assetUrls?: { translations?: Record<string, string> }
    licenseKey?: string
    onMount?: (editor: unknown) => void
    options?: { maxShapesPerPage?: number }
    overrides?: { translations?: Record<string, Record<string, string>> }
    shapeUtils?: Array<{ type?: string }>
    components?: {
      Toolbar?: (() => React.ReactNode) | null
      StylePanel?: ((props: Record<string, unknown>) => React.ReactNode) | null
      InFrontOfTheCanvas?: (() => React.ReactNode) | null
      ContextMenu?: ((props: { children?: React.ReactNode; disabled?: boolean }) => React.ReactNode) | null
    }
  }) => {
    mountedProps = props
    return (
    <div
      data-testid="tldraw-canvas"
      className="tl-canvas"
      data-license-key={props.licenseKey ?? ''}
      onPointerDown={() => onMockTldrawPointerDown?.()}
    />
    )
  },
}))

import { CanvasEditor, ShapeConnectionHandles, getCanvasLicenseKey } from './CanvasEditor'

describe('CanvasEditor', () => {
  it('ships a complete Chinese translation asset with the tldraw fallback keys filled', () => {
    const translations = JSON.parse(readFileSync(
      resolve(process.cwd(), 'apps/web/public/tldraw-translations/zh-cn.json'),
      'utf8',
    )) as Record<string, string>

    expect(Object.keys(translations).length).toBeGreaterThan(450)
    expect(translations).toMatchObject({
      'action.copy-hovered-styles': '复制悬停样式',
      'action.frame-selection': '为所选内容创建分区',
      'page-menu.max-pages-reached': '已达到最大页面数量',
      'page-menu.resize': '调整页面列表大小',
    })
  })

  it('mounts a tldraw canvas and passes the injected license key without rendering it', () => {
    render(<CanvasEditor licenseKey="secret-key" />)

    expect(screen.getByTestId('tldraw-canvas')).toHaveAttribute('data-license-key', 'secret-key')
    expect(screen.queryByText('secret-key')).not.toBeInTheDocument()
    expect(mountedProps?.shapeUtils?.map((util) => util.type)).toContain('board-reference')
    expect(mountedProps?.shapeUtils?.map((util) => util.type)).toEqual(expect.arrayContaining(['arrow', 'table', 'mind-map']))
    expect(mountedProps?.assetUrls?.translations?.en).toBeTruthy()
    expect(mountedProps?.assetUrls?.translations?.en).not.toMatch(/^https?:/)
    expect(mountedProps?.assetUrls?.translations?.['zh-cn']).toBe('/tldraw-translations/zh-cn.json')
  })

  it('does not expose mutable mind-map text styles in readonly mode', () => {
    const props = createMindMapProps('Root', () => 'node:root')
    const shape = { id: 'shape:mind-map', type: 'mind-map', x: 0, y: 0, rotation: 0, props }
    const updateShape = vi.fn()
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => shape),
      getInstanceState: vi.fn(() => ({ isReadonly: true })),
      getCurrentTheme: vi.fn(() => ({
        colors: { light: {} },
        fonts: {
          draw: { family: 'draw' },
          sans: { family: 'sans' },
          serif: { family: 'serif' },
          mono: { family: 'mono' },
        },
      })),
      getColorMode: vi.fn(() => 'light'),
      getShape: vi.fn(() => shape),
      updateShape,
      markHistoryStoppingPoint: vi.fn(),
    }
    setCanvasShapeInteractionTarget(hookEditor as never, {
      type: 'mind-map',
      shapeId: shape.id,
      nodeId: props.nodes[0]!.id,
    })

    render(<CanvasEditor />)
    const StylePanel = mountedProps?.components?.StylePanel
    expect(StylePanel).toBeTypeOf('function')
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    const italicIcon = document.querySelector('[data-icon="italic"]')
    expect(italicIcon).toBeNull()
    expect(updateShape).not.toHaveBeenCalled()
  })

  it('reads the Vite-injected license key without depending on Node globals', () => {
    expect(getCanvasLicenseKey({ VITE_TLDRAW_LICENSE_KEY: 'vite-license-key' })).toBe('vite-license-key')
  })

  it('configures enough per-page capacity for the 5000-shape performance baseline', () => {
    render(<CanvasEditor />)

    expect(mountedProps?.options?.maxShapesPerPage).toBeGreaterThanOrEqual(5_000)
    expect(mountedProps?.overrides?.translations?.['zh-cn']).toMatchObject({
      'action.copy-hovered-styles': '复制悬停样式',
      'action.frame-selection': '为所选内容创建分区',
      'page-menu.max-pages-reached': '已达到最大页面数量',
      'page-menu.resize': '调整页面列表大小',
    })
  })

  it('groups pen and eraser, promotes frame, and distinguishes the child-board icon', () => {
    vi.useFakeTimers()
    let currentToolId = 'select'
    const selectDraw = vi.fn()
    const selectEraser = vi.fn()
    hookEditor = {
      getCurrentToolId: vi.fn(() => currentToolId),
    }
    hookTools = {
      draw: { onSelect: selectDraw },
      eraser: { onSelect: selectEraser },
    }
    const onReferenceToolToggle = vi.fn()

    render(<CanvasEditor
      referenceToolActive
      onReferenceToolToggle={onReferenceToolToggle}
    />)
    const Toolbar = mountedProps?.components?.Toolbar
    expect(Toolbar).toBeTypeOf('function')
    if (!Toolbar) throw new Error('Expected toolbar override')

    const toolbarView = render(<>{Toolbar()}</>)

    expect(document.querySelector('[data-tool-id="select"]')).toBeNull()
    expect(document.querySelector('[data-tool-id="hand"]')).toBeNull()
    expect(document.querySelector('[data-tool-id="draw"]')).toBeNull()
    expect(document.querySelector('[data-tool-id="eraser"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: '连接线' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: '分区' })).toHaveAttribute('data-tool-id', 'frame')

    const visibleToolIds = Array.from(document.querySelectorAll('[data-tool-id]'))
      .map((element) => element.getAttribute('data-tool-id'))
    expect(visibleToolIds.indexOf('frame')).toBeLessThan(visibleToolIds.indexOf('asset'))
    expect(visibleToolIds.indexOf('frame')).toBeLessThan(visibleToolIds.indexOf('table'))
    expect(visibleToolIds.indexOf('table')).toBeLessThan(visibleToolIds.indexOf('mind-map'))
    expect(visibleToolIds.indexOf('mind-map')).toBeLessThan(visibleToolIds.indexOf('asset'))
    expect(visibleToolIds.indexOf('asset')).toBeLessThan(visibleToolIds.indexOf('arrow'))
    expect(screen.getByTestId('default-toolbar')).toHaveAttribute('data-min-items', '10')
    expect(screen.getByTestId('default-toolbar')).toHaveAttribute('data-max-items', '10')
    expect(readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8'))
      .toContain(".tlui-main-toolbar__overflow-content [data-value='asset']")
    expect(mountedProps?.overrides?.translations?.['zh-cn']?.['tool.frame']).toBe('分区')

    const childBoardButton = screen.getByRole('button', { name: '插入子画板' })
    expect(childBoardButton.querySelector('[data-icon="duplicate"]')).not.toBeNull()
    expect(childBoardButton.querySelector('[data-icon="tool-frame"]')).toBeNull()
    expect(childBoardButton).toHaveAttribute('aria-pressed', 'true')
    expect(childBoardButton).toHaveAttribute('data-isactive', 'true')
    fireEvent.click(childBoardButton)
    expect(onReferenceToolToggle).toHaveBeenCalledOnce()

    const mainButton = screen.getByTestId('tools.pen-eraser').querySelector('[data-active-tool]')
    expect(mainButton).toHaveAttribute('data-active-tool', 'draw')
    if (!mainButton) throw new Error('Expected pen and eraser main button')
    expect(screen.queryByTestId('tools.pen-eraser-menu')).toBeNull()
    fireEvent.click(mainButton)
    expect(selectDraw).toHaveBeenCalledWith('toolbar')

    fireEvent.pointerDown(mainButton, { button: 0, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(450))
    expect(mainButton).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerUp(mainButton, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.click(screen.getByTestId('tools.pen-eraser.eraser'))
    expect(selectEraser).toHaveBeenCalledWith('toolbar')
    expect(mainButton).toHaveAttribute('data-active-tool', 'eraser')

    currentToolId = 'draw'
    toolbarView.rerender(<>{Toolbar()}</>)
    expect(screen.getByTestId('tools.pen-eraser').querySelector('[data-active-tool]'))
      .toHaveAttribute('data-active-tool', 'draw')

    currentToolId = 'eraser'
    toolbarView.rerender(<>{Toolbar()}</>)
    expect(screen.getByTestId('tools.pen-eraser').querySelector('[data-active-tool]'))
      .toHaveAttribute('data-active-tool', 'eraser')

    currentToolId = 'arrow'
    toolbarView.rerender(<>{Toolbar()}</>)
    expect(screen.getByTestId('tools.pen-eraser').querySelector('[data-active-tool]'))
      .toHaveAttribute('data-active-tool', 'eraser')
  })

  it('mounts with eraser active without a passive state-resync render', () => {
    const getCurrentToolId = vi.fn(() => 'eraser')
    hookEditor = { getCurrentToolId }
    hookTools = {
      draw: { onSelect: vi.fn() },
      eraser: { onSelect: vi.fn() },
    }

    render(<CanvasEditor />)
    const Toolbar = mountedProps?.components?.Toolbar
    if (!Toolbar) throw new Error('Expected toolbar override')
    render(<>{Toolbar()}</>)

    expect(screen.getByTestId('tools.pen-eraser').querySelector('[data-active-tool]'))
      .toHaveAttribute('data-active-tool', 'eraser')
    expect(getCurrentToolId).toHaveBeenCalledTimes(1)
  })

  it('keeps tldraw component configuration stable across parent rerenders', () => {
    const firstToggle = vi.fn()
    const secondToggle = vi.fn()
    const { rerender } = render(<CanvasEditor onCommentToolToggle={firstToggle} />)
    const firstComponents = mountedProps?.components
    const firstShapeUtils = mountedProps?.shapeUtils

    rerender(<CanvasEditor onCommentToolToggle={secondToggle} commentToolActive />)

    expect(mountedProps?.components).toBe(firstComponents)
    expect(mountedProps?.shapeUtils).toBe(firstShapeUtils)
  })

  it('places one child board at the clicked page point without selecting the shape underneath', () => {
    const onReferencePlace = vi.fn()
    const onReferenceToolCancel = vi.fn()
    const getShapeAtPoint = vi.fn(() => ({ id: 'shape:under-pointer', type: 'geo' }))
    const view = render(<CanvasEditor
      referenceToolActive
      onReferencePlace={onReferencePlace}
      onReferenceToolCancel={onReferenceToolCancel}
    />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        screenToPage: ({ x, y }: { x: number; y: number }) => ({ x: x + 11, y: y + 22 }),
        getShapeAtPoint,
      })
    })

    const canvas = screen.getByLabelText('白板画布')
    const tldrawCanvas = screen.getByTestId('tldraw-canvas')
    expect(canvas).toHaveAttribute('data-reference-tool-active', 'true')
    fireEvent.pointerDown(tldrawCanvas, { pointerId: 7, button: 0, clientX: 30, clientY: 40 })
    fireEvent.pointerUp(tldrawCanvas, { pointerId: 7, button: 0, clientX: 30, clientY: 40 })

    expect(onReferenceToolCancel).toHaveBeenCalledOnce()
    expect(onReferencePlace).toHaveBeenCalledOnce()
    expect(onReferencePlace).toHaveBeenCalledWith({ x: 41, y: 62 })
    expect(getShapeAtPoint).not.toHaveBeenCalled()

    view.rerender(<CanvasEditor
      referenceToolActive={false}
      onReferencePlace={onReferencePlace}
      onReferenceToolCancel={onReferenceToolCancel}
    />)
    fireEvent.pointerDown(tldrawCanvas, { pointerId: 8, button: 0, clientX: 50, clientY: 60 })
    fireEvent.pointerUp(tldrawCanvas, { pointerId: 8, button: 0, clientX: 50, clientY: 60 })
    expect(onReferencePlace).toHaveBeenCalledOnce()
  })

  it('cancels child-board placement with Escape or right click', () => {
    const onReferenceToolCancel = vi.fn()
    render(<CanvasEditor
      referenceToolActive
      onReferenceToolCancel={onReferenceToolCancel}
      onReferencePlace={vi.fn()}
    />)

    const canvas = screen.getByLabelText('白板画布')
    fireEvent.keyDown(canvas, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByTestId('tldraw-canvas'), { button: 2 })

    expect(onReferenceToolCancel).toHaveBeenCalledTimes(2)
  })

  it('redirects a local board-reference deletion to the structural remove command', () => {
    const remove = vi.fn()
    const dispose = vi.fn()
    let beforeDelete: ((shape: { type: string }, source: 'user' | 'remote') => void | false) | undefined
    render(<CanvasEditor boardReferenceActions={{
      enter: vi.fn(),
      openInNewTab: vi.fn(),
      renameTarget: vi.fn(),
      changeKind: vi.fn(),
      remove,
    }} />)

    act(() => {
      mountedProps?.onMount?.({
        sideEffects: {
          registerBeforeDeleteHandler: vi.fn((_typeName, handler) => {
            beforeDelete = handler
            return dispose
          }),
        },
        updateInstanceState: vi.fn(),
      })
    })
    const reference = { type: 'board-reference', props: { referenceId: 'reference-1' } }

    expect(beforeDelete?.(reference, 'user')).toBe(false)
    expect(remove).toHaveBeenCalledWith(reference)
    expect(beforeDelete?.(reference, 'remote')).toBeUndefined()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('shows four midpoint anchors and creates a bound arrow from the exact shape edge', () => {
    let createdArrow: { id: string; type: 'arrow'; x: number; y: number; props: Record<string, unknown> } | undefined
    const createShape = vi.fn((shape) => {
      createdArrow = shape
    })
    const createBinding = vi.fn()
    const updateBinding = vi.fn()
    const updateShapes = vi.fn()
    const select = vi.fn()
    const onHandleDrag = vi.fn((_shape, info) => ({
      id: createdArrow?.id,
      type: 'arrow',
      props: { end: { x: info.handle.x, y: info.handle.y } },
    }))
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => ({ id: 'shape:box', type: 'geo' })),
      getCurrentToolId: vi.fn(() => 'select'),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      canBindShapes: vi.fn(() => true),
      getShapeGeometry: vi.fn(() => ({
        bounds: {
          x: 0, y: 0, maxX: 100, maxY: 60,
          center: { x: 50, y: 30 },
        },
      })),
      getShapePageTransform: vi.fn(() => ({ applyToPoint: (point: { x: number; y: number }) => point })),
      pageToScreen: vi.fn((point: { x: number; y: number }) => point),
      screenToPage: vi.fn((point: { x: number; y: number }) => point),
      getResizeScaleFactor: vi.fn(() => 1),
      markHistoryStoppingPoint: vi.fn(() => 'mark:arrow'),
      createShape,
      getShape: vi.fn(() => createdArrow),
      createBinding,
      getShapeHandles: vi.fn(() => [
        { id: 'start', type: 'vertex', index: 'a2', x: 0, y: 0 },
        { id: 'end', type: 'vertex', index: 'a3', x: 1, y: 1 },
      ]),
      getPointInShapeSpace: vi.fn((_shape, point: { x: number; y: number }) => point),
      getShapeUtil: vi.fn(() => ({ onHandleDrag })),
      updateShapes,
      getBindingsFromShape: vi.fn(() => [{
        id: 'binding:end',
        type: 'arrow',
        fromId: createdArrow?.id,
        toId: 'shape:target',
        props: {
          terminal: 'end',
          normalizedAnchor: { x: 0.2, y: 0.3 },
          isPrecise: true,
          isExact: false,
          snap: 'none',
        },
      }]),
      updateBinding,
      select,
      bailToMark: vi.fn(),
    }

    render(<ShapeConnectionHandles />)

    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '从上边连接' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从右边连接' })).toHaveStyle({ left: '114px', top: '30px' })
    expect(screen.getByRole('button', { name: '从下边连接' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从左边连接' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: '从右边连接' }), {
      pointerId: 7, pointerType: 'mouse', button: 0, clientX: 114, clientY: 30,
    })
    fireEvent.pointerMove(window, {
      pointerId: 7, pointerType: 'mouse', button: 0, clientX: 180, clientY: 80,
    })
    fireEvent.pointerUp(window, {
      pointerId: 7, pointerType: 'mouse', button: 0, clientX: 240, clientY: 120,
    })

    expect(createShape).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      type: 'arrow',
      x: 100,
      y: 30,
      props: expect.objectContaining({ kind: 'elbow' }),
    }))
    expect(createBinding).toHaveBeenCalledWith(expect.objectContaining({
      type: 'arrow',
      fromId: createdArrow?.id,
      toId: 'shape:box',
      props: expect.objectContaining({
        terminal: 'start',
        normalizedAnchor: { x: 1, y: 0.5 },
        isPrecise: true,
        snap: 'edge-point',
      }),
    }))
    expect(onHandleDrag).toHaveBeenNthCalledWith(1, createdArrow, expect.objectContaining({
      handle: expect.objectContaining({ id: 'end', x: 180, y: 80 }),
      isCreatingShape: true,
    }))
    expect(onHandleDrag).toHaveBeenNthCalledWith(2, createdArrow, expect.objectContaining({
      handle: expect.objectContaining({ id: 'end', x: 240, y: 120 }),
      isCreatingShape: true,
    }))
    expect(updateShapes).toHaveBeenCalledTimes(2)
    expect(updateBinding).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'binding:end',
      props: expect.objectContaining({
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
        snap: 'center',
      }),
    }))
    expect(select).toHaveBeenCalledWith(createdArrow?.id)
  })

  it('requests edit access when tldraw mounts so the full toolset is immediately available', () => {
    const updateInstanceState = vi.fn()
    const setStyleForNextShapes = vi.fn()
    const onEditIntent = vi.fn(() => true)

    render(<CanvasEditor onEditIntent={onEditIntent} />)
    act(() => {
      mountedProps?.onMount?.({ updateInstanceState, setStyleForNextShapes })
    })

    expect(onEditIntent).toHaveBeenCalledTimes(1)
    expect(setStyleForNextShapes).toHaveBeenCalledWith(expect.anything(), 'elbow')
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: false })

    fireEvent.pointerDown(screen.getByLabelText('白板画布'))

    expect(onEditIntent).toHaveBeenCalledTimes(1)
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: false })
  })

  it('merges board-reference actions into the native context menu', () => {
    const shape = {
      id: 'shape:reference',
      type: 'board-reference',
      props: {
        referenceId: 'reference:one',
        targetBoardId: 'board:b',
        kind: 'embed',
        titleFallback: 'Board B',
      },
    }
    hookEditor = { getOnlySelectedShape: vi.fn(() => shape) }
    const boardReferenceActions = {
      enter: vi.fn(),
      openInNewTab: vi.fn(),
      renameTarget: vi.fn(),
      changeKind: vi.fn(),
      remove: vi.fn(),
    }
    render(<CanvasEditor boardReferenceActions={boardReferenceActions} />)
    const ContextMenu = mountedProps?.components?.ContextMenu
    expect(ContextMenu).toBeTypeOf('function')
    if (!ContextMenu) throw new Error('Expected native context menu override')

    render(<>{ContextMenu({})}</>)

    expect(screen.getByTestId('native-context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('default-context-menu-content')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('context-menu.board-reference-enter'))
    fireEvent.click(screen.getByTestId('context-menu.board-reference-new-tab'))
    fireEvent.click(screen.getByTestId('context-menu.board-reference-rename'))
    fireEvent.click(screen.getByTestId('context-menu.board-reference-kind'))
    fireEvent.click(screen.getByTestId('context-menu.board-reference-remove'))

    expect(boardReferenceActions.enter).toHaveBeenCalledWith(shape)
    expect(boardReferenceActions.openInNewTab).toHaveBeenCalledWith(shape)
    expect(boardReferenceActions.renameTarget).toHaveBeenCalledWith(shape)
    expect(boardReferenceActions.changeKind).toHaveBeenCalledWith(shape, 'link')
    expect(boardReferenceActions.remove).toHaveBeenCalledWith(shape)
  })

  it('merges table and mind-map operations into the native context menu', () => {
    const tableProps = createTableProps(3, 3)
    const table = { id: 'shape:table', type: 'table', props: tableProps }
    const markHistoryStoppingPoint = vi.fn()
    const updateShape = vi.fn()
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => table),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      markHistoryStoppingPoint,
      updateShape,
    }
    setCanvasShapeInteractionTarget(hookEditor as never, {
      type: 'table',
      shapeId: table.id,
      rowId: tableProps.rows[0]!.id,
      columnId: tableProps.columns[0]!.id,
      cellId: tableProps.rows[0]!.cells[0]!.id,
    })
    render(<CanvasEditor />)
    const ContextMenu = mountedProps?.components?.ContextMenu
    if (!ContextMenu) throw new Error('Expected native context menu override')
    const tableMenu = render(<>{ContextMenu({})}</>)

    expect(screen.getByTestId('native-context-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('context-menu.table-row-after'))
    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('table_row_after')
    expect(updateShape).toHaveBeenCalledWith(expect.objectContaining({
      id: table.id,
      type: 'table',
      props: expect.objectContaining({ rows: expect.arrayContaining([expect.any(Object)]) }),
    }))
    expect(screen.getByTestId('context-menu.table-clear-cells')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.table-cycle-align')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.table-toggle-header')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('context-menu.table-cycle-background'))
    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('table_cycle_background')
    expect(updateShape).toHaveBeenLastCalledWith(expect.objectContaining({
      props: expect.objectContaining({ rows: [expect.objectContaining({ cells: [expect.objectContaining({ background: 'gray' }), ...tableProps.rows[0]!.cells.slice(1)] }), ...tableProps.rows.slice(1)] }),
    }))
    tableMenu.unmount()
    cleanup()

    const initialMindMap = createMindMapProps('Root')
    const root = getMindMapRoot(initialMindMap)!
    const withChild = addMindMapChild(initialMindMap, root.id)
    const childId = withChild.nodeId!
    const mindMap = { id: 'shape:mind-map', type: 'mind-map', props: withChild.props }
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => mindMap),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      markHistoryStoppingPoint,
      updateShape,
    }
    setCanvasShapeInteractionTarget(hookEditor as never, {
      type: 'mind-map', shapeId: mindMap.id, nodeId: childId,
    })
    render(<CanvasEditor />)
    const MindMapContextMenu = mountedProps?.components?.ContextMenu
    if (!MindMapContextMenu) throw new Error('Expected native context menu override')
    render(<>{MindMapContextMenu({})}</>)

    expect(screen.getByTestId('context-menu.mind-map-add-child')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-add-sibling')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-delete-branch')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-copy-branch')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-duplicate-branch')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-copy-style')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-cycle-color')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-cycle-shape')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-cycle-theme')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('context-menu.mind-map-copy-branch'))
    fireEvent.click(screen.getByTestId('context-menu.mind-map-copy-style'))
    cleanup()
    render(<CanvasEditor />)
    const MindMapContextMenuWithClipboard = mountedProps?.components?.ContextMenu
    if (!MindMapContextMenuWithClipboard) throw new Error('Expected native context menu override')
    render(<>{MindMapContextMenuWithClipboard({})}</>)
    expect(screen.getByTestId('context-menu.mind-map-paste-branch')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu.mind-map-paste-style')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('context-menu.mind-map-toggle-layout'))
    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('mind_map_toggle_layout')
    expect(updateShape).toHaveBeenCalledWith(expect.objectContaining({
      id: mindMap.id,
      type: 'mind-map',
      props: expect.objectContaining({ layout: 'bilateral' }),
    }))
  })

  it('resets a manual elbow route through the native context menu and hides the action in read-only mode', () => {
    const shape = {
      id: 'shape:manual-arrow',
      type: 'arrow',
      props: { kind: 'elbow' },
      meta: {
        source: 'test',
        manualElbowRoute: {
          version: 1,
          segments: [
            { id: 'one', orientation: 'horizontal', position: 20 },
            { id: 'two', orientation: 'vertical', position: 80 },
            { id: 'three', orientation: 'horizontal', position: 120 },
          ],
        },
      },
    }
    const markHistoryStoppingPoint = vi.fn()
    const updateShape = vi.fn()
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => shape),
      getIsReadonly: vi.fn(() => false),
      markHistoryStoppingPoint,
      updateShape,
    }
    render(<CanvasEditor />)
    const ContextMenu = mountedProps?.components?.ContextMenu
    if (!ContextMenu) throw new Error('Expected native context menu override')
    const menu = render(<>{ContextMenu({})}</>)

    fireEvent.click(screen.getByRole('button', { name: '恢复自动布线' }))
    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('arrow_reset_routing')
    expect(updateShape).toHaveBeenCalledWith({
      id: shape.id,
      type: 'arrow',
      meta: { source: 'test' },
    })

    menu.unmount()
    hookEditor.getIsReadonly = vi.fn(() => true)
    render(<>{ContextMenu({})}</>)
    expect(screen.queryByRole('button', { name: '恢复自动布线' })).not.toBeInTheDocument()
  })

  it('selects the child board under every right-click before opening the native menu', () => {
    const reference = { id: 'shape:reference', type: 'board-reference' }
    const select = vi.fn()
    render(<CanvasEditor />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getContainer: () => screen.getByTestId('tldraw-canvas').parentElement,
        screenToPage: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        getShapeAtPoint: vi.fn(() => reference),
        select,
      })
    })

    fireEvent.contextMenu(screen.getByTestId('tldraw-canvas'), { clientX: 120, clientY: 80 })

    expect(select).toHaveBeenCalledWith(reference.id)
  })

  it('replays a missed canvas context menu once through the native trigger', () => {
    const clearOpenMenus = vi.fn()
    const frameCallbacks: FrameRequestCallback[] = []
    const timeoutCallbacks: Array<() => void> = []
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const setTimeout = vi.fn((callback: () => void) => {
      timeoutCallbacks.push(callback)
      return timeoutCallbacks.length
    })
    render(<CanvasEditor />)
    const canvas = screen.getByTestId('tldraw-canvas')
    const container = canvas.parentElement!
    const replayed = vi.fn()
    container.addEventListener('contextmenu', (event) => {
      if (event.target === container) replayed()
    })
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getContainer: () => container,
        timers: { requestAnimationFrame, setTimeout },
        menus: { clearOpenMenus },
        screenToPage: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        getShapeAtPoint: vi.fn(),
      })
    })

    fireEvent.contextMenu(canvas, { clientX: 120, clientY: 80 })
    act(() => {
      while (frameCallbacks.length) frameCallbacks.shift()!(0)
      timeoutCallbacks.forEach((callback) => callback())
      while (frameCallbacks.length) frameCallbacks.shift()!(0)
    })

    expect(clearOpenMenus).toHaveBeenCalledTimes(1)
    expect(replayed).toHaveBeenCalledTimes(1)
  })

  it('cancels an older native menu replay when a new right-button gesture starts', () => {
    const clearOpenMenus = vi.fn()
    const frameCallbacks: FrameRequestCallback[] = []
    const timeoutCallbacks: Array<() => void> = []
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const setTimeout = vi.fn((callback: () => void) => {
      timeoutCallbacks.push(callback)
      return timeoutCallbacks.length
    })
    render(<CanvasEditor />)
    const canvas = screen.getByTestId('tldraw-canvas')
    const container = canvas.parentElement!
    const replayed = vi.fn()
    container.addEventListener('contextmenu', (event) => {
      if (event.target === container) replayed()
    })
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getContainer: () => container,
        timers: { requestAnimationFrame, setTimeout },
        menus: { clearOpenMenus },
        screenToPage: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        getShapeAtPoint: vi.fn(),
      })
    })

    fireEvent.contextMenu(canvas, { clientX: 120, clientY: 80 })
    fireEvent.pointerDown(canvas, { button: 2, clientX: 160, clientY: 100 })
    act(() => {
      while (frameCallbacks.length) frameCallbacks.shift()!(0)
      timeoutCallbacks.forEach((callback) => callback())
      while (frameCallbacks.length) frameCallbacks.shift()!(0)
    })

    expect(clearOpenMenus).not.toHaveBeenCalled()
    expect(replayed).not.toHaveBeenCalled()
  })

  it('places comments and accepts child-board drops through canvas callbacks', () => {
    const onCommentPlace = vi.fn()
    const onCommentCancel = vi.fn()
    const onBoardReferenceDrop = vi.fn()
    const shape = {
      id: 'shape:reference',
      type: 'board-reference',
      props: {
        referenceId: 'reference:one', targetBoardId: 'board:b', kind: 'embed', titleFallback: '画板 B',
      },
    }
    render(<CanvasEditor
      commentToolActive
      onCommentPlace={onCommentPlace}
      onCommentCancel={onCommentCancel}
      onBoardReferenceDrop={onBoardReferenceDrop}
    />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        screenToPage: ({ x, y }: { x: number; y: number }) => ({ x: x + 1, y: y + 2 }),
        getShapeAtPoint: () => shape,
        getShapePageTransform: () => ({
          clone: () => ({
            invert: () => ({
              applyToPoint: () => ({ x: 5, y: 6 }),
            }),
          }),
        }),
      })
    })

    const canvas = screen.getByLabelText('白板画布')
    const tldrawCanvas = screen.getByTestId('tldraw-canvas')
    fireEvent.pointerDown(tldrawCanvas, { pointerId: 2, button: 0, clientX: 10, clientY: 20 })
    fireEvent.pointerUp(tldrawCanvas, { pointerId: 2, button: 0, clientX: 30, clientY: 40 })
    expect(onCommentPlace).toHaveBeenCalledWith({
      shapeId: 'shape:reference',
      x: 31,
      y: 42,
      shapeOffsetX: 5,
      shapeOffsetY: 6,
    })

    fireEvent.contextMenu(canvas)
    expect(onCommentCancel).toHaveBeenCalledTimes(1)

    const drop = createEvent.drop(canvas, {
      dataTransfer: {
        types: ['application/x-infinite-board-board-id'],
        getData: (type: string) => type === 'application/x-infinite-board-board-id' ? 'board:child' : '',
      },
    })
    Object.defineProperties(drop, { clientX: { value: 50 }, clientY: { value: 60 } })
    fireEvent(canvas, drop)
    expect(onBoardReferenceDrop).toHaveBeenCalledWith({ boardId: 'board:child', x: 51, y: 62 })

  })

  it('keeps tldraw read-only when the edit-intent gate rejects an input', () => {
    const updateInstanceState = vi.fn()
    const onEditIntent = vi.fn(() => false)

    render(<CanvasEditor onEditIntent={onEditIntent} />)
    act(() => {
      mountedProps?.onMount?.({ updateInstanceState })
    })
    fireEvent.keyDown(screen.getByLabelText('白板画布'), { key: 'a' })

    expect(onEditIntent).toHaveBeenCalledTimes(2)
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: true })
  })

  it('relocks and immediately reacquires a lease when the mounted board session changes', () => {
    const updateInstanceState = vi.fn()
    const onEditIntent = vi.fn(() => true)
    const { rerender } = render(
      <CanvasEditor onEditIntent={onEditIntent} inputSessionKey="tab-1:board-a" />,
    )
    act(() => {
      mountedProps?.onMount?.({ updateInstanceState })
    })
    fireEvent.pointerDown(screen.getByLabelText('白板画布'))
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: false })

    rerender(<CanvasEditor onEditIntent={onEditIntent} inputSessionKey="tab-1:board-b" />)

    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: false })
    expect(onEditIntent).toHaveBeenCalledTimes(2)
  })

  it('keeps a changed board session read-only when automatic lease reacquisition is rejected', () => {
    const updateInstanceState = vi.fn()
    const onEditIntent = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const { rerender } = render(
      <CanvasEditor onEditIntent={onEditIntent} inputSessionKey="tab-1:board-a" />,
    )
    act(() => {
      mountedProps?.onMount?.({ updateInstanceState })
    })

    rerender(<CanvasEditor onEditIntent={onEditIntent} inputSessionKey="tab-1:board-b" />)

    expect(onEditIntent).toHaveBeenCalledTimes(2)
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: true })
  })

  it('blocks a losing duplicate tab input before it can dirty or autosave its mounted board session', async () => {
    let readOnly = true
    let snapshot: unknown = { store: {} }
    const listeners = new Set<() => void>()
    const editor = {
      updateInstanceState: ({ isReadonly }: { isReadonly: boolean }) => {
        readOnly = isReadonly
      },
      getSnapshot: () => snapshot,
      loadSnapshot: (nextSnapshot: unknown) => {
        snapshot = nextSnapshot
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const saveSnapshot = vi.fn()
    const session = new BoardSession({
      api: {
        loadBoard: async () => ({ snapshot: { store: {} }, revision: 1 }),
        saveSnapshot,
      },
      debounceMs: 0,
    })
    onMockTldrawPointerDown = () => {
      if (readOnly) return
      snapshot = { store: { changed: true } }
      for (const listener of listeners) listener()
    }

    render(
      <CanvasEditor
        onEditIntent={() => false}
        onMount={(mountedEditor) => {
          void session.mount('duplicate-tab', 'board-a', mountedEditor as never)
        }}
      />,
    )
    await act(async () => {
      mountedProps?.onMount?.(editor)
      await Promise.resolve()
    })
    fireEvent.pointerDown(screen.getByTestId('tldraw-canvas'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(session.pendingSnapshot).toBeUndefined()
    expect(saveSnapshot).not.toHaveBeenCalled()
  })
})
