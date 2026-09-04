import { useState, useSyncExternalStore, type MouseEvent } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  type TLResizeInfo,
} from 'tldraw'

import {
  TRADING_PANEL_SHAPE_TYPE,
  tradingPanelShapeMigrations,
  tradingPanelShapeProps,
  type TradingPanelShape,
} from './schema.js'
import {
  YishuiInferenceBoard,
  type YishuiInferenceStatus,
} from './YishuiInferenceBoard.js'
import type { YishuiInferenceBoardContract } from './yishui-inference.js'

export interface TradingWorkbenchTheme {
  name: string
  heat?: number
  structure?: string
}

export interface TradingWorkbenchStock {
  code: string
  name: string
  score?: number
  action?: string
  reason?: string
}

export interface TradingTodayOverviewLeader {
  code: string
  name: string
  marketSegment?: string
  auctionChangePct?: number
  sealAmountCny?: number
  sealToTurnoverRatio?: number
  executionAuthority?: string
}

export interface TradingTodayDecisionStep {
  id: string
  label: string
  status: string
  summary: string
  occurredAt?: string | null
  validUntil?: string | null
  evidenceIds?: string[]
}

export interface TradingTodayChange {
  id: string
  label: string
  summary: string
}

export interface TradingTodayEvidenceRef {
  id: string
  label: string
  kind: string
  sha256?: string
  occurredAt?: string | null
  informationNature?: string
}

export interface TradingTodayPlanItem {
  code: string
  name: string
  action?: string
  tradePattern?: string
  planBucket?: string
  themes?: string[]
  priority?: number
  candidateType?: string
  roleLabel?: string
  carrierLabel?: string
  focusReason?: string
  nextCheck?: string
  currentExecutionState?: string
  expectationLevel?: string
  expectationAuthority?: string
  confirmConditions?: string[]
  vetoConditions?: string[]
  hardVetoes?: string[]
  branchActions?: {
    strong?: string
    flat?: string
    weak?: string
  }
  branchPlans?: {
    strong?: string
    flat?: string
    weak?: string
  }
  peerComparison?: {
    status?: 'DEFINED' | 'UNDEFINED'
    label?: string
    members?: string[]
    definition?: string
    strengthRule?: string
    verdict?: string
    limitation?: string
  }
  relativeStrengthVerdict?: string
  morningInstruction?: string
  selectionContext?: {
    originLabel?: string
    statusLabel?: string
    summary?: string
    supportingFacts?: string[]
    limitingFacts?: string[]
    orderingBasis?: string
  }
  doNotChase?: boolean
}

export interface TradingTodayOverview {
  sourceLabel?: string
  status?: TradingSnapshotStatus
  updatedAt?: string | null
  sourceGeneratedAt?: string | null
  availableAt?: string | null
  lastSuccessAt?: string | null
  lastErrorAt?: string | null
  freshness?: TradingFreshness
  sourceHealth?: TradingSourceHealth
  freshUntil?: string | null
  staleSince?: string | null
  message?: string
  tradeDate?: string
  reportGeneratedAt?: string | null
  phaseGeneratedAt?: string | null
  decisionTradeDate?: string
  sourceTradeDate?: string
  planTradeDate?: string
  dataAsOf?: string | null
  validUntil?: string | null
  nextKeyTime?: string | null
  currentPhase?: string
  currentPhaseLabel?: string
  overallState?: string
  canParticipate?: boolean
  participationStatus?: string
  participationSummary?: string
  sourceExecutionAuthority?: string
  effectiveExecutionAuthority?: string
  unattendedAction?: string
  focusFamily?: string
  focusSummary?: string
  primaryTheme?: string
  parallelThemes?: string[]
  phase?: string
  phaseStatus?: string
  pipelineHealth?: string
  planAvailability?: string
  marketDecision?: string
  executionAuthority?: string
  reasonCodes?: string[]
  summaryLines?: string[]
  selectionFunnel?: {
    headline?: string
    eligibleObservationCount?: number
    frozenObservationCount?: number
    formalCandidateCount?: number
    displayedCount?: number
    orderingRule?: string
  }
  planItems?: TradingTodayPlanItem[]
  planCount?: number
  executePlanCount?: number
  observationPlanCount?: number
  planProjectionMode?: string
  decisionChain?: TradingTodayDecisionStep[]
  changes?: TradingTodayChange[]
  evidenceRefs?: TradingTodayEvidenceRef[]
  auction?: {
    status?: string
    snapshotAt?: string
    population?: number
    mainBoardPopulation?: number
    executionAuthority?: string
    leader?: TradingTodayOverviewLeader
  }
}

export type TradingEpistemicClass =
  | 'raw_observation'
  | 'verified_official_document'
  | 'normalized_metric'
  | 'model_output'
  | 'human_claim'
  | 'ai_synthesis'

export type TradingAnnouncementVerificationStatus = 'VERIFIED' | 'UNVERIFIED'

export interface TradingWorkbenchAnnouncement {
  id: string
  title: string
  epistemicClass: TradingEpistemicClass
  verificationStatus: TradingAnnouncementVerificationStatus
  summary?: string
  summaryEpistemicClass?: 'human_claim'
  publishedAt?: string
  direction?: 'positive' | 'neutral' | 'negative'
  names?: string[]
  codes?: string[]
  sourceIdentity?: string
  sourceName?: string
  sourceType?: string
  claimedSourceTier?: string
  issuer?: string
  securityKey?: string
  officialUrl?: string
  officialFileRef?: string
  documentId?: string
  contentHash?: string
  firstSeenAt?: string
  capturedAt?: string
}

export type TradingSnapshotStatus = 'ready' | 'stale' | 'degraded' | 'unavailable'
export type TradingFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN'
export type TradingSourceHealth = 'CURRENT' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE'
export type TradingTransportState = 'connecting' | 'connected' | 'reconnecting' | 'fallback' | 'disabled'
export type TradingFactState =
  | 'LIVE'
  | 'CURRENT'
  | 'CONNECTING'
  | 'DELAYED'
  | 'STALE'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'BLOCKED'
  | 'disabled'

export interface TradingTransportStatus {
  state: TradingTransportState
  lastConnectedAt?: string
  lastEventAt?: string
  detail?: string
}

export type TradingWorkbenchViewState =
  | {
      kind: 'connecting'
      transport: TradingTransportStatus
      message: string
    }
  | {
      kind: 'snapshot'
      snapshot: TradingWorkbenchSnapshot
    }

interface TradingStructuralFlowSession {
  tradeDate?: string
  status?: string
  reasonCodes?: string[]
  flowMode?: string
  label?: string
  reason?: string
  dominantThemeArchetype?: string | null
  dominantPrototype?: string | null
  pathLabel?: string | null
  pathReason?: string | null
  pathStrength?: number | null
  topArchetypes?: Array<{ name?: string; weight?: number }>
  sourceHash?: string
}

interface TradingRecentMarketSession {
  tradeDate?: string
  generatedAt?: string | null
  sourceHash?: string
  sentimentStatus?: string
  environmentVerdict?: string
  nodeVerdict?: string
  limitUpTotal?: number
  limitDownTotal?: number
  highestBoardLevel?: number
  boardTotal?: number
  indexChange?: Record<string, number>
  lossEffect?: number | null
  sampleCount?: number
  flow?: TradingStructuralFlowSession
}

interface TradingSentimentCoverageItem {
  key?: string
  label?: string
  status?: string
  detail?: string
}

export interface TradingDrilldownCandidate {
  code?: string
  name?: string
  marketSegment?: string | null
  originLabel?: string
  statusLabel?: string
  selectionSummary?: string
  supportingFacts?: string[]
  limitingFacts?: string[]
  reasonCodes?: string[]
  hardBlocks?: string[]
  currentExecution?: { state?: string; eligible?: boolean; reasonCodes?: string[] }
  quote?: Record<string, unknown>
  peerComparison?: {
    status?: string
    label?: string
    definition?: string
    verdict?: string
    limitation?: string
    members?: string[]
  }
  confirmConditions?: string[]
  vetoConditions?: string[]
  nextCheck?: string | null
  branchPlans?: Record<string, string>
  branchActions?: Record<string, string>
  doNotChase?: boolean
}

export interface TradingWorkbenchDrilldowns {
  meta?: {
    tradeDate?: string
    phase?: string
    dataAsOf?: string | null
    validUntil?: string | null
    factStatus?: string
    factUsability?: string
    actionCeiling?: string
    canParticipate?: boolean
    permissionSummary?: string
    hardIssueCodes?: string[]
  }
  marketSentiment?: {
    status?: string
    nodeStatus?: string
    headline?: string
    dataAsOf?: string | null
    completedAt?: string | null
    dimensions?: Array<{
      key?: string
      label?: string
      status?: string
      summary?: string
      observedAt?: string | null
      missingFields?: string[]
      sourceRefs?: string[]
      detail?: string
    }>
    missingDimensions?: string[]
    history?: TradingRecentMarketSession[]
    methodBoundary?: string
  }
  mainlineFunds?: {
    status?: string
    headline?: string
    topDirections?: Array<{
      name?: string
      taxonomy?: string | null
      rank?: number
      changePct?: number | null
      turnoverAmountCny?: number | null
      rankChange?: number | null
      changePctDelta?: number | null
      constituentSetReady?: boolean
    }>
    twoWayFlow?: {
      status?: string
      directions?: Array<{
        taxonomy?: string
        sectorCount?: number
        advanceCount?: number
        declineCount?: number
        flatCount?: number
        advanceTurnoverAmountCny?: number | null
        declineTurnoverAmountCny?: number | null
      }>
    }
    twoPointComparison?: Record<string, unknown>
    causalLeadershipEvidence?: Record<string, unknown>
    fundBases?: Array<{ key?: string; label?: string; status?: string; summary?: string }>
    methodBoundary?: string
  }
  candidates?: {
    status?: string
    count?: number
    items?: TradingDrilldownCandidate[]
    boundary?: string
  }
  review?: {
    status?: string
    steps?: TradingTodayDecisionStep[]
    changes?: TradingTodayChange[]
    candidateCount?: number
    evidenceRefIds?: string[]
    boundary?: string
  }
  evidence?: {
    status?: string
    coverage?: { observed?: number; partialOrMissing?: number; total?: number }
    sourceGroups?: Array<{
      sourceId?: string
      toolName?: string
      requestCount?: number
      failureCount?: number
      latestAvailableTime?: string | null
    }>
    sourceFailures?: Array<{ refId?: string; sourceId?: string; error?: string; integrityIssue?: string | null }>
    reasonCodes?: string[]
    hardIssueCodes?: string[]
    evidenceRefs?: TradingTodayEvidenceRef[]
    missingDimensions?: string[]
    methodBoundary?: string
  }
}

