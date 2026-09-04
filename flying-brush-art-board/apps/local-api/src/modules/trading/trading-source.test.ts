import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { TradingSource } from './trading-source.js'

type JsonRecord = Record<string, unknown>

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as JsonRecord
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function fixture() {
  const asOf = '2026-08-05T09:29:00+08:00'
  const evidenceHash = `sha256:${'a'.repeat(64)}`
  const decisionChain = [{
    id: 'stage:one',
    label: '09:25竞价复核',
    status: 'ALLOWED',
    summary: '同一交易日证据完整。',
    occurredAt: '2026-08-05T09:25:05+08:00',
    validUntil: '2026-08-05T09:30:00+08:00',
    evidenceIds: ['auction:one'],
  }]
  const changes = [{ id: 'phase:auction_final', label: '当前阶段', summary: '竞价复核完成。' }]
  const evidenceRefs = [{
    id: 'auction:one',
    label: '09:25竞价事实',
    kind: 'auction_facts',
    sha256: evidenceHash,
    occurredAt: '2026-08-05T09:25:05+08:00',
    informationNature: 'raw_observation',
  }]
  const snapshot = {
    status: 'ready',
    updatedAt: '2026-08-05T09:25:05+08:00',
    tradeDate: '2026-08-05',
    sourceLabel: '06 人机协作服务',
    message: '当前允许参与。',
    deliveryMode: 'SNAPSHOT',
    sourceGeneratedAt: '2026-08-05T09:25:05+08:00',
    availableAt: '2026-08-05T09:25:05+08:00',
    freshness: 'CURRENT',
    sourceHealth: 'CURRENT',
    sourceHash: evidenceHash,
    freshUntil: '2026-08-05T09:30:00+08:00',
    staleSince: null,
    todayOverview: {
      sourceLabel: '06 人机协作服务',
      status: 'ready',
      updatedAt: '2026-08-05T09:25:05+08:00',
      sourceGeneratedAt: '2026-08-05T09:25:05+08:00',
      availableAt: '2026-08-05T09:25:05+08:00',
      freshness: 'CURRENT',
      sourceHealth: 'CURRENT',
      freshUntil: '2026-08-05T09:30:00+08:00',
      tradeDate: '2026-08-05',
      currentPhase: 'auction_final',
      currentPhaseLabel: '09:25竞价复核',
      overallState: 'PARTICIPATE',
      sourceTradeDate: '2026-08-04',
      decisionTradeDate: '2026-08-05',
      planTradeDate: '2026-08-05',
      dataAsOf: '2026-08-05T09:25:05+08:00',
      validUntil: '2026-08-05T09:30:00+08:00',
      nextKeyTime: '2026-08-05T09:30:00+08:00',
      canParticipate: true,
      participationStatus: 'PARTICIPATE',
      participationSummary: '同一交易日证据完整，当前允许参与。',
      sourceExecutionAuthority: 'ALLOWED',
      effectiveExecutionAuthority: 'ALLOWED',
      executionAuthority: 'ALLOWED',
      unattendedAction: '无人响应时不执行新的交易动作。',
      reasonCodes: [],
      decisionChain,
      changes,
      evidenceRefs,
      auction: {
        status: 'READY',
        snapshotAt: '2026-08-05T09:25:05+08:00',
        executionAuthority: 'ALLOWED',
        leader: { code: '000001', name: '测试股份' },
      },
    },
    market: { environmentVerdict: '允许试错', summaryLines: ['市场背景'] },
    themes: [{ name: '测试主线', heat: 88 }],
    stocks: [{ code: '000001', name: '测试股份', score: 88, action: '观察' }],
    announcements: [],
    readiness: {
      state: 'READY',
      executionEligible: true,
      sourceExecutionEligible: true,
      observationEligible: false,
      reasonCount: 0,
    },
    services: [{ name: '06统一快照', status: 'CURRENT', detail: '证据完整' }],
    decisionChain,
    changes,
    evidenceRefs,
  }
  const lineage = {
    stage: { id: 'stage:one', sha256: `sha256:${'b'.repeat(64)}` },
    freeze: { id: 'freeze:one', sha256: `sha256:${'c'.repeat(64)}` },
    report: { id: 'report:one', sha256: `sha256:${'d'.repeat(64)}` },
    calendar: { policy: 'exchange-calendar-cn-v1', verified: true },
  }
  const basis = { schemaVersion: 'collaboration-today-v1', asOf, snapshot, lineage }
  const snapshotCanonical = canonicalJson(basis)
  return {
    ok: true,
    schemaVersion: 'collaboration-today-v1',
    snapshotId: `sha256:${createHash('sha256').update(snapshotCanonical, 'utf8').digest('hex')}`,
    snapshotCanonical,
    assembledAt: '2026-08-05T09:29:00.100+08:00',
    asOf,
    snapshot,
    lineage,
  }
}

