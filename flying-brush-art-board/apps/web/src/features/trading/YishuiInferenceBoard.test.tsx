import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  TradingPanelContent,
  YishuiInferenceBoard,
  setTradingWorkbenchSnapshotResolver,
  validateYishuiInferenceBoard,
  type TradingPanelShape,
  type TradingWorkbenchSnapshot,
  type YishuiInferenceBoardContract,
} from '@infinite-board/tldraw-adapter'

const SNAPSHOT_ID = `sha256:${'a'.repeat(64)}`
const REQUEST_FINGERPRINT = `sha256:${'b'.repeat(64)}`
const ARCHIVE_HASH = `sha256:${'c'.repeat(64)}`
const CONSTITUENT_HASH = `sha256:${'d'.repeat(64)}`
const TARGET_SNAPSHOT_ID = `sha256:${'e'.repeat(64)}`
const TARGET_REQUEST_FINGERPRINT = `sha256:${'f'.repeat(64)}`

function createBoard(): YishuiInferenceBoardContract {
  return {
    schemaVersion: 'xzn-yishui-inference-board-v1',
    mode: 'HISTORICAL_REPLAY',
    generatedAt: '2026-09-01T14:20:30+08:00',
    dataAsOf: '2026-09-01T14:20:12+08:00',
    validUntil: '2026-09-01T14:25:12+08:00',
    factEnvelopeRef: {
      requestFingerprint: REQUEST_FINGERPRINT,
      snapshotId: SNAPSHOT_ID,
    },
    sourceStageRef: {
      tradeDate: '2026-09-01',
      phase: 'intraday-discovery',
      archiveSha256: ARCHIVE_HASH,
    },
    factUsability: 'PARTIAL',
    actionCeiling: 'WATCH_ONLY',
    marketNode: {
      status: 'UNKNOWN',
      label: '后端冻结：暂不能定节点',
      summary: '七个观察维度已逐项记录，但比较证据仍不足。',
      dimensions: [
        { key: 'breadth', label: '涨跌广度', status: 'OBSERVED', summary: '广度数据已到。', evidenceRefIds: ['market-frame'] },
        { key: 'durability', label: '封板持续性', status: 'OBSERVED', summary: '持续性数据已到。', evidenceRefIds: ['market-frame'] },
        { key: 'height', label: '连板高度', status: 'OBSERVED', summary: '梯队数据已到。', evidenceRefIds: ['market-frame'] },
        { key: 'priorWinnerFeedback', label: '昨日强势反馈', status: 'OBSERVED', summary: '反馈数据已到。', evidenceRefIds: ['market-frame'] },
        { key: 'lossEffect', label: '亏钱效应', status: 'OBSERVED', summary: '亏钱效应已到。', evidenceRefIds: ['market-frame'] },
        { key: 'liquidity', label: '成交与流动性', status: 'OBSERVED', summary: '成交数据已到。', evidenceRefIds: ['market-frame'] },
        { key: 'styleFlow', label: '板块与风格', status: 'PARTIAL', summary: '板块比较仍缺领先证据。', evidenceRefIds: ['sector-frame'] },
      ],
      support: [{ text: '市场广度仍偏正。', evidenceRefIds: ['market-frame'] }],
      counterEvidence: [{ text: '跌停数边际上升。', evidenceRefIds: ['market-frame'] }],
    },
    sectorStructure: {
      status: 'UNRESOLVED',
      summary: '先按成分口径拆分，暂不强行合并成一条主线。',
      lines: [
        {
          lineId: 'line-b',
          label: 'B线（后端第一项）',
          status: 'PLAUSIBLE',
          sectorRefs: [{
            normalizedName: '种业',
            taxonomyRef: 'tdx-wenda:INDUSTRY-sector',
            constituentSetRef: CONSTITUENT_HASH,
            sourceSnapshotId: SNAPSHOT_ID,
          }],
          sharedMembers: [{ code: '000001', name: '共享样本' }],
          uniqueMemberSummary: '保留种业独有成分。',
          thesis: '这一线可能由农业成分共同驱动。',
          counterEvidence: '拿掉共享样本后强度下降。',
          evidenceRefIds: ['sector-frame'],
        },
        {
          lineId: 'line-a',
          label: 'A线（后端第二项）',
          status: 'UNRESOLVED',
          sectorRefs: [{
            normalizedName: '数字媒体',
            taxonomyRef: 'tdx-wenda:INDUSTRY-sector',
            constituentSetRef: CONSTITUENT_HASH,
            sourceSnapshotId: SNAPSHOT_ID,
          }],
          sharedMembers: [],
          uniqueMemberSummary: '数字媒体独有成分尚未形成一致反馈。',
          thesis: '先作为独立方向观察。',
          counterEvidence: '缺少领先与跟随时序。',
          evidenceRefIds: ['sector-frame'],
        },
      ],
      relations: [{
        fromLineId: 'line-b',
        toLineId: 'line-a',
        relationType: 'SPLIT',
        summary: '成分口径和价格反馈不同，暂时拆开。',
        evidenceRefIds: ['sector-frame'],
      }],
      antiSelfDeceptionTests: [{
        testId: 'remove-shared-members',
        label: '移除共享成分再看',
        status: 'FAILED',
        summary: '移除后共同强度不再成立。',
        evidenceRefIds: ['sector-frame'],
      }],
    },
    roleNodes: [{
      code: '000001',
      name: '角色样本',
      targetFactEnvelopeRef: {
        requestFingerprint: TARGET_REQUEST_FINGERPRINT,
        snapshotId: TARGET_SNAPSHOT_ID,
      },
      structureRole: 'UNCLASSIFIED',
      initiativeRole: 'UNKNOWN',
      marketFunctions: ['UNKNOWN'],
      tradability: 'OBSERVABLE',
      summary: '身份可观察，但当前不能定龙头或带动者。',
      evidenceRefIds: ['sector-frame'],
      counterEvidence: ['缺少个股先动、同组后跟的连续证据。'],
    }],
    branches: [{
      branchId: 'branch-1',
      label: '方向继续分化',
      status: 'FROZEN',
      hypothesis: '农业线保持承接，科技线继续独立。',
      trigger: ['下一可比帧仍显示两组不同步。', '农业线独有成分保持承接。'],
      invalidation: ['两组在完整成分口径下同步扩张。'],
      deadline: '2026-09-01T14:25:00+08:00',
      sourceSnapshotId: SNAPSHOT_ID,
      evidenceRefIds: ['sector-frame'],
    }],
    previousSettlement: {
      status: 'UNAVAILABLE',
      summary: 'Phase 1 还没有合规的上轮结算样本。',
      confirmed: [],
      falsified: [],
      unresolved: [],
    },
    evidenceRefs: [
      { refId: 'market-frame', label: '全市场事实帧', sourcePath: 'daily_pipeline/runs/market.json', sourceSnapshotId: SNAPSHOT_ID },
      { refId: 'sector-frame', label: '板块成分事实', sourcePath: 'daily_pipeline/runs/sectors.json', sourceSnapshotId: SNAPSHOT_ID },
    ],
    missing: [{ code: 'CAUSAL_LEADERSHIP_MISSING', summary: '个股因果带动证据缺失', impact: '个股主动性和市场功能保持未知。' }],
    contractRules: {
      uiMayInfer: false,
      uiMayRankSectors: false,
      uiMayAssignRoles: false,
      uiMayConvertBranchToTrade: false,
    },
  }
}

