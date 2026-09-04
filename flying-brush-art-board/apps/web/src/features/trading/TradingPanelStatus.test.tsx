import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  TradingPanelContent,
  resolveOperationalState,
  resolveTradingFactState,
  setTradingWorkbenchSnapshotResolver,
  type TradingPanelShape,
  type TradingWorkbenchSnapshot,
} from '@infinite-board/tldraw-adapter'

const shape = {
  props: {
    w: 720,
    h: 420,
    panelKind: 'market-overview',
    title: '市场与题材',
  },
} as TradingPanelShape

const announcementShape = {
  props: {
    ...shape.props,
    panelKind: 'announcements',
    title: '公告与事件',
  },
} as TradingPanelShape

const todayShape = {
  props: {
    ...shape.props,
    panelKind: 'today-overview',
    title: '今天怎么看',
  },
} as TradingPanelShape

const stockPoolShape = {
  props: {
    ...shape.props,
    panelKind: 'stock-pool',
    title: '个人选股池',
  },
} as TradingPanelShape

type DualCycleBoard = NonNullable<TradingWorkbenchSnapshot['dualCycleBoard']>

function snapshot(overrides: Partial<TradingWorkbenchSnapshot> = {}): TradingWorkbenchSnapshot {
  return {
    status: 'ready',
    updatedAt: '2026-08-08T02:05:00.000Z',
    sourceLabel: '07 中短线选股器',
    tradeDate: '2026-08-08',
    sourceGeneratedAt: '2026-08-08T02:00:00.000Z',
    freshUntil: '2099-08-09T02:00:00.000Z',
    availableAt: '2026-08-08T02:01:00.000Z',
    freshness: 'CURRENT',
    sourceHealth: 'CURRENT',
    themes: [{ name: '机器人', heat: 8.2 }],
    stocks: [],
    announcements: [],
    services: [],
    ...overrides,
  }
}

function tradingDates(count: number, start = '2026-01-02'): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  while (dates.length < count) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function sentimentCoverage(count: number): Record<string, number> {
  return {
    breadth: count,
    durability: count,
    height: count,
    priorWinnerFeedback: count,
    lossEffect: count,
    liquidity: count,
    styleFlow: count,
  }
}

function sentimentStatuses(): Record<string, string> {
  return {
    breadth: 'OBSERVED',
    durability: 'OBSERVED',
    height: 'OBSERVED',
    priorWinnerFeedback: 'OBSERVED',
    lossEffect: 'OBSERVED',
    liquidity: 'OBSERVED',
    styleFlow: 'OBSERVED',
  }
}