export interface TradingWorkbenchSnapshot {
  status: TradingSnapshotStatus
  updatedAt: string
  tradeDate?: string
  sourceLabel: string
  message?: string
  deliveryMode?: 'LIVE' | 'SNAPSHOT'
  revision?: string
  streamId?: string
  sequence?: number
  sourceGeneratedAt?: string | null
  availableAt?: string | null
  lastSuccessAt?: string | null
  lastErrorAt?: string | null
  ageMs?: number | null
  freshness?: TradingFreshness
  sourceHealth?: TradingSourceHealth
  sourceHash?: string | null
  freshUntil?: string | null
  staleSince?: string | null
  transport?: TradingTransportStatus
  todayOverview?: TradingTodayOverview
  market?: {
    environmentVerdict?: string
    nodeVerdict?: string
    limitUpTotal?: number
    limitDownTotal?: number
    highestBoardLevel?: number
    summaryLines?: string[]
    recentSentiment?: {
      status?: string
      windowLabel?: string
      headline?: string
      changeSummary?: string
      currentAssessment?: string
      sessions?: TradingRecentMarketSession[]
      dimensionCoverage?: TradingSentimentCoverageItem[]
      missingDimensions?: string[]
      methodBoundary?: string
    }
    recentFundFlow?: {
      status?: string
      headline?: string
      structuralFlow?: {
        status?: string
        basisLabel?: string
        trendSummary?: string
        sessions?: TradingStructuralFlowSession[]
      }
      etfProxy?: {
        status?: string
        basisLabel?: string
        label?: string
        state?: string | null
        evidenceDate?: string | null
        coverage?: number
        creationCount?: number
        redemptionCount?: number
        medianShareChange3dPct?: number | null
        medianPriceChange3dPct?: number | null
        decisionImpactEligible?: boolean
        validationStatus?: string
        summaryLines?: string[]
      }
      externalDailyFlow?: {
        status?: string
        basisLabel?: string
        asOf?: string | null
        reportTradeDate?: string | null
        decisionEligible?: boolean
        summaryLines?: string[]
      }
      methodBoundary?: string
    }
  }
  themes: TradingWorkbenchTheme[]
  stocks: TradingWorkbenchStock[]
  announcements: TradingWorkbenchAnnouncement[]
  readiness?: {
    state?: string
    executionEligible?: boolean
    sourceExecutionEligible?: boolean
    observationEligible?: boolean
    reasonCount?: number
  }
  services: Array<{ name: string; status: string; detail?: string }>
  dualCycleBoard?: TradingDualCycleBoardContract
  yishuiInferenceBoard?: YishuiInferenceBoardContract
  yishuiInferenceStatus?: YishuiInferenceStatus
  drilldowns?: TradingWorkbenchDrilldowns
}

type TradingDualCycleWindowStatus = 'READY' | 'PARTIAL' | 'NOT_READY' | 'BLOCKED'

interface TradingDualCycleWindow {
  windowName?: string
  status?: TradingDualCycleWindowStatus | string
  tradeDates?: string[]
  dimensionCoverage?: Record<string, unknown>
  latestHistoricalDimensionStatus?: Record<string, unknown>
  latestStates?: Record<string, unknown>
}

interface TradingDualCycleSentimentHistory {
  evaluationAsOf?: string | null
  status?: TradingDualCycleWindowStatus | string
  contextWindows?: Record<string, TradingDualCycleWindow>
}

interface TradingDualCycleEpisodeItem {
  ordinal?: number | null
  startTradeDate?: string | null
  endTradeDate?: string | null
  eventIds?: string[]
}

interface TradingDualCycleSentimentEpisode {
  evaluationAsOf?: string | null
  status?: TradingDualCycleWindowStatus | string
  anchor?: {
    nodeStatus?: string
    tradeDate?: string | null
    observedAt?: string | null
    eventId?: string
  } | null
  iceOccurrences?: TradingDualCycleEpisodeItem[]
  currentNode?: string | null
  lastIceOrdinal?: number | null
  currentIceOrdinal?: number | null
}

interface TradingDualCycleStrategicHistory {
  evaluationAsOf?: string | null
  status?: TradingDualCycleWindowStatus | string
  contextWindows?: Record<string, TradingDualCycleWindow>
}

interface TradingDualCycleCandidate {
  symbol?: string
  name?: string
}

interface TradingDualCycleLaneItem {
  candidate?: TradingDualCycleCandidate
  firstSeenAt?: string | null
  firstSeenPrice?: number | null
  lastObservedAt?: string | null
  lastSnapshotId?: string
  lifecycleRecordHash?: string
  currentAttentionState?: string
}

interface TradingDualCycleCandidateLanes {
  strategicResearch?: TradingDualCycleLaneItem[]
  tacticalWatch?: TradingDualCycleLaneItem[]
  jointReview?: TradingDualCycleLaneItem[]
}

export interface TradingDualCycleBoardContract {
  schemaVersion?: string
  generatedAt?: string | null
  displayBoundary?: string
  authorityBoundary?: string
  sentimentHistory?: TradingDualCycleSentimentHistory
  sentimentEpisode?: TradingDualCycleSentimentEpisode
  strategicRegimeHistory?: TradingDualCycleStrategicHistory
  candidateLanes?: TradingDualCycleCandidateLanes
  contractRules?: Record<string, unknown>
}

const DUAL_CYCLE_SCHEMA_VERSION = 'xzn-dual-cycle-board-contract-v2'
const DUAL_CYCLE_DISPLAY_BOUNDARY = 'READ_ONLY_ATTENTION_BOARD_NO_TRADE_AUTHORITY'
const DUAL_CYCLE_AUTHORITY_BOUNDARY = 'ATTENTION_ONLY_NOT_TRADE_PERMISSION'
const DUAL_CYCLE_SENTIMENT_WINDOWS = [
  ['TACTICAL_5', '5日镜头', 5],
  ['SWING_10', '10日镜头', 10],
  ['CYCLE_20', '20日镜头', 20],
  ['REGIME_60', '60日镜头', 60],
  ['CALIBRATION_120', '120日镜头', 120],
  ['ANNUAL_250', '250日镜头', 250],
] as const
const DUAL_CYCLE_STRATEGIC_WINDOWS = [
  ['CYCLE_20', '20日战略镜头'],
  ['REGIME_60', '60日战略镜头'],
  ['CALIBRATION_120', '120日战略镜头'],
] as const
const DUAL_CYCLE_RULE_KEYS = [
  'scoreAggregationAllowed',
  'sameSessionCloseFactReuseAllowed',
  'attentionMayBeRenderedAsParticipation',
  'uiMayOverrideCoreState',
  'singleWindowSentimentVerdictAllowed',
  'uiMayInferIceOrdinal',
  'uiMayInferStrategicRegime',
] as const

type DualCycleBoardState =
  | { mode: 'absent' }
  | { mode: 'invalid'; board: TradingDualCycleBoardContract }
  | { mode: 'valid'; board: TradingDualCycleBoardContract }

const FACT_STATE_PRESENTATION: Record<TradingFactState, {
  symbol: string
  label: string
  explanation: string
}> = {
  LIVE: {
    symbol: '●',
    label: '实时推送',
    explanation: '数据源当前，且已连接实时推送通道。',
  },
  CURRENT: {
    symbol: '✓',
    label: '当前快照',
    explanation: '最近一次可核验源快照仍在有效期内。',
  },
  CONNECTING: {
    symbol: '◌',
    label: '正在连接',
    explanation: '正在等待首个可核验快照，当前不展示交易事实。',
  },
  DELAYED: {
    symbol: '◷',
    label: '延迟更新',
    explanation: '实时推送不可用，正通过低频 HTTP 对账展示最近快照。',
  },
  STALE: {
    symbol: '▲',
    label: '数据过期',
    explanation: '源数据已超过新鲜度阈值，不得当作当前事实。',
  },
  DEGRADED: {
    symbol: '△',
    label: '数据降级',
    explanation: '源数据不完整或最新读取失败，当前仅供参考。',
  },
  UNAVAILABLE: {
    symbol: '×',
    label: '数据不可用',
    explanation: '尚无可核验快照，不展示为实时或当前数据。',
  },
  BLOCKED: {
    symbol: '⊘',
    label: '当前不参与',
    explanation: '当前只用于观察，等待后续实时条件确认。',
  },
  disabled: {
    symbol: '—',
    label: '已停用',
    explanation: '该能力未启用，不会产生或推送事实。',
  },
}

export function getTradingFactStatePresentation(state: TradingFactState) {
  return FACT_STATE_PRESENTATION[state]
}

export function resolveTradingFactState(
  snapshot: TradingWorkbenchSnapshot | undefined,
): TradingFactState {
  return resolveTradingFactStateFromEnvelope(snapshot)
}

