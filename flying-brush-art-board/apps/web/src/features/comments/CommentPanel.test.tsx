import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentPanel } from './CommentPanel'
import type { CommentClient } from './comment-client'

afterEach(() => cleanup())

describe('CommentPanel', () => {
  it('creates anchor comments and warns when a linked shape no longer exists', async () => {
    const createdAt = '2026-07-25T08:00:00.000Z'
    const createThread = vi.fn(async () => ({ thread: { id: 't2', status: 'open' as const, createdBy: 'ou_1', createdAt, updatedAt: createdAt } }))
    const deleteThread = vi.fn(async () => undefined)
    const listMessages = vi.fn(async () => [])
    const client: CommentClient = { listThreads: async () => [{ id: 't1', shapeId: 'shape:missing', status: 'open', createdBy: 'ou_1', createdAt, updatedAt: createdAt }], listMessages, createThread, addMessage: async () => ({ id: 'm', threadId: 't1', authorOpenId: 'ou_1', body: 'reply', createdAt }), setThreadStatus: async () => ({ id: 't1', status: 'resolved', createdBy: 'ou_1', createdAt, updatedAt: createdAt }), updateThreadAnchor: async () => ({ id: 't1', status: 'open', createdBy: 'ou_1', createdAt, updatedAt: createdAt }), deleteThread }
    render(<CommentPanel boardId="b" client={client} hasShape={() => false} pendingAnchor={{ shapeId: 'shape:selected', x: 1, y: 2 }} onClose={vi.fn()} />)
    expect(await screen.findByText(/原画布锚点已不存在/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '新评论' }), { target: { value: 'Review' } })
    fireEvent.click(screen.getByRole('button', { name: '发送评论' }))
    await waitFor(() => expect(createThread).toHaveBeenCalledWith('b', { body: 'Review', shapeId: 'shape:selected', x: 1, y: 2 }))
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith('t1'))
    fireEvent.click(screen.getByRole('button', { name: '评论操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除讨论' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除讨论' }))
    await waitFor(() => expect(deleteThread).toHaveBeenCalledWith('t1'))
  })

  it('offers a canvas locate action for positioned threads', async () => {
    const createdAt = '2026-07-25T08:00:00.000Z'
    const thread = { id: 't1', x: 24, y: 48, status: 'open' as const, createdBy: 'ou_1', createdAt, updatedAt: createdAt }
    const onLocateThread = vi.fn()
    const client: CommentClient = {
      listThreads: async () => [thread],
      listMessages: async () => [],
      createThread: vi.fn(),
      addMessage: vi.fn(),
      setThreadStatus: vi.fn(),
      updateThreadAnchor: vi.fn(),
      deleteThread: vi.fn(),
    }

    render(<CommentPanel boardId="b" client={client} hasShape={() => true} onLocateThread={onLocateThread} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '定位到画布' }))
    expect(onLocateThread).toHaveBeenCalledWith(thread)
  })

  it('shows only the focused thread and hides overview filters', async () => {
    const createdAt = '2026-07-25T08:00:00.000Z'
    const thread = { id: 'resolved-thread', status: 'resolved' as const, createdBy: 'ou_1', createdAt, updatedAt: createdAt }
    const otherThread = { id: 'open-thread', status: 'open' as const, createdBy: 'ou_2', createdAt, updatedAt: createdAt }
    const client: CommentClient = {
      listThreads: async () => [thread, otherThread],
      listMessages: async (threadId) => threadId === thread.id
        ? [{ id: 'message-1', threadId: thread.id, authorOpenId: 'ou_1', body: 'Resolved body', createdAt }]
        : [{ id: 'message-2', threadId: otherThread.id, authorOpenId: 'ou_2', body: 'Other body', createdAt }],
      createThread: vi.fn(), addMessage: vi.fn(), setThreadStatus: vi.fn(), updateThreadAnchor: vi.fn(), deleteThread: vi.fn(),
    }

    render(<CommentPanel boardId="b" client={client} hasShape={() => true} focusedThreadId={thread.id} onClose={vi.fn()} />)
    expect(await screen.findByText('Resolved body')).toBeInTheDocument()
    expect(screen.queryByText('Other body')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: '评论状态' })).not.toBeInTheDocument()
  })
})
