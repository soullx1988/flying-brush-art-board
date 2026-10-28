import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor, TLUiActionsContextType, TLUiOverrides } from 'tldraw'
import { renderHtmlFromRichText, renderRichTextFromHTML } from 'tldraw'
import { readCanvasToolStylePreference, writeCanvasToolStylePreference } from './tool-style-preferences'

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
  overrides?: TLUiOverrides
  shapeUtils?: Array<{ type?: string }>
  components?: {
    ActionsMenu?: ((props: { children?: React.ReactNode }) => React.ReactNode) | null
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
  window.localStorage.clear()
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
  TldrawUiContextualToolbar: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div data-testid="contextual-toolbar" aria-label={label}>{children}</div>
  ),
  TldrawUiDropdownMenuRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TldrawUiDropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TldrawUiDropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="group-selection-more.content">{children}</div>,
  TldrawUiMenuContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TldrawUiMenuActionItem: ({ actionId, disabled }: { actionId: string; disabled?: boolean }) => (
    <button type="button" data-testid={`action.${actionId}`} disabled={disabled}>{actionId}</button>
  ),
  DefaultActionsMenu: ({ children }: { children?: React.ReactNode }) => <div data-testid="actions-menu">{children}</div>,
  DistributeMenuItems: () => null,
  StackMenuItems: () => null,
  ReorderMenuItems: () => null,
  ZoomOrRotateMenuItem: () => null,
  RotateCWMenuItem: () => null,
  GroupOrUngroupMenuItem: () => null,
  TldrawUiToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DefaultStylePanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="style-panel">{children}</div>,
  DefaultStylePanelContent: () => <div data-testid="default-style-panel-content" />,
  StylePanelSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StylePanelButtonPicker: ({ title, onHistoryMark, onValueChange }: { title: string; onHistoryMark?: () => void; onValueChange?: (event: unknown, value: string) => void }) => (
    <button type="button" data-style-picker={title} onClick={() => {
      onHistoryMark?.()
      onValueChange?.({}, title === '背景颜色' ? 'yellow' : title === '背景填充' ? 'solid' : 'start')
    }}>{title}</button>
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
    overrides?: TLUiOverrides
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

import { CANVAS_TLDRAW_OPTIONS, CanvasEditor, ShapeConnectionHandles, getCanvasLicenseKey } from './CanvasEditor'

it('round-trips underline and other text formats without duplicate extension warnings', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const editor = { getTextOptions: () => CANVAS_TLDRAW_OPTIONS.text } as unknown as Editor
  try {
    const richText = renderRichTextFromHTML(editor, '<p><u><strong><em><s>设计验证</s></em></strong></u></p>')
    const parsed = richText as { content?: Array<{ content?: Array<{ marks?: Array<{ type: string }> }> }> }
    const marks = (parsed.content?.[0]?.content?.[0]?.marks ?? []).map(mark => mark.type)
    expect(marks).toEqual(expect.arrayContaining(['underline', 'bold', 'italic', 'strike']))
    expect(new Set(marks).size).toBe(marks.length)
    const html = renderHtmlFromRichText(editor, richText)
    for (const tag of ['u', 'strong', 'em', 's']) expect(html).toContain(`<${tag}>`)
    expect(warn.mock.calls.filter(args => args.some(arg => String(arg).includes('Duplicate extension names')))).toEqual([])
  } finally {
    warn.mockRestore()
  }
})

