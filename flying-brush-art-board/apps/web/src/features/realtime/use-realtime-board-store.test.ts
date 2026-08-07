import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const useSync = vi.hoisted(() => vi.fn(() => ({ status: 'loading' })))

vi.mock('@tldraw/sync', () => ({ useSync }))

import { getRealtimeBoardSocketUri, useRealtimeBoardStore } from './use-realtime-board-store'

describe('getRealtimeBoardSocketUri', () => {
  it('uses a same-origin secure websocket address and never embeds credentials', () => {
    expect(getRealtimeBoardSocketUri('board / one', { protocol: 'https:', host: 'board.example.test' }))
      .toBe('wss://board.example.test/realtime/boards/board%20%2F%20one')
  })

  it('uses ws only for localhost-style HTTP development', () => {
    expect(getRealtimeBoardSocketUri('board-1', { protocol: 'http:', host: '127.0.0.1:4173' }))
      .toBe('ws://127.0.0.1:4173/realtime/boards/board-1')
  })

  it('keeps useSync options referentially stable across a normal rerender', () => {
    const { rerender } = renderHook(() => useRealtimeBoardStore('board-1'))
    rerender()

    expect(useSync).toHaveBeenCalledTimes(2)
    const calls = useSync.mock.calls as unknown as Array<[{ shapeUtils: unknown }]>
    const first = calls[0]?.[0]
    const second = calls[1]?.[0]
    expect(second?.shapeUtils).toBe(first?.shapeUtils)
  })
})
