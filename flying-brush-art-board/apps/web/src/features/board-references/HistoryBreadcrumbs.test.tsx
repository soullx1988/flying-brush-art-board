import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardHistoryEntry } from '@infinite-board/board-core'

import { HistoryBreadcrumbs } from './HistoryBreadcrumbs'

afterEach(cleanup)

function entry(entryId: string, boardId: string): BoardHistoryEntry {
  return {
    entryId,
    projectId: 'project-1',
    boardId,
    viewState: { camera: {}, selectedShapeIds: [], currentToolId: 'select' },
  }
}

describe('HistoryBreadcrumbs', () => {
  it('renders ancestor entries without repeating the current board title', () => {
    const onGoToEntry = vi.fn()
    render(
      <HistoryBreadcrumbs
        entries={[entry('a-1', 'board-a'), entry('b-1', 'board-b'), entry('a-2', 'board-a')]}
        getBoardTitle={(boardId) => ({ 'board-a': 'Alpha', 'board-b': 'Beta' })[boardId] ?? boardId}
        onBack={vi.fn()}
        onProjectHome={vi.fn()}
        onGoToEntry={onGoToEntry}
      />,
    )

    expect(screen.getAllByText('Alpha')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(onGoToEntry).toHaveBeenCalledWith(0)
    expect(screen.queryByText('Alpha', { selector: '[aria-current="page"]' })).not.toBeInTheDocument()
  })

  it('offers an application back action independently from the project-home crumb', () => {
    const onBack = vi.fn()
    const onProjectHome = vi.fn()
    render(
      <HistoryBreadcrumbs
        entries={[entry('a-1', 'board-a')]}
        getBoardTitle={() => 'Alpha'}
        onBack={onBack}
        onProjectHome={onProjectHome}
        onGoToEntry={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    fireEvent.click(screen.getByRole('button', { name: '项目首页' }))

    expect(onBack).toHaveBeenCalledOnce()
    expect(onProjectHome).toHaveBeenCalledOnce()
  })
})