function resolveTradingFactStateFromEnvelope(
  snapshot: Pick<TradingWorkbenchSnapshot, 'status' | 'sourceHealth' | 'freshness' | 'sourceGeneratedAt' | 'freshUntil' | 'deliveryMode' | 'transport'> | undefined,
): TradingFactState {
  if (!snapshot || snapshot.status === 'unavailable' || snapshot.sourceHealth === 'UNAVAILABLE') {
    return 'UNAVAILABLE'
  }
  if (snapshot.status === 'degraded' || snapshot.sourceHealth === 'DEGRADED') return 'DEGRADED'
  if (snapshot.status === 'stale' || snapshot.freshness === 'STALE' || snapshot.sourceHealth === 'STALE') {
    return 'STALE'
  }
  if (snapshot.transport?.state === 'disabled') return 'disabled'
  const positiveCurrentTuple = snapshot.status === 'ready'
    && snapshot.sourceHealth === 'CURRENT'
    && snapshot.freshness === 'CURRENT'
  if (!positiveCurrentTuple) return 'DEGRADED'
  // 06 is the only phase-clock and freshness authority. Some valid phases
  // (for example post-close background review) intentionally have no expiry.
  // 08 displays timestamps but must not invent a second current/degraded rule.
  // SSE only invalidates this batch/snapshot source. A connected transport is
  // not evidence that the underlying market fact itself is live.
  if (snapshot.deliveryMode === 'LIVE' && snapshot.transport?.state === 'connected') return 'LIVE'
  return 'CURRENT'
}

export function resolveOperationalState(value: string | undefined): TradingFactState {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'LIVE') return 'LIVE'
  if (normalized === 'READY' || normalized === 'CURRENT' || normalized === 'OK' || normalized === 'ENABLED') return 'CURRENT'
  if (normalized === 'CONNECTING') return 'CONNECTING'
  if (normalized === 'DELAYED' || normalized === 'PENDING' || normalized === 'RECONNECTING' || normalized === 'FALLBACK') return 'DELAYED'
  if (normalized === 'STALE') return 'STALE'
  if (normalized === 'BLOCKED') return 'BLOCKED'
  if (normalized === 'DISABLED') return 'disabled'
  if (normalized === 'UNAVAILABLE' || normalized === 'OFFLINE' || normalized === 'ERROR' || normalized === 'FAILED') return 'UNAVAILABLE'
  return 'DEGRADED'
}

type TradingWorkbenchViewStateResolver = () => TradingWorkbenchViewState | undefined

let viewStateResolver: TradingWorkbenchViewStateResolver = () => undefined
let resolverVersion = 0
const resolverListeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  resolverListeners.add(listener)
  return () => resolverListeners.delete(listener)
}

function version(): number {
  return resolverVersion
}

export function setTradingWorkbenchViewStateResolver(
  resolver: TradingWorkbenchViewStateResolver,
): () => void {
  const previous = viewStateResolver
  viewStateResolver = resolver
  resolverVersion += 1
  for (const listener of resolverListeners) listener()
  return () => {
    if (viewStateResolver !== resolver) return
    viewStateResolver = previous
    resolverVersion += 1
    for (const listener of resolverListeners) listener()
  }
}

export function setTradingWorkbenchSnapshotResolver(
  resolver: () => TradingWorkbenchSnapshot | undefined,
): () => void {
  return setTradingWorkbenchViewStateResolver(() => {
    const snapshot = resolver()
    return snapshot ? { kind: 'snapshot', snapshot } : undefined
  })
}

export function useTradingWorkbenchViewState(): TradingWorkbenchViewState | undefined {
  useSyncExternalStore(subscribe, version, version)
  return viewStateResolver()
}

function humanSystemMessage(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return /^[A-Z][A-Z0-9_:-]+$/.test(value.trim())
    ? '后台正在自动恢复，本轮不采用这份数据。'
    : value
}

function EmptyPanel({
  snapshot,
  connecting,
}: {
  snapshot: TradingWorkbenchSnapshot | undefined
  connecting?: Extract<TradingWorkbenchViewState, { kind: 'connecting' }>
}) {
  return (
    <div className="trading-panel__empty">
      <strong>{connecting ? '正在连接交易数据' : '数据源暂不可用'}</strong>
      <span>{humanSystemMessage(
        connecting?.message ?? snapshot?.message,
        '画布内容不会因此丢失，连接恢复后会自动刷新。',
      )}</span>
    </div>
  )
}

function formatFactTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '未提供'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function formatShortTradeDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? '—'
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function marketDataStatusLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'READY') return '可用'
  if (normalized === 'PARTIAL') return '部分可用'
  if (normalized === 'STALE') return '已过期'
  if (normalized === 'MISSING') return '缺失'
  if (normalized === 'CONFLICTED') return '有冲突'
  return '不可用'
}

function freshnessLabel(snapshot: TradingWorkbenchSnapshot | undefined): string {
  if (!snapshot?.freshness) return '未知'
  if (snapshot.freshness === 'CURRENT') return '当前'
  if (snapshot.freshness === 'STALE') return '过期'
  return '未知'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatSessionCount(window: TradingDualCycleWindow | undefined, targetSessions: number): string {
  const actualSessions = Array.isArray(window?.tradeDates) ? window.tradeDates.length : 0
  return `${actualSessions} / ${targetSessions} 个交易日`
}

const DUAL_CYCLE_FIELD_LABELS: Record<string, string> = {
  breadth: '涨跌家数',
  durability: '涨停持续性',
  height: '连板高度',
  priorWinnerFeedback: '昨日强势反馈',
  lossEffect: '亏钱效应',
  liquidity: '流动性',
  styleFlow: '风格流向',
  environment: '市场环境',
  profitModelCycle: '盈利模式周期',
  strategicMainline: '战略主线',
  relativeDifferentiation: '相对辨异',
}

const DUAL_CYCLE_VALUE_LABELS: Record<string, string> = {
  READY: '就绪',
  PARTIAL: '部分就绪',
  NOT_READY: '未就绪',
  BLOCKED: '已阻断',
  OBSERVED: '已观察',
  MISSING: '缺失',
  CONFLICTED: '冲突',
  SUPPORTIVE: '支持',
  MIXED: '混合',
  ADVERSE: '不利',
  UNKNOWN: '未知',
  EXPANDING: '扩张',
  MATURE: '成熟',
  CONTRACTING: '收缩',
  TRANSITION: '切换',
  PRIMARY: '主线',
  SECONDARY: '次主线',
  ABSENT: '缺席',
  STRENGTHENING: '增强',
  STABLE: '稳定',
  WEAKENING: '减弱',
}

const DUAL_CYCLE_BOUNDARY_LABELS: Record<string, string> = {
  READ_ONLY_ATTENTION_BOARD_NO_TRADE_AUTHORITY: '只读关注画板',
  ATTENTION_ONLY_NOT_TRADE_PERMISSION: '只作关注，不构成交易许可',
}

const DUAL_CYCLE_NODE_LABELS: Record<string, string> = {
  CLIMAX: '高潮',
  COOLING: '降温',
  DIVERGENCE: '分歧',
  ICE: '冰点',
  REPAIR: '修复',
  MIXED: '混合',
  UNKNOWN: '未知',
}

const DUAL_CYCLE_ATTENTION_LABELS: Record<string, string> = {
  PRIORITY_MANUAL_REVIEW: '双周期人工复核',
  TACTICAL_MANUAL_REVIEW: '战术人工复核',
  WAITING_TRIGGER: '等待触发',
  WATCH_ONLY: '仅观察',
  BLOCKED: '阻断',
}

function formatDualCycleValue(value: unknown): string {
  const text = String(value)
  return DUAL_CYCLE_VALUE_LABELS[text.trim().toUpperCase()] ?? text
}

function formatDualCycleBoundary(value: string | undefined): string {
  if (!value) return '未提供'
  return DUAL_CYCLE_BOUNDARY_LABELS[value] ?? value
}

function formatKeyValueList(value: Record<string, unknown> | undefined): string {
  if (!value) return '未提供'
  const items = Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .map(([key, item]) => `${DUAL_CYCLE_FIELD_LABELS[key] ?? key}:${formatDualCycleValue(item)}`)
  return items.length ? items.join(' / ') : '未提供'
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '未提供'
}

function formatHashPreview(value: string | undefined): string {
  if (!value) return '未提供'
  return value.length <= 24 ? value : `${value.slice(0, 24)}...`
}

function dualCycleChipState(value: string | undefined): TradingDualCycleWindowStatus | 'UNKNOWN' {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'READY' || normalized === 'PARTIAL' || normalized === 'NOT_READY' || normalized === 'BLOCKED') {
    return normalized
  }
  return 'UNKNOWN'
}

function resolveDualCycleBoardState(value: TradingWorkbenchSnapshot['dualCycleBoard']): DualCycleBoardState {
  if (!value) return { mode: 'absent' }
  const board = value
  const hasSentimentWindows = DUAL_CYCLE_SENTIMENT_WINDOWS.every(([key]) => isRecord(board.sentimentHistory?.contextWindows?.[key]))
  const hasStrategicWindows = DUAL_CYCLE_STRATEGIC_WINDOWS.every(([key]) => isRecord(board.strategicRegimeHistory?.contextWindows?.[key]))
  const hasStrictRules = DUAL_CYCLE_RULE_KEYS.every((key) => board.contractRules?.[key] === false)
  const isValid = board.schemaVersion === DUAL_CYCLE_SCHEMA_VERSION
    && board.displayBoundary === DUAL_CYCLE_DISPLAY_BOUNDARY
    && board.authorityBoundary === DUAL_CYCLE_AUTHORITY_BOUNDARY
    && hasSentimentWindows
    && hasStrategicWindows
    && hasStrictRules
  return isValid ? { mode: 'valid', board } : { mode: 'invalid', board }
}

function DualCycleStateChip({ value }: { value: string | undefined }) {
  const state = dualCycleChipState(value)
  const normalized = value?.trim().toUpperCase() ?? 'UNKNOWN'
  const label = DUAL_CYCLE_ATTENTION_LABELS[normalized]
    ?? DUAL_CYCLE_VALUE_LABELS[normalized]
    ?? value
    ?? 'UNKNOWN'
  return <span className="trading-panel__dual-cycle-chip" data-state={state}>{label}</span>
}

