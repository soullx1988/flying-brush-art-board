import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('tldraw', () => ({
  useValue: (_name: string, getValue: () => unknown) => getValue(),
  TldrawUiIcon: () => <span />,
}))

import { CommentDraftPin, CommentPendingPin, CommentPins } from './CommentPins'

describe('CommentPins', () => {
  it('places shape and free-coordinate anchors on the canvas and focuses their thread', () => {
    const onFocusThread = vi.fn()
    const onMoveThread = vi.fn()
    const onDeleteThread = vi.fn()
    const editor = {
      getShape: (id: string) => id === 'shape:one' ? { x: 20, y: 30 } : undefined,
      getShapePageTransform: () => ({ applyToPoint: ({ x, y }: { x: number; y: number }) => ({ x: x + 20, y: y + 30 }) }),
      getShapeGeometry: () => ({ bounds: { center: { x: 20, y: 30 } } }),
      pageToScreen: ({ x, y }: { x: number; y: number }) => ({ x: x + 100, y: y + 200 }),
      screenToPage: ({ x, y }: { x: number; y: number }) => ({ x: x - 100, y: y - 200 }),
      getCamera: () => ({ x: 0, y: 0, z: 1 }),
    }
    render(<CommentPins
      editor={editor as never}
      threads={[
        { id: 'shape-thread', shapeId: 'shape:one', shapeOffsetX: 5, shapeOffsetY: 6, status: 'open', createdBy: 'ou_1', createdAt: '2026-07-25T08:00:00.000Z', updatedAt: '2026-07-25T08:00:00.000Z' },
        { id: 'point-thread', x: 40, y: 50, status: 'resolved', createdBy: 'ou_1', createdAt: '2026-07-25T08:00:00.000Z', updatedAt: '2026-07-25T08:00:00.000Z' },
        { id: 'missing-thread', shapeId: 'shape:missing', status: 'open', createdBy: 'ou_1', createdAt: '2026-07-25T08:00:00.000Z', updatedAt: '2026-07-25T08:00:00.000Z' },
      ]}
      onFocusThread={onFocusThread}
      onMoveThread={onMoveThread}
      onDeleteThread={onDeleteThread}
    />)

    expect(screen.getByRole('button', { name: '评论 1' })).toHaveStyle({ left: '125px', top: '236px' })
    expect(screen.getByRole('button', { name: '评论 2' })).toHaveStyle({ left: '140px', top: '250px' })
    expect(screen.queryByRole('button', { name: '评论 3' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '评论 1' }))
    expect(screen.getByRole('button', { name: '评论 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(onFocusThread).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByRole('button', { name: '评论 1' }))
    expect(onFocusThread).toHaveBeenCalledWith('shape-thread')

    fireEvent.keyDown(screen.getByRole('button', { name: '评论 1' }), { key: 'Delete' })
    expect(onDeleteThread).toHaveBeenCalledWith('shape-thread')

    fireEvent.contextMenu(screen.getByRole('button', { name: '评论 1' }), { clientX: 320, clientY: 240 })
    fireEvent.click(screen.getByRole('menuitem', { name: '查看详情' }))
    expect(onFocusThread).toHaveBeenLastCalledWith('shape-thread')
    fireEvent.contextMenu(screen.getByRole('button', { name: '评论 1' }), { clientX: 320, clientY: 240 })
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    expect(onDeleteThread).toHaveBeenLastCalledWith('shape-thread')

    fireEvent.pointerDown(screen.getByRole('button', { name: '评论 2' }), { pointerId: 7, clientX: 140, clientY: 250 })
    fireEvent.pointerMove(screen.getByRole('button', { name: '评论 2' }), { pointerId: 7, clientX: 180, clientY: 270 })
    expect(screen.getByRole('button', { name: '评论 2' })).toHaveStyle({ left: '180px', top: '270px' })
    fireEvent.pointerUp(screen.getByRole('button', { name: '评论 2' }), { pointerId: 7, clientX: 180, clientY: 270 })
    expect(onMoveThread).toHaveBeenCalledWith('point-thread', { x: 80, y: 70 })
  })

  it('shows the draft comment icon at the cursor only while it is over the canvas', () => {
    const editor = {
    }
    const { container } = render(<div className="canvas-editor"><CommentDraftPin editor={editor as never} /></div>)
    fireEvent.pointerMove(container.firstElementChild as Element, { clientX: 230, clientY: 300 })
    const pin = container.querySelector('.comment-pin--draft')
    expect(pin).toHaveClass('comment-pin--visible')
    expect(pin).toHaveStyle({ left: '230px', top: '300px' })
  })

  it('keeps a pending comment icon visible after the canvas receives its placement', () => {
    const editor = {
      getCamera: () => ({ x: 0, y: 0, z: 1 }),
      pageToScreen: ({ x, y }: { x: number; y: number }) => ({ x: x + 100, y: y + 200 }),
    }
    render(<CommentPendingPin editor={editor as never} anchor={{ x: 20, y: 30 }} />)

    expect(screen.getByLabelText('待提交评论')).toHaveStyle({ left: '120px', top: '230px' })
  })
})