function createDualCycleBoard(): DualCycleBoard {
  return {
    schemaVersion: 'xzn-dual-cycle-board-contract-v2',
    generatedAt: '2026-08-14T15:30:00.000+08:00',
    displayBoundary: 'READ_ONLY_ATTENTION_BOARD_NO_TRADE_AUTHORITY',
    authorityBoundary: 'ATTENTION_ONLY_NOT_TRADE_PERMISSION',
    sentimentHistory: {
      evaluationAsOf: '2026-08-14T15:20:00.000+08:00',
      status: 'READY',
      contextWindows: {
        TACTICAL_5: {
          windowName: 'TACTICAL_5',
          status: 'READY',
          tradeDates: tradingDates(5),
          dimensionCoverage: sentimentCoverage(5),
          latestHistoricalDimensionStatus: sentimentStatuses(),
        },
        SWING_10: {
          windowName: 'SWING_10',
          status: 'READY',
          tradeDates: tradingDates(10),
          dimensionCoverage: sentimentCoverage(10),
          latestHistoricalDimensionStatus: sentimentStatuses(),
        },
        CYCLE_20: {
          windowName: 'CYCLE_20',
          status: 'READY',
          tradeDates: tradingDates(20),
          dimensionCoverage: sentimentCoverage(20),
          latestHistoricalDimensionStatus: sentimentStatuses(),
        },
        REGIME_60: {
          windowName: 'REGIME_60',
          status: 'READY',
          tradeDates: tradingDates(60),
          dimensionCoverage: sentimentCoverage(60),
          latestHistoricalDimensionStatus: sentimentStatuses(),
        },
        CALIBRATION_120: {
          windowName: 'CALIBRATION_120',
          status: 'READY',
          tradeDates: tradingDates(120),
          dimensionCoverage: sentimentCoverage(120),
          latestHistoricalDimensionStatus: sentimentStatuses(),
        },
        ANNUAL_250: {
          windowName: 'ANNUAL_250',
          status: 'PARTIAL',
          tradeDates: tradingDates(250),
          dimensionCoverage: sentimentCoverage(250),
          latestHistoricalDimensionStatus: sentimentStatuses(),
        },
      },
    },
    sentimentEpisode: {
      evaluationAsOf: '2026-08-14T15:20:00.000+08:00',
      status: 'READY',
      anchor: {
        tradeDate: '2026-08-04',
        observedAt: '2026-08-04T15:05:00.000+08:00',
        nodeStatus: 'CLIMAX',
        eventId: `sha256:${'a'.repeat(64)}`,
      },
      currentNode: 'REPAIR',
      lastIceOrdinal: 2,
      currentIceOrdinal: null,
      iceOccurrences: [
        { ordinal: 1, startTradeDate: '2026-08-06', endTradeDate: '2026-08-07', eventIds: [`sha256:${'b'.repeat(64)}`] },
        { ordinal: 2, startTradeDate: '2026-08-11', endTradeDate: '2026-08-11', eventIds: [`sha256:${'c'.repeat(64)}`] },
      ],
    },
    strategicRegimeHistory: {
      evaluationAsOf: '2026-08-14T15:20:00.000+08:00',
      status: 'READY',
      contextWindows: {
        CYCLE_20: {
          windowName: 'CYCLE_20',
          status: 'READY',
          tradeDates: tradingDates(20),
          latestStates: { environment: 'SUPPORTIVE', profitModelCycle: 'EXPANDING', strategicMainline: 'PRIMARY', relativeDifferentiation: 'STRENGTHENING' },
        },
        REGIME_60: {
          windowName: 'REGIME_60',
          status: 'READY',
          tradeDates: tradingDates(60),
          latestStates: { environment: 'MIXED', profitModelCycle: 'MATURE', strategicMainline: 'SECONDARY', relativeDifferentiation: 'STABLE' },
        },
        CALIBRATION_120: {
          windowName: 'CALIBRATION_120',
          status: 'PARTIAL',
          tradeDates: tradingDates(120),
          latestStates: { environment: 'ADVERSE', profitModelCycle: 'CONTRACTING', strategicMainline: 'ABSENT', relativeDifferentiation: 'WEAKENING' },
        },
      },
    },
    candidateLanes: {
      strategicResearch: [
        {
          candidate: { symbol: '600001', name: '回归股份' },
          firstSeenAt: '2026-08-12T09:25:00.000+08:00',
          firstSeenPrice: 12.34,
          lastObservedAt: '2026-08-14T09:31:00.000+08:00',
          lastSnapshotId: `sha256:${'4'.repeat(64)}`,
          lifecycleRecordHash: `sha256:${'1'.repeat(64)}` ,
          currentAttentionState: 'WATCH_ONLY',
        },
      ],
      tacticalWatch: [
        {
          candidate: { symbol: '600002', name: '节奏股份' },
          firstSeenAt: '2026-08-11T09:25:00.000+08:00',
          firstSeenPrice: 23.45,
          lastObservedAt: '2026-08-14T09:35:00.000+08:00',
          lastSnapshotId: `sha256:${'5'.repeat(64)}`,
          lifecycleRecordHash: `sha256:${'2'.repeat(64)}` ,
          currentAttentionState: 'WAITING_TRIGGER',
        },
      ],
      jointReview: [
        {
          candidate: { symbol: '600003', name: '共振股份' },
          firstSeenAt: '2026-08-10T09:25:00.000+08:00',
          firstSeenPrice: 34.56,
          lastObservedAt: '2026-08-14T09:40:00.000+08:00',
          lastSnapshotId: `sha256:${'6'.repeat(64)}`,
          lifecycleRecordHash: `sha256:${'3'.repeat(64)}` ,
          currentAttentionState: 'PRIORITY_MANUAL_REVIEW',
        },
      ],
    },
    contractRules: {
      scoreAggregationAllowed: false,
      sameSessionCloseFactReuseAllowed: false,
      attentionMayBeRenderedAsParticipation: false,
      uiMayOverrideCoreState: false,
      singleWindowSentimentVerdictAllowed: false,
      uiMayInferIceOrdinal: false,
      uiMayInferStrategicRegime: false,
    },
  }
}

