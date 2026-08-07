import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardReferenceRecord } from '@infinite-board/board-core'

import { InboundReferenceList } from './InboundReferenceList'

afterEach(cleanup)

const now = '2026-07-23T00:00:00.000Z'

function reference(id: string, sourceBoardId: string, shapeId: string): BoardReferenceRecord {
  return {
    id,
    projectId: 'project-1',
    sourceBoardId,
    targetBoardId: 'board-c',
    shapeId,
    kind: 'link',
    createdAt: now,
    updatedAt: now,
  }
}

describe('InboundReferenceList', () => {
  it('shows every inbound source shape for a bare deep link', () => {
    const a = reference('a-c', 'board-a', 'shape:a-c')
    const b = reference('b-c', 'board-b', 'shape:b-c')
    const onOpenSource = vi.fn()
    render(
      <InboundReferenceList
        references={[a, b]}
        getBoardTitle={(boardId) => ({ 'board-a': 'Alpha', 'board-b': 'Beta' })[boardId] ?? boardId}
        onOpenSource={onOpenSource}
      />,
    )

    expect(screen.getByRole('heading', { name: '引用此画板的位置' })).toBeInTheDocument()
    expect(screen.queryByText('shape:a-c')).not.toBeInTheDocument()
    expect(screen.queryByText('shape:b-c')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(onOpenSource).toHaveBeenCalledWith(a)
  })

  it('states that no source exists when a bare board has no inbound references', () => {
    render(
      <InboundReferenceList references={[]} getBoardTitle={(boardId) => boardId} onOpenSource={vi.fn()} />,
    )

    expect(screen.getByText('没有画板引用此画板。')).toBeInTheDocument()
  })
})
