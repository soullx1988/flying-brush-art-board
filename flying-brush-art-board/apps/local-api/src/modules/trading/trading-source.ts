import { createHash, randomUUID } from 'node:crypto'

import type {
  TradingTodayOverview,
  TradingWorkbenchAnnouncement,
  TradingWorkbenchSnapshot,
} from '@infinite-board/tldraw-adapter'

export const DEFAULT_TRADING_COLLABORATION_URL = 'http://127.0.0.1:8765/api/collaboration/today'

const COLLABORATION_SCHEMA_VERSION = 'collaboration-today-v1'
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000
const DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000

type JsonRecord = Record<string, unknown>
type Fetcher = typeof fetch

export type TradingSnapshotStatus = 'ready' | 'stale' | 'degraded' | 'unavailable'
export type TradingFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN'
export type TradingSourceHealth = 'CURRENT' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE'

export interface TradingStockDetail {
  code: string
  name: string
  score?: number
  action?: string
  reason?: string
  marketSegment?: string
  price?: number
  changePct?: number
  themes: string[]
  source: 'ranking' | 'writebackRanking'
  asOf?: string
}

export interface TradingBridgeSnapshot extends Omit<TradingWorkbenchSnapshot, 'status'> {
  status: TradingSnapshotStatus
  sourceGeneratedAt: string | null
  availableAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  errorActive: boolean
  ageMs: number | null
  ageEvaluatedAt: string
  freshness: TradingFreshness
  sourceHealth: TradingSourceHealth
  sourceHash: string | null
  freshUntil: string | null
  staleSince: string | null
}

export interface TradingSnapshotState {
  revision: string
  streamId: string
  sequence: number
  snapshot: TradingBridgeSnapshot
  stocks: ReadonlyMap<string, TradingStockDetail>
}

export interface TradingSourceOptions {
  collaborationUrl?: string
  fetch?: Fetcher
  pollIntervalMs?: number
  requestTimeoutMs?: number
  maxJsonBytes?: number
  /** Retained for caller compatibility. Business freshness is owned by 06. */
  staleAfterMs?: number
  maxFutureSkewMs?: number
  now?: () => Date
  /** @deprecated 08 no longer reads any 07 directory. */
  dataDirectory?: string
}

interface CollaborationEnvelope {
  ok: boolean
  snapshotId: string
  snapshotCanonical: string
  assembledAt: string
  asOf: string
  snapshot: JsonRecord
  lineage: JsonRecord
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requireRecord(value: unknown, code: string): JsonRecord {
  if (!isRecord(value)) throw new Error(code)
  return value
}

function requireArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(code)
  return value
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code)
  return value.trim()
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw new Error(code)
  return value
}

