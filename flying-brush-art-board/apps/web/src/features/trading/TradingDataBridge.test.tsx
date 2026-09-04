import { act, cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TradingPanelContent,
  type TradingPanelShape,
  type TradingWorkbenchSnapshot,
  type TradingWorkbenchViewState,
} from '@infinite-board/tldraw-adapter'

const resolverCapture = vi.hoisted(() => ({
  viewStates: [] as TradingWorkbenchViewState[],
}))

vi.mock('@infinite-board/tldraw-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@infinite-board/tldraw-adapter')>()
  return {
    ...actual,
    setTradingWorkbenchViewStateResolver: (
      resolver: Parameters<typeof actual.setTradingWorkbenchViewStateResolver>[0],
    ) => {
      const value = resolver()
      if (value) resolverCapture.viewStates.push(value)
      return actual.setTradingWorkbenchViewStateResolver(resolver)
    },
  }
})

import {
  TRADING_FALLBACK_POLL_INTERVAL_MS,
  TradingDataBridge,
  enforceTradingFreshnessDeadline,
  shouldAcceptTradingCursor,
  shouldRefreshForTradingEvent,
  type TradingSnapshotResponse,
} from './TradingDataBridge'

const todayShape = {
  props: {
    w: 1_860,
    h: 900,
    panelKind: 'today-overview',
    title: '今天怎么看',
  },
} as TradingPanelShape

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly listeners = new Map<string, Set<(event: Event) => void>>()
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener || typeof listener !== 'function') return
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener || typeof listener !== 'function') return
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data?: unknown) {
    const event = data === undefined
      ? new Event(type)
      : new MessageEvent(type, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function response(snapshot: TradingSnapshotResponse): Response {
  return {
    ok: true,
    json: async () => snapshot,
  } as Response
}

function tradingSnapshot(overrides: Partial<TradingSnapshotResponse> = {}): TradingSnapshotResponse {
  return {
    revision: 'revision-1',
    streamId: 'stream-a',
    sequence: 1,
    status: 'ready',
    updatedAt: '2026-08-08T02:05:00.000Z',
    sourceLabel: 'snapshot-1',
    sourceGeneratedAt: '2026-08-08T02:00:00.000Z',
    freshUntil: '2099-08-09T02:00:00.000Z',
    availableAt: '2026-08-08T02:01:00.000Z',
    freshness: 'CURRENT',
    sourceHealth: 'CURRENT',
    themes: [],
    stocks: [],
    announcements: [],
    services: [],
    ...overrides,
  }
}

function currentTodaySnapshot(overrides: Partial<TradingSnapshotResponse> = {}): TradingSnapshotResponse {
  return tradingSnapshot({
    todayOverview: {
      status: 'ready',
      updatedAt: '2026-08-08T02:05:00.000Z',
      sourceLabel: '06 交易工作台统一解释',
      sourceGeneratedAt: '2026-08-08T02:00:00.000Z',
      availableAt: '2026-08-08T02:01:00.000Z',
      freshUntil: '2099-08-09T02:00:00.000Z',
      freshness: 'CURRENT',
      sourceHealth: 'CURRENT',
      canParticipate: true,
      participationSummary: '证据完整，当前可进入人工确认。',
    },
    ...overrides,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function latestViewState(): TradingWorkbenchViewState {
  const latest = resolverCapture.viewStates.at(-1)
  if (!latest) throw new Error('Trading bridge did not publish a view state')
  return latest
}

function latestSnapshot(): TradingWorkbenchSnapshot {
  const latest = latestViewState()
  if (latest.kind !== 'snapshot') throw new Error('Trading bridge has not published a snapshot yet')
  return latest.snapshot
}

function renderTodayBridge() {
  const rendered = render(<>
    <TradingDataBridge />
    <TradingPanelContent shape={todayShape} />
  </>)
  const panel = rendered.container.querySelector<HTMLElement>('.trading-panel[data-panel-kind="today-overview"]')
  if (!panel) throw new Error('Today panel did not render')
  return { ...rendered, panel }
}

function expectConnecting(panel: HTMLElement) {
  expect(panel).toHaveAttribute('data-fact-state', 'CONNECTING')
  expect(within(panel).getByText('正在连接', { exact: true })).toBeVisible()
  expect(within(panel).getByText('正在连接交易数据', { exact: true })).toBeVisible()
  expect(within(panel).queryByText('数据不可用', { exact: true })).not.toBeInTheDocument()
  expect(within(panel).queryByText('数据源暂不可用', { exact: true })).not.toBeInTheDocument()
}

function expectUnavailable(panel: HTMLElement) {
  expect(panel).toHaveAttribute('data-fact-state', 'UNAVAILABLE')
  expect(within(panel).getByText('数据不可用', { exact: true })).toBeVisible()
  expect(within(panel).getByText('数据源暂不可用', { exact: true })).toBeVisible()
  expect(within(panel).queryByText('正在连接', { exact: true })).not.toBeInTheDocument()
  expect(within(panel).queryByText('当前快照', { exact: true })).not.toBeInTheDocument()
}

beforeEach(() => {
  resolverCapture.viewStates = []
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TradingDataBridge ordering', () => {
  it('shows CONNECTING on the real today panel until the first accepted snapshot becomes CURRENT', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { panel } = renderTodayBridge()
    expectConnecting(panel)
    expect(latestViewState().kind).toBe('connecting')

    const events = FakeEventSource.instances[0]!
    act(() => events.emit('open'))
    expectConnecting(panel)

    second.resolve(response(currentTodaySnapshot()))
    await flushPromises()
    expect(panel).toHaveAttribute('data-fact-state', 'CURRENT')
    expect(within(panel).getByText('当前快照', { exact: true })).toBeVisible()
    expect(within(panel).queryByText('正在连接', { exact: true })).not.toBeInTheDocument()
    expect(within(panel).queryByText('数据不可用', { exact: true })).not.toBeInTheDocument()
    expect(latestSnapshot().status).toBe('ready')
    expect(latestSnapshot().sourceHealth).toBe('CURRENT')
  })

  it('changes the real today panel from CONNECTING to UNAVAILABLE after the first HTTP failure', async () => {
    const first = deferred<Response>()
    const retry = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { panel } = renderTodayBridge()
    expectConnecting(panel)

    first.resolve({ ok: false, status: 503 } as Response)
    await flushPromises()

    expectUnavailable(panel)
    expect(latestSnapshot().message).toBe('HTTP_503')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails closed and then recovers when the first HTTP 200 has no valid cursor', async () => {
    const first = deferred<Response>()
    const retry = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { panel } = renderTodayBridge()
    expectConnecting(panel)

    first.resolve(response(currentTodaySnapshot({ streamId: '' })))
    await flushPromises()

    expectUnavailable(panel)
    expect(latestSnapshot().message).toBe('TRADING_SNAPSHOT_CURSOR_INVALID')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    retry.resolve(response(currentTodaySnapshot({ revision: 'revision-recovered', sequence: 2 })))
    await flushPromises()

    expect(panel).toHaveAttribute('data-fact-state', 'CURRENT')
    expect(within(panel).getByText('当前快照', { exact: true })).toBeVisible()
    expect(within(panel).queryByText('数据不可用', { exact: true })).not.toBeInTheDocument()
    expect(latestSnapshot().revision).toBe('revision-recovered')
  })

  it('discards an older HTTP response that resolves after a newer refresh', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)

    render(<TradingDataBridge />)
    const events = FakeEventSource.instances[0]!
    act(() => events.emit('open'))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    second.resolve(response(tradingSnapshot({
      revision: 'revision-new',
      sequence: 2,
      sourceLabel: 'new-snapshot',
    })))
    await flushPromises()
    expect(latestSnapshot().sourceLabel).toBe('new-snapshot')

    first.resolve(response(tradingSnapshot({
      revision: 'revision-old',
      sequence: 1,
      sourceLabel: 'old-snapshot',
    })))
    await flushPromises()
    expect(latestSnapshot().sourceLabel).toBe('new-snapshot')
  })

  it('settles the SSE transport without replacing the last snapshot when reconciliation returns a lower cursor', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)

    render(<TradingDataBridge />)
    first.resolve(response(tradingSnapshot({
      revision: 'revision-current',
      sequence: 2,
      sourceLabel: 'current-snapshot',
    })))
    await flushPromises()
    expect(latestSnapshot().sourceLabel).toBe('current-snapshot')
    expect(latestSnapshot().transport?.state).toBe('connecting')

    const events = FakeEventSource.instances[0]!
    act(() => events.emit('open'))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    second.resolve(response(tradingSnapshot({
      revision: 'revision-older',
      sequence: 1,
      sourceLabel: 'older-snapshot',
    })))
    await flushPromises()

    expect(latestSnapshot().sourceLabel).toBe('current-snapshot')
    expect(latestSnapshot().transport?.state).toBe('connected')
  })

  it('rejects a lower server sequence in the same stream but resets on a new stream', () => {
    expect(shouldAcceptTradingCursor(undefined, undefined)).toBe(false)
    expect(shouldAcceptTradingCursor(undefined, { streamId: 'stream-a', sequence: 1 })).toBe(true)
    expect(shouldAcceptTradingCursor(
      { streamId: 'stream-a', sequence: 8 },
      { streamId: 'stream-a', sequence: 7 },
    )).toBe(false)
    expect(shouldAcceptTradingCursor(
      { streamId: 'stream-a', sequence: 8 },
      { streamId: 'stream-a', sequence: 8 },
    )).toBe(true)
    expect(shouldAcceptTradingCursor(
      { streamId: 'stream-a', sequence: 8 },
      { streamId: 'stream-b', sequence: 1 },
    )).toBe(true)
  })

  it('fails closed when a CURRENT snapshot has no deadline and expires it locally at the deadline', () => {
    expect(enforceTradingFreshnessDeadline(tradingSnapshot({ freshUntil: null }), Date.parse('2026-08-08T02:05:00.000Z')))
      .toMatchObject({ status: 'degraded', sourceHealth: 'DEGRADED', freshness: 'UNKNOWN' })
    expect(enforceTradingFreshnessDeadline(tradingSnapshot({
      sourceGeneratedAt: '2026-08-08T02:00:00.000Z',
      freshUntil: '2026-08-08T03:00:00.000Z',
    }), Date.parse('2026-08-08T03:00:00.000Z'))).toMatchObject({
      status: 'stale',
      sourceHealth: 'STALE',
      freshness: 'STALE',
      staleSince: '2026-08-08T03:00:00.000Z',
    })
  })

  it('uses SSE only as invalidation and ignores events already represented by HTTP', () => {
    const accepted = { streamId: 'stream-a', sequence: 5 }
    expect(shouldRefreshForTradingEvent(accepted, { streamId: 'stream-a', sequence: 5 })).toBe(false)
    expect(shouldRefreshForTradingEvent(accepted, { streamId: 'stream-a', sequence: 6 })).toBe(true)
    expect(shouldRefreshForTradingEvent(accepted, { streamId: 'stream-b', sequence: 1 })).toBe(true)
    expect(shouldRefreshForTradingEvent(accepted, 'invalid')).toBe(true)
  })
})

