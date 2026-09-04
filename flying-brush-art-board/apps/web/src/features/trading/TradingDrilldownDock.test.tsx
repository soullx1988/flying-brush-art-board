import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  setTradingWorkbenchSnapshotResolver,
  type TradingWorkbenchSnapshot,
} from '@infinite-board/tldraw-adapter'

import { TradingDrilldownDock, TRADING_DRILLDOWN_BOARD_IDS } from './TradingDrilldownDock'

let disposeResolver = () => {}

function snapshot(): TradingWorkbenchSnapshot {
  return {
    status: 'degraded',
    updatedAt: '2026-08-18T06:00:30.000Z',
    sourceLabel: '06 交易工作台',
    sourceHash: 'sha256:current',
    tradeDate: '2026-08-18',
    sourceGeneratedAt: '2026-08-18T06:00:20.000Z',
    freshUntil: '2026-08-18T06:05:20.000Z',
    todayOverview: { participationSummary: '事实不完整，只允许观察。' },
    themes: [],
    stocks: [],
    announcements: [],
    services: [],
    drilldowns: {
      meta: {
        tradeDate: '2026-08-18',
        phase: 'intraday_discovery',
        dataAsOf: '2026-08-18T14:00:20+08:00',
        validUntil: '2026-08-18T14:05:20+08:00',
        factUsability: 'PARTIAL',
        actionCeiling: 'WATCH_ONLY',
        canParticipate: false,
        permissionSummary: '事实不完整，只允许观察。',
      },
      marketSentiment: {
        nodeStatus: 'UNKNOWN',
        headline: '七维中 2 维已完整观察，5 维仍缺事实。',
        dimensions: [
          { key: 'breadth', label: '市场广度', status: 'OBSERVED', summary: '上涨 3200 · 下跌 1700' },
          { key: 'durability', label: '封板质量', status: 'MISSING', summary: '该维度尚无完整可比事实。' },
        ],
        history: [],
        methodBoundary: '维度不齐时保持 UNKNOWN。',
      },
      candidates: {
        count: 1,
        boundary: '进入复核通道不等于可以买。',
        items: [{
          code: '000001',
          name: '测试股份',
          originLabel: '盘中量价异动召回',
          statusLabel: '人工复核通道，不是买入名单',
          selectionSummary: '因量价异动进入复核。',
          supportingFacts: ['放量且位于均价线上方'],
          limitingFacts: ['尚未确认主线归属'],
          currentExecution: { state: 'BLOCKED', eligible: false },
          quote: { currentPrice: 10.5, priceChangePct: 5 },
          peerComparison: { label: '同类未冻结', definition: '同主题、同制度、相近流动性。' },
          confirmConditions: ['主线进入双向竞争前列'],
          vetoConditions: ['跌破均价线且无法修复'],
        }],
      },
    },
  }
}

afterEach(() => {
  cleanup()
  disposeResolver()
  disposeResolver = () => {}
  window.history.replaceState({}, '', '/')
})

describe('TradingDrilldownDock', () => {
  it('renders sentiment dimensions with the shared permission ceiling', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(snapshot)
    render(<TradingDrilldownDock boardId={TRADING_DRILLDOWN_BOARD_IDS.sentiment} />)

    expect(screen.getByRole('heading', { name: '市场情绪' })).toBeInTheDocument()
    expect(screen.getByText('当前不能定节点')).toBeInTheDocument()
    expect(screen.getByText('市场广度')).toBeInTheDocument()
    expect(screen.getByText('只观察')).toBeInTheDocument()
    expect(screen.queryByText('WATCH_ONLY')).not.toBeInTheDocument()
  })

  it('explains why a candidate is visible and warns when the link is from an old snapshot', () => {
    window.history.replaceState({}, '', '/?symbol=000001&snapshot=sha256%3Aold')
    disposeResolver = setTradingWorkbenchSnapshotResolver(snapshot)
    render(<TradingDrilldownDock boardId={TRADING_DRILLDOWN_BOARD_IDS.candidate} />)

    expect(screen.getByRole('heading', { name: /测试股份/ })).toBeInTheDocument()
    expect(screen.getByText('为什么出现它')).toBeInTheDocument()
    expect(screen.getByText('尚未确认主线归属')).toBeInTheDocument()
    expect(screen.getAllByText('当前不参与').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument()
    expect(screen.queryByText('WATCH_ONLY')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('链接来自旧快照')
  })

  it('describes an overnight blocked candidate as waiting for today auction confirmation', () => {
    const value = snapshot()
    value.todayOverview = { ...value.todayOverview, currentPhase: 'us_close' }
    if (value.drilldowns?.meta) value.drilldowns.meta.phase = 'us_close'
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => value)

    render(<TradingDrilldownDock boardId={TRADING_DRILLDOWN_BOARD_IDS.candidate} />)

    expect(screen.getAllByText('等待今日竞价确认').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument()
  })
})