function rehash(envelope: ReturnType<typeof fixture>) {
  const basis = {
    schemaVersion: envelope.schemaVersion,
    asOf: envelope.asOf,
    snapshot: envelope.snapshot,
    lineage: envelope.lineage,
  }
  envelope.snapshotCanonical = canonicalJson(basis)
  envelope.snapshotId = `sha256:${createHash('sha256').update(envelope.snapshotCanonical, 'utf8').digest('hex')}`
  return envelope
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

describe('TradingSource 06 HTTP boundary', () => {
  const now = () => new Date('2026-08-05T01:29:10.000Z')

  it('accepts the real collaboration-today-v1 shape and exposes no filesystem fallback', async () => {
    const fetcher = vi.fn(async () => response(fixture()))
    const source = new TradingSource({
      collaborationUrl: 'http://127.0.0.1:9999/api/collaboration/today',
      fetch: fetcher,
      dataDirectory: 'Z:/must-not-be-read',
      now,
    })

    const state = await source.getSnapshot()

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'http://127.0.0.1:9999/api/collaboration/today' }),
      expect.objectContaining({ method: 'GET', cache: 'no-store', redirect: 'error' }),
    )
    expect(state.snapshot).toMatchObject({
      status: 'ready',
      sourceHealth: 'CURRENT',
      freshness: 'CURRENT',
      errorActive: false,
      todayOverview: {
        canParticipate: true,
        sourceExecutionAuthority: 'ALLOWED',
        effectiveExecutionAuthority: 'ALLOWED',
      },
    })
    expect(state.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await source.getStock('000001')).toMatchObject({ name: '测试股份', source: 'ranking' })
  })

  it('accepts the authenticated preopen freeze read-only projection without a stage artifact hash', async () => {
    const envelope = fixture()
    envelope.snapshot.readiness.executionEligible = false
    envelope.snapshot.readiness.sourceExecutionEligible = true
    const today = envelope.snapshot.todayOverview
    today.currentPhase = 'preopen_freeze_readonly'
    today.currentPhaseLabel = '盘前冻结预案'
    today.overallState = 'OBSERVATION_ONLY'
    today.canParticipate = false
    today.participationStatus = 'REVIEW_ONLY'
    today.sourceExecutionAuthority = 'REVIEW_ONLY'
    today.effectiveExecutionAuthority = 'DENIED'
    today.executionAuthority = 'DENIED'
    envelope.lineage.stage = { id: 'projection:preopen_freeze_read_only', sha256: '' }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot).toMatchObject({
      status: 'ready',
      errorActive: false,
      todayOverview: {
        currentPhase: 'preopen_freeze_readonly',
        canParticipate: false,
        effectiveExecutionAuthority: 'DENIED',
      },
    })
    expect(state.revision).toBe(envelope.snapshotId)
  })

  it('accepts an authenticated current intraday stage-only projection', async () => {
    const envelope = fixture()
    const today = envelope.snapshot.todayOverview
    Object.assign(envelope.snapshot, {
      status: 'ready',
      freshness: 'CURRENT',
      sourceHealth: 'CURRENT',
    })
    Object.assign(today, {
      phase: 'intraday_discovery',
      currentPhase: 'intraday_discovery',
      currentPhaseLabel: '盘中全市场确认',
      planProjectionMode: 'INTRADAY_READ_ONLY',
      phaseStatus: 'READY',
      pipelineHealth: 'READY',
      canParticipate: false,
      overallState: 'OBSERVATION_ONLY',
      participationStatus: 'REVIEW_ONLY',
      sourceExecutionAuthority: 'REVIEW_ONLY',
      effectiveExecutionAuthority: 'DENIED',
      executionAuthority: 'DENIED',
      reasonCodes: ['INTRADAY_STAGE_ONLY_BACKGROUND'],
    })
    Object.assign(envelope.snapshot.readiness, {
      state: 'READY',
      executionEligible: false,
      sourceExecutionEligible: false,
      observationEligible: true,
    })
    envelope.lineage.freeze = { id: 'freeze:unverified', sha256: '' }
    envelope.lineage.report = { id: 'report:unverified', sha256: '' }
    envelope.lineage.calendar = { policy: '', verified: false }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot).toMatchObject({
      status: 'ready',
      freshness: 'CURRENT',
      sourceHealth: 'CURRENT',
      errorActive: false,
      todayOverview: {
        currentPhase: 'intraday_discovery',
        canParticipate: false,
        effectiveExecutionAuthority: 'DENIED',
      },
    })
    expect(state.revision).toBe(envelope.snapshotId)
  })

  it('accepts an authenticated current partial intraday read-only projection', async () => {
    const envelope = fixture()
    const today = envelope.snapshot.todayOverview
    Object.assign(envelope.snapshot, {
      status: 'degraded',
      freshness: 'CURRENT',
      sourceHealth: 'DEGRADED',
    })
    Object.assign(today, {
      phase: 'intraday_discovery',
      currentPhase: 'intraday_discovery',
      planProjectionMode: 'INTRADAY_READ_ONLY',
      phaseStatus: 'REVIEW_ONLY',
      pipelineHealth: 'DEGRADED',
      canParticipate: false,
      overallState: 'OBSERVATION_ONLY',
      participationStatus: 'REVIEW_ONLY',
      sourceExecutionAuthority: 'REVIEW_ONLY',
      effectiveExecutionAuthority: 'DENIED',
      executionAuthority: 'DENIED',
      reasonCodes: ['INTRADAY_STAGE_ONLY_BACKGROUND'],
    })
    Object.assign(envelope.snapshot.readiness, {
      state: 'PARTIAL',
      executionEligible: false,
      sourceExecutionEligible: false,
      observationEligible: true,
    })
    envelope.lineage.freeze = { id: 'freeze:unverified', sha256: '' }
    envelope.lineage.report = { id: 'report:unverified', sha256: '' }
    envelope.lineage.calendar = { policy: '', verified: false }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot).toMatchObject({
      status: 'degraded',
      freshness: 'CURRENT',
      sourceHealth: 'DEGRADED',
      errorActive: false,
      todayOverview: {
        currentPhase: 'intraday_discovery',
        participationStatus: 'REVIEW_ONLY',
        canParticipate: false,
        effectiveExecutionAuthority: 'DENIED',
      },
    })
    expect(state.revision).toBe(envelope.snapshotId)
  })

  it('rejects a partial intraday projection that attempts to retain execution permission', async () => {
    const envelope = fixture()
    const today = envelope.snapshot.todayOverview
    Object.assign(envelope.snapshot, {
      status: 'degraded',
      freshness: 'CURRENT',
      sourceHealth: 'DEGRADED',
    })
    Object.assign(today, {
      phase: 'intraday_discovery',
      currentPhase: 'intraday_discovery',
      planProjectionMode: 'INTRADAY_READ_ONLY',
      phaseStatus: 'REVIEW_ONLY',
      pipelineHealth: 'DEGRADED',
      canParticipate: true,
      overallState: 'PARTICIPATE',
      participationStatus: 'PARTICIPATE',
      sourceExecutionAuthority: 'ALLOWED',
      effectiveExecutionAuthority: 'ALLOWED',
      executionAuthority: 'ALLOWED',
      reasonCodes: ['INTRADAY_STAGE_ONLY_BACKGROUND'],
    })
    Object.assign(envelope.snapshot.readiness, {
      state: 'PARTIAL',
      executionEligible: true,
      sourceExecutionEligible: true,
      observationEligible: true,
    })
    envelope.lineage.freeze = { id: 'freeze:unverified', sha256: '' }
    envelope.lineage.report = { id: 'report:unverified', sha256: '' }
    envelope.lineage.calendar = { policy: '', verified: false }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot.status).toBe('unavailable')
    expect(state.snapshot.message).toBe('TRADING_COLLABORATION_LINEAGE_FREEZE_HASH_MISSING')
  })

  it('rejects a claimed intraday stage-only projection without its read-only evidence boundary', async () => {
    const envelope = fixture()
    const today = envelope.snapshot.todayOverview
    Object.assign(today, {
      phase: 'intraday_discovery',
      currentPhase: 'intraday_discovery',
      planProjectionMode: 'INTRADAY_READ_ONLY',
      phaseStatus: 'READY',
      pipelineHealth: 'READY',
      canParticipate: false,
      sourceExecutionAuthority: 'REVIEW_ONLY',
      effectiveExecutionAuthority: 'DENIED',
      executionAuthority: 'DENIED',
      reasonCodes: [],
    })
    Object.assign(envelope.snapshot.readiness, {
      executionEligible: false,
      observationEligible: true,
    })
    envelope.lineage.freeze = { id: 'freeze:unverified', sha256: '' }
    envelope.lineage.report = { id: 'report:unverified', sha256: '' }
    envelope.lineage.calendar = { policy: '', verified: false }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot.status).toBe('unavailable')
    expect(state.snapshot.message).toBe('TRADING_COLLABORATION_LINEAGE_FREEZE_HASH_MISSING')
  })

  it('still rejects an arbitrary successful stage that omits its artifact hash', async () => {
    const envelope = fixture()
    envelope.lineage.stage = { id: 'projection:other', sha256: '' }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot.status).toBe('unavailable')
    expect(state.snapshot.message).toBe('TRADING_COLLABORATION_LINEAGE_STAGE_HASH_MISSING')
  })

  it('rejects a preopen projection that tries to retain participation permission', async () => {
    const envelope = fixture()
    envelope.snapshot.todayOverview.currentPhase = 'preopen_freeze_readonly'
    envelope.lineage.stage = { id: 'projection:preopen_freeze_read_only', sha256: '' }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot.status).toBe('unavailable')
    expect(state.snapshot.message).toBe('TRADING_COLLABORATION_LINEAGE_STAGE_HASH_MISSING')
  })

  it('accepts a structurally valid blocked envelope as read-only information', async () => {
    const envelope = fixture()
    envelope.ok = false
    envelope.snapshot.status = 'degraded'
    envelope.snapshot.freshness = 'UNKNOWN'
    envelope.snapshot.sourceHealth = 'DEGRADED'
    envelope.snapshot.readiness.executionEligible = false
    const today = envelope.snapshot.todayOverview
    today.status = 'degraded'
    today.freshness = 'UNKNOWN'
    today.sourceHealth = 'DEGRADED'
    today.canParticipate = false
    today.overallState = 'OBSERVATION_ONLY'
    today.participationStatus = 'REVIEW_ONLY'
    today.sourceExecutionAuthority = 'REVIEW_ONLY'
    today.effectiveExecutionAuthority = 'DENIED'
    today.executionAuthority = 'DENIED'
    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot).toMatchObject({
      status: 'degraded',
      errorActive: false,
      todayOverview: { canParticipate: false, effectiveExecutionAuthority: 'DENIED' },
    })
  })

  it('accepts an authenticated blocked envelope with explicitly unverified optional lineage', async () => {
    const envelope = fixture()
    envelope.ok = false
    envelope.snapshot.status = 'degraded'
    envelope.snapshot.freshness = 'UNKNOWN'
    envelope.snapshot.sourceHealth = 'DEGRADED'
    envelope.snapshot.readiness.executionEligible = false
    const today = envelope.snapshot.todayOverview
    today.status = 'degraded'
    today.freshness = 'UNKNOWN'
    today.sourceHealth = 'DEGRADED'
    today.canParticipate = false
    today.overallState = 'SYSTEM_BLOCKED'
    today.participationStatus = 'SYSTEM_BLOCKED'
    today.sourceExecutionAuthority = 'REVIEW_ONLY'
    today.effectiveExecutionAuthority = 'DENIED'
    today.executionAuthority = 'DENIED'
    envelope.lineage.freeze = { id: 'freeze:unverified', sha256: '' }
    envelope.lineage.report = { id: 'report:unverified', sha256: '' }
    envelope.lineage.calendar = { policy: '', verified: false }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot).toMatchObject({
      status: 'degraded',
      errorActive: false,
      sourceHealth: 'DEGRADED',
      todayOverview: { canParticipate: false, effectiveExecutionAuthority: 'DENIED' },
    })
    expect(state.revision).toBe(envelope.snapshotId)
  })

  it('still rejects a blocked envelope that omits a hash without declaring the lineage unverified', async () => {
    const envelope = fixture()
    envelope.ok = false
    envelope.snapshot.status = 'degraded'
    envelope.snapshot.readiness.executionEligible = false
    envelope.snapshot.todayOverview.canParticipate = false
    envelope.snapshot.todayOverview.effectiveExecutionAuthority = 'DENIED'
    envelope.snapshot.todayOverview.executionAuthority = 'DENIED'
    envelope.lineage.freeze = { id: 'freeze:claimed', sha256: '' }

    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot.status).toBe('unavailable')
    expect(state.snapshot.message).toBe('TRADING_COLLABORATION_LINEAGE_FREEZE_HASH_MISSING')
  })

  it('rejects a tampered snapshot hash and fails closed without a prior snapshot', async () => {
    const envelope = fixture()
    envelope.snapshot.themes[0]!.name = '篡改后的主线'
    const state = await new TradingSource({ fetch: vi.fn(async () => response(envelope)), now }).getSnapshot()

    expect(state.snapshot).toMatchObject({
      status: 'unavailable',
      sourceHealth: 'UNAVAILABLE',
      message: 'TRADING_COLLABORATION_SNAPSHOT_CANONICAL_CONFLICT',
      todayOverview: { canParticipate: false, effectiveExecutionAuthority: 'DENIED' },
    })
  })

  it('verifies producer canonical bytes while comparing 1.0 and 1 by JSON value', async () => {
    const envelope = fixture()
    ;(envelope.snapshot.market as { limitUpTotal?: number }).limitUpTotal = 42
    const basis = {
      schemaVersion: envelope.schemaVersion,
      asOf: envelope.asOf,
      snapshot: envelope.snapshot,
      lineage: envelope.lineage,
    }
    envelope.snapshotCanonical = canonicalJson(basis).replace('"limitUpTotal":42', '"limitUpTotal":42.0')
    envelope.snapshotId = `sha256:${createHash('sha256').update(envelope.snapshotCanonical, 'utf8').digest('hex')}`

    const state = await new TradingSource({ fetch: vi.fn(async () => response(envelope)), now }).getSnapshot()

    expect(state.snapshot.status).toBe('ready')
    expect(state.revision).toBe(envelope.snapshotId)
  })

  it('keeps the last good content after transport failure but removes all participation permission', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(fixture()))
      .mockResolvedValueOnce(response({ code: 'offline' }, 503))
    const source = new TradingSource({ fetch: fetcher, now })
    const first = await source.getSnapshot()
    const second = await source.refresh()

    expect(first.snapshot.todayOverview?.canParticipate).toBe(true)
    expect(second.snapshot).toMatchObject({
      status: 'degraded',
      freshness: 'STALE',
      sourceHealth: 'DEGRADED',
      errorActive: true,
      themes: [{ name: '测试主线' }],
      todayOverview: {
        canParticipate: false,
        overallState: 'SYSTEM_BLOCKED',
        effectiveExecutionAuthority: 'DENIED',
        executionAuthority: 'DENIED',
      },
      readiness: { executionEligible: false },
    })
  })

  it('keeps repeated failure revisions bounded and clears the active error after recovery', async () => {
    let upstream: 'ready' | 'offline' = 'ready'
    const fetcher = vi.fn(async () => upstream === 'ready'
      ? response(fixture())
      : response({ code: 'offline' }, 503))
    const source = new TradingSource({ fetch: fetcher, now })
    await source.getSnapshot()
    upstream = 'offline'

    const failureRevisions: string[] = []
    for (let index = 0; index < 25; index += 1) {
      failureRevisions.push((await source.refresh()).revision)
    }

    expect(failureRevisions.every((revision) => revision.length <= 96)).toBe(true)
    expect(new Set(failureRevisions.map((revision) => revision.length)).size).toBe(1)
    expect(failureRevisions.every((revision) => revision.startsWith('degraded:sha256:'))).toBe(true)
    expect(failureRevisions.every((revision) => !revision.includes(':degraded:'))).toBe(true)

    upstream = 'ready'
    const recovered = await source.refresh()
    expect(recovered.snapshot).toMatchObject({
      status: 'ready',
      sourceHealth: 'CURRENT',
      freshness: 'CURRENT',
      errorActive: false,
      lastErrorAt: null,
    })
    expect(recovered.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('rejects an internally hashed envelope that tries to allow without a verified calendar', async () => {
    const envelope = fixture()
    envelope.lineage.calendar.verified = false
    envelope.lineage.calendar.policy = 'weekday-fallback-v1'
    const state = await new TradingSource({ fetch: vi.fn(async () => response(rehash(envelope))), now }).getSnapshot()

    expect(state.snapshot.status).toBe('unavailable')
    expect(state.snapshot.message).toBe('TRADING_COLLABORATION_PERMISSION_CONFLICT')
    expect(state.snapshot.todayOverview?.canParticipate).toBe(false)
  })
})
