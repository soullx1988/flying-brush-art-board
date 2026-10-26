import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUserId, type TLUserStore } from 'tldraw'

const useSync = vi.hoisted(() => vi.fn((_options: unknown) => ({ status: 'loading' })))

vi.mock('@tldraw/sync', () => ({ useSync }))

import { getRealtimeBoardSocketUri, useRealtimeBoardStore } from './use-realtime-board-store'

beforeEach(() => {
  useSync.mockClear()
})

describe('getRealtimeBoardSocketUri', () => {
  it('uses a same-origin secure websocket address and never embeds credentials', () => {
    expect(getRealtimeBoardSocketUri('board / one', { protocol: 'https:', host: 'board.example.test' }))
      .toBe('wss://board.example.test/realtime/boards/board%20%2F%20one')
  })

  it('uses ws only for localhost-style HTTP development', () => {
    expect(getRealtimeBoardSocketUri('board-1', { protocol: 'http:', host: '127.0.0.1:4173' }))
      .toBe('ws://127.0.0.1:4173/realtime/boards/board-1')
  })

  it('keeps the realtime user store stable across equivalent identity rerenders', () => {
    const identity = { id: 'ou_ada', name: 'Ada Lovelace', color: '#7B66DC' }
    const { rerender } = renderHook(
      ({ user }) => useRealtimeBoardStore('board-1', user),
      { initialProps: { user: identity } },
    )
    rerender({ user: { ...identity } })

    expect(useSync).toHaveBeenCalledTimes(2)
    const calls = useSync.mock.calls as unknown as Array<[{
      shapeUtils: unknown
      users?: TLUserStore
    }]>
    const first = calls[0]?.[0]
    const second = calls[1]?.[0]
    expect(second?.shapeUtils).toBe(first?.shapeUtils)
    expect(second?.users).toBe(first?.users)
    expect(first?.users?.currentUser.get()).toMatchObject({
      id: createUserId(identity.id),
      name: identity.name,
      color: identity.color,
    })
  })

  it('keeps the default anonymous useSync behavior when no identity is provided', () => {
    renderHook(() => useRealtimeBoardStore('board-1'))

    const options = useSync.mock.calls[0]?.[0] as unknown as Record<string, unknown>
    expect(options).not.toHaveProperty('users')
  })
})
