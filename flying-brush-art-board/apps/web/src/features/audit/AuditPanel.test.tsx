import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuditPanel } from './AuditPanel'

afterEach(cleanup)

describe('AuditPanel', () => {
  it('filters events and loads the next cursor page', async () => {
    const listAuditEvents = vi.fn()
      .mockResolvedValueOnce({ events: [] })
      .mockResolvedValueOnce({ events: [{ id: 'a1', actorOpenId: 'ou_1', boardId: 'b1', action: 'board.rename', summary: {}, createdAt: '2026-07-24T00:00:00Z' }], nextCursor: 'next' })
      .mockResolvedValueOnce({ events: [{ id: 'a2', actorOpenId: 'ou_1', boardId: 'b1', action: 'board.edit', summary: {}, createdAt: '2026-07-23T00:00:00Z' }] })
    render(<AuditPanel
      projectId="p1"
      client={{ listAuditEvents }}
      boards={[{ id: 'b1', projectId: 'p1', title: '研究', tldrawSnapshot: { store: {} }, revision: 0, createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z' }]}
    />)

    await waitFor(() => expect(listAuditEvents).toHaveBeenCalledWith({ projectId: 'p1', limit: 50 }))
    fireEvent.click(screen.getByLabelText('筛选画板'))
    fireEvent.click(await screen.findByRole('option', { name: '研究' }))
    fireEvent.click(screen.getByLabelText('筛选操作'))
    fireEvent.click(await screen.findByRole('option', { name: '重命名画板' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(listAuditEvents).toHaveBeenLastCalledWith({ projectId: 'p1', boardId: 'b1', action: 'board.rename', limit: 50 }))
    expect(screen.getByRole('button', { name: /重命名画板/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() => expect(listAuditEvents).toHaveBeenLastCalledWith({ projectId: 'p1', boardId: 'b1', action: 'board.rename', cursor: 'next', limit: 50 }))
    expect(screen.getByRole('button', { name: /编辑画板/ })).toBeInTheDocument()
  })

  it('ignores an older response that resolves after a newer filter request', async () => {
    let resolveInitial!: (value: { events: Array<{ id: string; actorOpenId: string; action: string; summary: Record<string, unknown>; createdAt: string }> }) => void
    const initial = new Promise<{ events: Array<{ id: string; actorOpenId: string; action: string; summary: Record<string, unknown>; createdAt: string }> }>((resolve) => { resolveInitial = resolve })
    const listAuditEvents = vi.fn()
      .mockReturnValueOnce(initial)
      .mockResolvedValueOnce({ events: [{ id: 'new', actorOpenId: 'ou_1', action: 'project.rename', summary: {}, createdAt: '2026-07-25T00:00:00Z' }] })
    render(<AuditPanel projectId="p1" client={{ listAuditEvents }} />)

    fireEvent.click(screen.getByLabelText('筛选操作'))
    fireEvent.click(await screen.findByRole('option', { name: '重命名项目' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    expect(await screen.findByRole('button', { name: /重命名项目/ })).toBeInTheDocument()

    resolveInitial({ events: [{ id: 'old', actorOpenId: 'ou_2', action: 'board.delete', summary: {}, createdAt: '2026-07-24T00:00:00Z' }] })
    await waitFor(() => expect(screen.queryByRole('button', { name: /删除画板/ })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /重命名项目/ })).toBeInTheDocument()
  })
})
