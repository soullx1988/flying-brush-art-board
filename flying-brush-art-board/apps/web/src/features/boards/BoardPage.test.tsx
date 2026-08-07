import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Box } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationEvent } from '../automation-presence/application-events'

const boardPageMocks = vi.hoisted(() => {
  const methods = {
    getShape: vi.fn(),
    setHintingShapes: vi.fn(),
    isIn: vi.fn(),
    getEditingShapeId: vi.fn(),
    getShapePageBounds: vi.fn(),
    zoomToBounds: vi.fn(),
  }
  const editor = { id: 'editor' } as Record<string, unknown>
  Object.defineProperties(editor, Object.fromEntries(
    Object.entries(methods).map(([name, value]) => [name, { configurable: true, value }]),
  ))
  return {
    applicationListener: undefined as ((event: ApplicationEvent) => void) | undefined,
    editor,
    methods,
  }
})

vi.mock('../automation-presence/application-events', () => ({
  subscribeApplicationEvents: vi.fn((listener: (event: ApplicationEvent) => void) => {
    boardPageMocks.applicationListener = listener
    return () => {
      if (boardPageMocks.applicationListener === listener) boardPageMocks.applicationListener = undefined
    }
  }),
}))

vi.mock('../canvas/CanvasEditor', () => ({
  CanvasEditor: ({
    onEditIntent,
    onMount,
    onFocusCommentThread,
    commentToolActive,
    onCommentToolToggle,
    referenceToolActive,
    onReferenceToolToggle,
    onReferencePlace,
  }: {
    onEditIntent?: () => boolean
    onMount?: (editor: unknown) => void
    onFocusCommentThread?: (threadId: string) => void
    commentToolActive?: boolean
    onCommentToolToggle?: () => void
    referenceToolActive?: boolean
    onReferenceToolToggle?: () => void
    onReferencePlace?: (placement: { x: number; y: number }) => void
  }) => {
    onMount?.(boardPageMocks.editor)
    return (
      <>
        <button type="button" onClick={() => onEditIntent?.()}>request canvas edit</button>
        <button type="button" onClick={() => onFocusCommentThread?.('thread-1')}>open comment 1</button>
        <button type="button" data-testid="toggle-comment-tool" data-active={commentToolActive ? 'true' : 'false'} onClick={onCommentToolToggle}>toggle comment tool</button>
        <button type="button" data-testid="toggle-reference-tool" data-active={referenceToolActive ? 'true' : 'false'} onClick={onReferenceToolToggle}>toggle reference tool</button>
        <button type="button" data-testid="place-reference" onClick={() => onReferencePlace?.({ x: 120, y: 240 })}>place reference</button>
      </>
    )
  },
}))

vi.mock('../import-export/visual-import', () => ({
  exportBoardAsPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  exportBoardAsSvg: vi.fn(async () => new Blob(['svg'], { type: 'image/svg+xml' })),
}))

import { BoardPage } from './BoardPage'
import { exportBoardAsPng, exportBoardAsSvg } from '../import-export/visual-import'