describe('TradingDataBridge fallback and recovery', () => {
  it('keeps the last accepted snapshot visible while a newer batch is still loading', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)

    render(<TradingDataBridge />)
    first.resolve(response(tradingSnapshot({
      revision: 'revision-1',
      sequence: 1,
      sourceLabel: 'snapshot-1',
      stocks: [{ code: '600001', name: '回归股份', score: 91.2 }],
    })))
    await flushPromises()
    expect(latestSnapshot().sourceLabel).toBe('snapshot-1')
    expect(latestSnapshot().stocks).toEqual([{ code: '600001', name: '回归股份', score: 91.2 }])

    const events = FakeEventSource.instances[0]!
    act(() => events.emit('open'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(latestSnapshot().sourceLabel).toBe('snapshot-1')

    second.resolve(response(tradingSnapshot({
      revision: 'revision-2',
      sequence: 2,
      sourceLabel: 'snapshot-2',
      stocks: [{ code: '600002', name: '分批加载股份', score: 88.8 }],
    })))
    await flushPromises()
    expect(latestSnapshot().sourceLabel).toBe('snapshot-2')
    expect(latestSnapshot().stocks).toEqual([{ code: '600002', name: '分批加载股份', score: 88.8 }])
  })

  it('marks reconnecting, polls at low frequency, and reconciles before returning to connected', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => response(tradingSnapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<TradingDataBridge />)
    await flushPromises()
    const events = FakeEventSource.instances[0]!

    act(() => events.emit('open'))
    await flushPromises()
    expect(latestSnapshot().transport?.state).toBe('connected')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    act(() => events.emit('error'))
    expect(latestSnapshot().transport?.state).toBe('reconnecting')
    expect(latestSnapshot().transport?.detail).toContain('SSE 连接中断')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRADING_FALLBACK_POLL_INTERVAL_MS)
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(latestSnapshot().transport?.state).toBe('reconnecting')

    act(() => events.emit('open'))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(latestSnapshot().transport?.state).toBe('connected')
  })
})