function createSnapshot(board: YishuiInferenceBoardContract | undefined): TradingWorkbenchSnapshot {
  return {
    status: 'ready',
    updatedAt: '2026-09-01T14:20:31+08:00',
    tradeDate: '2026-09-01',
    sourceLabel: '06 交易工作台',
    sourceGeneratedAt: '2026-09-01T14:20:30+08:00',
    availableAt: '2026-09-01T14:20:31+08:00',
    freshUntil: '2099-09-01T14:25:12+08:00',
    freshness: 'CURRENT',
    sourceHealth: 'CURRENT',
    themes: [],
    stocks: [],
    announcements: [],
    services: [],
    ...(board ? { yishuiInferenceBoard: board } : {}),
  }
}

const inferenceShape = {
  props: {
    w: 1100,
    h: 820,
    panelKind: 'yishui-inference',
    title: '不会采用这个旧标题',
  },
} as unknown as TradingPanelShape

afterEach(() => cleanup())

describe('Yishui inference contract', () => {
  it('accepts the exact read-only contract', () => {
    const validation = validateYishuiInferenceBoard(createBoard())
    expect(validation.mode).toBe('valid')
  })

  it('fails closed when an extra field or a write boundary appears', () => {
    const invalid = {
      ...createBoard(),
      tradeAction: 'BUY',
    }
    const validation = validateYishuiInferenceBoard(invalid)
    expect(validation.mode).toBe('invalid')
    if (validation.mode === 'invalid') expect(validation.reasonCodes).toContain('board:KEYS_MISMATCH')
  })

  it('rejects a replay generated after the original fact window closed', () => {
    const replay = {
      ...createBoard(),
      generatedAt: '2026-09-01T14:25:13+08:00',
    }
    const validation = validateYishuiInferenceBoard(replay)
    expect(validation.mode).toBe('invalid')
    if (validation.mode === 'invalid') expect(validation.reasonCodes).toContain('generatedAt:AFTER_VALID_UNTIL')
  })

  it('requires all seven dimensions in the fixed Phase 1 order', () => {
    const invalid = createBoard()
    ;[invalid.marketNode.dimensions[0], invalid.marketNode.dimensions[1]] = [
      invalid.marketNode.dimensions[1]!,
      invalid.marketNode.dimensions[0]!,
    ]
    const validation = validateYishuiInferenceBoard(invalid)
    expect(validation.mode).toBe('invalid')
    if (validation.mode === 'invalid') {
      expect(validation.reasonCodes).toContain('marketNode.dimensions[0].key:DIMENSION_ORDER_INVALID')
      expect(validation.reasonCodes).toContain('marketNode.dimensions[1].key:DIMENSION_ORDER_INVALID')
    }
  })

  it('rejects empty sector identities, duplicate ids, and self-relations', () => {
    const invalid = createBoard()
    invalid.sectorStructure.lines[0]!.sectorRefs = []
    invalid.sectorStructure.lines[1]!.lineId = invalid.sectorStructure.lines[0]!.lineId
    invalid.sectorStructure.relations[0]!.toLineId = invalid.sectorStructure.relations[0]!.fromLineId
    invalid.sectorStructure.antiSelfDeceptionTests.push(structuredClone(invalid.sectorStructure.antiSelfDeceptionTests[0]!))
    invalid.roleNodes.push(structuredClone(invalid.roleNodes[0]!))
    invalid.branches.push(structuredClone(invalid.branches[0]!))

    const validation = validateYishuiInferenceBoard(invalid)
    expect(validation.mode).toBe('invalid')
    if (validation.mode === 'invalid') {
      expect(validation.reasonCodes).toContain('sectorStructure.lines[0].sectorRefs:NON_EMPTY_ARRAY_REQUIRED')
      expect(validation.reasonCodes).toContain('sectorStructure.lines[1].lineId:DUPLICATE')
      expect(validation.reasonCodes).toContain('sectorStructure.relations[0]:SELF_RELATION_FORBIDDEN')
      expect(validation.reasonCodes).toContain('sectorStructure.antiSelfDeceptionTests[1].testId:DUPLICATE')
      expect(validation.reasonCodes).toContain('roleNodes[1].code:DUPLICATE')
      expect(validation.reasonCodes).toContain('branches[1].branchId:DUPLICATE')
    }
  })

  it('accepts a real partial settlement and renders falsified and unresolved branches', () => {
    const partial = createBoard()
    partial.previousSettlement = {
      status: 'PARTIAL',
      summary: '上一轮已有 1 条分支结算，另有 2 条因当前直接证据不足而保留。',
      confirmed: [],
      falsified: ['强势结构失效（structure-fails）'],
      unresolved: [
        '强线继续扩散（strong-line-spreads）',
        '前排抱团、后排继续分化（front-strong-back-weak）',
      ],
    }

    expect(validateYishuiInferenceBoard(partial).mode).toBe('valid')
    render(<YishuiInferenceBoard value={partial} />)
    expect(screen.getByText('证伪')).toBeInTheDocument()
    expect(screen.getByText('强势结构失效（structure-fails）')).toBeInTheDocument()
    expect(screen.getByText('未解决')).toBeInTheDocument()
    expect(screen.getByText('强线继续扩散（strong-line-spreads）')).toBeInTheDocument()
    expect(screen.getByText('前排抱团、后排继续分化（front-strong-back-weak）')).toBeInTheDocument()

    const available = structuredClone(partial)
    available.previousSettlement = {
      status: 'AVAILABLE',
      summary: '上一轮 3 条分支已全部用当前帧结算。',
      confirmed: ['强线继续扩散（strong-line-spreads）'],
      falsified: [
        '前排抱团、后排继续分化（front-strong-back-weak）',
        '强势结构失效（structure-fails）',
      ],
      unresolved: [],
    }
    expect(validateYishuiInferenceBoard(available).mode).toBe('valid')
  })

  it('keeps previous settlement exact and rejects unavailable rows, invalid strings, duplicates, and unknown states', () => {
    const unavailableWithRows = createBoard()
    unavailableWithRows.previousSettlement.confirmed.push('不应有的结算')
    const unavailableValidation = validateYishuiInferenceBoard(unavailableWithRows)
    expect(unavailableValidation.mode).toBe('invalid')
    if (unavailableValidation.mode === 'invalid') {
      expect(unavailableValidation.reasonCodes).toContain('previousSettlement:UNAVAILABLE_MUST_BE_EMPTY')
    }

    const malformed = createBoard() as unknown as {
      previousSettlement: Record<string, unknown> & {
        status: string
        confirmed: unknown[]
        falsified: unknown[]
        unresolved: unknown[]
      }
    }
    malformed.previousSettlement.status = 'SETTLED'
    malformed.previousSettlement.confirmed = ['重复分支', ' ']
    malformed.previousSettlement.falsified = ['重复分支']
    malformed.previousSettlement.extra = true
    const malformedValidation = validateYishuiInferenceBoard(malformed)
    expect(malformedValidation.mode).toBe('invalid')
    if (malformedValidation.mode === 'invalid') {
      expect(malformedValidation.reasonCodes).toContain('previousSettlement:KEYS_MISMATCH')
    }

    delete malformed.previousSettlement.extra
    const strictValidation = validateYishuiInferenceBoard(malformed)
    expect(strictValidation.mode).toBe('invalid')
    if (strictValidation.mode === 'invalid') {
      expect(strictValidation.reasonCodes).toContain('previousSettlement.status:ENUM_INVALID')
      expect(strictValidation.reasonCodes).toContain('previousSettlement.confirmed[1]:STRING_REQUIRED')
      expect(strictValidation.reasonCodes).toContain('previousSettlement.falsified[0]:DUPLICATE')
    }
  })

  it('requires a separate valid target FactEnvelope identity for every role node', () => {
    const invalid = createBoard()
    invalid.roleNodes[0]!.targetFactEnvelopeRef.snapshotId = 'not-a-sha256'

    const validation = validateYishuiInferenceBoard(invalid)
    expect(validation.mode).toBe('invalid')
    if (validation.mode === 'invalid') {
      expect(validation.reasonCodes).toContain('roleNodes[0].targetFactEnvelopeRef.snapshotId:SHA256_INVALID')
    }
  })
})

