import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildApp } from '../apps/local-api/src/app.js'
import { createDatabase } from '../apps/local-api/src/db/schema.js'
import { OAuthStateRepository } from '../apps/local-api/src/modules/auth/oauth-state-repository.js'
import { SessionRepository } from '../apps/local-api/src/modules/auth/session-repository.js'
import { UserDirectoryCache } from '../apps/local-api/src/modules/auth/user-directory-cache.js'
import { createMockFeishuOAuthProvider } from '../apps/local-api/src/modules/feishu/mock-oauth-provider.js'

const runId = (process.env.E2E_RUN_ID ?? 'isolated').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
const root = mkdtempSync(join(tmpdir(), `infinite-board-e2e-${runId}-`))
const apiPort = Number(process.env.E2E_API_PORT ?? 8787)
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:4173'
const shutdownToken = process.env.E2E_SHUTDOWN_TOKEN?.trim()
const enableTradingBridge = process.env.E2E_ENABLE_TRADING_BRIDGE === 'true'

type TradingFixtureMode = 'ready' | 'blocked'
let tradingFixture = {
  score: 67.3,
  announcementTitle: 'UAT 初始公告',
  mode: 'ready' as TradingFixtureMode,
  corrupt: false,
}

function chinaTimestamp(ageMinutes = 0): { tradeDate: string; generatedAt: string } {
  const value = new Date(Date.now() - ageMinutes * 60_000)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).map((part) => [part.type, part.value]))
  const tradeDate = `${parts.year}-${parts.month}-${parts.day}`
  return {
    tradeDate,
    generatedAt: `${tradeDate}T${parts.hour}:${parts.minute}:${parts.second}+08:00`,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function fixtureTradeDates(sessionCount: number): string[] {
  const dates: string[] = []
  const cursor = new Date('2026-08-14T12:00:00.000Z')
  while (dates.length < sessionCount) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return dates
}

function dualCycleBoardFixture() {
  const sentimentCoverage = (sessions: number) => ({
    breadth: sessions,
    durability: sessions,
    height: sessions,
    priorWinnerFeedback: sessions,
    lossEffect: sessions,
    liquidity: sessions,
    styleFlow: sessions,
  })
  const sentimentStatuses = {
    breadth: 'OBSERVED',
    durability: 'OBSERVED',
    height: 'OBSERVED',
    priorWinnerFeedback: 'OBSERVED',
    lossEffect: 'OBSERVED',
    liquidity: 'OBSERVED',
    styleFlow: 'OBSERVED',
  }
  const sentimentWindow = (windowName: string, sessions: number, status: 'READY' | 'PARTIAL' = 'READY') => ({
    windowName,
    status,
    tradeDates: fixtureTradeDates(sessions),
    dimensionCoverage: sentimentCoverage(sessions),
    latestHistoricalDimensionStatus: sentimentStatuses,
  })
  const strategicWindow = (
    windowName: string,
    sessions: number,
    status: 'READY' | 'PARTIAL',
    latestStates: Record<string, string>,
  ) => ({ windowName, status, tradeDates: fixtureTradeDates(sessions), latestStates })

  return {
    schemaVersion: 'xzn-dual-cycle-board-contract-v2',
    generatedAt: '2026-08-14T15:30:00.000+08:00',
    displayBoundary: 'READ_ONLY_ATTENTION_BOARD_NO_TRADE_AUTHORITY',
    authorityBoundary: 'ATTENTION_ONLY_NOT_TRADE_PERMISSION',
    sentimentHistory: {
      evaluationAsOf: '2026-08-14T15:20:00.000+08:00',
      status: 'READY',
      contextWindows: {
        TACTICAL_5: sentimentWindow('TACTICAL_5', 5),
        SWING_10: sentimentWindow('SWING_10', 10),
        CYCLE_20: sentimentWindow('CYCLE_20', 20),
        REGIME_60: sentimentWindow('REGIME_60', 60),
        CALIBRATION_120: sentimentWindow('CALIBRATION_120', 120),
        ANNUAL_250: sentimentWindow('ANNUAL_250', 250, 'PARTIAL'),
      },
    },
    sentimentEpisode: {
      evaluationAsOf: '2026-08-14T15:20:00.000+08:00',
      status: 'READY',
      anchor: {
        nodeStatus: 'CLIMAX',
        tradeDate: '2026-08-04',
        observedAt: '2026-08-04T15:05:00.000+08:00',
        eventId: `sha256:${'a'.repeat(64)}`,
      },
      currentNode: 'REPAIR',
      lastIceOrdinal: 2,
      currentIceOrdinal: null,
      iceOccurrences: [
        {
          ordinal: 1,
          startTradeDate: '2026-08-06',
          endTradeDate: '2026-08-07',
          eventIds: [`sha256:${'b'.repeat(64)}`],
        },
        {
          ordinal: 2,
          startTradeDate: '2026-08-11',
          endTradeDate: '2026-08-11',
          eventIds: [`sha256:${'c'.repeat(64)}`],
        },
      ],
    },
    strategicRegimeHistory: {
      evaluationAsOf: '2026-08-14T15:20:00.000+08:00',
      status: 'READY',
      contextWindows: {
        CYCLE_20: strategicWindow('CYCLE_20', 20, 'READY', {
          environment: 'SUPPORTIVE', profitModelCycle: 'EXPANDING',
          strategicMainline: 'PRIMARY', relativeDifferentiation: 'STRENGTHENING',
        }),
        REGIME_60: strategicWindow('REGIME_60', 60, 'READY', {
          environment: 'MIXED', profitModelCycle: 'MATURE',
          strategicMainline: 'SECONDARY', relativeDifferentiation: 'STABLE',
        }),
        CALIBRATION_120: strategicWindow('CALIBRATION_120', 120, 'PARTIAL', {
          environment: 'ADVERSE', profitModelCycle: 'CONTRACTING',
          strategicMainline: 'ABSENT', relativeDifferentiation: 'WEAKENING',
        }),
      },
    },
    candidateLanes: {
      strategicResearch: [{
        candidate: { symbol: '600001', name: '回归股份' },
        firstSeenAt: '2026-08-12T09:25:00.000+08:00', firstSeenPrice: 12.34,
        lastObservedAt: '2026-08-14T09:31:00.000+08:00',
        lastSnapshotId: `sha256:${'4'.repeat(64)}`,
        lifecycleRecordHash: `sha256:${'1'.repeat(64)}`,
        currentAttentionState: 'WATCH_ONLY',
      }],
      tacticalWatch: [{
        candidate: { symbol: '600002', name: '节奏股份' },
        firstSeenAt: '2026-08-11T09:25:00.000+08:00', firstSeenPrice: 23.45,
        lastObservedAt: '2026-08-14T09:35:00.000+08:00',
        lastSnapshotId: `sha256:${'5'.repeat(64)}`,
        lifecycleRecordHash: `sha256:${'2'.repeat(64)}`,
        currentAttentionState: 'WAITING_TRIGGER',
      }],
      jointReview: [{
        candidate: { symbol: '600003', name: '共振股份' },
        firstSeenAt: '2026-08-10T09:25:00.000+08:00', firstSeenPrice: 34.56,
        lastObservedAt: '2026-08-14T09:40:00.000+08:00',
        lastSnapshotId: `sha256:${'6'.repeat(64)}`,
        lifecycleRecordHash: `sha256:${'3'.repeat(64)}`,
        currentAttentionState: 'PRIORITY_MANUAL_REVIEW',
      }],
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

function collaborationResponse(): Response {
  if (tradingFixture.corrupt) {
    return new Response('{broken-json', { headers: { 'content-type': 'application/json' } })
  }
  const { tradeDate, generatedAt } = chinaTimestamp(0.02)
  const validUntil = new Date(Date.now() + 5 * 60_000).toISOString()
  const blocked = tradingFixture.mode === 'blocked'
  const status = blocked ? 'degraded' : 'ready'
  const freshness = blocked ? 'UNKNOWN' : 'CURRENT'
  const sourceHealth = blocked ? 'DEGRADED' : 'CURRENT'
  const authority = blocked ? 'DENIED' : 'ALLOWED'
  const evidenceHash = `sha256:${'a'.repeat(64)}`
  const decisionChain = [{
    id: 'stage:e2e-auction', label: '09:25 竞价复核', status: blocked ? 'REVIEW_ONLY' : 'ALLOWED',
    summary: blocked ? '证据链不完整，当前只看不参与。' : '同一交易日证据完整，可以进入人工确认。',
    occurredAt: generatedAt, validUntil, evidenceIds: ['auction:e2e'],
  }]
  const changes = [{ id: 'change:e2e', label: '从上一步到现在', summary: 'UAT 协作快照已更新。' }]
  const evidenceRefs = [{
    id: 'auction:e2e', label: '09:25 竞价事实', kind: 'auction_facts', sha256: evidenceHash,
    occurredAt: generatedAt, informationNature: 'raw_observation',
  }]
  const snapshot = {
    status,
    updatedAt: generatedAt,
    tradeDate,
    sourceLabel: '06 人机协作服务',
    message: blocked ? '当前只看，不参与。' : '当前可进入人工确认。',
    deliveryMode: 'SNAPSHOT',
    sourceGeneratedAt: generatedAt,
    availableAt: generatedAt,
    freshness,
    sourceHealth,
    sourceHash: evidenceHash,
    freshUntil: validUntil,
    staleSince: null,
    todayOverview: {
      sourceLabel: '06 人机协作服务', status, updatedAt: generatedAt, sourceGeneratedAt: generatedAt,
      availableAt: generatedAt, freshness, sourceHealth, freshUntil: validUntil, tradeDate,
      currentPhase: 'auction_final', currentPhaseLabel: '09:25 竞价复核',
      overallState: blocked ? 'OBSERVATION_ONLY' : 'PARTICIPATE',
      sourceTradeDate: tradeDate, decisionTradeDate: tradeDate, planTradeDate: tradeDate,
      dataAsOf: generatedAt, validUntil, nextKeyTime: validUntil,
      canParticipate: !blocked,
      participationStatus: blocked ? 'REVIEW_ONLY' : 'PARTICIPATE',
      participationSummary: blocked ? '证据链不完整，当前只看不参与。' : '证据完整，当前可进入人工确认。',
      sourceExecutionAuthority: blocked ? 'REVIEW_ONLY' : 'ALLOWED',
      effectiveExecutionAuthority: authority,
      executionAuthority: authority,
      unattendedAction: '如果我没空，保持观察，不产生新的交易动作。',
      reasonCodes: blocked ? ['E2E_EVIDENCE_BLOCKED'] : [],
      decisionChain, changes, evidenceRefs,
      auction: {
        status: blocked ? 'BLOCKED' : 'READY', snapshotAt: generatedAt, executionAuthority: authority,
        leader: { code: '301366', name: '一博科技', executionAuthority: authority },
      },
    },
    market: {
      environmentVerdict: blocked ? '只观察' : '轻参与', nodeVerdict: '分歧转一致',
      limitUpTotal: 68, limitDownTotal: 5, highestBoardLevel: 4,
      summaryLines: ['UAT 06 协作快照已接通。'],
    },
    themes: [{ name: '芯片', heat: 31.98, structure: '三锚闭环' }],
    stocks: [{ code: '301366', name: '一博科技', score: tradingFixture.score, action: '观察', reason: '主线：芯片' }],
    announcements: [{
      id: 'announcement:e2e', title: tradingFixture.announcementTitle,
      epistemicClass: 'human_claim', verificationStatus: 'UNVERIFIED',
      summary: 'UAT 人工观察摘要', summaryEpistemicClass: 'human_claim',
      sourceType: 'announcement', sourceName: 'UAT 公告观察源', direction: 'positive',
      publishedAt: generatedAt, names: ['一博科技'], codes: ['301366'],
    }],
    readiness: {
      state: blocked ? 'BLOCKED' : 'READY', executionEligible: !blocked,
      observationEligible: blocked, reasonCount: blocked ? 1 : 0,
    },
    services: [{ name: '06统一快照', status: sourceHealth, detail: 'UAT 合同夹具' }],
    dualCycleBoard: dualCycleBoardFixture(),
    decisionChain, changes, evidenceRefs,
  }
  const lineage = {
    stage: { id: 'stage:e2e', sha256: `sha256:${'b'.repeat(64)}` },
    freeze: { id: 'freeze:e2e', sha256: `sha256:${'c'.repeat(64)}` },
    report: { id: 'report:e2e', sha256: `sha256:${'d'.repeat(64)}` },
    calendar: { policy: 'exchange-calendar-cn-v1', verified: true },
  }
  const basis = { schemaVersion: 'collaboration-today-v1', asOf: generatedAt, snapshot, lineage }
  const snapshotCanonical = canonicalJson(basis)
  const snapshotId = `sha256:${createHash('sha256').update(snapshotCanonical, 'utf8').digest('hex')}`
  return new Response(JSON.stringify({
    ok: !blocked,
    schemaVersion: 'collaboration-today-v1',
    snapshotId,
    snapshotCanonical,
    assembledAt: new Date().toISOString(),
    asOf: generatedAt,
    snapshot,
    lineage,
  }), { headers: { 'content-type': 'application/json; charset=utf-8' } })
}
const database = createDatabase(join(root, 'database.sqlite'))
const app = await buildApp({
  host: '127.0.0.1',
  database,
  dataDirectory: root,
  assetDirectory: join(root, 'assets'),
  enableRealtime: true,
  automationProjectTag: runId,
  // Production stays fail-closed when Feishu is not configured. This explicit
  // provider enables only the isolated E2E import-OAuth lifecycle.
  feishuOAuthProvider: createMockFeishuOAuthProvider(),
  // E2E must remain hermetic and must never discover the user's real trading
  // workspace through the default relative path.
  enableTradingBridge,
  ...(enableTradingBridge
    ? { tradingFetch: async () => collaborationResponse(), tradingPollIntervalMs: 500 }
    : {}),
  authentication: {
    oauth: {
      createAuthorizationUrl: ({ state, redirectUri }) => {
        const url = new URL(redirectUri)
        url.search = new URLSearchParams({ state, code: 'e2e' }).toString()
        return url
      },
      async exchangeCode() { return { openId: 'e2e-user' } },
    },
    states: new OAuthStateRepository(database, undefined, 'e2e only OAuth state secret with at least 32 bytes'),
    sessions: new SessionRepository(database),
    users: new UserDirectoryCache({
      async findByOpenId(openId) { return openId === 'e2e-user' ? { openId, name: 'E2E User', department: 'Test' } : undefined },
      async checkHealth() { return 'ok' as const }, async close() {},
    }),
  },
})

let closePromise: Promise<void> | undefined
let databaseClosed = false
let rootRemoved = false
const removeRoot = () => {
  if (rootRemoved) return
  rmSync(root, { recursive: true, force: true })
  rootRemoved = true
}
const close = async (exitCode = 0) => {
  closePromise ??= (async () => {
    try {
      await app.close()
    } finally {
      if (!databaseClosed) {
        database.close()
        databaseClosed = true
      }
      removeRoot()
    }
  })()
  await closePromise
  process.exitCode = exitCode
}
const terminate = (exitCode: number) => {
  void close(exitCode).finally(() => process.exit(exitCode))
}

if (shutdownToken) {
  app.post('/__e2e/shutdown', async (request, reply) => {
    if (request.headers['x-e2e-shutdown-token'] !== shutdownToken) {
      return reply.code(404).send({ code: 'NOT_FOUND' })
    }
    const response = reply.send({ ok: true, runId })
    setImmediate(() => void close())
    return response
  })
}

if (enableTradingBridge && shutdownToken) {
  app.put('/__e2e/trading-source', async (request, reply) => {
    // This route exists only in the isolated mkdtemp E2E process when the
    // trading-live flag is explicit. Normal/production servers never register
    // it, and the regular authentication plugin still guards the request.
    const body = request.body as {
      score?: unknown
      announcementTitle?: unknown
      mode?: unknown
      corrupt?: unknown
    }
    if (body?.corrupt === true) {
      tradingFixture = { ...tradingFixture, corrupt: true }
      return { ok: true }
    }
    if (typeof body?.score !== 'number' || !Number.isFinite(body.score)
      || typeof body.announcementTitle !== 'string' || !body.announcementTitle.trim()
      || (body.mode !== undefined && body.mode !== 'ready' && body.mode !== 'blocked')) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR' })
    }
    tradingFixture = {
      score: body.score,
      announcementTitle: body.announcementTitle.trim(),
      mode: body.mode === 'blocked' ? 'blocked' : 'ready',
      corrupt: false,
    }
    return { ok: true }
  })
}

process.once('exit', () => {
  if (!databaseClosed) {
    try {
      database.close()
      databaseClosed = true
    } catch {
      // The graceful close path may already have released the native handle.
    }
  }
  try {
    removeRoot()
  } catch {
    // Exit handlers cannot recover; the next isolated run still has a unique runId.
  }
})
process.once('SIGINT', () => terminate(0))
process.once('SIGTERM', () => terminate(0))
process.once('SIGHUP', () => terminate(0))
if (process.platform === 'win32') process.once('SIGBREAK', () => terminate(0))

await app.listen({ host: '127.0.0.1', port: apiPort })