let disposeResolver = () => {}

afterEach(() => {
  cleanup()
  disposeResolver()
  disposeResolver = () => {}
})

describe('TradingPanelContent fact-state shell', () => {
  it('shows the fixed fact metadata and does not turn an SSE connection into LIVE facts', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      revision: 'revision-current',
      transport: { state: 'connected' },
    }))

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getByText('当前快照')).toBeInTheDocument()
    expect(screen.getByText('可核对')).toBeInTheDocument()
    expect(screen.queryByText('CURRENT')).not.toBeInTheDocument()
    expect(screen.getByText('07 中短线选股器')).toBeInTheDocument()
    expect(screen.getByText('源时点')).toBeInTheDocument()
    expect(screen.getByText('更新时点')).toBeInTheDocument()
    expect(screen.getByText('有效截止')).toBeInTheDocument()
    expect(screen.getByText('新鲜度')).toBeInTheDocument()
    expect(screen.getByText('交易日')).toBeInTheDocument()
    expect(screen.getByText('2026-08-08')).toBeInTheDocument()
    expect(screen.getByText(/更新通道：推送已连接/)).toBeInTheDocument()
    expect(screen.queryByText('实时推送')).not.toBeInTheDocument()
    expect(screen.queryByText('实时数据')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps last-good facts visible behind a prominent STALE warning', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      status: 'stale',
      freshness: 'STALE',
      sourceHealth: 'STALE',
      message: '源报告已超过 24 小时',
      transport: { state: 'connected' },
    }))

    const { container } = render(<TradingPanelContent shape={shape} />)

    expect(screen.getAllByText('数据过期').length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent('数据过期')
    expect(screen.getByRole('status')).not.toHaveTextContent('STALE')
    expect(screen.getByRole('status')).toHaveTextContent('源报告已超过 24 小时')
    expect(screen.getByText('机器人')).toBeInTheDocument()
    expect(container.querySelector('.trading-panel')).toHaveAttribute('data-fact-state', 'STALE')
    expect(screen.queryByText('实时推送')).not.toBeInTheDocument()
  })

  it('never presents unavailable data as live even when the transport is connected', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      status: 'unavailable',
      freshness: 'UNKNOWN',
      sourceHealth: 'UNAVAILABLE',
      sourceGeneratedAt: null,
      transport: { state: 'connected' },
      message: 'TRADING_SOURCE_UNAVAILABLE',
    }))

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getAllByText('数据不可用').length).toBeGreaterThan(0)
    expect(screen.getByRole('status')).toHaveTextContent('数据不可用')
    expect(screen.getByRole('status')).not.toHaveTextContent('UNAVAILABLE')
    expect(screen.getAllByText('未提供').length).toBeGreaterThan(0)
    expect(screen.queryByText('实时推送')).not.toBeInTheDocument()
  })

  it('shows last success and last error timestamps for degraded facts', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      status: 'degraded',
      freshness: 'STALE',
      sourceHealth: 'DEGRADED',
      lastSuccessAt: '2026-08-08T01:30:00.000Z',
      lastErrorAt: '2026-08-08T02:04:00.000Z',
      transport: { state: 'reconnecting' },
    }))

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getByText('上次成功')).toBeInTheDocument()
    expect(screen.getByText('最近失败')).toBeInTheDocument()
    expect(screen.getByText(/更新通道：推送重连中/)).toBeInTheDocument()
    expect(screen.queryByText('实时推送')).not.toBeInTheDocument()
  })

  it('labels manual feed entries as an unverified observation instead of official text', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      announcements: [{
        id: 'announcement-manual',
        title: '公司业绩观察',
        summary: '开盘一字强化题材预期，次日观察总锚。',
        epistemicClass: 'human_claim',
        verificationStatus: 'UNVERIFIED',
      }],
    }))

    render(<TradingPanelContent shape={announcementShape} />)

    expect(screen.getByText('公告观察源')).toBeInTheDocument()
    expect(screen.getByText('待核验')).toBeInTheDocument()
    expect(screen.getByText('观察摘要 / 人工解读')).toBeInTheDocument()
    expect(screen.queryByText('公告与事件')).not.toBeInTheDocument()
    expect(screen.queryByText('官方原文证据已核验')).not.toBeInTheDocument()
  })

  it('shows recent sentiment and keeps three fund-flow definitions separate', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      market: {
        environmentVerdict: '只观察',
        nodeVerdict: '混乱',
        limitUpTotal: 106,
        limitDownTotal: 0,
        highestBoardLevel: 4,
        summaryLines: ['指数与涨停扩张，但结构资金样本不完整。'],
        recentSentiment: {
          status: 'PARTIAL',
          windowLabel: '近 3 个交易日',
          headline: '修复 → 分歧 → 混乱；最近一日由分歧转为混乱。',
          currentAssessment: '当前盘后系统标签为“混乱”，环境上限为“只观察”。',
          sessions: [
            { tradeDate: '2026-08-13', nodeVerdict: '修复', environmentVerdict: '可参与', limitUpTotal: 59, limitDownTotal: 2, highestBoardLevel: 5, sentimentStatus: 'READY' },
            { tradeDate: '2026-08-14', nodeVerdict: '分歧', environmentVerdict: '轻参与', limitUpTotal: 63, limitDownTotal: 13, highestBoardLevel: 5, sentimentStatus: 'READY' },
            { tradeDate: '2026-08-17', nodeVerdict: '混乱', environmentVerdict: '只观察', limitUpTotal: 106, limitDownTotal: 0, highestBoardLevel: 4, sentimentStatus: 'PARTIAL' },
          ],
          dimensionCoverage: [
            { key: 'height', label: '连板高度', status: 'READY', detail: '梯队完整，最高 4 板' },
            { key: 'liquidity', label: '市场流动性', status: 'MISSING', detail: '缺同阶段成交额可比基准' },
          ],
          methodBoundary: '这是盘后系统标签趋势，不是义水七维正式节点。',
        },
        recentFundFlow: {
          status: 'PARTIAL',
          headline: '当日板块结构权重为空；不能把历史焦点标签当成当日净流入事实。',
          structuralFlow: {
            status: 'PARTIAL',
            basisLabel: '系统候选结构权重（不是净流入金额）',
            trendSummary: '科技进攻 → 科技进攻 → 权重缺失',
            sessions: [
              { tradeDate: '2026-08-13', status: 'READY', dominantThemeArchetype: '科技进攻', dominantPrototype: '科技修复' },
              { tradeDate: '2026-08-14', status: 'READY', dominantThemeArchetype: '科技进攻', dominantPrototype: '机器人修复' },
              { tradeDate: '2026-08-17', status: 'PARTIAL', dominantThemeArchetype: null, dominantPrototype: null },
            ],
          },
          etfProxy: {
            status: 'READY',
            basisLabel: '宽基ETF份额三日变化代理',
            label: '一级市场赎回占优',
            evidenceDate: '2026-08-14',
            coverage: 5,
            creationCount: 0,
            redemptionCount: 5,
            medianShareChange3dPct: -4.27,
            decisionImpactEligible: false,
            validationStatus: 'REJECTED',
          },
          externalDailyFlow: {
            status: 'STALE',
            basisLabel: '外部主力资金日报',
            asOf: '2026-07-09 18:30:00',
            reportTradeDate: '2026-07-09',
            decisionEligible: false,
            summaryLines: ['资金日报已过期。'],
          },
          methodBoundary: '不同资金口径不混算。',
        },
      },
    }))

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getByText(/修复 → 分歧 → 混乱/)).toBeInTheDocument()
    expect(screen.getByText(/不能把历史焦点标签当成当日净流入事实/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '近期情绪' }))
    expect(screen.getByText('市场情绪变化')).toBeInTheDocument()
    expect(screen.getByText('连板高度')).toBeInTheDocument()
    expect(screen.getByText('缺同阶段成交额可比基准')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '资金流向' }))
    expect(screen.getByText('系统候选结构权重（不是净流入金额）')).toBeInTheDocument()
    expect(screen.getByText('一级市场赎回占优')).toBeInTheDocument()
    expect(screen.getByText('-4.27%')).toBeInTheDocument()
    expect(screen.getByText('不能当近期数据')).toBeInTheDocument()
    expect(screen.getByText('资金日报已过期。')).toBeInTheDocument()
  })

  it('leads with a natural-language participation answer and keeps the full reasoning chain nearby', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      todayOverview: {
        status: 'ready',
        freshness: 'CURRENT',
        sourceHealth: 'CURRENT',
        overallState: 'REVIEW_ONLY',
        currentPhaseLabel: '等待竞价确认',
        canParticipate: false,
        participationSummary: '当前只能复核观察对象，不能形成参与动作。',
        nextKeyTime: '2026-08-08T01:25:00.000Z',
        focusFamily: '科技主线',
        focusSummary: '科技主线连续 3 个交易日占优，今天先看芯片承接。',
        phaseStatus: 'REVIEW_ONLY',
        marketDecision: 'PENDING',
        executionAuthority: 'REVIEW_ONLY',
        summaryLines: ['09:25 只复核冻结观察对象，不允许临时升级执行。'],
        decisionTradeDate: '2026-08-16',
        planTradeDate: '2026-08-17',
        planCount: 2,
        executePlanCount: 0,
        observationPlanCount: 2,
        selectionFunnel: {
          headline: '本轮不是精选出 2 只推荐股：系统召回 76 个盘中异动，冻结 20 个观察对象，正式动作对象 0 个。',
          eligibleObservationCount: 76,
          frozenObservationCount: 20,
          formalCandidateCount: 0,
          displayedCount: 2,
          orderingRule: '首屏先展示不同机会类型和市场分组的代表，再按复核优先级排列；不是涨幅榜、收益榜或推荐顺序。',
        },
        planProjectionMode: 'OVERNIGHT_READ_ONLY',
        planItems: [
          {
            code: '300684',
            name: '中石科技',
            action: '观察',
            tradePattern: '趋势承接',
            planBucket: 'observe',
            themes: ['CPO'],
            roleLabel: '独立趋势观察',
            carrierLabel: '高辨识度连板承载',
            focusReason: '同类未定义，明早不能用相对强弱升级；只核对自身竞价、承接和否决条件。',
            confirmConditions: ['次日09:25行情交易日与时间有效', '开盘首次回踩不破竞价低点'],
            vetoConditions: ['高开后跌破竞价低点且无法修复'],
            branchPlans: { strong: '强开后继续强于同类再复核。', flat: '承接稳定则保留观察。', weak: '掉到同类后排就取消。' },
            branchActions: { strong: '只观察', flat: '只观察', weak: '取消观察' },
            peerComparison: {
              status: 'UNDEFINED',
              label: '同类未定义',
              members: [],
              definition: '必须同时满足：同一主主题、同一涨跌幅制度、同一承载角色，并冻结至少两名成员。',
              strengthRule: '需要09:25竞价与开盘后两个时点的完整同组排序；缺任一项就不判断相对强弱。',
              verdict: '不能判断是否强于同类',
              limitation: '当前冻结预案没有合格比较组，只能看标的自身承接，不能据此升级。',
            },
            relativeStrengthVerdict: '不能判断是否强于同类',
            morningInstruction: '只观察，不参与',
            selectionContext: {
              originLabel: '盘中异动召回',
              statusLabel: '观察池，不是买入名单',
              summary: '它因“高弹性突破异动”被保留到次日复核；这解释的是为什么入池，不代表已经选中参与。',
              supportingFacts: ['日内涨幅 20.00%，约为该市场涨停幅度的 100%', '量比 0.29、换手 1.78%'],
              limitingFacts: ['已封涨停或卖盘为空，当前不可成交', '尚未确认所属主线', '策略EV尚未完成时点校准'],
              orderingBasis: '先保留不同机会类型和市场分组的代表，再按复核优先级排序；不是推荐排名。',
            },
            nextCheck: '次日竞价',
            expectationLevel: 'EV待验证',
            doNotChase: true,
          },
          { code: '920083', name: '金戈新材', action: '观察', tradePattern: '观察池', planBucket: 'observe', themes: ['CPO'] },
        ],
        unattendedAction: '没空时保持不参与，不自动升级任何对象。',
        decisionChain: [
          { id: 'post-close', label: '盘后怎么看', status: 'READY', summary: '科技主线继续占优。' },
          { id: 'freeze', label: '冻结了什么', status: 'REVIEW_ONLY', summary: '只冻结观察对象。' },
          { id: 'auction', label: '竞价怎么变', status: 'PENDING', summary: '等待 09:25 复核。' },
          { id: 'permission', label: '最后怎么处理', status: 'BLOCKED', summary: '当前不能参与。' },
        ],
        changes: [{ id: 'authority', label: '参与边界', summary: '从预案观察收紧为当前不参与。' }],
        evidenceRefs: [{ id: 'freeze-a', label: '冻结预案', kind: 'freeze', sha256: 'sha256:1234567890abcdef' }],
        auction: {
          status: 'READY',
          leader: {
            code: '600601',
            name: '方正科技',
            auctionChangePct: 9.98,
            sealAmountCny: 125000000,
          },
        },
      },
    }))

    render(<TradingPanelContent shape={todayShape} />)

    expect(screen.getByText('今天怎么看')).toBeInTheDocument()
    expect(screen.getAllByText('科技主线')).toHaveLength(2)
    expect(screen.getByText('现在能不能参与')).toBeInTheDocument()
    expect(screen.getByText('不能参与')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '深入查看' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '市场情绪' })).toHaveAttribute('href', expect.stringContaining('board-e3d3579e-3ddd-4d62-9bb2-3a991319ff0b'))
    expect(screen.getAllByRole('link', { name: '查看完整理由与同类' })).toHaveLength(2)
    expect(screen.getByText('当前只能复核观察对象，不能形成参与动作。')).toBeInTheDocument()
    expect(screen.getAllByText('等待竞价确认').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('region', { name: '明日候选解释与预案' })).toBeInTheDocument()
    expect(screen.getByText('0 个正式候选 · 2 个观察对象')).toBeInTheDocument()
    expect(screen.getByText('为什么系统留下这些对象')).toBeInTheDocument()
    expect(screen.getByText(/系统召回 76 个盘中异动/)).toBeInTheDocument()
    expect(screen.getAllByText('盘中异动召回').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('观察池，不是买入名单')).toBeInTheDocument()
    expect(screen.getAllByText('为什么入池')).toHaveLength(2)
    expect(screen.getAllByText('为什么不能参与')).toHaveLength(2)
    expect(screen.getByText(/高弹性突破异动/)).toBeInTheDocument()
    expect(screen.getByText('已封涨停或卖盘为空，当前不可成交')).toBeInTheDocument()
    expect(screen.getByText('中石科技')).toBeInTheDocument()
    expect(screen.getByText('金戈新材')).toBeInTheDocument()
    expect(screen.getAllByText('看到这些才继续观察')).toHaveLength(2)
    expect(screen.getByText('次日09:25行情交易日与时间有效')).toBeInTheDocument()
    expect(screen.getAllByText('出现任一就放弃')).toHaveLength(2)
    expect(screen.queryByText('相对强弱')).not.toBeInTheDocument()
    expect(screen.queryByText('不能判断是否强于同类')).not.toBeInTheDocument()
    expect(screen.queryByText('开盘分支只决定是否提交人工复核，不是自动买点')).not.toBeInTheDocument()
    expect(screen.getAllByText('明日怎么验证')).toHaveLength(2)
    expect(screen.getByText(/只核对自身竞价、承接和否决条件/)).toBeInTheDocument()
    expect(screen.getByText('这轮判断怎么来的')).toBeInTheDocument()
    expect(screen.getByText('冻结了什么')).toBeInTheDocument()
    expect(screen.getByText('从上一步到现在')).toBeInTheDocument()
    expect(screen.getByText('没空时保持不参与，不自动升级任何对象。')).toBeInTheDocument()
    expect(screen.getByText('冻结预案')).toBeInTheDocument()
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument()
    expect(screen.queryByText('REVIEW_ONLY')).not.toBeInTheDocument()
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument()
  })

  it('keeps every evidence item available and opens the detail popup', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      todayOverview: {
        status: 'ready',
        freshness: 'CURRENT',
        sourceHealth: 'CURRENT',
        evidenceRefs: [
          { id: 'report', label: '盘后报告', kind: 'immutable_report', sha256: `sha256:${'1'.repeat(64)}` },
          { id: 'freeze', label: '冻结计划', kind: 'freeze_manifest', sha256: `sha256:${'2'.repeat(64)}` },
          { id: 'stage', label: '阶段产物', kind: 'stage_archive', sha256: `sha256:${'3'.repeat(64)}` },
          { id: 'auction', label: '09:25竞价事实', kind: 'auction_facts', sha256: `sha256:${'4'.repeat(64)}` },
        ],
      },
    }))

    render(<TradingPanelContent shape={todayShape} />)

    fireEvent.click(screen.getByRole('button', { name: '打开全部（4）' }))
    const dialog = screen.getByRole('dialog', { name: '这轮判断的全部依据' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4)
    expect(within(dialog).getByText('09:25竞价事实')).toBeInTheDocument()
    expect(within(dialog).getByText('共 4 项，按判断链路顺序排列')).toBeInTheDocument()
  })

  it('keeps the four readonly data panels under the same degraded fact shell', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      status: 'degraded',
      freshness: 'STALE',
      sourceHealth: 'DEGRADED',
      message: 'TRADING_SOURCE_PARTIAL_REFRESH',
      lastSuccessAt: '2026-08-08T01:30:00.000Z',
      lastErrorAt: '2026-08-08T02:04:00.000Z',
      stocks: [{ code: '600001', name: '回归股份', score: 91.2 }],
      announcements: [{
        id: 'announcement-a',
        title: '回归公告',
        summary: '等待后台补齐正文。',
        epistemicClass: 'human_claim',
        verificationStatus: 'UNVERIFIED',
      }],
      services: [{ name: '桥接服务', status: 'DEGRADED', detail: '正在分批补齐' }],
    }))

    const { container } = render(
      <div>
        <TradingPanelContent shape={shape} />
        <TradingPanelContent shape={{ ...shape, props: { ...shape.props, panelKind: 'stock-pool', title: '个人选股池' } } as TradingPanelShape} />
        <TradingPanelContent shape={announcementShape} />
        <TradingPanelContent shape={{ ...shape, props: { ...shape.props, panelKind: 'system-status', title: '数据源与生产就绪状态' } } as TradingPanelShape} />
      </div>,
    )

    expect(container.querySelectorAll('.trading-panel[data-fact-state="DEGRADED"]')).toHaveLength(4)
    expect(screen.getAllByRole('status')).toHaveLength(4)
    expect(screen.getByText('回归股份')).toBeInTheDocument()
    expect(screen.getByText('600001')).toBeInTheDocument()
    expect(screen.getByText('回归公告')).toBeInTheDocument()
    expect(screen.getByText('桥接服务')).toBeInTheDocument()
  })
})

