import { describe, expect, it, vi } from 'vitest'

import { asRealtimeSocket } from './realtime-socket.js'

describe('asRealtimeSocket', () => {
  it('adapts Node ws message events to the EventTarget shape used by TLSocketRoom', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const raw = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => handlers.set(event, listener)),
      off: vi.fn((event: string) => handlers.delete(event)),
    }
    const socket = asRealtimeSocket(raw)
    const listener = vi.fn()

    socket.addEventListener?.('message', listener)
    handlers.get('message')?.(new TextEncoder().encode('{"type":"connect"}'))

    expect(listener).toHaveBeenCalledWith({ data: '{"type":"connect"}' })
    socket.removeEventListener?.('message', listener)
    expect(raw.off).toHaveBeenCalled()
  })

  it('leaves standards-compliant WebSockets unchanged', () => {
    const raw = {
      readyState: 1,
      send() {},
      close() {},
      addEventListener() {},
    }
    expect(asRealtimeSocket(raw)).toBe(raw)
  })
})
