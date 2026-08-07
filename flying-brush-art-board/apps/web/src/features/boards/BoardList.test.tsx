import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BOARD_DRAG_TYPE, BoardList } from './BoardList'

afterEach(cleanup)

describe('BoardList', () => {
  it('publishes a board id for dropping an existing board onto the current canvas', () => {
    const onDragBoardStart = vi.fn()
    render(<BoardList
      project={{ id: 'project:one', title: '项目', rootBoardId: 'board:root', formatVersion: 1, createdAt: 't', updatedAt: 't' }}
      boards={[{ id: 'board:root', projectId: 'project:one', title: '概览', tldrawSnapshot: { store: {} }, revision: 0, createdAt: 't', updatedAt: 't' }]}
      references={[]}
      onOpenBoard={vi.fn()}
      onSetDefault={vi.fn()}
      onDragBoardStart={onDragBoardStart}
    />)

    const setData = vi.fn()
    fireEvent.dragStart(screen.getByRole('listitem', { name: '概览' }), {
      dataTransfer: { setData, effectAllowed: 'none' },
    })

    expect(setData).toHaveBeenCalledWith(BOARD_DRAG_TYPE, 'board:root')
    expect(onDragBoardStart).toHaveBeenCalledWith('board:root')
  })

  it('opens with Enter modifiers and moves focus with arrow keys', () => {
    const onOpenBoard = vi.fn()
    render(<BoardList
      project={{ id: 'project:one', title: '项目', rootBoardId: 'board:root', formatVersion: 1, createdAt: 't', updatedAt: 't' }}
      boards={[
        { id: 'board:root', projectId: 'project:one', title: '概览', tldrawSnapshot: { store: {} }, revision: 0, createdAt: 't', updatedAt: 't' },
        { id: 'board:next', projectId: 'project:one', title: '研究', tldrawSnapshot: { store: {} }, revision: 0, createdAt: 't', updatedAt: 't' },
      ]}
      references={[]}
      onOpenBoard={onOpenBoard}
      onSetDefault={vi.fn()}
    />)

    const [overview, research] = Array.from(document.querySelectorAll<HTMLButtonElement>('.board-list__open'))
    expect(overview).toBeDefined()
    expect(research).toBeDefined()
    if (!overview || !research) return
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowDown' })
    expect(research).toHaveFocus()
    fireEvent.keyDown(research, { key: 'ArrowUp' })
    expect(overview).toHaveFocus()
    fireEvent.keyDown(overview, { key: 'Enter', ctrlKey: true })
    expect(onOpenBoard).toHaveBeenCalledWith('board:root', 'new')
  })

  it('pins the default board first and gives it the default visual treatment', () => {
    render(<BoardList
      project={{ id: 'project:one', title: '项目', rootBoardId: 'board:root', formatVersion: 1, createdAt: 't', updatedAt: 't' }}
      boards={[
        { id: 'board:next', projectId: 'project:one', title: '研究', tldrawSnapshot: { store: {} }, revision: 0, createdAt: 't', updatedAt: '2026-07-28T10:00:00.000Z' },
        { id: 'board:root', projectId: 'project:one', title: '概览', tldrawSnapshot: { store: {} }, revision: 0, createdAt: 't', updatedAt: '2026-07-28T09:00:00.000Z' },
        { id: 'board:last', projectId: 'project:one', title: '归档候选', tldrawSnapshot: { store: {} }, revision: 0, createdAt: 't', updatedAt: '2026-07-28T08:00:00.000Z' },
      ]}
      references={[]}
      onOpenBoard={vi.fn()}
      onSetDefault={vi.fn()}
    />)

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['概览', '研究', '归档候选'])
    expect(items[0]).toHaveClass('board-list__item--default')
    expect(items[0]).toHaveTextContent('默认入口')
    expect(items[1]).not.toHaveClass('board-list__item--default')
  })
})