describe('CanvasEditor', () => {
  it('ships a complete Chinese translation asset with the tldraw fallback keys filled', () => {
    const translations = JSON.parse(readFileSync(
      resolve(process.cwd(), 'apps/web/public/tldraw-translations/zh-cn.json'),
      'utf8',
    )) as Record<string, string>

    expect(Object.keys(translations).length).toBeGreaterThan(450)
    expect(translations).toMatchObject({
      'action.open-cursor-chat': '临时消息',
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
    expect(mountedProps?.shapeUtils?.map((util) => util.type)).toEqual(expect.arrayContaining(['text', 'arrow', 'table', 'mind-map']))
    expect(mountedProps?.assetUrls?.translations?.en).toBeTruthy()
    expect(mountedProps?.assetUrls?.translations?.en).not.toMatch(/^https?:/)
    expect(mountedProps?.assetUrls?.translations?.['zh-cn']).toBe('/tldraw-translations/zh-cn.json')
  })

  it('does not expose mutable mind-map text styles in readonly mode', () => {
    const props = createMindMapProps('Root', () => 'node:root')
    const shape = { id: 'shape:mind-map', type: 'mind-map', x: 0, y: 0, rotation: 0, props }
    const updateShape = vi.fn()
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => [shape.id]),
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

  it('hides the style panel when the canvas selection is empty', () => {
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => []),
      getOnlySelectedShape: vi.fn(() => undefined),
      getCurrentToolId: vi.fn(() => 'select'),
    }
    render(<CanvasEditor />)

    const StylePanel = mountedProps?.components?.StylePanel
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    const { container } = render(<StylePanelElement />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('style-panel')).not.toBeInTheDocument()
  })

  it('shows the native style panel as soon as the arrow tool is active', () => {
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => []),
      getOnlySelectedShape: vi.fn(() => undefined),
      getCurrentToolId: vi.fn(() => 'arrow'),
    }
    render(<CanvasEditor />)

    const StylePanel = mountedProps?.components?.StylePanel
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    expect(screen.getByTestId('style-panel')).toBeInTheDocument()
  })

  it('shows and persists text format controls while the text tool is active', () => {
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => []),
      getOnlySelectedShape: vi.fn(() => undefined),
      getCurrentToolId: vi.fn(() => 'text'),
    }
    render(<CanvasEditor tldrawUser={{ id: 'account-a', name: 'Ada', color: '#7B66DC' }} />)

    const StylePanel = mountedProps?.components?.StylePanel
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    expect(screen.getByTestId('default-style-panel-content')).toBeInTheDocument()
    for (const mark of ['bold', 'italic', 'underline', 'strike']) {
      expect(screen.getByTestId(`text-tool-style-${mark}`)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('text-tool-style-bold'))

    expect(readCanvasToolStylePreference('account-a', 'text')?.formats).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strike: false,
    })
  })

  it('applies active formats to non-empty text shapes during creation without leaving pending metadata', () => {
    hookEditor = {
      updateInstanceState: vi.fn(),
      setStyleForNextShapes: vi.fn(),
    }
    writeCanvasToolStylePreference('account-a', 'text', {
      styles: {},
      opacity: 1,
      formats: { bold: true, italic: false, underline: false, strike: false },
    })
    render(<CanvasEditor tldrawUser={{ id: 'account-a', name: 'Ada', color: '#7B66DC' }} />)
    act(() => {
      mountedProps?.onMount?.(hookEditor)
    })

    type TextShapeUtilConstructor = new (editor: unknown) => {
      onBeforeCreate(shape: unknown): unknown
    }
    const TextShapeUtil = mountedProps?.shapeUtils?.find((util) => util.type === 'text') as TextShapeUtilConstructor | undefined
    if (!TextShapeUtil) throw new Error('Expected text shape util')

    const created = new TextShapeUtil(hookEditor).onBeforeCreate({
      id: 'shape:pasted-text',
      type: 'text',
      meta: {
        infiniteBoardPendingTextFormats: { italic: true },
      },
      props: {
        richText: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pasted text' }] }],
        },
      },
    }) as {
      meta: Record<string, unknown>
      props: { richText: { content?: Array<{ content?: Array<{ marks?: Array<{ type: string }> }> }> } }
    }

    expect(created.meta).not.toHaveProperty('infiniteBoardPendingTextFormats')
    expect(created.props.richText.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }])
  })

  it('adds persistent background color and fill controls for a selected text shape', () => {
    const shape = { id: 'shape:text', type: 'text', meta: {}, props: { richText: { type: 'doc', content: [] } } }
    const updateShape = vi.fn()
    const markHistoryStoppingPoint = vi.fn()
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => [shape.id]),
      getOnlySelectedShape: vi.fn(() => shape),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      getCurrentTheme: vi.fn(() => ({ colors: { light: {} } })),
      getColorMode: vi.fn(() => 'light'),
      getShape: vi.fn(() => shape),
      updateShape,
      markHistoryStoppingPoint,
    }
    render(<CanvasEditor tldrawUser={{ id: 'account-a', name: 'Ada', color: '#7B66DC' }} />)

    const StylePanel = mountedProps?.components?.StylePanel
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    expect(screen.getByTestId('default-style-panel-content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '背景颜色' }))
    fireEvent.click(screen.getByRole('button', { name: '背景填充' }))

    expect(markHistoryStoppingPoint.mock.calls.map(([name]) => name)).toEqual([
      'text_background_color:shape:text',
      'text_background_fill:shape:text',
    ])
    expect(updateShape).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: shape.id,
      type: 'text',
      meta: { infiniteBoardTextBackground: { color: 'yellow', fill: 'semi' } },
    }))
    expect(updateShape).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: shape.id,
      type: 'text',
      meta: { infiniteBoardTextBackground: { color: 'yellow', fill: 'solid' } },
    }))
    expect(readCanvasToolStylePreference('account-a', 'text')?.background).toEqual({
      color: 'yellow',
      fill: 'solid',
    })
  })

  it('adds bold, italic, underline, and strike controls for a selected text shape', () => {
    let currentShape = {
      id: 'shape:text-format',
      type: 'text',
      meta: {},
      props: {
        richText: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '格式' }] }],
        },
      },
    }
    const updateShape = vi.fn((change: { props?: Record<string, unknown> }) => {
      currentShape = {
        ...currentShape,
        props: { ...currentShape.props, ...change.props },
      }
    })
    const markHistoryStoppingPoint = vi.fn()
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => [currentShape.id]),
      getOnlySelectedShape: vi.fn(() => currentShape),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      getCurrentTheme: vi.fn(() => ({ colors: { light: {} } })),
      getColorMode: vi.fn(() => 'light'),
      getShape: vi.fn(() => currentShape),
      getEditingShapeId: vi.fn(() => undefined),
      getRichTextEditor: vi.fn(() => undefined),
      updateShape,
      markHistoryStoppingPoint,
    }
    render(<CanvasEditor tldrawUser={{ id: 'account-a', name: 'Ada', color: '#7B66DC' }} />)

    const StylePanel = mountedProps?.components?.StylePanel
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    for (const mark of ['bold', 'italic', 'underline', 'strike']) {
      expect(screen.getByTestId(`text-style-${mark}`)).toBeInTheDocument()
      fireEvent.click(screen.getByTestId(`text-style-${mark}`))
    }

    expect(markHistoryStoppingPoint.mock.calls.map(([name]) => name)).toEqual([
      'text_format_bold:shape:text-format',
      'text_format_italic:shape:text-format',
      'text_format_underline:shape:text-format',
      'text_format_strike:shape:text-format',
    ])
    expect((currentShape.props.richText.content?.[0]?.content?.[0] as { marks?: Array<{ type: string }> })?.marks).toEqual([
      { type: 'bold' },
      { type: 'italic' },
      { type: 'underline' },
      { type: 'strike' },
    ])
    expect(readCanvasToolStylePreference('account-a', 'text')?.formats).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
    })
  })

  it('records active rich-text formats changed through the editor', () => {
    const shape = {
      id: 'shape:text-editor-format',
      type: 'text',
      meta: {},
      props: {
        richText: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '格式' }] }],
        },
      },
    }
    const richTextEditor = {
      on: vi.fn(),
      off: vi.fn(),
      isActive: vi.fn((mark: string) => mark === 'bold' || mark === 'underline'),
    }
    hookEditor = {
      getSelectedShapeIds: vi.fn(() => [shape.id]),
      getOnlySelectedShape: vi.fn(() => shape),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      getCurrentTheme: vi.fn(() => ({ colors: { light: {} } })),
      getColorMode: vi.fn(() => 'light'),
      getShape: vi.fn(() => shape),
      getEditingShapeId: vi.fn(() => shape.id),
      getRichTextEditor: vi.fn(() => richTextEditor),
      updateShape: vi.fn(),
      markHistoryStoppingPoint: vi.fn(),
    }
    render(<CanvasEditor tldrawUser={{ id: 'account-a', name: 'Ada', color: '#7B66DC' }} />)

    const StylePanel = mountedProps?.components?.StylePanel
    if (!StylePanel) throw new Error('Expected style panel override')
    const StylePanelElement = StylePanel as (props: Record<string, unknown>) => React.ReactElement
    render(<StylePanelElement />)

    expect(readCanvasToolStylePreference('account-a', 'text')?.formats).toEqual({
      bold: true,
      italic: false,
      underline: true,
      strike: false,
    })
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
      'action.group': '组合',
      'action.open-cursor-chat': '临时消息',
      'action.ungroup': '取消组合',
      'page-menu.max-pages-reached': '已达到最大页面数量',
      'page-menu.resize': '调整页面列表大小',
    })
  })

  it('uses Ctrl+G only for one-step grouping and keeps native ungroup separate', () => {
    render(<CanvasEditor />)
    const overrideActions = mountedProps?.overrides?.actions
    if (!overrideActions) throw new Error('Expected canvas action overrides')

    const selectedShapes = [
      { id: 'shape:one', type: 'geo' },
      { id: 'shape:two', type: 'geo' },
    ]
    const markHistoryStoppingPoint = vi.fn()
    const groupShapes = vi.fn()
    const editor = {
      getIsReadonly: vi.fn(() => false),
      isIn: vi.fn(() => true),
      getSelectedShapes: vi.fn(() => selectedShapes),
      getSelectedShapeIds: vi.fn(() => selectedShapes.map((shape) => shape.id)),
      isShapeOrAncestorLocked: vi.fn(() => false),
      isShapeOfType: vi.fn((shape: { type: string }, type: string) => shape.type === type),
      markHistoryStoppingPoint,
      groupShapes,
    } as unknown as Editor
    const nativeGroup = {
      id: 'group',
      label: 'action.group',
      kbd: 'cmd+g,ctrl+g',
      onSelect: vi.fn(),
    }
    const nativeUngroup = {
      id: 'ungroup',
      label: 'action.ungroup',
      kbd: 'cmd+shift+g,ctrl+shift+g',
      onSelect: vi.fn(),
    }

    const actions = overrideActions(editor, {
      group: nativeGroup,
      ungroup: nativeUngroup,
    } as TLUiActionsContextType, {} as never)
    actions.group!.onSelect('kbd')

    expect(actions.group?.kbd).toBe('cmd+g,ctrl+g')
    expect(actions.ungroup).toBe(nativeUngroup)
    expect(markHistoryStoppingPoint).toHaveBeenCalledOnce()
    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('group')
    expect(groupShapes).toHaveBeenCalledOnce()
    expect(groupShapes).toHaveBeenCalledWith(['shape:one', 'shape:two'])
    expect(nativeGroup.onSelect).not.toHaveBeenCalled()
  })

  it('does not group readonly, locked, single-group, or externally-bound-arrow selections', () => {
    render(<CanvasEditor />)
    const overrideActions = mountedProps?.overrides?.actions
    if (!overrideActions) throw new Error('Expected canvas action overrides')

    const markHistoryStoppingPoint = vi.fn()
    const groupShapes = vi.fn()
    let readonly = false
    let lockedShapeId: string | undefined
    let selectedShapes: Array<{ id: string; type: string }> = [
      { id: 'shape:one', type: 'geo' },
      { id: 'shape:two', type: 'geo' },
    ]
    const editor = {
      getIsReadonly: vi.fn(() => readonly),
      isIn: vi.fn(() => true),
      getSelectedShapes: vi.fn(() => selectedShapes),
      getSelectedShapeIds: vi.fn(() => selectedShapes.map((shape) => shape.id)),
      isShapeOrAncestorLocked: vi.fn((shape: { id: string }) => shape.id === lockedShapeId),
      isShapeOfType: vi.fn((shape: { type: string }, type: string) => shape.type === type),
      getBindingsFromShape: vi.fn((shapeId: string) => shapeId === 'shape:arrow'
        ? [{ id: 'binding:end', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:outside', props: { terminal: 'end' } }]
        : []),
      markHistoryStoppingPoint,
      groupShapes,
    } as unknown as Editor
    const actions = overrideActions(editor, {
      group: { id: 'group', onSelect: vi.fn() },
    } as TLUiActionsContextType, {} as never)

    readonly = true
    actions.group!.onSelect('kbd')
    readonly = false

    lockedShapeId = 'shape:two'
    actions.group!.onSelect('kbd')
    lockedShapeId = undefined

    selectedShapes = [{ id: 'shape:group', type: 'group' }]
    actions.group!.onSelect('kbd')

    selectedShapes = [
      { id: 'shape:arrow', type: 'arrow' },
      { id: 'shape:one', type: 'geo' },
    ]
    actions.group!.onSelect('kbd')

    expect(markHistoryStoppingPoint).not.toHaveBeenCalled()
    expect(groupShapes).not.toHaveBeenCalled()
  })

  it('enables alignment for a selected group and applies all layout actions to its children', () => {
    const group = { id: 'shape:group', type: 'group', props: {} }
    const children = [
      { id: 'shape:child-one', type: 'geo', props: {} },
      { id: 'shape:child-two', type: 'geo', props: {} },
    ]
    const childIds = children.map((shape) => shape.id)
    const alignShapes = vi.fn()
    const stretchShapes = vi.fn()
    const markHistoryStoppingPoint = vi.fn()
    const getOnlySelectedShape = vi.fn(() => group)
    const run = vi.fn((operation: () => void) => operation())
    hookEditor = {
      getOnlySelectedShape,
      getIsReadonly: vi.fn(() => false),
      isIn: vi.fn((state: string) => state === 'select'),
      getSelectedShapes: vi.fn(() => [group]),
      getSelectedShapeIds: vi.fn(() => [group.id]),
      getSortedChildIdsForParent: vi.fn(() => childIds),
      getShape: vi.fn((id: string) => children.find((shape) => shape.id === id)),
      isShapeOrAncestorLocked: vi.fn(() => false),
      isShapeOfType: vi.fn((shape: { type: string }, type: string) => shape.type === type),
      markHistoryStoppingPoint,
      alignShapes,
      stretchShapes,
      run,
    }
    render(<CanvasEditor />)

    const overrideActions = mountedProps?.overrides?.actions
    if (!overrideActions) throw new Error('Expected canvas action overrides')
    const layoutActionIds = [
      'align-left',
      'align-center-horizontal',
      'align-right',
      'stretch-horizontal',
      'align-top',
      'align-center-vertical',
      'align-bottom',
      'stretch-vertical',
    ] as const
    const nativeActions = Object.fromEntries([
      ['group', { id: 'group', onSelect: vi.fn() }],
      ...layoutActionIds.map((id) => [id, { id, onSelect: vi.fn() }]),
    ]) as TLUiActionsContextType
    const actions = overrideActions(hookEditor as unknown as Editor, nativeActions, {} as never)

    for (const id of layoutActionIds) actions[id]!.onSelect('actions-menu')

    expect(alignShapes.mock.calls).toEqual([
      [childIds, 'left'],
      [childIds, 'center-horizontal'],
      [childIds, 'right'],
      [childIds, 'top'],
      [childIds, 'center-vertical'],
      [childIds, 'bottom'],
    ])
    expect(stretchShapes.mock.calls).toEqual([
      [childIds, 'horizontal'],
      [childIds, 'vertical'],
    ])
    expect(markHistoryStoppingPoint.mock.calls.map(([name]) => name)).toEqual([
      'align left',
      'align center horizontal',
      'align right',
      'stretch horizontal',
      'align top',
      'align center vertical',
      'align bottom',
      'stretch vertical',
    ])
    for (const id of layoutActionIds) expect(nativeActions[id]!.onSelect).not.toHaveBeenCalled()

    const ActionsMenu = mountedProps?.components?.ActionsMenu
    if (!ActionsMenu) throw new Error('Expected actions menu override')
    const ActionsMenuElement = ActionsMenu as (props: { children?: React.ReactNode }) => React.ReactElement
    render(<ActionsMenuElement />)
    for (const id of layoutActionIds) expect(screen.getByTestId(`action.${id}`)).toBeEnabled()

    getOnlySelectedShape.mockReturnValue(children[0]!)
    actions['align-left']!.onSelect('kbd')
    expect(nativeActions['align-left']!.onSelect).toHaveBeenCalledWith('kbd')
  })

  it('shows group quick actions above the selection and reuses the context menu content', () => {
    const group = { id: 'shape:group', type: 'group' }
    const childIds = ['shape:child-one', 'shape:child-two']
    const setSelectedShapes = vi.fn()
    const markHistoryStoppingPoint = vi.fn()
    const ungroupShapes = vi.fn()
    hookEditor = {
      getOnlySelectedShape: vi.fn(() => group),
      isIn: vi.fn((state: string) => state === 'select.idle'),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      isShapeOrAncestorLocked: vi.fn(() => false),
      getSortedChildIdsForParent: vi.fn(() => childIds),
      getCurrentToolId: vi.fn(() => 'select'),
      canBindShapes: vi.fn(() => false),
      setSelectedShapes,
      markHistoryStoppingPoint,
      ungroupShapes,
    }
    render(<CanvasEditor />)
    const InFrontOfTheCanvas = mountedProps?.components?.InFrontOfTheCanvas
    if (!InFrontOfTheCanvas) throw new Error('Expected in-front canvas component')
    render(<>{InFrontOfTheCanvas()}</>)

    fireEvent.click(screen.getByTestId('group-selection-toolbar.select-children'))
    expect(setSelectedShapes).toHaveBeenCalledWith(childIds)

    fireEvent.click(screen.getByTestId('group-selection-toolbar.ungroup'))
    expect(markHistoryStoppingPoint).toHaveBeenCalledWith('ungroup')
    expect(ungroupShapes).toHaveBeenCalledWith([group.id])

    expect(screen.getByTestId('group-selection-toolbar.more')).toBeInTheDocument()
    expect(screen.getByTestId('default-context-menu-content')).toBeInTheDocument()
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
    const setCurrentTool = vi.fn()

    render(<CanvasEditor
      referenceToolActive
      onReferenceToolToggle={onReferenceToolToggle}
    />)
    if (hookEditor) hookEditor.setCurrentTool = setCurrentTool
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
    expect(readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8'))
      .toContain('.tl-container {\n  font-synthesis: style;\n}')
    expect(mountedProps?.overrides?.translations?.['zh-cn']?.['tool.frame']).toBe('分区')

    const childBoardButton = screen.getByRole('button', { name: '插入子画板' })
    expect(childBoardButton.querySelector('[data-icon="duplicate"]')).not.toBeNull()
    expect(childBoardButton.querySelector('[data-icon="tool-frame"]')).toBeNull()
    expect(childBoardButton).toHaveAttribute('aria-pressed', 'true')
    expect(childBoardButton).toHaveAttribute('data-isactive', 'true')
    fireEvent.click(childBoardButton)
    expect(onReferenceToolToggle).toHaveBeenCalledOnce()
    expect(setCurrentTool).toHaveBeenCalledWith('select')

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

  it('cancels external placement tools when a native tldraw tool becomes active', () => {
    const onCommentCancel = vi.fn()
    const onReferenceToolCancel = vi.fn()
    hookEditor = {
      getCurrentToolId: vi.fn(() => 'arrow'),
      getOnlySelectedShape: vi.fn(() => undefined),
      getSelectedShapeIds: vi.fn(() => []),
      getSelectedShapes: vi.fn(() => []),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      isIn: vi.fn(() => false),
    }

    render(<CanvasEditor
      commentToolActive
      referenceToolActive
      onCommentCancel={onCommentCancel}
      onReferenceToolCancel={onReferenceToolCancel}
    />)
    const InFrontOfTheCanvas = mountedProps?.components?.InFrontOfTheCanvas
    if (!InFrontOfTheCanvas) throw new Error('Expected in-front canvas component')
    render(<>{InFrontOfTheCanvas()}</>)

    expect(onCommentCancel).toHaveBeenCalledOnce()
    expect(onReferenceToolCancel).toHaveBeenCalledOnce()
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

  it('shows four midpoint anchors and does not auto-rewrite the dragged endpoint', () => {
    let createdArrow: { id: string; type: 'arrow'; x: number; y: number; props: Record<string, unknown> } | undefined
    const sourceShape = { id: 'shape:box', type: 'geo' }
    const targetShape = { id: 'shape:target', type: 'geo' }
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
      getOnlySelectedShape: vi.fn(() => sourceShape),
      getCurrentToolId: vi.fn(() => 'select'),
      getInstanceState: vi.fn(() => ({ isReadonly: false })),
      canBindShapes: vi.fn(() => true),
      getShapeGeometry: vi.fn((shape: { id: string }) => ({
        bounds: shape.id === targetShape.id
          ? { x: 200, y: 80, w: 100, h: 60, maxX: 300, maxY: 140, center: { x: 250, y: 110 } }
          : { x: 0, y: 0, w: 100, h: 60, maxX: 100, maxY: 60, center: { x: 50, y: 30 } },
      })),
      getShapePageTransform: vi.fn(() => ({ applyToPoint: (point: { x: number; y: number }) => point })),
      pageToScreen: vi.fn((point: { x: number; y: number }) => point),
      screenToPage: vi.fn((point: { x: number; y: number }) => point),
      getResizeScaleFactor: vi.fn(() => 1),
      markHistoryStoppingPoint: vi.fn(() => 'mark:arrow'),
      createShape,
      getShape: vi.fn((id: string) => id === createdArrow?.id ? createdArrow : id === sourceShape.id ? sourceShape : id === targetShape.id ? targetShape : undefined),
      createBinding,
      getShapeHandles: vi.fn(() => [
        { id: 'start', type: 'vertex', index: 'a2', x: 0, y: 0 },
        { id: 'end', type: 'vertex', index: 'a3', x: 1, y: 1 },
      ]),
      getPointInShapeSpace: vi.fn((_shape, point: { x: number; y: number }) => point),
      getShapeUtil: vi.fn(() => ({ onHandleDrag })),
      updateShapes,
      getBindingsFromShape: vi.fn(() => [{
        id: 'binding:start',
        type: 'arrow',
        fromId: createdArrow?.id,
        toId: sourceShape.id,
        props: {
          terminal: 'start',
          normalizedAnchor: { x: 1, y: 0.5 },
          isPrecise: true,
          isExact: false,
          snap: 'edge-point',
        },
      }, {
        id: 'binding:end',
        type: 'arrow',
        fromId: createdArrow?.id,
        toId: targetShape.id,
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

    writeCanvasToolStylePreference('account-a', 'arrow', {
      styles: {
        'tldraw:color': 'red',
        'tldraw:dash': 'solid',
        'tldraw:size': 'l',
      },
      opacity: 0.5,
    })
    render(<ShapeConnectionHandles accountId="account-a" />)

    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '从上边连接' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从右边连接' })).toHaveStyle({ left: '114px', top: '30px' })
    expect(screen.getByRole('button', { name: '从下边连接' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从左边连接' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: '从右边连接' }), {
      pointerId: 6, pointerType: 'mouse', button: 0, clientX: 114, clientY: 30,
    })
    fireEvent.pointerUp(window, {
      pointerId: 6, pointerType: 'mouse', button: 0, clientX: 114, clientY: 30,
    })

    expect(hookEditor?.markHistoryStoppingPoint).not.toHaveBeenCalled()
    expect(createShape).not.toHaveBeenCalled()
    expect(createBinding).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getAllByRole('button')[1]!, {
      pointerId: 8, pointerType: 'mouse', button: 0, clientX: 114, clientY: 30,
    })
    fireEvent.pointerMove(window, {
      pointerId: 8, pointerType: 'mouse', button: 0, clientX: 180, clientY: 80,
    })
    fireEvent.pointerUp(window, {
      pointerId: 8, pointerType: 'mouse', button: 0, clientX: 114, clientY: 30,
    })

    expect(hookEditor?.bailToMark).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()

    fireEvent.pointerDown(screen.getAllByRole('button')[1]!, {
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
      meta: { connectedShapeArrow: true },
    }))
    expect(createShape).toHaveBeenCalledWith(expect.objectContaining({
      opacity: 0.5,
      props: expect.objectContaining({ color: 'red', labelColor: 'red', dash: 'solid', size: 'l' }),
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
    expect(updateBinding).not.toHaveBeenCalled()
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

  it('keeps connected arrow anchors unchanged when another shape changes', () => {
    const registerAfterChangeHandler = vi.fn()
    const updateBinding = vi.fn()
    hookEditor = {
      sideEffects: {
        registerBeforeDeleteHandler: vi.fn(() => vi.fn()),
        registerAfterChangeHandler,
      },
      getCurrentPageShapes: vi.fn(() => []),
      updateBinding,
      updateInstanceState: vi.fn(),
    } as never

    render(<CanvasEditor />)
    act(() => {
      mountedProps?.onMount?.(hookEditor)
    })

    expect(registerAfterChangeHandler).not.toHaveBeenCalled()
    expect(updateBinding).not.toHaveBeenCalled()
  })

  it('migrates existing anchored arc arrows to elbow routing on mount', () => {
    const arrow = {
      id: 'shape:legacy-connected-arrow',
      type: 'arrow',
      meta: { connectedShapeArrow: true },
      props: { kind: 'arc' },
    }
    const updateShapes = vi.fn()
    hookEditor = {
      sideEffects: {
        registerBeforeDeleteHandler: vi.fn(() => vi.fn()),
        registerAfterChangeHandler: vi.fn(() => vi.fn()),
      },
      getCurrentPageShapes: vi.fn(() => [arrow]),
      updateShapes,
      updateInstanceState: vi.fn(),
    } as never

    render(<CanvasEditor />)
    act(() => {
      mountedProps?.onMount?.(hookEditor)
    })

    expect(updateShapes).toHaveBeenCalledWith([{
      id: arrow.id,
      type: 'arrow',
      props: { kind: 'elbow' },
    }])
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
    const updateUserPreferences = vi.fn()
    const onEditIntent = vi.fn(() => false)

    render(<CanvasEditor onEditIntent={onEditIntent} />)
    act(() => {
      mountedProps?.onMount?.({ updateInstanceState, user: { updateUserPreferences } })
    })
    fireEvent.keyDown(screen.getByLabelText('白板画布'), { key: 'a' })

    expect(updateUserPreferences).toHaveBeenCalledWith({ isPasteAtCursorMode: true })
    expect(onEditIntent).toHaveBeenCalledTimes(2)
    expect(updateInstanceState).toHaveBeenLastCalledWith({ isReadonly: true })
  })

  it('routes Ctrl+Shift+V through one plain-text paste event and prevents duplicate handling', () => {
    const editor = { updateInstanceState: vi.fn() }
    const onClipboardPaste = vi.fn(() => true)
    render(<CanvasEditor onClipboardPaste={onClipboardPaste} />)
    act(() => {
      mountedProps?.onMount?.(editor)
    })

    const canvas = screen.getByLabelText('白板画布')
    fireEvent.keyDown(canvas, { key: 'v', ctrlKey: true, shiftKey: true })
    const plainPaste = createEvent.paste(canvas, {
      clipboardData: { types: ['text/plain'], getData: () => 'plain text' },
    })
    fireEvent(canvas, plainPaste)

    expect(onClipboardPaste).toHaveBeenLastCalledWith({
      editor,
      event: plainPaste,
      pasteAsPlainText: true,
    })
    expect(plainPaste.defaultPrevented).toBe(true)

    const normalPaste = createEvent.paste(canvas, {
      clipboardData: { types: ['text/plain'], getData: () => 'normal text' },
    })
    fireEvent(canvas, normalPaste)
    expect(onClipboardPaste).toHaveBeenLastCalledWith({
      editor,
      event: normalPaste,
      pasteAsPlainText: false,
    })
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
