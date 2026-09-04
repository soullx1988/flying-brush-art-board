import { T, type RecordProps, type TLShape } from 'tldraw'

export const TRADING_PANEL_SHAPE_TYPE = 'trading-panel' as const

export type TradingPanelKind =
  | 'today-overview'
  | 'market-overview'
  | 'stock-pool'
  | 'announcements'
  | 'yishui-inference'
  | 'system-status'

export interface TradingPanelShapeProps {
  w: number
  h: number
  panelKind: TradingPanelKind
  title: string
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [TRADING_PANEL_SHAPE_TYPE]: TradingPanelShapeProps
  }
}

export type TradingPanelShape = TLShape<typeof TRADING_PANEL_SHAPE_TYPE>

export const tradingPanelShapeProps: RecordProps<TradingPanelShape> = {
  w: T.number,
  h: T.number,
  panelKind: T.literalEnum('today-overview', 'market-overview', 'stock-pool', 'announcements', 'yishui-inference', 'system-status'),
  title: T.string,
}

export const tradingPanelShapeMigrations = { sequence: [] }
