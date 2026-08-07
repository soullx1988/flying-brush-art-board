import { describe, expect, it, vi } from 'vitest'

import { CommentEventHub } from './comment-events.js'

describe('CommentEventHub', () => {
  it('pushes only matching Board events and releases subscribers', () => {
    const hub = new CommentEventHub()
    const listener = vi.fn()
    const close = vi.fn()
    const unsubscribe = hub.subscribe('board-1', (event) => { listener(event); return true }, close)

    hub.publish({ type: 'comment.changed', boardId: 'board-2', threadId: 'other', action: 'reply' })
    hub.publish({ type: 'comment.changed', boardId: 'board-1', threadId: 'thread-1', action: 'resolve' })
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-1', action: 'resolve' }))
    expect(hub.subscriberCount('board-1')).toBe(1)

    unsubscribe()
    expect(hub.subscriberCount()).toBe(0)
    hub.subscribe('board-1', (event) => { listener(event); return true }, close)
    hub.close()
    expect(close).toHaveBeenCalledOnce()
    expect(hub.subscriberCount()).toBe(0)
  })

  it('replays missed events after the supplied event id', () => {
    const hub = new CommentEventHub({ replaySize: 3 })
    const first = hub.publish({ type: 'comment.changed', boardId: 'board-1', threadId: 'thread-1', action: 'create' })
    hub.publish({ type: 'comment.changed', boardId: 'board-1', threadId: 'thread-1', action: 'reply' })
    const listener = vi.fn(() => true)

    hub.subscribe('board-1', listener, undefined, first.id)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ action: 'reply' }))
  })

  it('enforces connection limits and removes subscribers that apply backpressure', () => {
    const hub = new CommentEventHub({ maxSubscribersPerBoard: 1, maxSubscribersTotal: 2 })
    const close = vi.fn()
    hub.subscribe('board-1', () => false, close)
    expect(() => hub.subscribe('board-1', () => true)).toThrow('COMMENT_EVENT_CONNECTION_LIMIT')

    hub.publish({ type: 'comment.changed', boardId: 'board-1', threadId: 'thread-1', action: 'move' })
    expect(close).toHaveBeenCalledOnce()
    expect(hub.subscriberCount()).toBe(0)
  })
})
