import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CreateBoardReferenceDialog } from './CreateBoardReferenceDialog'

describe('CreateBoardReferenceDialog', () => {
  it('submits either an existing target or a newly embedded board', async () => {
    const onCreate = vi.fn()
    const view = render(
      <CreateBoardReferenceDialog
        open
        boards={[
          { id: 'board:a', title: 'Board A' },
          { id: 'board:b', title: 'Board B' },
        ]}
        onCancel={vi.fn()}
        onCreate={onCreate}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '目标画板' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Board B' }))
    fireEvent.click(screen.getByRole('combobox', { name: '引用类型' }))
    fireEvent.click(await screen.findByRole('option', { name: '普通链接' }))
    fireEvent.click(screen.getByRole('button', { name: '创建引用' }))
    expect(onCreate).toHaveBeenLastCalledWith({
      mode: 'existing',
      targetBoardId: 'board:b',
      kind: 'link',
    })

    view.rerender(
      <CreateBoardReferenceDialog
        open
        boards={[]}
        onCancel={vi.fn()}
        onCreate={onCreate}
      />,
    )
    fireEvent.click(screen.getByLabelText('新建目标画板'))
    fireEvent.change(screen.getByLabelText('新画板名称'), { target: { value: 'Nested board' } })
    fireEvent.click(screen.getByRole('button', { name: '创建引用' }))
    expect(onCreate).toHaveBeenLastCalledWith({ mode: 'new', title: 'Nested board' })
  })
})