beforeEach(() => {
  boardPageMocks.applicationListener = undefined
  boardPageMocks.methods.getShape.mockReset().mockReturnValue(undefined)
  boardPageMocks.methods.setHintingShapes.mockReset()
  boardPageMocks.methods.isIn.mockReset().mockReturnValue(true)
  boardPageMocks.methods.getEditingShapeId.mockReset().mockReturnValue(undefined)
  boardPageMocks.methods.getShapePageBounds.mockReset().mockReturnValue(undefined)
  boardPageMocks.methods.zoomToBounds.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function emitApplicationEvent(event: Partial<ApplicationEvent> & Pick<ApplicationEvent, 'type'>) {
  act(() => {
    boardPageMocks.applicationListener?.({
      createdAt: '2026-08-01T00:00:00.000Z',
      ...event,
    })
  })
}

describe('BoardPage', () => {
  it('always follows committed AI results and no longer exposes a follow toggle', () => {
    boardPageMocks.methods.getShape.mockReturnValue({ id: 'shape:result' })
    boardPageMocks.methods.getShapePageBounds.mockReturnValue(new Box(10, 20, 120, 80))

    render(
      <BoardPage
        title="Board A"
        boardId="board-a"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
      />,
    )

    expect(screen.queryByRole('button', { name: /跟随 AI/ })).not.toBeInTheDocument()
    expect(boardPageMocks.methods.zoomToBounds).not.toHaveBeenCalled()

    emitApplicationEvent({
      type: 'operation.committed',
      boardId: 'board-a',
      summary: '创建完成',
      affectedIds: ['shape:result'],
    })

    expect(boardPageMocks.methods.setHintingShapes).toHaveBeenCalledWith(['shape:result'])
    expect(boardPageMocks.methods.zoomToBounds).toHaveBeenCalledWith(
      expect.any(Box),
      { animation: { duration: 220 }, inset: 80, targetZoom: 1 },
    )
  })

  it('does not move the viewport while the editor is busy or editing text', () => {
    boardPageMocks.methods.getShape.mockReturnValue({ id: 'shape:result' })
    boardPageMocks.methods.getShapePageBounds.mockReturnValue(new Box(10, 20, 120, 80))
    boardPageMocks.methods.isIn.mockReturnValue(false)

    render(
      <BoardPage
        title="Board A"
        boardId="board-a"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
      />,
    )

    emitApplicationEvent({ type: 'operation.committed', boardId: 'board-a', affectedIds: ['shape:result'] })
    expect(boardPageMocks.methods.zoomToBounds).not.toHaveBeenCalled()

    boardPageMocks.methods.isIn.mockReturnValue(true)
    boardPageMocks.methods.getEditingShapeId.mockReturnValue('shape:editing')
    emitApplicationEvent({ type: 'operation.committed', boardId: 'board-a', affectedIds: ['shape:result'] })
    expect(boardPageMocks.methods.zoomToBounds).not.toHaveBeenCalled()
  })

  it('ignores AI events from another board and committed events without valid shapes', () => {
    render(
      <BoardPage
        title="Board A"
        boardId="board-a"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
      />,
    )

    emitApplicationEvent({ type: 'operation.committed', boardId: 'board-b', affectedIds: ['shape:result'] })
    emitApplicationEvent({ type: 'operation.committed', boardId: 'board-a', affectedIds: [] })

    expect(boardPageMocks.methods.setHintingShapes).not.toHaveBeenCalled()
    expect(boardPageMocks.methods.zoomToBounds).not.toHaveBeenCalled()
  })

  it('forwards the synchronous edit-intent boundary to its mounted canvas', () => {
    const onEditIntent = vi.fn(() => true)

    render(
      <BoardPage
        title="Board A"
        status="clean"
        readOnly
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={onEditIntent}
      />,
    )

    screen.getByRole('button', { name: 'request canvas edit' }).click()
    expect(onEditIntent).toHaveBeenCalledTimes(1)
  })

  it('exports the mounted Board editor as PNG and SVG', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:export') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const downloaded: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded.push(this.download)
    })
    render(
      <BoardPage
        title={'Board/A:*? '}
        boardId="board-a"
        projectId="project-a"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 PNG' }))
    await waitFor(() => expect(exportBoardAsPng).toHaveBeenCalledWith({ id: 'editor' }, false))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 SVG' }))

    await waitFor(() => expect(exportBoardAsSvg).toHaveBeenCalledWith({ id: 'editor' }, false))
    expect(downloaded).toEqual(['Board_A___.png', 'Board_A___.svg'])
  })

  it('flushes the dirty editor snapshot before requesting the current Board PDF', async () => {
    const order: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      order.push('pdf-request')
      return new Response(new Blob(['pdf'], { type: 'application/pdf' }), { status: 200 })
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:pdf') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(
      <BoardPage
        title="Board A"
        boardId="board-a"
        status="dirty"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
        onBeforePdfExport={async () => { order.push('flush') }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出 PDF' }))

    await waitFor(() => expect(order).toEqual(['flush', 'pdf-request']))
  })

  it('opens a comment when its pin is clicked and closes it when focus moves to the canvas', async () => {
    const createdAt = '2026-07-25T08:00:00.000Z'
    const commentClient = {
      loadBoardComments: vi.fn(async () => ({
        threads: [
          { id: 'thread-1', status: 'open' as const, createdBy: 'ou_1', createdAt, updatedAt: createdAt },
          { id: 'thread-2', status: 'open' as const, createdBy: 'ou_2', createdAt, updatedAt: createdAt },
        ],
        messages: [
          { id: 'message-1', threadId: 'thread-1', authorOpenId: 'ou_1', body: 'First thread body', createdAt },
          { id: 'message-2', threadId: 'thread-2', authorOpenId: 'ou_2', body: 'Second thread body', createdAt },
        ],
      })),
      listThreads: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      createThread: vi.fn(),
      addMessage: vi.fn(),
      setThreadStatus: vi.fn(),
      updateThreadAnchor: vi.fn(),
      deleteThread: vi.fn(),
    }
    render(
      <BoardPage
        title="Board A"
        boardId="board-a"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
        commentClient={commentClient}
      />,
    )

    await waitFor(() => expect(commentClient.loadBoardComments).toHaveBeenCalledWith('board-a'))
    expect(commentClient.listThreads).not.toHaveBeenCalled()
    expect(commentClient.listMessages).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'open comment 1' }))
    expect(await screen.findByRole('complementary', { name: '评论' })).toBeInTheDocument()
    expect(screen.getByText('First thread body')).toBeInTheDocument()
    expect(screen.queryByText('Second thread body')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: '评论状态' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '评论', hidden: true }))
    expect(screen.getByText('Second thread body')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: '评论状态' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '评论', hidden: true }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '评论' })).not.toBeInTheDocument())
  })

  it('keeps the repeated insert-child-board action out of the page header', () => {
    render(
      <BoardPage
        title="Board A"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
        onCreateReference={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '插入子画板' })).not.toBeInTheDocument()
  })

  it('keeps comment and child-board placement tools mutually exclusive and resets placement by session', async () => {
    const onCreateReference = vi.fn()
    const commentClient = {
      loadBoardComments: vi.fn(async () => ({ threads: [], messages: [] })),
      listThreads: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      createThread: vi.fn(),
      addMessage: vi.fn(),
      setThreadStatus: vi.fn(),
      updateThreadAnchor: vi.fn(),
      deleteThread: vi.fn(),
    }
    const view = render(
      <BoardPage
        title="Board A"
        boardId="board-a"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-1:board-a"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
        onCreateReference={onCreateReference}
        commentClient={commentClient}
      />,
    )

    fireEvent.click(screen.getByTestId('toggle-reference-tool'))
    expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('toggle-comment-tool')).toHaveAttribute('data-active', 'false')

    fireEvent.click(screen.getByTestId('toggle-comment-tool'))
    expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('toggle-comment-tool')).toHaveAttribute('data-active', 'true')

    fireEvent.click(screen.getByTestId('toggle-reference-tool'))
    expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('toggle-comment-tool')).toHaveAttribute('data-active', 'false')
    fireEvent.click(screen.getByTestId('place-reference'))
    expect(onCreateReference).toHaveBeenCalledWith({ x: 120, y: 240 })
    expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'false')

    fireEvent.click(screen.getByTestId('toggle-reference-tool'))
    view.rerender(
      <BoardPage
        title="Board B"
        boardId="board-b"
        status="clean"
        readOnly={false}
        store={{} as never}
        inputSessionKey="tab-2:board-b"
        onEditorMount={vi.fn()}
        onShowAllBoards={vi.fn()}
        onEditIntent={() => true}
        onCreateReference={onCreateReference}
        commentClient={commentClient}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'false'))
  })
})
