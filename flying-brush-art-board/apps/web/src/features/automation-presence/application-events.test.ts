import { afterEach, describe, expect, it, vi } from 'vitest'

type SocketListener = (event: { data?: unknown }) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  close = vi.fn()
  private readonly listeners = new Map<string, SocketListener[]>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  FakeWebSocket.instances = []
})

describe('application event socket lifecycle', () => {
  it('does not open the discarded StrictMode handshake', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const { startApplicationEvents } = await import('./application-events')

    const stopDiscardedMount = startApplicationEvents()
    stopDiscardedMount()
    const stopLiveMount = startApplicationEvents()

    expect(FakeWebSocket.instances).toHaveLength(0)
    await vi.runOnlyPendingTimersAsync()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]?.url).toMatch(/\/realtime\/events$/)

    stopLiveMount()
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalledOnce()
  })

  it('ignores a close event from a superseded socket', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const { startApplicationEvents } = await import('./application-events')
    const stop = startApplicationEvents()
    await vi.runOnlyPendingTimersAsync()

    const first = FakeWebSocket.instances[0]!
    first.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeWebSocket.instances).toHaveLength(2)

    first.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    stop()
  })
})