describe('Yishui inference panel', () => {
  it('never presents a historical replay as a current outer panel fact', () => {
    const restore = setTradingWorkbenchSnapshotResolver(() => createSnapshot(createBoard()))
    try {
      const { container } = render(<TradingPanelContent shape={inferenceShape} />)
      expect(container.querySelector('[data-panel-kind="yishui-inference"]'))
        .toHaveAttribute('data-fact-state', 'HISTORICAL_REPLAY')
      expect(container.querySelector('.trading-panel__state-badge'))
        .toHaveAttribute('data-state', 'HISTORICAL_REPLAY')
      expect(screen.getByText('义水北路不可变历史推演')).toBeInTheDocument()
      expect(screen.getByText('历史回放')).toBeInTheDocument()
      expect(screen.getByText('仅用于复盘')).toBeInTheDocument()
      expect(screen.getByText('历史回放（不作当前行情）')).toBeInTheDocument()
      expect(screen.getByText('历史回放 · 仅用于复盘')).toBeInTheDocument()
      expect(screen.getAllByText('当时有效至')).toHaveLength(2)
      expect(screen.queryByText('有效截止')).not.toBeInTheDocument()
      expect(screen.queryByText('数据过期')).not.toBeInTheDocument()
      expect(screen.queryByText('不作当前依据')).not.toBeInTheDocument()
      expect(container.querySelector('.trading-panel__state-overlay')).toBeNull()
    } finally {
      restore()
    }
  })

  it('still fails closed as stale when a CURRENT board is past validUntil', () => {
    const board = createBoard()
    board.mode = 'CURRENT'
    const restore = setTradingWorkbenchSnapshotResolver(() => createSnapshot(board))
    try {
      const { container } = render(<TradingPanelContent shape={inferenceShape} />)
      expect(container.querySelector('[data-panel-kind="yishui-inference"]'))
        .toHaveAttribute('data-fact-state', 'STALE')
      expect(container.querySelector('.trading-panel__state-badge'))
        .toHaveAttribute('data-state', 'STALE')
      expect(container.querySelector('.trading-panel__state-overlay'))
        .toHaveAttribute('data-state', 'STALE')
      expect(screen.getByText('数据过期')).toBeInTheDocument()
      expect(screen.getByText('这份义水推演已超过有效期，不能当作当前行情')).toBeInTheDocument()
      expect(screen.getByText('过期')).toBeInTheDocument()
      expect(screen.queryByText('历史回放（不作当前行情）')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('presents the outer panel as current only inside a CURRENT board fact window', () => {
    const board = createBoard()
    board.mode = 'CURRENT'
    board.validUntil = '2099-09-01T14:25:12+08:00'
    const restore = setTradingWorkbenchSnapshotResolver(() => createSnapshot(board))
    try {
      const { container } = render(<TradingPanelContent shape={inferenceShape} />)
      expect(container.querySelector('[data-panel-kind="yishui-inference"]'))
        .toHaveAttribute('data-fact-state', 'CURRENT')
      expect(screen.getByText('义水北路当前推演')).toBeInTheDocument()
      expect(screen.getAllByText('当前有效至')).toHaveLength(2)
      expect(screen.queryByText('当时有效至')).not.toBeInTheDocument()
      expect(screen.queryByText('有效截止')).not.toBeInTheDocument()
      expect(screen.getByText('验证进度：已冻结')).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('renders the five frozen sections and preserves backend array order without trading controls', () => {
    const { container } = render(<YishuiInferenceBoard value={createBoard()} />)

    expect([...container.querySelectorAll('[data-yishui-section]')].map((node) => node.getAttribute('data-yishui-section'))).toEqual([
      'market-node',
      'sector-structure',
      'role-nodes',
      'branches',
      'previous-settlement',
    ])
    expect([...container.querySelectorAll('.trading-panel__yishui-lines > article > header > strong')].map((node) => node.textContent)).toEqual([
      'B线（后端第一项）',
      'A线（后端第二项）',
    ])
    expect(screen.getByText('后端冻结：暂不能定节点')).toBeInTheDocument()
    expect(screen.getByText('当时有效至')).toBeInTheDocument()
    expect(screen.queryByText('当前有效至')).not.toBeInTheDocument()
    expect(screen.queryByText('有效截止')).not.toBeInTheDocument()
    expect(screen.getByText('当时进度：已冻结')).toBeInTheDocument()
    expect(screen.getByText('事后回看，不代表当时已经生成，也不能作为样本外有效性证明。')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText('立即买入')).not.toBeInTheDocument()
  })

  it('uses the independent panel dispatch and closes when the payload is absent', () => {
    const restore = setTradingWorkbenchSnapshotResolver(() => createSnapshot(undefined))
    try {
      render(<TradingPanelContent shape={inferenceShape} />)
      expect(screen.getByText('义水北路推演画板')).toBeInTheDocument()
      expect(screen.getByText('义水推演契约未接入')).toBeInTheDocument()
      expect(screen.queryByText('市场与题材')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('shows a plain waiting state before the first current frame arrives', () => {
    const snapshot = createSnapshot(undefined)
    snapshot.yishuiInferenceStatus = {
      state: 'WAITING_FIRST_FRAME',
      headline: '第一帧正在生成和校验',
      message: '正在等今天 09:36 后的第一帧义水数据；历史数据不会冒充今天。',
      displayMode: null,
      currentTradeDate: '2026-09-02',
      sourceTradeDate: null,
      expectedFirstFrameAt: '2026-09-02T09:36:20+08:00',
      actionCeiling: 'WATCH_ONLY',
    }
    const restore = setTradingWorkbenchSnapshotResolver(() => snapshot)
    try {
      render(<TradingPanelContent shape={inferenceShape} />)
      expect(screen.getByText('第一帧正在生成和校验')).toBeInTheDocument()
      expect(screen.getAllByText(snapshot.yishuiInferenceStatus.message).length).toBeGreaterThan(0)
      expect(screen.queryByText('市场与题材')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('explains a real system fault with the automatic recovery action and next time', () => {
    const snapshot = createSnapshot(undefined)
    snapshot.yishuiInferenceStatus = {
      state: 'SYSTEM_RECOVERING',
      headline: '这一轮画板校验没有通过',
      message: '系统保留最后可靠画面，但不据此判断新的市场变化。',
      currentTradeDate: '2026-09-02',
      nextExpectedAt: '2026-09-02T10:01:20+08:00',
      recoveryAction: '后台将在 10:01:20 重新采样并重建画板；成功后页面自动恢复。',
      isSystemFault: true,
      actionBoundary: '只用于研究观察，不会自动下单。',
      actionCeiling: 'WATCH_ONLY',
    }
    const restore = setTradingWorkbenchSnapshotResolver(() => snapshot)
    try {
      render(<TradingPanelContent shape={inferenceShape} />)
      expect(screen.getByText('这一轮画板校验没有通过')).toBeInTheDocument()
      expect(screen.getByText('后台将在 10:01:20 重新采样并重建画板；成功后页面自动恢复。')).toBeInTheDocument()
      expect(screen.getByText(/下一时点：.*10:01:20/)).toBeInTheDocument()
      expect(screen.getByText('只用于研究观察，不会自动下单。')).toBeInTheDocument()
      expect(screen.queryByText('SYSTEM_RECOVERING')).not.toBeInTheDocument()
      expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('leads with a human current-frame explanation instead of internal status codes', () => {
    render(<YishuiInferenceBoard
      value={createBoard()}
      status={{
        state: 'CURRENT_FRAME_ONLY',
        headline: '当前行情已经接入',
        message: '当前有效事实已形成截面判断；下一份五分钟帧会自动确认前后变化。',
        qualitySummary: '已按当前有效事实完成推演；尚未确认的内容不参与结论。',
        comparisonSummary: '当前截面可看，前后变化暂不能比较。',
        actionBoundary: '只用于研究观察，不会自动下单。',
        actionCeiling: 'WATCH_ONLY',
      }}
    />)
    expect(screen.getByText('当前行情已经接入')).toBeInTheDocument()
    expect(screen.getByText('已按当前有效事实完成推演；尚未确认的内容不参与结论。')).toBeInTheDocument()
    expect(screen.getByText('当前截面可看，前后变化暂不能比较。')).toBeInTheDocument()
    expect(screen.queryByText('CURRENT_FRAME_ONLY')).not.toBeInTheDocument()
    expect(screen.queryByText('PARTIAL')).not.toBeInTheDocument()
    expect(screen.queryByText('UNKNOWN')).not.toBeInTheDocument()
  })

  it('renders reviewed divergence and dominant-sector conclusions in plain Chinese', () => {
    const reviewed = createBoard()
    reviewed.marketNode.status = 'DIVERGENCE'
    reviewed.marketNode.label = '分歧期'
    reviewed.marketNode.summary = '上涨仍有扩散，但负反馈同步增加，当前按分歧处理。'
    reviewed.sectorStructure.status = 'DOMINANT'
    reviewed.sectorStructure.summary = '当前主导交易线是“种植业 / 种业”，下一帧继续验证。'

    render(<YishuiInferenceBoard value={reviewed} />)

    expect(screen.getByText('分歧期')).toBeInTheDocument()
    expect(screen.getByText('分歧')).toBeInTheDocument()
    expect(screen.getByText('单一方向主导')).toBeInTheDocument()
    expect(screen.getByText('当前主导交易线是“种植业 / 种业”，下一帧继续验证。')).toBeInTheDocument()
    expect(screen.queryByText('DIVERGENCE')).not.toBeInTheDocument()
    expect(screen.queryByText('DOMINANT')).not.toBeInTheDocument()
  })

  it('closes the whole panel instead of showing partial data when validation fails', () => {
    const invalid = createBoard() as YishuiInferenceBoardContract & { tradeAction?: string }
    invalid.tradeAction = 'BUY'
    const { container } = render(<YishuiInferenceBoard value={invalid} />)
    expect(screen.getByText('义水推演契约已关闭')).toBeInTheDocument()
    expect(container.querySelector('[data-yishui-section]')).toBeNull()
    expect(screen.queryByText('B线（后端第一项）')).not.toBeInTheDocument()
  })
})
