import { useLayoutEffect } from 'react'

import {
  setTradingWorkbenchViewStateResolver,
  type TradingWorkbenchSnapshot,
  type TradingWorkbenchViewState,
  type TradingTransportState,
} from '@infinite-board/tldraw-adapter'

export const TRADING_FALLBACK_POLL_INTERVAL_MS = 4_000

export interface TradingSnapshotResponse extends TradingWorkbenchSnapshot {
  revision: string
  streamId?: string
  sequence?: number
}

export interface TradingStreamCursor {
  streamId: string
  sequence: number
}

function cursorFrom(value: { streamId?: string; sequence?: number }): TradingStreamCursor | undefined {
  if (!value.streamId || !Number.isSafeInteger(value.sequence) || (value.sequence ?? -1) < 0) return undefined
  return { streamId: value.streamId, sequence: value.sequence! }
}

/**
 * `revision` remains an opaque ETag. Ordering is provided by the stream cursor;
 * responses from older server sequences are rejected within the same stream.
 */
export function shouldAcceptTradingCursor(
  accepted: TradingStreamCursor | undefined,
  incoming: TradingStreamCursor | undefined,
): boolean {
  if (!incoming) return false
  if (!accepted) return true
  if (incoming.streamId !== accepted.streamId) return true
  return incoming.sequence >= accepted.sequence
}

export function enforceTradingFreshnessDeadline(
  snapshot: TradingSnapshotResponse,
  nowMs = Date.now(),
): TradingSnapshotResponse {
  if (snapshot.status !== 'ready'
    || snapshot.sourceHealth !== 'CURRENT'
    || snapshot.freshness !== 'CURRENT') return snapshot
  const sourceGeneratedAtMs = snapshot.sourceGeneratedAt ? Date.parse(snapshot.sourceGeneratedAt) : Number.NaN
  const freshUntilMs = snapshot.freshUntil ? Date.parse(snapshot.freshUntil) : Number.NaN
  if (!Number.isFinite(sourceGeneratedAtMs) || !Number.isFinite(freshUntilMs)) {
    return {
      ...snapshot,
      status: 'degraded',
      freshness: 'UNKNOWN',
      sourceHealth: 'DEGRADED',
      message: 'TRADING_FRESHNESS_CONTRACT_INCOMPLETE',
    }
  }
  if (freshUntilMs > nowMs) return snapshot
  return {
    ...snapshot,
    status: 'stale',
    freshness: 'STALE',
    sourceHealth: 'STALE',
    staleSince: snapshot.freshUntil ?? new Date(nowMs).toISOString(),
    ageMs: Math.max(0, nowMs - sourceGeneratedAtMs),
    message: 'TRADING_SOURCE_EXPIRED_LOCALLY',
  }
}

export function shouldRefreshForTradingEvent(
  accepted: TradingStreamCursor | undefined,
  eventData: unknown,
): boolean {
  if (!eventData || typeof eventData !== 'object') return true
  const incoming = cursorFrom(eventData as { streamId?: string; sequence?: number })
  if (!incoming || !accepted || incoming.streamId !== accepted.streamId) return true
  return incoming.sequence > accepted.sequence
}