function DualCycleContractUnavailable() {
  return (
    <div className="trading-panel__dual-cycle-unavailable">
      <strong>核心契约不可用</strong>
      <span>双周期只读契约未通过结构边界校验，当前不回退旧的市场或候选卡片。</span>
    </div>
  )
}

function DualCycleMarketOverview({ board }: { board: TradingDualCycleBoardContract }) {
  const sentimentWindows = board.sentimentHistory?.contextWindows ?? {}
  const strategicWindows = board.strategicRegimeHistory?.contextWindows ?? {}
  const episode = board.sentimentEpisode
  const iceOccurrences = episode?.iceOccurrences ?? []
  return (
    <div className="trading-panel__body trading-panel__dual-cycle">
      <div className="trading-panel__dual-cycle-shell">
        <section className="trading-panel__dual-cycle-header">
          <div className="trading-panel__dual-cycle-header-main">
            <span>双周期只读 / 人工复核</span>
            <strong>双周期核心只提供关注与复核，不提供交易授权。</strong>
            <small>生成时间：{formatFactTime(board.generatedAt)}</small>
          </div>
          <div className="trading-panel__dual-cycle-header-meta">
            <div>
              <span>契约状态</span>
              <DualCycleStateChip value={board.sentimentHistory?.status ?? board.strategicRegimeHistory?.status} />
            </div>
            <div>
              <span>显示边界</span>
              <strong title={board.displayBoundary}>{formatDualCycleBoundary(board.displayBoundary)}</strong>
            </div>
            <div>
              <span>权限边界</span>
              <strong title={board.authorityBoundary}>{formatDualCycleBoundary(board.authorityBoundary)}</strong>
            </div>
          </div>
        </section>

        <div className="trading-panel__dual-cycle-grid">
          <section className="trading-panel__dual-cycle-section">
            <div className="trading-panel__dual-cycle-section-title">
              <h3>义水情绪六镜头</h3>
              <small>只显示核心给出的状态、覆盖与交易日数量</small>
            </div>
            <div className="trading-panel__dual-cycle-window-grid">
              {DUAL_CYCLE_SENTIMENT_WINDOWS.map(([key, label, sessions]) => {
                const window = sentimentWindows[key]
                return (
                  <article className="trading-panel__dual-cycle-window-card" key={key}>
                    <div className="trading-panel__dual-cycle-card-header">
                      <strong>{label}</strong>
                      <DualCycleStateChip value={window?.status} />
                    </div>
                    <span>交易日：{formatSessionCount(window, sessions)}</span>
                    <span>维度覆盖：{formatKeyValueList(window?.dimensionCoverage)}</span>
                    <span>最新维度状态：{formatKeyValueList(window?.latestHistoricalDimensionStatus)}</span>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="trading-panel__dual-cycle-section">
            <div className="trading-panel__dual-cycle-section-title">
              <h3>情绪事件链</h3>
              <small>不在前端推断节点或冰点序号</small>
            </div>
            <div className="trading-panel__dual-cycle-episode">
              <article className="trading-panel__dual-cycle-window-card">
                <div className="trading-panel__dual-cycle-card-header">
                  <strong>高潮锚点</strong>
                  <DualCycleStateChip value={episode?.status} />
                </div>
                <span>{DUAL_CYCLE_NODE_LABELS[episode?.anchor?.nodeStatus ?? ''] ?? episode?.anchor?.nodeStatus ?? '未提供锚点'}</span>
                <span>交易日：{episode?.anchor?.tradeDate ?? '未提供'}</span>
                <span>观察时点：{formatFactTime(episode?.anchor?.observedAt)}</span>
              </article>
              <article className="trading-panel__dual-cycle-window-card">
                <div className="trading-panel__dual-cycle-card-header">
                  <strong>当前节点</strong>
                  <DualCycleStateChip value={episode?.status} />
                </div>
                <span>{DUAL_CYCLE_NODE_LABELS[episode?.currentNode ?? ''] ?? episode?.currentNode ?? '未提供'}</span>
                <span>当前冰点序号：{episode?.currentIceOrdinal ?? '未提供'}</span>
                <span>最近冰点序号：{episode?.lastIceOrdinal ?? '未提供'}</span>
              </article>
            </div>
            <ol className="trading-panel__dual-cycle-episode-list">
              {iceOccurrences.length ? iceOccurrences.map((item, index) => (
                <li key={item.eventIds?.[0] ?? `${item.startTradeDate ?? 'event'}-${index}`}>
                  <div className="trading-panel__dual-cycle-card-header">
                    <strong>第 {item.ordinal ?? index + 1} 次冰点</strong>
                    <span className="trading-panel__dual-cycle-chip" data-state="UNKNOWN">已验证事件链</span>
                  </div>
                  <span>开始交易日：{item.startTradeDate ?? '未提供'}</span>
                  <span>结束交易日：{item.endTradeDate ?? '未提供'}</span>
                  <span title={item.eventIds?.join(', ')}>事件哈希：{formatHashPreview(item.eventIds?.[0])}</span>
                </li>
              )) : (
                <li>
                  <strong>冰点序号缺少本轮锚点</strong>
                  <span>当前契约没有提供可展示的冰点事件链。</span>
                </li>
              )}
            </ol>
          </section>
        </div>

        <section className="trading-panel__dual-cycle-section">
          <div className="trading-panel__dual-cycle-section-title">
            <h3>模型先生战略历史</h3>
            <small>历史环境，不等于当前战略资格</small>
          </div>
          <div className="trading-panel__dual-cycle-window-grid trading-panel__dual-cycle-window-grid--strategic">
            {DUAL_CYCLE_STRATEGIC_WINDOWS.map(([key, label]) => {
              const window = strategicWindows[key]
              return (
                <article className="trading-panel__dual-cycle-window-card" key={key}>
                  <div className="trading-panel__dual-cycle-card-header">
                    <strong>{label}</strong>
                    <DualCycleStateChip value={window?.status} />
                  </div>
                  <span>评估时点：{formatFactTime(board.strategicRegimeHistory?.evaluationAsOf)}</span>
                  <span>交易日：{Array.isArray(window?.tradeDates) ? window.tradeDates.length : 0} 个</span>
                  <span>环境状态：{formatKeyValueList(window?.latestStates)}</span>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function DualCycleCandidateLanes({ board }: { board: TradingDualCycleBoardContract }) {
  const lanes: Array<[keyof TradingDualCycleCandidateLanes, string]> = [
    ['strategicResearch', '战略研究'],
    ['tacticalWatch', '战术观察'],
    ['jointReview', '联合复核'],
  ]
  return (
    <div className="trading-panel__body trading-panel__dual-cycle">
      <div className="trading-panel__dual-cycle-shell trading-panel__dual-cycle-shell--lanes">
        <section className="trading-panel__dual-cycle-section">
          <div className="trading-panel__dual-cycle-section-title">
            <h3>候选泳道</h3>
            <small>保留生命周期字段，不展示综合分、动作建议或参与许可</small>
          </div>
          <div className="trading-panel__dual-cycle-lanes">
            {lanes.map(([key, label]) => {
              const items = board.candidateLanes?.[key] ?? []
              return (
                <section className="trading-panel__dual-cycle-lane" key={key}>
                  <div className="trading-panel__dual-cycle-lane-header">
                    <strong>{label}</strong>
                    <small>{items.length} 条</small>
                  </div>
                  <div className="trading-panel__dual-cycle-lane-list">
                    {items.length ? items.map((item, index) => (
                      <article className="trading-panel__dual-cycle-lane-card" key={`${item.candidate?.symbol ?? 'candidate'}-${index}`}>
                        <div className="trading-panel__dual-cycle-card-header">
                          <strong>{item.candidate?.name ?? '未命名标的'}</strong>
                          <DualCycleStateChip value={item.currentAttentionState} />
                        </div>
                        <span>代码：{item.candidate?.symbol ?? '未提供'}</span>
                        <span>首次发现：{formatFactTime(item.firstSeenAt)}</span>
                        <span>首次价格：{formatPrice(item.firstSeenPrice)}</span>
                        <span>最近观察：{formatFactTime(item.lastObservedAt)}</span>
                        <span title={item.lastSnapshotId}>最近快照哈希：{formatHashPreview(item.lastSnapshotId)}</span>
                        <span title={item.lifecycleRecordHash}>生命周期哈希：{formatHashPreview(item.lifecycleRecordHash)}</span>
                      </article>
                    )) : (
                      <article className="trading-panel__dual-cycle-lane-card trading-panel__dual-cycle-lane-card--empty">
                        <strong>{label}为空</strong>
                        <span>当前契约未给出该泳道候选。</span>
                      </article>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function panelSnapshotMeta(
  snapshot: TradingWorkbenchSnapshot | undefined,
  panelKind: TradingPanelShape['props']['panelKind'],
): TradingWorkbenchSnapshot | undefined {
  if (panelKind === 'yishui-inference') {
    const board = snapshot?.yishuiInferenceBoard
    if (!board) {
      const status = snapshot?.yishuiInferenceStatus
      return {
        status: snapshot ? 'degraded' : 'unavailable',
        updatedAt: snapshot?.updatedAt ?? new Date(0).toISOString(),
        sourceLabel: '义水北路推演契约',
        message: status?.message ?? '义水推演契约未接入，不能沿用其他面板的当前状态',
        sourceGeneratedAt: null,
        availableAt: null,
        freshUntil: null,
        freshness: 'UNKNOWN',
        sourceHealth: snapshot ? 'DEGRADED' : 'UNAVAILABLE',
        themes: [],
        stocks: [],
        announcements: [],
        services: [],
        ...(status ? { yishuiInferenceStatus: status } : {}),
        ...(snapshot?.transport ? { transport: snapshot.transport } : {}),
      }
    }

    const now = Date.now()
    const dataAsOf = Date.parse(board.dataAsOf)
    const validUntil = Date.parse(board.validUntil)
    const timestampWindowValid = Number.isFinite(dataAsOf)
      && Number.isFinite(validUntil)
      && dataAsOf <= now
      && now < validUntil
    const isCurrent = board.mode === 'CURRENT' && timestampWindowValid
    const isHistoricalReplay = board.mode === 'HISTORICAL_REPLAY'
    const isExpired = Number.isFinite(validUntil) && now >= validUntil
    const statusMessage = snapshot?.yishuiInferenceStatus?.message
    const message = isHistoricalReplay
      ? statusMessage ?? '历史回放，仅供事后复盘，不是当前行情'
      : isExpired
        ? '这份义水推演已超过有效期，不能当作当前行情'
        : isCurrent
          ? undefined
          : '义水推演的数据时点尚未到达或时间字段无效，不能标为当前'

    return {
      status: isCurrent ? 'ready' : isHistoricalReplay || isExpired ? 'stale' : 'degraded',
      updatedAt: board.generatedAt,
      tradeDate: board.sourceStageRef.tradeDate,
      sourceLabel: isHistoricalReplay ? '义水北路不可变历史推演' : '义水北路当前推演',
      ...(message ? { message } : {}),
      sourceGeneratedAt: board.dataAsOf,
      availableAt: board.generatedAt,
      freshUntil: board.validUntil,
      staleSince: isHistoricalReplay || isExpired ? board.validUntil : null,
      freshness: isCurrent ? 'CURRENT' : isHistoricalReplay || isExpired ? 'STALE' : 'UNKNOWN',
      sourceHealth: isCurrent ? 'CURRENT' : isHistoricalReplay || isExpired ? 'STALE' : 'DEGRADED',
      themes: [],
      stocks: [],
      announcements: [],
      services: [],
      ...(snapshot?.yishuiInferenceStatus
        ? { yishuiInferenceStatus: snapshot.yishuiInferenceStatus }
        : {}),
      ...(snapshot?.transport ? { transport: snapshot.transport } : {}),
    }
  }
  if (panelKind !== 'today-overview') return snapshot
  const overview = snapshot?.todayOverview
  if (!overview) {
    return {
      status: 'unavailable',
      updatedAt: snapshot?.updatedAt ?? new Date(0).toISOString(),
      sourceLabel: '06 交易工作台统一解释',
      message: 'WORKBENCH_CONTEXT_UNAVAILABLE',
      sourceGeneratedAt: null,
      availableAt: null,
      freshUntil: null,
      freshness: 'UNKNOWN',
      sourceHealth: 'UNAVAILABLE',
      themes: [],
      stocks: [],
      announcements: [],
      services: [],
      ...(snapshot?.transport ? { transport: snapshot.transport } : {}),
    }
  }
  const tradeDate = overview.tradeDate ?? overview.decisionTradeDate ?? snapshot?.tradeDate
  return {
    status: overview.status ?? 'degraded',
    updatedAt: overview.updatedAt ?? snapshot?.updatedAt ?? new Date(0).toISOString(),
    ...(tradeDate ? { tradeDate } : {}),
    sourceLabel: overview.sourceLabel ?? '06 交易工作台统一解释',
    ...(overview.message ? { message: overview.message } : {}),
    sourceGeneratedAt: overview.sourceGeneratedAt ?? null,
    availableAt: overview.availableAt ?? null,
    lastSuccessAt: overview.lastSuccessAt ?? null,
    lastErrorAt: overview.lastErrorAt ?? null,
    freshness: overview.freshness ?? 'UNKNOWN',
    sourceHealth: overview.sourceHealth ?? 'DEGRADED',
    freshUntil: overview.freshUntil ?? null,
    staleSince: overview.staleSince ?? null,
    themes: [],
    stocks: [],
    announcements: [],
    services: [],
    ...(snapshot?.transport ? { transport: snapshot.transport } : {}),
  }
}

function transportLabel(state: TradingTransportState | undefined): string {
  if (state === 'connected') return '推送已连接'
  if (state === 'reconnecting') return '推送重连中（轮询对账）'
  if (state === 'fallback') return '轮询降级'
  if (state === 'disabled') return '推送已停用'
  return '推送连接中'
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)}%`
}

function formatAmountWan(value: number | undefined): string {
  return value === undefined ? '—' : `${(value / 10_000).toFixed(0)} 万`
}

const FACT_STATE_SHORT_LABELS: Record<TradingFactState, string> = {
  LIVE: '自动更新',
  CURRENT: '可核对',
  CONNECTING: '等待首帧',
  DELAYED: '最近快照',
  STALE: '不作当前依据',
  DEGRADED: '仅供参考',
  UNAVAILABLE: '等待恢复',
  BLOCKED: '只观察',
  disabled: '未运行',
}

function operationalStatusLabel(value: string | undefined): string {
  const state = value?.trim().toUpperCase()
  if (state === 'READY' || state === 'VERIFIED' || state === 'CURRENT' || state === 'OK') return '已按计划运行'
  if (state === 'REVIEW_ONLY' || state === 'WATCH_ONLY') return '只作观察，等待实时确认'
  if (state === 'PENDING' || state === 'PENDING_TRIGGER' || state === 'WAIT') return '等待下一步确认'
  if (state === 'PARTICIPATE' || state === 'ELIGIBLE_FOR_MANUAL_REVIEW') return '进入人工复核'
  if (state === 'BLOCKED' || state === 'SYSTEM_BLOCKED' || state === 'DENIED' || state === 'NO_PARTICIPATION') return '当前不参与'
  if (!value || /^[A-Z0-9_:-]+$/.test(value.trim())) return '等待确认'
  return value
}

function tradingPhaseLabel(value: string | undefined): string {
  const phase = value?.trim().toLowerCase()
  if (phase === 'us_close') return '隔夜风险已更新'
  if (phase === 'post_close' || phase === 'post-close') return '盘后复盘'
  if (phase === 'pre_open' || phase === 'preopen_freeze_readonly') return '盘前预案'
  if (phase === 'preauction') return '竞价观察'
  if (phase === 'auction' || phase === 'auction_final') return '竞价确认'
  if (phase === 'intraday' || phase === 'intraday_discovery') return '盘中复核'
  if (!value || /^[a-z0-9_:-]+$/i.test(value.trim())) return '等待下一次确认'
  return value
}

function FactStateBadge({ state }: { state: TradingFactState }) {
  const presentation = getTradingFactStatePresentation(state)
  return (
    <span className="trading-panel__state-badge" data-state={state} title={presentation.explanation}>
      <span aria-hidden="true">{presentation.symbol}</span>
      <strong>{presentation.label}</strong>
      <small>{FACT_STATE_SHORT_LABELS[state]}</small>
    </span>
  )
}

function TodayOverview({ snapshot }: { snapshot: TradingWorkbenchSnapshot }) {
  const [showEvidence, setShowEvidence] = useState(false)
  const overview = snapshot.todayOverview
  const dualCycleState = resolveDualCycleBoardState(snapshot.dualCycleBoard)
  const leader = overview?.auction?.leader
  const lines = overview?.summaryLines?.filter(Boolean) ?? []
  const participationAnswer = overview?.participationSummary
    ?? (overview?.canParticipate ? '可以参与，但仍要服从计划边界。' : '当前不能参与。')
  const currentPhaseLabel = overview?.currentPhaseLabel ?? overview?.phaseStatus ?? overview?.phase ?? '—'
  const systemView = operationalStatusLabel(overview?.overallState ?? overview?.marketDecision)
  const decisionSteps = overview?.decisionChain?.slice(0, 4) ?? []
  const changes = overview?.changes?.slice(0, 2) ?? []
  const evidence = overview?.evidenceRefs ?? []
  const planItems = overview?.planItems ?? []
  const planCount = overview?.planCount ?? planItems.length
  const executePlanCount = overview?.executePlanCount ?? planItems.filter((item) => item.planBucket === 'execute').length
  const observationPlanCount = overview?.observationPlanCount ?? Math.max(0, planCount - executePlanCount)
  const focusPlanItems = planItems.slice(0, 3)
  const selectionFunnel = overview?.selectionFunnel
  const planIsForNextSession = Boolean(
    overview?.planTradeDate
    && overview?.decisionTradeDate
    && overview.planTradeDate !== overview.decisionTradeDate,
  )
  const sessionLabel = planIsForNextSession ? '明日' : '今日'
  const evidencePreview = evidence.slice(0, 1)
  const whySummary = overview?.focusSummary ?? lines[0] ?? '当前没有可用说明。'
  const reasonSummary = lines[1]
    ?? (overview?.reasonCodes?.length ? '当前权限已按规则收紧，等待下一阶段自动复核。' : '当前没有额外限制说明。')
  const projectId = 'project-a19b95b7-8834-4605-80e8-f449650192ea'
  const drilldownBoards = [
    { label: '市场情绪', boardId: 'board-e3d3579e-3ddd-4d62-9bb2-3a991319ff0b' },
    { label: '主线与资金', boardId: 'board-64466bcc-0a8c-43f6-8bca-b69e25706f0e' },
    { label: '个股理由与同类', boardId: 'board-e5a80dcf-3c00-48b4-be98-38026a3e6b26' },
    { label: '预案验证与回放', boardId: 'board-4032db70-9467-44aa-a96a-519dd21b361d' },
  ]
  const boardHref = (boardId: string, params?: Record<string, string | undefined>) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) search.set(key, value)
    }
    const suffix = search.size ? `?${search.toString()}` : ''
    return `/projects/${projectId}/boards/${boardId}${suffix}`
  }
  return (
    <div className="trading-panel__body trading-panel__today">
      <div className="trading-panel__today-shell">
        <div className="trading-panel__today-top">
          <div className="trading-panel__today-answer" data-state={resolveOperationalState(overview?.overallState)}>
            <span>现在能不能参与</span>
            <strong>{overview?.canParticipate ? '可以参与' : '不能参与'}</strong>
            <small>{participationAnswer}</small>
          </div>
          <div className="trading-panel__today-fact-card">
            <div className="trading-panel__today-fact-row">
              <span>当前阶段</span>
              <strong>{currentPhaseLabel}</strong>
              <small>{tradingPhaseLabel(overview?.currentPhase ?? overview?.phase)}</small>
            </div>
            <div className="trading-panel__today-fact-row">
              <span>下一关键时间</span>
              <strong>{formatFactTime(overview?.nextKeyTime)}</strong>
              <small>数据时点：{formatFactTime(overview?.dataAsOf ?? overview?.updatedAt)}</small>
            </div>
          </div>
          <div className="trading-panel__today-fact-grid">
            <div className="trading-panel__today-fact-row">
              <span>{sessionLabel}主要看</span>
              <strong>{overview?.focusFamily ?? overview?.primaryTheme ?? '—'}</strong>
            </div>
            <div className="trading-panel__today-fact-row">
              <span>系统怎么看</span>
              <strong>{systemView}</strong>
            </div>
          </div>
        </div>

        <nav className="trading-panel__today-drilldown" aria-label="深入查看">
          <strong>深入查看</strong>
          {drilldownBoards.map((item) => (
            <a
              key={item.boardId}
              href={boardHref(item.boardId)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >{item.label}</a>
          ))}
        </nav>

        {dualCycleState.mode !== 'absent' ? (
          <div className="trading-panel__today-dual-cycle-note">
            双周期核心只提供关注与人工复核，不产生参与许可
          </div>
        ) : null}

        {planItems.length ? (
          <section className="trading-panel__today-plan" aria-label={`${sessionLabel}候选解释与预案`}>
            <div className="trading-panel__today-plan-heading">
              <div>
                <h3>为什么系统留下这些对象</h3>
                <small>先解释入池理由，再看{sessionLabel}如何验证 · 适用 {overview?.planTradeDate ?? overview?.decisionTradeDate ?? '—'}</small>
              </div>
              <strong>{executePlanCount} 个正式候选 · {observationPlanCount} 个观察对象</strong>
            </div>
            <div className="trading-panel__today-selection-funnel">
              <strong>{selectionFunnel?.headline ?? `本轮冻结 ${planCount} 个候选，首屏只解释前 ${focusPlanItems.length} 个。`}</strong>
              <div>
                <span><b>{selectionFunnel?.eligibleObservationCount ?? '—'}</b>盘中异动召回</span>
                <span><b>{selectionFunnel?.frozenObservationCount ?? observationPlanCount}</b>冻结观察</span>
                <span><b>{selectionFunnel?.formalCandidateCount ?? executePlanCount}</b>正式候选</span>
                <span><b>{selectionFunnel?.displayedCount ?? focusPlanItems.length}</b>首屏解释</span>
              </div>
              <small>{selectionFunnel?.orderingRule ?? '首屏沿用冻结清单顺序，不代表推荐排名。'}</small>
            </div>
            <div className="trading-panel__today-plan-boundary">
              <strong>{overview?.focusFamily ?? overview?.primaryTheme ?? '方向待确认'}</strong>
              <span>{whySummary}</span>
              <b>先判断为什么入池，再判断是否继续观察</b>
            </div>
            <ol className="trading-panel__today-focus-list">
              {focusPlanItems.map((item, index) => (
                <li
                  key={`${item.code}:${item.name}`}
                  className="trading-panel__today-focus-card"
                  data-plan-bucket={item.planBucket ?? 'observe'}
                >
                  <header>
                    <span>首屏样本 #{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.code}</small>
                    </div>
                    <b>{item.roleLabel ?? item.candidateType ?? item.tradePattern ?? '观察对象'}</b>
                  </header>
                  <div className="trading-panel__today-focus-tags">
                    <span>{item.carrierLabel ?? item.tradePattern ?? '承载类型待确认'}</span>
                    <span>{item.themes?.length ? item.themes.join(' / ') : '方向待归并'}</span>
                    {item.doNotChase ? <em>不追高</em> : null}
                  </div>
                  <a
                    className="trading-panel__today-stock-drilldown"
                    href={boardHref('board-e5a80dcf-3c00-48b4-be98-38026a3e6b26', {
                      symbol: item.code,
                      snapshot: snapshot.sourceHash ?? snapshot.revision,
                    })}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >查看完整理由与同类</a>
                  <div className="trading-panel__today-selection-context">
                    <div>
                      <span>{item.selectionContext?.originLabel ?? '冻结观察池'}</span>
                      <b>{item.selectionContext?.statusLabel ?? '观察对象，不是买入名单'}</b>
                    </div>
                    <strong>{item.selectionContext?.summary ?? '当前只确认它进入了观察清单，尚未提供足够的正式入选理由。'}</strong>
                    <div className="trading-panel__today-selection-reasons">
                      <section data-kind="support">
                        <h4>为什么入池</h4>
                        <ul>
                          {(item.selectionContext?.supportingFacts?.length ? item.selectionContext.supportingFacts : ['入池证据未完整写入']).slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}
                        </ul>
                      </section>
                      <section data-kind="limit">
                        <h4>为什么不能参与</h4>
                        <ul>
                          {(item.selectionContext?.limitingFacts?.length ? item.selectionContext.limitingFacts : ['仍需等待竞价事实和人工复核']).slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}
                        </ul>
                      </section>
                    </div>
                    <small>{item.selectionContext?.orderingBasis ?? '这是观察清单顺序，不是收益或推荐排名。'}</small>
                  </div>
                  {item.peerComparison?.status === 'DEFINED' ? (
                    <div className="trading-panel__today-peer-verdict" data-state="DEFINED">
                      <span>相对强弱</span>
                      <strong>{item.relativeStrengthVerdict ?? item.peerComparison?.verdict ?? '尚未比较'}</strong>
                      <b>{item.morningInstruction ?? '只观察，不参与'}</b>
                    </div>
                  ) : null}
                  <p className="trading-panel__today-focus-reason"><b>{sessionLabel}怎么验证</b>{item.focusReason ?? item.nextCheck ?? '等待竞价事实后再判断。'}</p>
                  <div className="trading-panel__today-focus-gates">
                    <section data-kind="confirm">
                      <h4>看到这些才继续观察</h4>
                      <ul>
                        {(item.confirmConditions?.length ? item.confirmConditions : ['等待同日 09:25 竞价事实']).slice(0, 3).map((condition) => <li key={condition}>{condition}</li>)}
                      </ul>
                    </section>
                    <section data-kind="veto">
                      <h4>出现任一就放弃</h4>
                      <ul>
                        {(item.vetoConditions?.length ? item.vetoConditions : item.hardVetoes ?? ['未提供否决条件']).slice(0, 2).map((condition) => <li key={condition}>{condition}</li>)}
                      </ul>
                    </section>
                  </div>
                  {item.planBucket === 'execute' ? (
                    <>
                      <div className="trading-panel__today-branches">
                        <small>开盘分支只决定是否提交人工复核，不是自动买点</small>
                        <p><b>强开</b><span>{item.branchActions?.strong ?? '等待确认'}</span></p>
                        <p><b>平开</b><span>{item.branchActions?.flat ?? '只观察'}</span></p>
                        <p><b>弱开</b><span>{item.branchActions?.weak ?? '取消观察'}</span></p>
                      </div>
                      <footer>
                        <span>下次检查：{item.nextCheck ?? '次日竞价'}</span>
                        <b>{item.expectationLevel ?? item.expectationAuthority ?? '仅人工复核'}</b>
                      </footer>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
            {planCount > focusPlanItems.length ? <small className="trading-panel__today-plan-more">另有 {planCount - focusPlanItems.length} 个对象保留在完整冻结清单；首屏不把它们包装成推荐排名。</small> : null}
          </section>
        ) : null}

        <div className="trading-panel__today-layout">
          <div className="trading-panel__today-column">
            <section className="trading-panel__today-section trading-panel__today-section--primary">
              <h3>这轮判断怎么来的</h3>
              <ol className="trading-panel__decision-chain">
                {decisionSteps.length ? decisionSteps.map((step) => (
                  <li key={step.id} data-state={resolveOperationalState(step.status)}>
                    <div className="trading-panel__decision-chain-header">
                      <span>{step.label}</span>
                      <strong>{operationalStatusLabel(step.status)}</strong>
                    </div>
                    <small>{step.summary}</small>
                  </li>
                )) : (
                  <li>
                    <div className="trading-panel__decision-chain-header">
                      <span>判断过程</span>
                    </div>
                    <small>{lines[0] ?? '当前快照还没有给出完整判断过程。'}</small>
                  </li>
                )}
              </ol>
            </section>

            <section className="trading-panel__today-section">
              <h3>为什么这样看</h3>
              <p>{whySummary}</p>
              {leader ? <p>竞价观察：{leader.name} {leader.code} · {formatPercent(leader.auctionChangePct)} · 封单 {formatAmountWan(leader.sealAmountCny)}</p> : null}
              <p>{reasonSummary}</p>
            </section>
          </div>

          <div className="trading-panel__today-column trading-panel__today-column--side">
            <section className="trading-panel__today-section">
              <h3>从上一步到现在</h3>
              <ul className="trading-panel__today-list">
                {changes.length ? changes.map((change) => (
                  <li key={change.id}>
                    <strong>{change.label}</strong>
                    <span>{change.summary}</span>
                  </li>
                )) : <li><span>暂时没有需要单独提醒的重要变化。</span></li>}
              </ul>
            </section>

            <section className="trading-panel__today-section trading-panel__today-section--support">
              <h3>如果我没空</h3>
              <p>{overview?.unattendedAction ?? '默认不新增动作，保留记录并等待下一次确认。'}</p>
              <div className="trading-panel__evidence-heading">
                <h3>查看依据</h3>
                {evidence.length ? (
                  <button
                    type="button"
                    className="trading-panel__evidence-open"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      setShowEvidence(true)
                    }}
                  >打开全部（{evidence.length}）</button>
                ) : null}
              </div>
              <ul className="trading-panel__evidence-list">
                {evidencePreview.length ? evidencePreview.map((item) => (
                  <li key={item.id}>
                    <span>{item.label}</span>
                    <small>{item.sha256 ? item.sha256.slice(0, 18) : item.kind}</small>
                  </li>
                )) : <li><span>当前没有可打开的依据索引。</span></li>}
              </ul>
            </section>
          </div>
        </div>
      </div>
      {showEvidence ? (
        <div
          className="trading-panel__evidence-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="这轮判断的全部依据"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="trading-panel__evidence-dialog-card">
            <header>
              <div>
                <strong>这轮判断的全部依据</strong>
                <small>共 {evidence.length} 项，按判断链路顺序排列</small>
              </div>
              <button type="button" onClick={() => setShowEvidence(false)}>关闭</button>
            </header>
            <ol>
              {evidence.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <span>类型：{item.kind}</span>
                  <span>时点：{formatFactTime(item.occurredAt)}</span>
                  <span>信息性质：{item.informationNature ?? '未标明'}</span>
                  <code>{item.sha256 ?? item.id}</code>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MarketOverview({ snapshot }: { snapshot: TradingWorkbenchSnapshot }) {
  const dualCycleState = resolveDualCycleBoardState(snapshot.dualCycleBoard)
  if (dualCycleState.mode === 'invalid') return <DualCycleContractUnavailable />
  if (dualCycleState.mode === 'valid') return <DualCycleMarketOverview board={dualCycleState.board} />
  const market = snapshot.market
  const recentSentiment = market?.recentSentiment
  const recentFundFlow = market?.recentFundFlow
  const sentimentSessions = recentSentiment?.sessions ?? []
  const flowSessions = recentFundFlow?.structuralFlow?.sessions ?? []
  const etfProxy = recentFundFlow?.etfProxy
  const externalFlow = recentFundFlow?.externalDailyFlow
  const [activeTab, setActiveTab] = useState<'overview' | 'sentiment' | 'flow'>('overview')
  const changeTab = (tab: 'overview' | 'sentiment' | 'flow') => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setActiveTab(tab)
  }
  return (
    <div className="trading-panel__body trading-panel__market">
      <div className="trading-panel__market-tabs" role="tablist" aria-label="市场数据视图">
        <button type="button" role="tab" aria-selected={activeTab === 'overview'} onPointerDown={(event) => event.stopPropagation()} onClick={changeTab('overview')}>一眼看懂</button>
        <button type="button" role="tab" aria-selected={activeTab === 'sentiment'} onPointerDown={(event) => event.stopPropagation()} onClick={changeTab('sentiment')}>近期情绪</button>
        <button type="button" role="tab" aria-selected={activeTab === 'flow'} onPointerDown={(event) => event.stopPropagation()} onClick={changeTab('flow')}>资金流向</button>
      </div>

      {activeTab === 'overview' ? (
        <div className="trading-panel__market-view" role="tabpanel">
          <div className="trading-panel__metrics">
            <div><span>环境许可</span><strong>{market?.environmentVerdict ?? '—'}</strong></div>
            <div><span>市场节点</span><strong>{market?.nodeVerdict ?? '—'}</strong></div>
            <div><span>涨停 / 跌停</span><strong>{market?.limitUpTotal ?? '—'} / {market?.limitDownTotal ?? '—'}</strong></div>
            <div><span>最高连板</span><strong>{market?.highestBoardLevel ? `${market.highestBoardLevel} 板` : '—'}</strong></div>
          </div>
          <div className="trading-panel__market-briefs">
            <article data-kind="sentiment">
              <header><span>近况怎么变</span><b data-state={recentSentiment?.status ?? 'UNAVAILABLE'}>{marketDataStatusLabel(recentSentiment?.status)}</b></header>
              <strong>{recentSentiment?.headline ?? '近期情绪序列尚未接入。'}</strong>
              <small>{recentSentiment?.currentAssessment ?? '等待同口径历史快照。'}</small>
            </article>
            <article data-kind="flow">
              <header><span>资金最近往哪去</span><b data-state={recentFundFlow?.status ?? 'UNAVAILABLE'}>{marketDataStatusLabel(recentFundFlow?.status)}</b></header>
              <strong>{recentFundFlow?.headline ?? '近期资金口径尚未接入。'}</strong>
              <small>{recentFundFlow?.structuralFlow?.trendSummary ?? '等待结构资金历史。'}</small>
            </article>
          </div>
          <div className="trading-panel__themes">
            {snapshot.themes.slice(0, 5).map((theme) => (
              <span key={theme.name}><strong>{theme.name}</strong>{theme.heat === undefined ? null : ` ${theme.heat.toFixed(1)}`}</span>
            ))}
          </div>
          {market?.summaryLines?.[0] ? <p>{market.summaryLines[0]}</p> : null}
        </div>
      ) : null}

      {activeTab === 'sentiment' ? (
        <div className="trading-panel__market-view" role="tabpanel">
          <section className="trading-panel__market-section">
            <header>
              <div><span>{recentSentiment?.windowLabel ?? '近期'}</span><strong>市场情绪变化</strong></div>
              <b data-state={recentSentiment?.status ?? 'UNAVAILABLE'}>{marketDataStatusLabel(recentSentiment?.status)}</b>
            </header>
            <p>{recentSentiment?.headline ?? '尚无同口径历史情绪。'}</p>
            <div className="trading-panel__sentiment-timeline">
              {sentimentSessions.map((session, index) => (
                <article key={`${session.tradeDate ?? 'session'}-${index}`} data-state={session.sentimentStatus ?? 'PARTIAL'}>
                  <time>{formatShortTradeDate(session.tradeDate)}</time>
                  <strong>{session.nodeVerdict ?? '未知'}</strong>
                  <small>{session.environmentVerdict ?? '环境未知'}</small>
                  <span>涨停/跌停 {session.limitUpTotal ?? '—'}/{session.limitDownTotal ?? '—'}</span>
                  <span>高度 {session.highestBoardLevel ?? '—'} 板</span>
                </article>
              ))}
            </div>
          </section>
          <section className="trading-panel__market-section">
            <header><div><span>七维证据</span><strong>哪些能看，哪些还缺</strong></div></header>
            <div className="trading-panel__sentiment-coverage">
              {(recentSentiment?.dimensionCoverage ?? []).map((item) => (
                <article key={item.key ?? item.label} data-state={item.status ?? 'MISSING'}>
                  <div><strong>{item.label ?? item.key}</strong><b>{marketDataStatusLabel(item.status)}</b></div>
                  <small>{item.detail ?? '未提供说明'}</small>
                </article>
              ))}
            </div>
            <small className="trading-panel__market-boundary">{recentSentiment?.methodBoundary ?? '缺失维度不做推断。'}</small>
          </section>
        </div>
      ) : null}

      {activeTab === 'flow' ? (
        <div className="trading-panel__market-view" role="tabpanel">
          <section className="trading-panel__market-section">
            <header>
              <div><span>{recentFundFlow?.structuralFlow?.basisLabel ?? '结构资金'}</span><strong>方向迁移</strong></div>
              <b data-state={recentFundFlow?.structuralFlow?.status ?? 'UNAVAILABLE'}>{marketDataStatusLabel(recentFundFlow?.structuralFlow?.status)}</b>
            </header>
            <p>{recentFundFlow?.headline ?? '结构资金数据尚未接入。'}</p>
            <div className="trading-panel__flow-timeline">
              {flowSessions.map((session, index) => (
                <article key={`${session.tradeDate ?? 'flow'}-${index}`} data-state={session.status ?? 'PARTIAL'}>
                  <time>{formatShortTradeDate(session.tradeDate)}</time>
                  <strong>{session.dominantThemeArchetype ?? '权重缺失'}</strong>
                  <span>{session.dominantPrototype ?? session.flowMode ?? '方向未知'}</span>
                </article>
              ))}
            </div>
          </section>
          <div className="trading-panel__fund-source-grid">
            <section className="trading-panel__market-section" data-kind="etf">
              <header>
                <div><span>{etfProxy?.basisLabel ?? 'ETF代理'}</span><strong>{etfProxy?.label ?? '不可用'}</strong></div>
                <b data-state={etfProxy?.status ?? 'UNAVAILABLE'}>{marketDataStatusLabel(etfProxy?.status)}</b>
              </header>
              <div className="trading-panel__fund-metrics">
                <span><b>{etfProxy?.creationCount ?? '—'}/{etfProxy?.coverage ?? '—'}</b>创设占优</span>
                <span><b>{etfProxy?.redemptionCount ?? '—'}/{etfProxy?.coverage ?? '—'}</b>赎回占优</span>
                <span><b>{formatSignedPercent(etfProxy?.medianShareChange3dPct)}</b>份额中位变化</span>
              </div>
              <small>证据日 {etfProxy?.evidenceDate ?? '—'}；验证 {etfProxy?.validationStatus ?? 'UNKNOWN'}；{etfProxy?.decisionImpactEligible ? '可参与环境修正' : '只观察，不影响参与权限'}</small>
            </section>
            <section className="trading-panel__market-section" data-kind="external">
              <header>
                <div><span>{externalFlow?.basisLabel ?? '外部资金日报'}</span><strong>{externalFlow?.status === 'STALE' ? '不能当近期数据' : marketDataStatusLabel(externalFlow?.status)}</strong></div>
                <b data-state={externalFlow?.status ?? 'UNAVAILABLE'}>{marketDataStatusLabel(externalFlow?.status)}</b>
              </header>
              <p>{externalFlow?.summaryLines?.[0] ?? '没有可用的外部主力资金日报。'}</p>
              <small>报告交易日 {externalFlow?.reportTradeDate ?? '—'}；数据时点 {externalFlow?.asOf ?? '—'}</small>
            </section>
          </div>
          <small className="trading-panel__market-boundary">{recentFundFlow?.methodBoundary ?? '不同资金口径不混算。'}</small>
        </div>
      ) : null}
    </div>
  )
}

function HistoricalReplayBadge() {
  return (
    <span
      className="trading-panel__state-badge"
      data-state="HISTORICAL_REPLAY"
      title="这是已结束时点的不可变回放，只用于复盘，不作当前行情。"
    >
      <span aria-hidden="true">↺</span>
      <strong>历史回放</strong>
      <small>仅用于复盘</small>
    </span>
  )
}

function StockPool({ snapshot }: { snapshot: TradingWorkbenchSnapshot }) {
  const dualCycleState = resolveDualCycleBoardState(snapshot.dualCycleBoard)
  if (dualCycleState.mode === 'invalid') return <DualCycleContractUnavailable />
  if (dualCycleState.mode === 'valid') return <DualCycleCandidateLanes board={dualCycleState.board} />
  return (
    <div className="trading-panel__body trading-panel__list">
      <div className="trading-panel__stock trading-panel__stock--header">
        <span>股票</span><span>分数</span><span>动作</span><span>依据</span>
      </div>
      {snapshot.stocks.slice(0, 12).map((stock) => (
        <div className="trading-panel__stock" key={stock.code}>
          <span><strong>{stock.name}</strong><small>{stock.code}</small></span>
          <span>{stock.score?.toFixed(1) ?? '—'}</span>
          <span className="trading-panel__tag">{stock.action ?? '观察'}</span>
          <span title={stock.reason}>{stock.reason ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

function Announcements({ snapshot }: { snapshot: TradingWorkbenchSnapshot }) {
  return (
    <div className="trading-panel__body trading-panel__list">
      {snapshot.announcements.length === 0 ? <div className="trading-panel__empty"><strong>暂无启用观察条目</strong><span>后台公告观察源有新内容后会自动刷新。</span></div> : null}
      {snapshot.announcements.slice(0, 10).map((item) => (
        <article
          className="trading-panel__announcement"
          data-direction={item.direction ?? 'neutral'}
          data-verification-status={item.verificationStatus ?? 'UNVERIFIED'}
          key={item.id}
        >
          <div>
            <strong>{item.title}</strong>
            <span className="trading-panel__verification-badge">
              {item.verificationStatus === 'VERIFIED' ? '官方原文证据已核验' : '待核验'}
            </span>
            <time>{item.publishedAt ?? '时间未标注'}</time>
          </div>
          <p>
            <b>观察摘要 / 人工解读</b>
            <span>{item.summary ?? '暂无摘要'}</span>
          </p>
          <small>{[...(item.names ?? []), ...(item.codes ?? [])].join(' · ') || '题材级公告'}</small>
        </article>
      ))}
    </div>
  )
}

function SystemStatus({ snapshot }: { snapshot: TradingWorkbenchSnapshot }) {
  const readinessState = resolveOperationalState(snapshot.readiness?.state)
  return (
    <div className="trading-panel__body trading-panel__system">
      <div className="trading-panel__readiness" data-state={readinessState}>
        <span>协作快照状态</span>
        <FactStateBadge state={readinessState} />
        <small>现在可参与：{snapshot.todayOverview?.canParticipate ? '是' : '否'} · 可供研究复核：{snapshot.readiness?.observationEligible ? '是' : '否'}</small>
      </div>
      {snapshot.services.map((service) => {
        const serviceState = resolveOperationalState(service.status)
        return (
          <div className="trading-panel__service" data-state={serviceState} key={service.name}>
            <span>{service.name}</span><FactStateBadge state={serviceState} />{service.detail ? <small>{service.detail}</small> : null}
          </div>
        )
      })}
    </div>
  )
}

export function TradingPanelContent({ shape }: { shape: TradingPanelShape }) {
  useSyncExternalStore(subscribe, version, version)
  const viewState = viewStateResolver()
  const connecting = viewState?.kind === 'connecting' ? viewState : undefined
  const snapshot = viewState?.kind === 'snapshot' ? viewState.snapshot : undefined
  const dualCycleState = resolveDualCycleBoardState(snapshot?.dualCycleBoard)
  const panelSnapshot = connecting ? undefined : panelSnapshotMeta(snapshot, shape.props.panelKind)
  const factState = connecting ? 'CONNECTING' : resolveTradingFactStateFromEnvelope(panelSnapshot)
  const statePresentation = getTradingFactStatePresentation(factState)
  const isHistoricalYishuiPanel = shape.props.panelKind === 'yishui-inference'
    && snapshot?.yishuiInferenceBoard?.mode === 'HISTORICAL_REPLAY'
  const panelTitle = shape.props.panelKind === 'announcements'
    ? '公告观察源'
    : shape.props.panelKind === 'today-overview'
      ? '今天怎么看'
      : shape.props.panelKind === 'yishui-inference'
        ? '义水北路推演画板'
      : shape.props.panelKind === 'market-overview' && dualCycleState.mode !== 'absent'
        ? '双周期观察画板'
        : shape.props.title
  const content = connecting
    ? <EmptyPanel snapshot={undefined} connecting={connecting} />
    : !panelSnapshot || panelSnapshot.status === 'unavailable'
    ? <EmptyPanel snapshot={panelSnapshot} />
    : shape.props.panelKind === 'today-overview'
      ? <TodayOverview snapshot={snapshot!} />
      : shape.props.panelKind === 'market-overview'
      ? <MarketOverview snapshot={snapshot!} />
      : shape.props.panelKind === 'stock-pool'
        ? <StockPool snapshot={snapshot!} />
      : shape.props.panelKind === 'announcements'
          ? <Announcements snapshot={snapshot!} />
          : shape.props.panelKind === 'yishui-inference'
            ? <YishuiInferenceBoard
                value={snapshot!.yishuiInferenceBoard}
                status={snapshot!.yishuiInferenceStatus}
              />
          : <SystemStatus snapshot={snapshot!} />

  return (
    <article
      className="trading-panel"
      data-fact-state={isHistoricalYishuiPanel ? 'HISTORICAL_REPLAY' : factState}
      data-panel-kind={shape.props.panelKind}
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <header>
        {isHistoricalYishuiPanel ? <HistoricalReplayBadge /> : <FactStateBadge state={factState} />}
        <strong>{panelTitle}</strong>
        <dl className="trading-panel__fact-meta">
          <div><dt>来源</dt><dd>{connecting ? '等待首个快照' : panelSnapshot?.sourceLabel ?? '选股后台（未连接）'}</dd></div>
          <div><dt>交易日</dt><dd>{panelSnapshot?.tradeDate ?? '未提供'}</dd></div>
          <div><dt>源时点</dt><dd>{formatFactTime(panelSnapshot?.sourceGeneratedAt)}</dd></div>
          <div>
            <dt>{shape.props.panelKind === 'yishui-inference'
              ? isHistoricalYishuiPanel ? '当时有效至' : '当前有效至'
              : '有效截止'}</dt>
            <dd>{formatFactTime(panelSnapshot?.freshUntil)}</dd>
          </div>
          <div><dt>更新时点</dt><dd>{formatFactTime(panelSnapshot?.updatedAt)}</dd></div>
          <div><dt>新鲜度</dt><dd>{isHistoricalYishuiPanel ? '历史回放（不作当前行情）' : freshnessLabel(panelSnapshot)}</dd></div>
          {factState === 'DEGRADED' ? <>
            <div><dt>上次成功</dt><dd>{formatFactTime(panelSnapshot?.lastSuccessAt)}</dd></div>
            <div><dt>最近失败</dt><dd>{formatFactTime(panelSnapshot?.lastErrorAt)}</dd></div>
          </> : null}
        </dl>
      </header>
      <div className="trading-panel__content">
        {isHistoricalYishuiPanel || factState === 'LIVE' || factState === 'CURRENT' ? null : (
          <div className="trading-panel__state-overlay" data-state={factState} role="status">
            <strong>{statePresentation.symbol} {statePresentation.label}</strong>
            <span>{humanSystemMessage(connecting?.message ?? panelSnapshot?.message, statePresentation.explanation)}</span>
          </div>
        )}
        <div className="trading-panel__content-body">{content}</div>
      </div>
      <footer>
        <span>可用时点：{formatFactTime(panelSnapshot?.availableAt)}</span>
        <span>更新通道：{transportLabel(connecting?.transport.state ?? panelSnapshot?.transport?.state)}</span>
        <span>版本：{snapshot?.revision?.slice(0, 12) ?? '—'}</span>
      </footer>
    </article>
  )
}

export class TradingPanelShapeUtil extends BaseBoxShapeUtil<TradingPanelShape> {
  static override type = TRADING_PANEL_SHAPE_TYPE
  static override props = tradingPanelShapeProps
  static override migrations = tradingPanelShapeMigrations

  override getDefaultProps(): TradingPanelShape['props'] {
    return { w: 720, h: 420, panelKind: 'market-overview', title: '交易数据' }
  }

  override getGeometry(shape: TradingPanelShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override canEdit() {
    return false
  }

  override component(shape: TradingPanelShape) {
    return <HTMLContainer><TradingPanelContent shape={shape} /></HTMLContainer>
  }

  override getIndicatorPath() {
    return undefined
  }

  override onResize(shape: TradingPanelShape, info: TLResizeInfo<TradingPanelShape>) {
    return resizeBox(shape, info)
  }
}

export const tradingPanelShapeUtils = [TradingPanelShapeUtil] as const
