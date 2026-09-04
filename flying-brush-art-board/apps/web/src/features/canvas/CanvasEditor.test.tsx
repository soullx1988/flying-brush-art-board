import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
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
  TldrawUiMenuItem: ({ id, label, onSelect, readonlyOk, disabled }: { id: string; label: string; onSelect(): void; readonlyOk?: boolean; disabled?: boolean }) => {
    const getIsReadonly = hookEditor?.getIsReadonly as (() => boolean) | undefined
    return getIsReadonly?.() && !readonlyOk
      ? null
      : <button type="button" data-testid={`context-menu.${id}`} disabled={disabled} onClick={onSelect}>{label}</button>
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
      getCurrentToolId: vi.fn(() => 'select'),
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

  it.each(['draw', 'text', 'note', 'geo'] as const)(
    'keeps the default style panel visible before placement when the %s tool is active',
    (toolId) => {
      hookEditor = {
        getOnlySelectedShape: vi.fn(() => undefined),
        getCurrentToolId: vi.fn(() => toolId),
        getInstanceState: vi.fn(() => ({ isReadonly: false })),
      }

      render(<CanvasEditor />)
      const StylePanel = mountedProps?.components?.StylePanel
      expect(StylePanel).toBeTypeOf('function')
      if (!StylePanel) throw new Error('Expected style panel override')
      const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
      render(<StylePanelElement />)

      expect(screen.getByTestId('style-panel')).toBeInTheDocument()
    },
  )

  it('keeps the style panel hidden during idle readonly browsing with no selection', () => {
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => undefined),
      getCurrentToolId: vi.fn(() => 'select'),
      getInstanceState: vi.fn(() => ({ isReadonly: true })),
    }

    render(<CanvasEditor />)
    const StylePanel = mountedProps?.components?.StylePanel
    expect(StylePanel).toBeTypeOf('function')
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    expect(screen.queryByTestId('style-panel')).not.toBeInTheDocument()
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

  it('keeps all five data reading views after a free-form note is added and reloaded', () => {
    const panelKinds = ['market-overview', 'yishui-inference', 'stock-pool', 'announcements', 'system-status']
    const panels = panelKinds.map((panelKind, index) => ({
      id: `shape:panel-${index}`,
      type: 'trading-panel',
      meta: { template: 'shortline-trading-v1' },
      props: { panelKind, title: panelKind },
    }))
    const shapes = [
      ...panels,
      { id: 'shape:personal-note', type: 'note', meta: {}, props: { text: '盘中个人备注' } },
    ]
    const getShapePageBounds = vi.fn((shapeOrId: { id: string } | string) => {
      const id = typeof shapeOrId === 'string' ? shapeOrId : shapeOrId.id
      const index = panels.findIndex((panel) => panel.id === id)
      return index >= 0 ? { x: index * 100, y: index * 50, w: 780, h: 390 } : undefined
    })
    const zoomToBounds = vi.fn()

    render(<CanvasEditor />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => ({ x: 0, y: 0, z: 1 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds,
        zoomToBounds,
        zoomToFit: vi.fn(),
        timers: { setTimeout: (callback: () => void) => { callback(); return 1 } },
      })
    })

    const navigation = screen.getByRole('navigation', { name: '数据画板阅读视图' })
    expect(within(navigation).getAllByRole('button')).toHaveLength(6)
    for (const label of ['全景', '市场主线', '义水推演', '个人选股池', '公告观察', '数据状态']) {
      expect(within(navigation).getByRole('button', { name: `数据视图：${label}` })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: '数据视图：个人选股池' }))
    expect(getShapePageBounds).toHaveBeenLastCalledWith('shape:panel-2')
    expect(zoomToBounds).toHaveBeenLastCalledWith(
      { x: 200, y: -20, w: 960, h: 582 },
      { inset: 48, animation: { duration: 180 } },
    )
  })

  it('focuses the requested Yishui panel on a direct-entry route', () => {
    const panelKinds = ['market-overview', 'yishui-inference', 'stock-pool', 'announcements', 'system-status']
    const panels = panelKinds.map((panelKind, index) => ({
      id: `shape:direct-${index}`,
      type: 'trading-panel',
      meta: { template: 'shortline-trading-v1' },
      props: { panelKind, title: panelKind },
    }))
    const getShapePageBounds = vi.fn((shapeOrId: { id: string } | string) => {
      const id = typeof shapeOrId === 'string' ? shapeOrId : shapeOrId.id
      return id === 'shape:direct-1' ? { x: 0, y: 1478, w: 1860, h: 1180 } : { x: 0, y: 0, w: 780, h: 390 }
    })
    const zoomToBounds = vi.fn()

    render(<CanvasEditor initialTradingPanelKind="yishui-inference" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => panels,
        getCamera: () => ({ x: 0, y: 0, z: 1 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds,
        zoomToBounds,
        zoomToFit: vi.fn(),
        timers: { setTimeout: (callback: () => void) => { callback(); return 1 } },
      })
    })

    expect(getShapePageBounds).toHaveBeenCalledWith(panels[1])
    expect(zoomToBounds).toHaveBeenCalledWith(
      { x: 0, y: 1358, w: 2040, h: 1372 },
      { inset: 48, immediate: true },
    )
    expect(screen.getByRole('button', { name: '数据视图：义水推演' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not run a delayed initial fit after the user takes control of the viewport', () => {
    vi.useFakeTimers()
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown> }> = []
    const zoomToFit = vi.fn()

    render(<CanvasEditor />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        zoomToFit,
        timers: { setTimeout: window.setTimeout },
      })
    })

    fireEvent.pointerDown(screen.getByTestId('tldraw-canvas'), {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
    })
    shapes.push({ id: 'shape:user-created', type: 'geo' })

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(zoomToFit).not.toHaveBeenCalled()
  })

  it('never applies a generic delayed fit to a non-trading board', () => {
    vi.useFakeTimers()
    const zoomToFit = vi.fn()
    const zoomToBounds = vi.fn()

    render(<CanvasEditor inputSessionKey="tab-1:notes" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => [{ id: 'shape:note', type: 'note', meta: {} }],
        getShapePageBounds: vi.fn(),
        zoomToBounds,
        zoomToFit,
        timers: { setTimeout: window.setTimeout },
      })
      vi.advanceTimersByTime(2_000)
    })

    expect(zoomToFit).not.toHaveBeenCalled()
    expect(zoomToBounds).not.toHaveBeenCalled()
  })

  it.each(['camera', 'selection', 'tool'] as const)(
    'does not auto-fit delayed trading panels after programmatic %s restoration',
    (restoredState) => {
      vi.useFakeTimers()
      const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
      let camera = { x: 0, y: 0, z: 1 }
      let selectedShapeIds: string[] = []
      let currentToolId = 'select'
      const zoomToBounds = vi.fn()
      const editor = {
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => camera,
        setCamera: vi.fn((nextCamera: { x: number; y: number; z: number }) => { camera = nextCamera }),
        getSelectedShapeIds: () => selectedShapeIds,
        setSelectedShapes: vi.fn((shapeIds: string[]) => { selectedShapeIds = shapeIds }),
        getCurrentToolId: () => currentToolId,
        setCurrentTool: vi.fn((toolId: string) => { currentToolId = toolId }),
        getShapePageBounds: vi.fn(() => ({ x: 10, y: 20, w: 780, h: 390 })),
        zoomToBounds,
        timers: { setTimeout: window.setTimeout },
      }

      render(<CanvasEditor inputSessionKey="tab-1:data" />)
      act(() => mountedProps?.onMount?.(editor))
      act(() => {
        if (restoredState === 'camera') editor.setCamera({ x: 32, y: -18, z: 1.25 })
        if (restoredState === 'selection') editor.setSelectedShapes(['shape:restored-selection'])
        if (restoredState === 'tool') editor.setCurrentTool('draw')
        shapes.push({
          id: 'shape:market',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'market-overview', title: 'Market' },
        })
        vi.advanceTimersByTime(250)
      })

      expect(screen.getByRole('navigation', { name: '数据画板阅读视图' })).toBeVisible()
      expect(zoomToBounds).not.toHaveBeenCalled()
    },
  )

  it('auto-fits delayed trading panels only after all five reading panels arrive at the default initial view', () => {
    vi.useFakeTimers()
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()

    render(<CanvasEditor inputSessionKey="tab-1:data" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => ({ x: 0.00001, y: -0.00001, z: 1.00001 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds: vi.fn(() => ({ x: 10, y: 20, w: 780, h: 390 })),
        zoomToBounds,
        timers: { setTimeout: window.setTimeout },
      })
      shapes.push(
        {
          id: 'shape:market',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'market-overview', title: 'Market' },
        },
        {
          id: 'shape:stock',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'stock-pool', title: 'Pool' },
        },
        {
          id: 'shape:yishui',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'yishui-inference', title: '义水北路推演画板' },
        },
        {
          id: 'shape:announcements',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'announcements', title: 'Announcements' },
        },
        {
          id: 'shape:system',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'system-status', title: 'System' },
        },
      )
      vi.advanceTimersByTime(250)
    })

    expect(zoomToBounds).toHaveBeenCalledOnce()
    expect(within(screen.getByRole('navigation', { name: '数据画板阅读视图' })).getAllByRole('button')).toHaveLength(6)
  })

  it('keeps rescanning partial trading panels until the full overview plus five reading entries arrive', () => {
    vi.useFakeTimers()
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()
    let notifyDocumentChange = () => {}

    render(<CanvasEditor inputSessionKey="tab-1:data" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => ({ x: 0.00001, y: -0.00001, z: 1.00001 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds: vi.fn((shapeOrId: { id: string } | string) => {
          const id = typeof shapeOrId === 'string' ? shapeOrId : shapeOrId.id
          if (id === 'shape:market') return { x: 10, y: 20, w: 780, h: 390 }
          if (id === 'shape:yishui') return { x: 10, y: 900, w: 1620, h: 900 }
          if (id === 'shape:stock') return { x: 840, y: 20, w: 780, h: 390 }
          if (id === 'shape:announcements') return { x: 10, y: 460, w: 780, h: 390 }
          if (id === 'shape:system') return { x: 840, y: 460, w: 780, h: 390 }
          return undefined
        }),
        zoomToBounds,
        timers: { setTimeout: window.setTimeout },
        store: {
          listen: (listener: () => void) => {
            notifyDocumentChange = listener
            return () => { notifyDocumentChange = () => {} }
          },
        },
      })
    })

    act(() => {
      shapes.push({
        id: 'shape:market',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'market-overview', title: '市场主线' },
      })
      notifyDocumentChange()
      vi.advanceTimersByTime(250)
    })

    const partialNavigation = screen.getByRole('navigation', { name: '数据画板阅读视图' })
    expect(within(partialNavigation).getAllByRole('button')).toHaveLength(2)
    expect(zoomToBounds).not.toHaveBeenCalled()

    act(() => {
      shapes.push(
        {
          id: 'shape:yishui',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'yishui-inference', title: '义水北路推演画板' },
        },
        {
          id: 'shape:stock',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'stock-pool', title: '个人选股池' },
        },
        {
          id: 'shape:announcements',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'announcements', title: '公告观察' },
        },
        {
          id: 'shape:system',
          type: 'trading-panel',
          meta: { template: 'shortline-trading-v1' },
          props: { panelKind: 'system-status', title: '数据状态' },
        },
      )
      notifyDocumentChange()
      vi.advanceTimersByTime(250)
    })

    const fullNavigation = screen.getByRole('navigation', { name: '数据画板阅读视图' })
    expect(within(fullNavigation).getAllByRole('button')).toHaveLength(6)
    for (const label of ['全景', '市场主线', '义水推演', '个人选股池', '公告观察', '数据状态']) {
      expect(within(fullNavigation).getByRole('button', { name: `数据视图：${label}` })).toBeInTheDocument()
    }
    expect(zoomToBounds).toHaveBeenCalledOnce()
  })

  it('auto-fits the standalone today-overview board on the initial screen', () => {
    vi.useFakeTimers()
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()

    render(<CanvasEditor inputSessionKey="tab-1:today" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => ({ x: 0, y: 0, z: 1 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds: vi.fn(() => ({ x: 40, y: 60, w: 1860, h: 900 })),
        zoomToBounds,
        timers: { setTimeout: window.setTimeout },
      })
      shapes.push({
        id: 'shape:today',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'today-overview', title: '今天怎么看' },
      })
      vi.advanceTimersByTime(250)
    })

    expect(screen.queryByRole('navigation', { name: '数据画板阅读视图' })).not.toBeInTheDocument()
    expect(zoomToBounds).toHaveBeenCalledWith(
      { x: 40, y: 48, w: 1892, h: 932 },
      { inset: 48, immediate: true },
    )
  })

  it('auto-fits template board references on the overview board so real double-click targets stay visible', () => {
    vi.useFakeTimers()
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()
    const getShapePageBounds = vi.fn((shapeOrId: { id: string } | string) => {
      const id = typeof shapeOrId === 'string' ? shapeOrId : shapeOrId.id
      if (id === 'shape:today-ref') return { x: 0, y: 0, w: 620, h: 330 }
      if (id === 'shape:data-ref') return { x: 660, y: 0, w: 620, h: 330 }
      if (id === 'shape:logic-ref') return { x: 1320, y: 0, w: 620, h: 330 }
      if (id === 'shape:experience-ref') return { x: 330, y: 370, w: 620, h: 330 }
      if (id === 'shape:mindset-ref') return { x: 990, y: 370, w: 620, h: 330 }
      return undefined
    })

    render(<CanvasEditor inputSessionKey="tab-1:root" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => ({ x: 0, y: 0, z: 1 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds,
        zoomToBounds,
        timers: { setTimeout: window.setTimeout },
      })
      shapes.push(
        { id: 'shape:today-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '今天怎么看' } },
        { id: 'shape:data-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '数据' } },
        { id: 'shape:logic-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '逻辑' } },
        { id: 'shape:experience-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '经验' } },
        { id: 'shape:mindset-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '心态' } },
      )
      vi.advanceTimersByTime(250)
    })

    expect(zoomToBounds).toHaveBeenCalledWith(
      { x: 0, y: 0, w: 2120, h: 820 },
      { inset: 48, immediate: true },
    )
  })

  it('keeps rescanning after a free-form note and a single root entry until all five template references arrive', () => {
    vi.useFakeTimers()
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()
    let notifyDocumentChange = () => {}
    const getShapePageBounds = vi.fn((shapeOrId: { id: string } | string) => {
      const id = typeof shapeOrId === 'string' ? shapeOrId : shapeOrId.id
      if (id === 'shape:today-ref') return { x: 0, y: 0, w: 620, h: 330 }
      if (id === 'shape:data-ref') return { x: 660, y: 0, w: 620, h: 330 }
      if (id === 'shape:logic-ref') return { x: 1320, y: 0, w: 620, h: 330 }
      if (id === 'shape:experience-ref') return { x: 330, y: 370, w: 620, h: 330 }
      if (id === 'shape:mindset-ref') return { x: 990, y: 370, w: 620, h: 330 }
      return undefined
    })

    render(<CanvasEditor inputSessionKey="tab-1:root" />)
    act(() => {
      mountedProps?.onMount?.({
        updateInstanceState: vi.fn(),
        getCurrentPageShapes: () => shapes,
        getCamera: () => ({ x: 0, y: 0, z: 1 }),
        getSelectedShapeIds: () => [],
        getCurrentToolId: () => 'select',
        getShapePageBounds,
        zoomToBounds,
        timers: { setTimeout: window.setTimeout },
        store: {
          listen: (listener: () => void) => {
            notifyDocumentChange = listener
            return () => { notifyDocumentChange = () => {} }
          },
        },
      })
    })

    act(() => {
      shapes.push(
        { id: 'shape:personal-note', type: 'note', meta: {}, props: { text: '盘中个人备注' } },
        { id: 'shape:today-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '今天怎么看' } },
      )
      notifyDocumentChange()
      vi.advanceTimersByTime(250)
    })

    expect(screen.queryByRole('navigation', { name: '数据画板阅读视图' })).not.toBeInTheDocument()
    expect(zoomToBounds).not.toHaveBeenCalled()

    act(() => {
      shapes.push(
        { id: 'shape:data-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '数据' } },
        { id: 'shape:logic-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '逻辑' } },
        { id: 'shape:experience-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '经验' } },
        { id: 'shape:mindset-ref', type: 'board-reference', meta: { template: 'shortline-trading-v1' }, props: { titleFallback: '心态' } },
      )
      notifyDocumentChange()
      vi.advanceTimersByTime(250)
    })

    expect(zoomToBounds).toHaveBeenCalledWith(
      { x: 0, y: 0, w: 2120, h: 820 },
      { inset: 48, immediate: true },
    )
  })

  it('ignores a trading-template scan scheduled for a previous input session', () => {
    const scheduled: Array<() => void> = []
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()
    const editor = {
      updateInstanceState: vi.fn(),
      getCurrentPageShapes: () => shapes,
      getCamera: () => ({ x: 0, y: 0, z: 1 }),
      getSelectedShapeIds: () => [],
      getCurrentToolId: () => 'select',
      getShapePageBounds: vi.fn(() => ({ x: 10, y: 20, w: 780, h: 390 })),
      zoomToBounds,
      timers: {
        setTimeout: (callback: () => void) => {
          scheduled.push(callback)
          return 10_000 + scheduled.length
        },
      },
    }
    const view = render(<CanvasEditor inputSessionKey="tab-1:board-a" />)
    act(() => mountedProps?.onMount?.(editor))

    shapes.push(
      {
        id: 'shape:market',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'market-overview', title: 'Market' },
      },
      {
        id: 'shape:yishui',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'yishui-inference', title: '义水北路推演画板' },
      },
      {
        id: 'shape:stock',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'stock-pool', title: 'Pool' },
      },
      {
        id: 'shape:announcements',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'announcements', title: 'Announcements' },
      },
      {
        id: 'shape:system',
        type: 'trading-panel',
        meta: { template: 'shortline-trading-v1' },
        props: { panelKind: 'system-status', title: 'System' },
      },
    )
    view.rerender(<CanvasEditor inputSessionKey="tab-1:board-b" />)

    act(() => {
      for (const callback of [...scheduled]) callback()
    })

    expect(scheduled).toHaveLength(2)
    expect(zoomToBounds).toHaveBeenCalledOnce()
  })

  it('invalidates delayed scans and preserves a newer debug editor on unmount', () => {
    const scheduled: Array<() => void> = []
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; props?: Record<string, unknown> }> = []
    const zoomToBounds = vi.fn()
    const editor = {
      updateInstanceState: vi.fn(),
      getCurrentPageShapes: () => shapes,
      getShapePageBounds: vi.fn(() => ({ x: 0, y: 0, w: 780, h: 390 })),
      zoomToBounds,
      timers: {
        setTimeout: (callback: () => void) => {
          scheduled.push(callback)
          return 20_000 + scheduled.length
        },
      },
    }
    const debugWindow = window as Window & { __INFINITE_BOARD_EDITOR__?: unknown }
    const view = render(<CanvasEditor inputSessionKey="tab-1:board-a" />)
    act(() => mountedProps?.onMount?.(editor))

    expect(debugWindow.__INFINITE_BOARD_EDITOR__).toBe(editor)
    const replacementEditor = { replacement: true }
    debugWindow.__INFINITE_BOARD_EDITOR__ = replacementEditor
    view.unmount()
    shapes.push({
      id: 'shape:market',
      type: 'trading-panel',
      meta: { template: 'shortline-trading-v1' },
      props: { panelKind: 'market-overview', title: 'Market' },
    })
    act(() => {
      for (const callback of scheduled) callback()
    })

    expect(zoomToBounds).not.toHaveBeenCalled()
    expect(debugWindow.__INFINITE_BOARD_EDITOR__).toBe(replacementEditor)
    delete debugWindow.__INFINITE_BOARD_EDITOR__
  })

  it('clears its own debug editor on unmount', () => {
    const editor = { updateInstanceState: vi.fn() }
    const debugWindow = window as Window & { __INFINITE_BOARD_EDITOR__?: unknown }
    const view = render(<CanvasEditor />)
    act(() => mountedProps?.onMount?.(editor))

    expect(debugWindow.__INFINITE_BOARD_EDITOR__).toBe(editor)
    view.unmount()

    expect(debugWindow.__INFINITE_BOARD_EDITOR__).toBeUndefined()
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

    const protectedReference = {
      ...reference,
      meta: { protectedCore: true },
    }
    const protectedPanel = {
      type: 'trading-panel',
      meta: { protectedCore: true },
    }
    expect(beforeDelete?.(protectedReference, 'user')).toBe(false)
    expect(beforeDelete?.(protectedPanel, 'user')).toBe(false)
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

  it('offers the today-overview and Yishui inference panels in the native context menu', () => {
    const shape = {
      id: 'shape:trading',
      type: 'trading-panel',
      meta: { template: 'shortline-trading-v1' },
      props: {
        panelKind: 'market-overview',
        title: '市场环境与主线',
      },
    }
    const markHistoryStoppingPoint = vi.fn()
    const updateShape = vi.fn((update: { props: typeof shape.props }) => {
      shape.props = update.props
    })
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => shape),
      getCurrentPageShapes: vi.fn(() => [shape]),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      markHistoryStoppingPoint,
      updateShape,
    }
    render(<CanvasEditor />)
    const ContextMenu = mountedProps?.components?.ContextMenu
    if (!ContextMenu) throw new Error('Expected native context menu override')

    render(<>{ContextMenu({})}</>)
    expect(screen.getByTestId('context-menu.trading-panel-yishui')).toHaveTextContent('替换此面板为义水推演')
    fireEvent.click(screen.getByTestId('context-menu.trading-panel-yishui'))

    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('trading_panel_kind:yishui-inference')
    expect(updateShape).toHaveBeenCalledWith({
      id: shape.id,
      type: shape.type,
      props: { panelKind: 'yishui-inference', title: '义水北路推演画板' },
    })
    expect(screen.getByRole('navigation', { name: '数据画板阅读视图' }))
      .toHaveTextContent('义水推演')

    fireEvent.click(screen.getByTestId('context-menu.trading-panel-today'))

    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('trading_panel_kind:today-overview')
    expect(updateShape).toHaveBeenCalledWith({
      id: shape.id,
      type: shape.type,
      props: { panelKind: 'today-overview', title: '今天怎么看' },
    })
  })

  it('disables the Yishui replacement when another Yishui panel already exists', () => {
    const selected = {
      id: 'shape:market',
      type: 'trading-panel',
      meta: { template: 'shortline-trading-v1' },
      props: { panelKind: 'market-overview', title: '市场环境与主线' },
    }
    const existingYishui = {
      id: 'shape:yishui',
      type: 'trading-panel',
      meta: { template: 'shortline-trading-v1' },
      props: { panelKind: 'yishui-inference', title: '义水北路推演画板' },
    }
    const updateShape = vi.fn()
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => selected),
      getCurrentPageShapes: vi.fn(() => [selected, existingYishui]),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      markHistoryStoppingPoint: vi.fn(),
      updateShape,
    }
    render(<CanvasEditor />)
    const ContextMenu = mountedProps?.components?.ContextMenu
    if (!ContextMenu) throw new Error('Expected native context menu override')

    render(<>{ContextMenu({})}</>)
    const replacement = screen.getByTestId('context-menu.trading-panel-yishui')
    expect(replacement).toBeDisabled()
    fireEvent.click(replacement)
    expect(updateShape).not.toHaveBeenCalled()
  })

  it('keeps protected core entry and panel context menus read-only at the UI boundary', () => {
    const actions = {
      enter: vi.fn(),
      openInNewTab: vi.fn(),
      renameTarget: vi.fn(),
      changeKind: vi.fn(),
      remove: vi.fn(),
    }
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => ({
        id: 'shape:today-entry',
        type: 'board-reference',
        meta: { protectedCore: true },
        props: { kind: 'embed' },
      })),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
    }
    render(<CanvasEditor boardReferenceActions={actions} />)
    const ContextMenu = mountedProps?.components?.ContextMenu
    if (!ContextMenu) throw new Error('Expected native context menu override')

    const view = render(<>{ContextMenu({})}</>)
    expect(screen.getByTestId('context-menu.board-reference-enter')).toBeInTheDocument()
    expect(screen.queryByTestId('context-menu.board-reference-kind')).not.toBeInTheDocument()
    expect(screen.queryByTestId('context-menu.board-reference-remove')).not.toBeInTheDocument()

    hookEditor = {
      getOnlySelectedShape: vi.fn(() => ({
        id: 'shape:today-core',
        type: 'trading-panel',
        meta: { protectedCore: true },
        props: { panelKind: 'today-overview', title: '今天怎么看' },
      })),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
    }
    view.rerender(<>{ContextMenu({})}</>)
    expect(screen.queryByTestId('context-menu.trading-panel-market')).not.toBeInTheDocument()
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