describe('TradingPanelContent dual cycle board', () => {
  it('renders the readonly dual-cycle market board with six windows, the event chain and three strategic windows', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      dualCycleBoard: createDualCycleBoard(),
    }))

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getByText('双周期观察画板')).toBeInTheDocument()
    expect(screen.getByText('只读关注画板')).toBeInTheDocument()
    expect(screen.getByText('只作关注，不构成交易许可')).toBeInTheDocument()
    expect(screen.getAllByText('就绪').length).toBeGreaterThan(0)
    expect(screen.getAllByText('部分就绪').length).toBeGreaterThan(0)
    expect(screen.getByText('义水情绪六镜头')).toBeInTheDocument()
    expect(screen.getByText('5日镜头')).toBeInTheDocument()
    expect(screen.getByText('10日镜头')).toBeInTheDocument()
    expect(screen.getByText('20日镜头')).toBeInTheDocument()
    expect(screen.getByText('60日镜头')).toBeInTheDocument()
    expect(screen.getByText('120日镜头')).toBeInTheDocument()
    expect(screen.getByText('250日镜头')).toBeInTheDocument()
    expect(screen.getByText('情绪事件链')).toBeInTheDocument()
    expect(screen.getByText('高潮锚点')).toBeInTheDocument()
    expect(screen.getByText('第 1 次冰点')).toBeInTheDocument()
    expect(screen.getByText('第 2 次冰点')).toBeInTheDocument()
    expect(screen.getByText('模型先生战略历史')).toBeInTheDocument()
    expect(screen.getByText('20日战略镜头')).toBeInTheDocument()
    expect(screen.getByText('60日战略镜头')).toBeInTheDocument()
    expect(screen.getByText('120日战略镜头')).toBeInTheDocument()
  })

  it('renders the three candidate lanes with lifecycle fields in the stock pool panel', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      dualCycleBoard: createDualCycleBoard(),
    }))

    render(<TradingPanelContent shape={stockPoolShape} />)

    expect(screen.getByText('候选泳道')).toBeInTheDocument()
    expect(screen.getByText('战略研究')).toBeInTheDocument()
    expect(screen.getByText('战术观察')).toBeInTheDocument()
    expect(screen.getByText('联合复核')).toBeInTheDocument()
    expect(screen.getByText('回归股份')).toBeInTheDocument()
    expect(screen.getByText('节奏股份')).toBeInTheDocument()
    expect(screen.getByText('共振股份')).toBeInTheDocument()
    expect(screen.getAllByText(/首次发现：/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/首次价格：/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/最近观察：/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/最近快照哈希：/).length).toBeGreaterThan(0)
  })

  it('fails closed when any contract rule is enabled and does not render business content', () => {
    const board = createDualCycleBoard()
    board.contractRules!.uiMayInferIceOrdinal = true
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      dualCycleBoard: board,
    }))

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getByText('核心契约不可用')).toBeInTheDocument()
    expect(screen.queryByText('义水情绪六镜头')).not.toBeInTheDocument()
    expect(screen.queryByText('模型先生战略历史')).not.toBeInTheDocument()
    expect(screen.queryByText('机器人')).not.toBeInTheDocument()
  })

  it('does not render score, action advice or participation copy inside the v2 market and candidate panels', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      dualCycleBoard: createDualCycleBoard(),
    }))

    render(
      <div>
        <TradingPanelContent shape={shape} />
        <TradingPanelContent shape={stockPoolShape} />
      </div>,
    )

    expect(screen.queryByText('综合分')).not.toBeInTheDocument()
    expect(screen.queryByText('动作建议')).not.toBeInTheDocument()
    expect(screen.queryByText('参与许可')).not.toBeInTheDocument()
  })

  it('keeps the legacy market panel unchanged when dualCycleBoard is absent', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot())

    render(<TradingPanelContent shape={shape} />)

    expect(screen.getByText('机器人')).toBeInTheDocument()
    expect(screen.queryByText('双周期观察画板')).not.toBeInTheDocument()
    expect(screen.queryByText('义水情绪六镜头')).not.toBeInTheDocument()
  })

  it('adds the readonly dual-cycle note to today-overview without overriding the 06 participation answer', () => {
    disposeResolver = setTradingWorkbenchSnapshotResolver(() => snapshot({
      dualCycleBoard: createDualCycleBoard(),
      todayOverview: {
        status: 'ready',
        freshness: 'CURRENT',
        sourceHealth: 'CURRENT',
        overallState: 'REVIEW_ONLY',
        canParticipate: false,
        participationSummary: '当前只能复核观察对象，不能形成参与动作。',
        currentPhaseLabel: '等待竞价确认',
      },
    }))

    render(<TradingPanelContent shape={todayShape} />)

    expect(screen.getByText('双周期核心只提供关注与人工复核，不产生参与许可')).toBeInTheDocument()
    expect(screen.getByText('当前只能复核观察对象，不能形成参与动作。')).toBeInTheDocument()
    expect(screen.getByText('不能参与')).toBeInTheDocument()
  })
})