function requireTimestamp(value: unknown, code: string): string {
  const result = requireText(value, code)
  if (!Number.isFinite(Date.parse(result)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) throw new Error(code)
  return result
}

function optionalTimestamp(value: unknown, code: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return requireTimestamp(value, code)
}

function optionalDate(value: unknown, code: string): string {
  if (value === null || value === undefined || value === '') return ''
  const result = requireText(value, code)
  if (!DATE_PATTERN.test(result)) throw new Error(code)
  return result
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Mirrors Python json.dumps(sort_keys=True, ensure_ascii=False, separators=(',', ':')). */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('TRADING_COLLABORATION_NON_FINITE_NUMBER')
    if (Object.is(value, -0)) return '-0.0'
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('TRADING_COLLABORATION_JSON_VALUE_INVALID')
}

function validateDecisionStep(value: unknown): void {
  const step = requireRecord(value, 'TRADING_COLLABORATION_DECISION_STEP_INVALID')
  requireText(step.id, 'TRADING_COLLABORATION_DECISION_STEP_ID_MISSING')
  requireText(step.label, 'TRADING_COLLABORATION_DECISION_STEP_LABEL_MISSING')
  requireText(step.status, 'TRADING_COLLABORATION_DECISION_STEP_STATUS_MISSING')
  requireText(step.summary, 'TRADING_COLLABORATION_DECISION_STEP_SUMMARY_MISSING')
  optionalTimestamp(step.occurredAt, 'TRADING_COLLABORATION_DECISION_STEP_TIME_INVALID')
  optionalTimestamp(step.validUntil, 'TRADING_COLLABORATION_DECISION_STEP_VALID_UNTIL_INVALID')
  if (step.evidenceIds !== undefined && !Array.isArray(step.evidenceIds)) {
    throw new Error('TRADING_COLLABORATION_DECISION_STEP_EVIDENCE_INVALID')
  }
}

function validateChange(value: unknown): void {
  const change = requireRecord(value, 'TRADING_COLLABORATION_CHANGE_INVALID')
  requireText(change.id, 'TRADING_COLLABORATION_CHANGE_ID_MISSING')
  requireText(change.label, 'TRADING_COLLABORATION_CHANGE_LABEL_MISSING')
  requireText(change.summary, 'TRADING_COLLABORATION_CHANGE_SUMMARY_MISSING')
}

function validateEvidence(value: unknown): void {
  const evidence = requireRecord(value, 'TRADING_COLLABORATION_EVIDENCE_INVALID')
  requireText(evidence.id, 'TRADING_COLLABORATION_EVIDENCE_ID_MISSING')
  requireText(evidence.label, 'TRADING_COLLABORATION_EVIDENCE_LABEL_MISSING')
  requireText(evidence.kind, 'TRADING_COLLABORATION_EVIDENCE_KIND_MISSING')
  const hash = requireText(evidence.sha256, 'TRADING_COLLABORATION_EVIDENCE_HASH_MISSING')
  if (!HASH_PATTERN.test(hash)) throw new Error('TRADING_COLLABORATION_EVIDENCE_HASH_INVALID')
  requireText(evidence.informationNature, 'TRADING_COLLABORATION_EVIDENCE_NATURE_MISSING')
  optionalTimestamp(evidence.occurredAt, 'TRADING_COLLABORATION_EVIDENCE_TIME_INVALID')
}

function isIntradayStageOnlyReadOnlyProjection(ok: boolean, snapshot: JsonRecord): boolean {
  const today = isRecord(snapshot.todayOverview) ? snapshot.todayOverview : {}
  const readiness = isRecord(snapshot.readiness) ? snapshot.readiness : {}
  const reasonCodes = Array.isArray(today.reasonCodes) ? today.reasonCodes : []
  const isCompleteCurrentFrame = snapshot.status === 'ready'
    && snapshot.sourceHealth === 'CURRENT'
    && today.phaseStatus === 'READY'
    && today.pipelineHealth === 'READY'
    && readiness.state === 'READY'
  const isPartialCurrentFrame = snapshot.status === 'degraded'
    && snapshot.sourceHealth === 'DEGRADED'
    && today.phaseStatus === 'REVIEW_ONLY'
    && today.pipelineHealth === 'DEGRADED'
    && readiness.state === 'PARTIAL'
  return ok
    && (isCompleteCurrentFrame || isPartialCurrentFrame)
    && snapshot.freshness === 'CURRENT'
    && today.phase === 'intraday_discovery'
    && today.currentPhase === 'intraday_discovery'
    && today.planProjectionMode === 'INTRADAY_READ_ONLY'
    && today.canParticipate === false
    && today.overallState === 'OBSERVATION_ONLY'
    && today.participationStatus === 'REVIEW_ONLY'
    && today.sourceExecutionAuthority === 'REVIEW_ONLY'
    && today.effectiveExecutionAuthority === 'DENIED'
    && today.executionAuthority === 'DENIED'
    && readiness.executionEligible === false
    && readiness.sourceExecutionEligible === false
    && readiness.observationEligible === true
    && reasonCodes.length === 1
    && reasonCodes[0] === 'INTRADAY_STAGE_ONLY_BACKGROUND'
}

function validateLineage(lineage: JsonRecord, ok: boolean, snapshot: JsonRecord): void {
  if (!ok && Object.keys(lineage).length === 0) return
  const today = isRecord(snapshot.todayOverview) ? snapshot.todayOverview : {}
  const readiness = isRecord(snapshot.readiness) ? snapshot.readiness : {}
  const isIntradayStageOnly = isIntradayStageOnlyReadOnlyProjection(ok, snapshot)
  const isPreopenFreezeReadOnlyProjection = ok
    && today.currentPhase === 'preopen_freeze_readonly'
    && today.canParticipate === false
    && today.effectiveExecutionAuthority === 'DENIED'
    && readiness.executionEligible === false
  for (const key of ['stage', 'freeze', 'report'] as const) {
    const item = requireRecord(lineage[key], `TRADING_COLLABORATION_LINEAGE_${key.toUpperCase()}_INVALID`)
    const id = requireText(item.id, `TRADING_COLLABORATION_LINEAGE_${key.toUpperCase()}_ID_MISSING`)
    const hash = typeof item.sha256 === 'string' ? item.sha256.trim().toLowerCase() : ''
    if (hash) {
      if (!HASH_PATTERN.test(hash)) throw new Error(`TRADING_COLLABORATION_LINEAGE_${key.toUpperCase()}_HASH_INVALID`)
    } else {
      const isKnownHashlessProjection = key === 'stage'
        && isPreopenFreezeReadOnlyProjection
        && id === 'projection:preopen_freeze_read_only'
      const isExplicitlyUnverifiedIntradayInput = isIntradayStageOnly
        && (key === 'freeze' || key === 'report')
        && id === `${key}:unverified`
      if (!isKnownHashlessProjection && !isExplicitlyUnverifiedIntradayInput && (ok || id !== `${key}:unverified`)) {
        throw new Error(`TRADING_COLLABORATION_LINEAGE_${key.toUpperCase()}_HASH_MISSING`)
      }
    }
  }
  const calendar = requireRecord(lineage.calendar, 'TRADING_COLLABORATION_LINEAGE_CALENDAR_INVALID')
  const calendarVerified = requireBoolean(calendar.verified, 'TRADING_COLLABORATION_CALENDAR_VERIFIED_MISSING')
  const calendarPolicy = typeof calendar.policy === 'string' ? calendar.policy.trim() : ''
  if ((calendarVerified || (ok && !isIntradayStageOnly)) && !calendarPolicy) {
    throw new Error('TRADING_COLLABORATION_CALENDAR_POLICY_MISSING')
  }
}

function validateSnapshot(snapshot: JsonRecord, envelopeOk: boolean, lineage: JsonRecord): void {
  const status = requireText(snapshot.status, 'TRADING_COLLABORATION_STATUS_MISSING')
  if (!['ready', 'stale', 'degraded', 'unavailable'].includes(status)) {
    throw new Error('TRADING_COLLABORATION_STATUS_INVALID')
  }
  requireTimestamp(snapshot.updatedAt, 'TRADING_COLLABORATION_UPDATED_AT_INVALID')
  requireText(snapshot.sourceLabel, 'TRADING_COLLABORATION_SOURCE_LABEL_MISSING')
  requireArray(snapshot.themes, 'TRADING_COLLABORATION_THEMES_INVALID')
  requireArray(snapshot.stocks, 'TRADING_COLLABORATION_STOCKS_INVALID')
  requireArray(snapshot.announcements, 'TRADING_COLLABORATION_ANNOUNCEMENTS_INVALID')
  requireArray(snapshot.services, 'TRADING_COLLABORATION_SERVICES_INVALID')

  const today = requireRecord(snapshot.todayOverview, 'TRADING_COLLABORATION_TODAY_OVERVIEW_INVALID')
  const currentPhase = requireText(today.currentPhase, 'TRADING_COLLABORATION_CURRENT_PHASE_MISSING')
  requireText(today.currentPhaseLabel, 'TRADING_COLLABORATION_CURRENT_PHASE_LABEL_MISSING')
  requireText(today.overallState, 'TRADING_COLLABORATION_OVERALL_STATE_MISSING')
  optionalDate(today.sourceTradeDate, 'TRADING_COLLABORATION_SOURCE_TRADE_DATE_INVALID')
  const decisionTradeDate = optionalDate(today.decisionTradeDate, 'TRADING_COLLABORATION_DECISION_TRADE_DATE_INVALID')
  optionalDate(today.planTradeDate, 'TRADING_COLLABORATION_PLAN_TRADE_DATE_INVALID')
  optionalTimestamp(today.dataAsOf, 'TRADING_COLLABORATION_DATA_AS_OF_INVALID')
  const validUntil = optionalTimestamp(today.validUntil, 'TRADING_COLLABORATION_VALID_UNTIL_INVALID')
  optionalTimestamp(today.nextKeyTime, 'TRADING_COLLABORATION_NEXT_KEY_TIME_INVALID')
  const canParticipate = requireBoolean(today.canParticipate, 'TRADING_COLLABORATION_CAN_PARTICIPATE_MISSING')
  requireText(today.participationStatus, 'TRADING_COLLABORATION_PARTICIPATION_STATUS_MISSING')
  requireText(today.participationSummary, 'TRADING_COLLABORATION_PARTICIPATION_SUMMARY_MISSING')
  const sourceAuthority = requireText(today.sourceExecutionAuthority, 'TRADING_COLLABORATION_SOURCE_AUTHORITY_MISSING')
  const effectiveAuthority = requireText(today.effectiveExecutionAuthority, 'TRADING_COLLABORATION_EFFECTIVE_AUTHORITY_MISSING')
  if (requireText(today.executionAuthority, 'TRADING_COLLABORATION_COMPATIBILITY_AUTHORITY_MISSING') !== effectiveAuthority) {
    throw new Error('TRADING_COLLABORATION_AUTHORITY_CONFLICT')
  }
  requireText(today.unattendedAction, 'TRADING_COLLABORATION_UNATTENDED_ACTION_MISSING')

  const decisionChain = requireArray(today.decisionChain, 'TRADING_COLLABORATION_DECISION_CHAIN_INVALID')
  const changes = requireArray(today.changes, 'TRADING_COLLABORATION_CHANGES_INVALID')
  const evidenceRefs = requireArray(today.evidenceRefs, 'TRADING_COLLABORATION_EVIDENCE_REFS_INVALID')
  decisionChain.forEach(validateDecisionStep)
  changes.forEach(validateChange)
  evidenceRefs.forEach(validateEvidence)
  for (const [key, nested] of [['decisionChain', decisionChain], ['changes', changes], ['evidenceRefs', evidenceRefs]] as const) {
    const topLevel = requireArray(snapshot[key], `TRADING_COLLABORATION_${key.toUpperCase()}_INVALID`)
    if (canonicalJson(topLevel) !== canonicalJson(nested)) throw new Error('TRADING_COLLABORATION_DUPLICATE_VIEW_CONFLICT')
  }

  const readiness = requireRecord(snapshot.readiness, 'TRADING_COLLABORATION_READINESS_INVALID')
  const executionEligible = requireBoolean(readiness.executionEligible, 'TRADING_COLLABORATION_EXECUTION_ELIGIBLE_MISSING')
  const calendar = Object.keys(lineage).length > 0
    ? requireRecord(lineage.calendar, 'TRADING_COLLABORATION_LINEAGE_CALENDAR_INVALID')
    : {}
  const calendarVerified = calendar.verified === true
  const asOfDate = optionalDate(snapshot.tradeDate, 'TRADING_COLLABORATION_TRADE_DATE_INVALID')
  const allowIsConsistent = envelopeOk
    && status === 'ready'
    && currentPhase === 'auction_final'
    && canParticipate
    && executionEligible
    && sourceAuthority === 'ALLOWED'
    && effectiveAuthority === 'ALLOWED'
    && calendarVerified
    && Boolean(decisionTradeDate && asOfDate === decisionTradeDate)
    && Boolean(validUntil)
  if (canParticipate !== allowIsConsistent || (effectiveAuthority === 'ALLOWED') !== allowIsConsistent) {
    throw new Error('TRADING_COLLABORATION_PERMISSION_CONFLICT')
  }
  if (!envelopeOk && (canParticipate || executionEligible || effectiveAuthority !== 'DENIED')) {
    throw new Error('TRADING_COLLABORATION_BLOCKED_ENVELOPE_TOO_PERMISSIVE')
  }
}

function parseEnvelope(value: unknown, now: Date, maxFutureSkewMs: number): CollaborationEnvelope {
  const envelope = requireRecord(value, 'TRADING_COLLABORATION_ENVELOPE_INVALID')
  if (envelope.schemaVersion !== COLLABORATION_SCHEMA_VERSION) throw new Error('TRADING_COLLABORATION_SCHEMA_INVALID')
  const ok = requireBoolean(envelope.ok, 'TRADING_COLLABORATION_OK_MISSING')
  const snapshotId = requireText(envelope.snapshotId, 'TRADING_COLLABORATION_SNAPSHOT_ID_MISSING').toLowerCase()
  if (!HASH_PATTERN.test(snapshotId)) throw new Error('TRADING_COLLABORATION_SNAPSHOT_ID_INVALID')
  const snapshotCanonical = requireText(
    envelope.snapshotCanonical,
    'TRADING_COLLABORATION_SNAPSHOT_CANONICAL_MISSING',
  )
  const assembledAt = requireTimestamp(envelope.assembledAt, 'TRADING_COLLABORATION_ASSEMBLED_AT_INVALID')
  const asOf = requireTimestamp(envelope.asOf, 'TRADING_COLLABORATION_AS_OF_INVALID')
  if (Date.parse(asOf) - now.getTime() > maxFutureSkewMs) throw new Error('TRADING_COLLABORATION_AS_OF_IN_FUTURE')
  const snapshot = requireRecord(envelope.snapshot, 'TRADING_COLLABORATION_SNAPSHOT_INVALID')
  const lineage = requireRecord(envelope.lineage, 'TRADING_COLLABORATION_LINEAGE_INVALID')
  const canonicalHash = `sha256:${createHash('sha256').update(snapshotCanonical, 'utf8').digest('hex')}`
  if (canonicalHash !== snapshotId) {
    throw new Error('TRADING_COLLABORATION_SNAPSHOT_HASH_MISMATCH')
  }
  let canonicalBasis: JsonRecord
  try {
    canonicalBasis = requireRecord(
      JSON.parse(snapshotCanonical) as unknown,
      'TRADING_COLLABORATION_SNAPSHOT_CANONICAL_INVALID',
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'TRADING_COLLABORATION_SNAPSHOT_CANONICAL_INVALID') throw error
    throw new Error('TRADING_COLLABORATION_SNAPSHOT_CANONICAL_INVALID')
  }
  const responseBasis = { schemaVersion: COLLABORATION_SCHEMA_VERSION, asOf, snapshot, lineage }
  // Compare parsed values, not re-serialized bytes. JSON transport erases the
  // lexical distinction between Python's `1.0` and JavaScript's `1`; the exact
  // producer bytes are authenticated above and their meaning must match body.
  if (canonicalJson(canonicalBasis) !== canonicalJson(responseBasis)) {
    throw new Error('TRADING_COLLABORATION_SNAPSHOT_CANONICAL_CONFLICT')
  }
  validateLineage(lineage, ok, snapshot)
  validateSnapshot(snapshot, ok, lineage)
  return { ok, snapshotId, snapshotCanonical, assembledAt, asOf, snapshot, lineage }
}

function normalizeUrl(value: string | undefined): URL {
  let url: URL
  try {
    url = new URL(value?.trim() || DEFAULT_TRADING_COLLABORATION_URL)
  } catch {
    throw new Error('TRADING_COLLABORATION_URL_INVALID')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('TRADING_COLLABORATION_URL_INVALID')
  }
  return url
}

function stockMap(snapshot: TradingBridgeSnapshot): ReadonlyMap<string, TradingStockDetail> {
  const result = new Map<string, TradingStockDetail>()
  for (const stock of snapshot.stocks) {
    result.set(stock.code, {
      ...stock,
      themes: [],
      source: 'ranking',
      ...(snapshot.sourceGeneratedAt ? { asOf: snapshot.sourceGeneratedAt } : {}),
    })
  }
  const leader = snapshot.todayOverview?.auction?.leader
  if (leader && !result.has(leader.code)) {
    result.set(leader.code, {
      code: leader.code,
      name: leader.name,
      ...(leader.marketSegment ? { marketSegment: leader.marketSegment } : {}),
      themes: [],
      source: 'writebackRanking',
      ...(snapshot.sourceGeneratedAt ? { asOf: snapshot.sourceGeneratedAt } : {}),
    })
  }
  return result
}

function failClosedToday(today: TradingTodayOverview | undefined, message: string): TradingTodayOverview {
  return {
    ...(today ?? {}),
    status: 'degraded',
    freshness: 'STALE',
    sourceHealth: 'DEGRADED',
    canParticipate: false,
    overallState: 'SYSTEM_BLOCKED',
    participationStatus: 'SYSTEM_BLOCKED',
    participationSummary: '06 统一快照暂时不可用；最近内容只作背景查看。',
    effectiveExecutionAuthority: 'DENIED',
    executionAuthority: 'DENIED',
    message,
    unattendedAction: '保持观察，不产生新的交易动作。',
  }
}

function unavailableSnapshot(now: Date, message: string): TradingBridgeSnapshot {
  const at = now.toISOString()
  return {
    status: 'unavailable',
    updatedAt: at,
    tradeDate: at.slice(0, 10),
    sourceLabel: '06 人机协作服务',
    message,
    deliveryMode: 'SNAPSHOT',
    sourceGeneratedAt: null,
    availableAt: null,
    lastSuccessAt: null,
    lastErrorAt: at,
    errorActive: true,
    ageMs: null,
    ageEvaluatedAt: at,
    freshness: 'UNKNOWN',
    sourceHealth: 'UNAVAILABLE',
    sourceHash: null,
    freshUntil: null,
    staleSince: null,
    todayOverview: {
      sourceLabel: '06 人机协作服务',
      status: 'unavailable',
      updatedAt: at,
      currentPhase: 'unavailable',
      currentPhaseLabel: '状态不可用',
      overallState: 'SYSTEM_BLOCKED',
      sourceTradeDate: '',
      decisionTradeDate: at.slice(0, 10),
      planTradeDate: '',
      dataAsOf: null,
      validUntil: null,
      nextKeyTime: null,
      canParticipate: false,
      participationStatus: 'SYSTEM_BLOCKED',
      participationSummary: '当前无法读取 06 的统一判断。',
      sourceExecutionAuthority: 'DENIED',
      effectiveExecutionAuthority: 'DENIED',
      executionAuthority: 'DENIED',
      decisionChain: [],
      changes: [],
      evidenceRefs: [],
      unattendedAction: '保持观察，不产生新的交易动作。',
    },
    themes: [],
    stocks: [],
    announcements: [],
    readiness: { state: 'BLOCKED', executionEligible: false, observationEligible: false, reasonCount: 1 },
    services: [{ name: '06统一快照', status: 'UNAVAILABLE', detail: message }],
  }
}

function bridgeSnapshot(envelope: CollaborationEnvelope, receivedAt: Date): TradingBridgeSnapshot {
  const raw = structuredClone(envelope.snapshot) as unknown as TradingWorkbenchSnapshot
  const sourceGeneratedAt = optionalTimestamp(raw.sourceGeneratedAt, 'TRADING_COLLABORATION_SOURCE_GENERATED_AT_INVALID')
  const availableAt = optionalTimestamp(raw.availableAt, 'TRADING_COLLABORATION_AVAILABLE_AT_INVALID')
  const freshUntil = optionalTimestamp(raw.freshUntil, 'TRADING_COLLABORATION_FRESH_UNTIL_INVALID')
  const staleSince = optionalTimestamp(raw.staleSince, 'TRADING_COLLABORATION_STALE_SINCE_INVALID')
  const receivedIso = receivedAt.toISOString()
  return {
    ...raw,
    status: raw.status,
    deliveryMode: 'SNAPSHOT',
    sourceGeneratedAt,
    availableAt,
    lastSuccessAt: receivedIso,
    lastErrorAt: null,
    errorActive: false,
    ageMs: sourceGeneratedAt ? Math.max(0, receivedAt.getTime() - Date.parse(sourceGeneratedAt)) : null,
    ageEvaluatedAt: receivedIso,
    freshness: raw.freshness ?? (raw.status === 'ready' ? 'CURRENT' : raw.status === 'stale' ? 'STALE' : 'UNKNOWN'),
    sourceHealth: raw.sourceHealth ?? (raw.status === 'ready' ? 'CURRENT' : raw.status === 'stale' ? 'STALE' : 'DEGRADED'),
    sourceHash: envelope.snapshotId,
    freshUntil,
    staleSince,
  }
}

export function tradingSourceMetadata(state: TradingSnapshotState) {
  const snapshot = state.snapshot
  return {
    revision: state.revision,
    streamId: state.streamId,
    sequence: state.sequence,
    status: snapshot.status,
    sourceGeneratedAt: snapshot.sourceGeneratedAt,
    availableAt: snapshot.availableAt,
    lastSuccessAt: snapshot.lastSuccessAt,
    lastErrorAt: snapshot.lastErrorAt,
    errorActive: snapshot.errorActive,
    ageMs: snapshot.ageMs,
    ageEvaluatedAt: snapshot.ageEvaluatedAt,
    freshness: snapshot.freshness,
    sourceHealth: snapshot.sourceHealth,
    sourceHash: snapshot.sourceHash,
    freshUntil: snapshot.freshUntil,
    staleSince: snapshot.staleSince,
  }
}

export function tradingWorkbenchSnapshot(state: TradingSnapshotState): TradingWorkbenchSnapshot {
  return {
    ...state.snapshot,
    revision: state.revision,
    streamId: state.streamId,
    sequence: state.sequence,
  }
}

export class TradingSource {
  private readonly collaborationUrl: URL
  private readonly fetcher: Fetcher
  private readonly pollIntervalMs: number
  private readonly requestTimeoutMs: number
  private readonly maxJsonBytes: number
  private readonly maxFutureSkewMs: number
  private readonly now: () => Date
  private readonly streamId = randomUUID()
  private readonly listeners = new Set<(state: TradingSnapshotState) => void>()
  private interval: ReturnType<typeof setInterval> | undefined
  private state: TradingSnapshotState | undefined
  private refreshPromise: Promise<TradingSnapshotState> | undefined
  private sequence = 0

  constructor(options: TradingSourceOptions = {}) {
    this.collaborationUrl = normalizeUrl(options.collaborationUrl)
    this.fetcher = options.fetch ?? globalThis.fetch
    this.pollIntervalMs = Math.max(250, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
    this.maxJsonBytes = Math.max(1024, options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES)
    this.maxFutureSkewMs = Math.max(0, options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS)
    this.now = options.now ?? (() => new Date())
  }

  diagnostics() {
    return {
      source: '06-collaboration-http',
      endpoint: `${this.collaborationUrl.origin}${this.collaborationUrl.pathname}`,
    }
  }

  start(): void {
    if (this.interval) return
    void this.refresh()
    this.interval = setInterval(() => { void this.refresh() }, this.pollIntervalMs)
    this.interval.unref?.()
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
  }

  subscribe(listener: (state: TradingSnapshotState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async getSnapshot(): Promise<TradingSnapshotState> {
    return this.state ?? this.refresh()
  }

  async getStock(code: string): Promise<TradingStockDetail | undefined> {
    return (await this.getSnapshot()).stocks.get(code)
  }

  refresh(): Promise<TradingSnapshotState> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.refreshOnce().finally(() => { this.refreshPromise = undefined })
    return this.refreshPromise
  }

  private publish(snapshot: TradingBridgeSnapshot, revision: string): TradingSnapshotState {
    this.sequence += 1
    const state: TradingSnapshotState = {
      revision,
      streamId: this.streamId,
      sequence: this.sequence,
      snapshot,
      stocks: stockMap(snapshot),
    }
    this.state = state
    for (const listener of this.listeners) listener(state)
    return state
  }

  private publishError(error: unknown, now: Date): TradingSnapshotState {
    const message = error instanceof Error && error.message
      ? error.message
      : 'TRADING_COLLABORATION_UNAVAILABLE'
    const at = now.toISOString()
    const failureRevision = (kind: 'unavailable' | 'degraded') => {
      const digest = createHash('sha256')
        .update(`${this.streamId}:${this.sequence + 1}:${kind}:${message}`, 'utf8')
        .digest('hex')
      return `${kind}:sha256:${digest}`
    }
    if (!this.state) return this.publish(unavailableSnapshot(now, message), failureRevision('unavailable'))
    const current = this.state.snapshot
    const snapshot: TradingBridgeSnapshot = {
      ...current,
      status: 'degraded',
      updatedAt: at,
      message,
      lastErrorAt: at,
      errorActive: true,
      ageMs: current.sourceGeneratedAt ? Math.max(0, now.getTime() - Date.parse(current.sourceGeneratedAt)) : null,
      ageEvaluatedAt: at,
      freshness: 'STALE',
      sourceHealth: 'DEGRADED',
      staleSince: current.staleSince ?? at,
      todayOverview: failClosedToday(current.todayOverview, message),
      readiness: {
        ...(current.readiness ?? {}),
        state: 'BLOCKED',
        executionEligible: false,
      },
    }
    return this.publish(snapshot, failureRevision('degraded'))
  }

  private async refreshOnce(): Promise<TradingSnapshotState> {
    const receivedAt = this.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    timeout.unref?.()
    try {
      const response = await this.fetcher(this.collaborationUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('TRADING_COLLABORATION_HTTP_ERROR')
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new Error('TRADING_COLLABORATION_CONTENT_TYPE_INVALID')
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > this.maxJsonBytes) {
        throw new Error('TRADING_COLLABORATION_RESPONSE_TOO_LARGE')
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > this.maxJsonBytes) throw new Error('TRADING_COLLABORATION_RESPONSE_TOO_LARGE')
      let value: unknown
      try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
      } catch {
        throw new Error('TRADING_COLLABORATION_JSON_INVALID')
      }
      const envelope = parseEnvelope(value, receivedAt, this.maxFutureSkewMs)
      return this.publish(bridgeSnapshot(envelope, receivedAt), envelope.snapshotId)
    } catch (error) {
      return this.publishError(error, receivedAt)
    } finally {
      clearTimeout(timeout)
    }
  }
}