async function loadTradingSnapshot(signal?: AbortSignal): Promise<TradingSnapshotResponse> {
  const response = await fetch('/api/trading/snapshot', {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  return response.json() as Promise<TradingSnapshotResponse>
}

export function TradingDataBridge() {
  useLayoutEffect(() => {
    let active = true
    let resolverDispose = () => {}
    let requestController: AbortController | undefined
    let requestSequence = 0
    let acceptedCursor: TradingStreamCursor | undefined
    let acceptedSnapshot: TradingSnapshotResponse | undefined
    let hasFailedBeforeFirstSnapshot = false
    let fallbackTimer: ReturnType<typeof setInterval> | undefined
    let freshnessTimer: ReturnType<typeof setTimeout> | undefined
    let streamOpen = false
    let events: EventSource | undefined
    let transport: NonNullable<TradingWorkbenchSnapshot['transport']> = { state: 'connecting' }

    const publish = (viewState: TradingWorkbenchViewState) => {
      resolverDispose()
      resolverDispose = setTradingWorkbenchViewStateResolver(() => viewState)
    }

    const connectingState = (message?: string): TradingWorkbenchViewState => ({
      kind: 'connecting',
      transport,
      message: message ?? '正在连接交易数据，等待首个可核验快照。',
    })

    const unavailableSnapshot = (message?: string): TradingWorkbenchSnapshot => ({
      status: 'unavailable',
      updatedAt: new Date().toISOString(),
      sourceLabel: '07 中短线选股器',
      ...(message ? { message } : {}),
      sourceGeneratedAt: null,
      availableAt: null,
      freshUntil: null,
      freshness: 'UNKNOWN',
      sourceHealth: 'UNAVAILABLE',
      themes: [],
      stocks: [],
      announcements: [],
      services: [],
      transport,
    })

    const publishCurrent = (message?: string) => {
      if (acceptedSnapshot) {
        publish({ kind: 'snapshot', snapshot: { ...acceptedSnapshot, transport } })
        return
      }
      publish(hasFailedBeforeFirstSnapshot
        ? { kind: 'snapshot', snapshot: unavailableSnapshot(message) }
        : connectingState(message))
    }

    const setTransport = (state: TradingTransportState, detail?: string) => {
      const now = new Date().toISOString()
      transport = {
        state,
        ...(transport.lastConnectedAt ? { lastConnectedAt: transport.lastConnectedAt } : {}),
        ...(transport.lastEventAt ? { lastEventAt: transport.lastEventAt } : {}),
        ...(state === 'connected' ? { lastConnectedAt: now } : {}),
        ...(detail ? { detail } : {}),
      }
      publishCurrent(detail)
    }

    const clearFallback = () => {
      if (fallbackTimer === undefined) return
      clearInterval(fallbackTimer)
      fallbackTimer = undefined
    }

    const clearFreshnessTimer = () => {
      if (freshnessTimer === undefined) return
      clearTimeout(freshnessTimer)
      freshnessTimer = undefined
    }

    const scheduleFreshnessDeadline = () => {
      clearFreshnessTimer()
      if (!acceptedSnapshot || acceptedSnapshot.status !== 'ready') return
      const deadline = acceptedSnapshot.freshUntil ? Date.parse(acceptedSnapshot.freshUntil) : Number.NaN
      if (!Number.isFinite(deadline)) return
      const delay = deadline - Date.now()
      if (delay <= 0) return
      freshnessTimer = setTimeout(() => {
        freshnessTimer = undefined
        if (!active || !acceptedSnapshot) return
        acceptedSnapshot = enforceTradingFreshnessDeadline(acceptedSnapshot)
        publishCurrent()
      }, Math.min(delay, 2_147_000_000))
    }

    const beginFallback = (state: 'reconnecting' | 'fallback', detail: string) => {
      setTransport(state, detail)
      if (fallbackTimer !== undefined) return
      fallbackTimer = setInterval(() => void refresh(), TRADING_FALLBACK_POLL_INTERVAL_MS)
      void refresh()
    }

    const settleConnectedTransport = () => {
      if (!streamOpen || transport.state === 'connected') return false
      clearFallback()
      transport = {
        state: 'connected',
        lastConnectedAt: new Date().toISOString(),
        ...(transport.lastEventAt ? { lastEventAt: transport.lastEventAt } : {}),
      }
      return true
    }

    const refresh = async () => {
      const sequence = ++requestSequence
      requestController?.abort()
      const controller = new AbortController()
      requestController = controller
      try {
        const snapshot = await loadTradingSnapshot(controller.signal)
        if (!active || controller.signal.aborted || sequence !== requestSequence) return
        const incomingCursor = cursorFrom(snapshot)
        if (!incomingCursor) throw new Error('TRADING_SNAPSHOT_CURSOR_INVALID')
        if (!shouldAcceptTradingCursor(acceptedCursor, incomingCursor)) {
          if (settleConnectedTransport()) publishCurrent()
          return
        }
        acceptedCursor = incomingCursor
        acceptedSnapshot = enforceTradingFreshnessDeadline(snapshot)
        hasFailedBeforeFirstSnapshot = false
        scheduleFreshnessDeadline()
        settleConnectedTransport()
        publishCurrent()
      } catch (error) {
        if (!active || controller.signal.aborted || sequence !== requestSequence) return
        if (!acceptedSnapshot) hasFailedBeforeFirstSnapshot = true
        beginFallback(
          streamOpen ? 'fallback' : 'reconnecting',
          error instanceof Error ? error.message : 'TRADING_SOURCE_UNAVAILABLE',
        )
      }
    }

    publishCurrent('正在建立数据连接')
    void refresh()
    if (typeof EventSource === 'undefined') {
      beginFallback('fallback', '当前环境不支持 SSE，已启用低频 HTTP 对账')
      return () => {
        active = false
        requestController?.abort()
        clearFallback()
        clearFreshnessTimer()
        resolverDispose()
      }
    }

    const onOpen = () => {
      streamOpen = true
      setTransport('connecting', 'SSE 已连接，正在进行 HTTP 对账')
      // The stream may have changed while disconnected; HTTP is authoritative.
      void refresh()
    }
    const onError = () => {
      streamOpen = false
      beginFallback('reconnecting', 'SSE 连接中断，正在重连并低频对账')
    }
    const changed = (event: Event) => {
      const message = event as MessageEvent<string>
      let data: unknown
      try {
        data = message.data ? JSON.parse(message.data) : undefined
      } catch {
        data = undefined
      }
      transport = { ...transport, lastEventAt: new Date().toISOString() }
      if (shouldRefreshForTradingEvent(acceptedCursor, data)) void refresh()
    }

    try {
      events = new EventSource('/api/trading/events')
    } catch (error) {
      beginFallback(
        'fallback',
        error instanceof Error ? error.message : 'SSE_UNAVAILABLE',
      )
    }
    events?.addEventListener('open', onOpen)
    events?.addEventListener('error', onError)
    events?.addEventListener('trading.snapshot.changed', changed)
    events?.addEventListener('trading.ready', changed)
    return () => {
      active = false
      requestController?.abort()
      clearFallback()
      clearFreshnessTimer()
      events?.removeEventListener('open', onOpen)
      events?.removeEventListener('error', onError)
      events?.removeEventListener('trading.snapshot.changed', changed)
      events?.removeEventListener('trading.ready', changed)
      events?.close()
      resolverDispose()
    }
  }, [])

  return null
}