describe('trading fact-state resolution', () => {
  it('covers all source, transport and authority states without relying on color', () => {
    expect(resolveTradingFactState(snapshot({ transport: { state: 'connected' } }))).toBe('CURRENT')
    expect(resolveTradingFactState(snapshot({ deliveryMode: 'LIVE', transport: { state: 'connected' } }))).toBe('LIVE')
    expect(resolveTradingFactState(snapshot({ transport: { state: 'connecting' } }))).toBe('CURRENT')
    expect(resolveTradingFactState(snapshot({ transport: { state: 'fallback' } }))).toBe('CURRENT')
    expect(resolveTradingFactState(snapshot({ freshUntil: null }))).toBe('CURRENT')
    expect(resolveTradingFactState(snapshot({ freshUntil: '2000-01-01T00:00:00.000Z' }))).toBe('CURRENT')
    expect(resolveOperationalState('DELAYED')).toBe('DELAYED')
    expect(resolveTradingFactState(snapshot({ status: 'stale', freshness: 'STALE' }))).toBe('STALE')
    expect(resolveTradingFactState(snapshot({ status: 'degraded', sourceHealth: 'DEGRADED' }))).toBe('DEGRADED')
    expect(resolveTradingFactState(undefined)).toBe('UNAVAILABLE')
    expect(resolveOperationalState('BLOCKED')).toBe('BLOCKED')
    expect(resolveOperationalState('disabled')).toBe('disabled')
  })
})
