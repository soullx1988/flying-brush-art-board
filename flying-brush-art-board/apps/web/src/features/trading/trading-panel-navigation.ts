import type { StoredBoard } from '@infinite-board/board-core'
import type { TradingPanelKind } from '@infinite-board/tldraw-adapter'

const TRADING_TEMPLATE_KEY = 'shortline-trading-v1'

export const TRADING_PANEL_FOCUS_QUERY = 'focusPanel'

const TRADING_PANEL_KINDS = new Set<TradingPanelKind>([
  'today-overview',
  'market-overview',
  'stock-pool',
  'announcements',
  'yishui-inference',
  'system-status',
])

function snapshotStore(snapshot: unknown): Record<string, Record<string, unknown>> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const root = snapshot as { store?: unknown; document?: { store?: unknown } }
  const store = root.store ?? root.document?.store
  if (!store || typeof store !== 'object' || Array.isArray(store)) return {}
  return store as Record<string, Record<string, unknown>>
}

export function parseTradingPanelFocus(value: string | null | undefined): TradingPanelKind | undefined {
  return value && TRADING_PANEL_KINDS.has(value as TradingPanelKind)
    ? value as TradingPanelKind
    : undefined
}

export function boardHasTradingPanel(board: StoredBoard, panelKind: TradingPanelKind): boolean {
  return Object.values(snapshotStore(board.tldrawSnapshot)).some((record) => {
    const props = record.props
    const meta = record.meta
    return record.type === 'trading-panel'
      && typeof props === 'object'
      && props !== null
      && !Array.isArray(props)
      && (props as { panelKind?: unknown }).panelKind === panelKind
      && typeof meta === 'object'
      && meta !== null
      && !Array.isArray(meta)
      && (meta as { template?: unknown }).template === TRADING_TEMPLATE_KEY
  })
}

export function findTradingPanelBoard(
  boards: readonly StoredBoard[],
  panelKind: TradingPanelKind,
): StoredBoard | undefined {
  return boards.find((board) => boardHasTradingPanel(board, panelKind))
}
