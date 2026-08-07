import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { TldrawUiIcon, useValue } from 'tldraw'
import { Eye, Trash } from '@phosphor-icons/react'
import { Menu, type MenuItem } from '@ttqtt/liquid-glass-react'

import type { CommentThreadView } from './comment-client'

const DRAG_THRESHOLD = 4

function hasMoved(
  start: { clientX: number; clientY: number },
  event: { clientX: number; clientY: number },
): boolean {
  return Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= DRAG_THRESHOLD
}

export function resolveCommentAnchorPagePoint(editor: Editor, thread: CommentThreadView): { x: number; y: number } | undefined {
  if (thread.shapeId) {
    const shape = editor.getShape(thread.shapeId as never)
    if (shape) {
      const transform = editor.getShapePageTransform(shape)
      if (transform && typeof thread.shapeOffsetX === 'number' && typeof thread.shapeOffsetY === 'number') {
        return transform.applyToPoint({ x: thread.shapeOffsetX, y: thread.shapeOffsetY })
      }
      const bounds = editor.getShapeGeometry(shape).bounds
      if (transform) return transform.applyToPoint(bounds.center)
    }
  }
  if (typeof thread.x === 'number' && typeof thread.y === 'number') return { x: thread.x, y: thread.y }
  return undefined
}

function anchorPoint(editor: Editor, thread: CommentThreadView): { x: number; y: number } | undefined {
  const point = resolveCommentAnchorPagePoint(editor, thread)
  return point ? editor.pageToScreen(point) : undefined
}

export function CommentPendingPin({
  editor,
  anchor,
}: {
  editor: Editor
  anchor: { shapeId?: string; x: number; y: number; shapeOffsetX?: number; shapeOffsetY?: number }
}) {
  const point = useValue('pending comment pin anchor', () => {
    const resolved = resolveCommentAnchorPagePoint(editor, { ...anchor, id: 'pending', status: 'open', createdBy: '', createdAt: '', updatedAt: '' })
    return resolved ? editor.pageToScreen(resolved) : editor.pageToScreen(anchor)
  }, [anchor, editor])

  return <div className="comment-pins" aria-label="待提交评论锚点">
    <div className="comment-pin comment-pin--pending" style={{ left: point.x, top: point.y }} aria-label="待提交评论">
      <TldrawUiIcon icon="comment" label="待提交评论" />
    </div>
  </div>
}

/** UI-only comment anchors; discussion state remains in the local API, not the tldraw store. */
export function CommentPins({
  editor,
  threads,
  onFocusThread,
  onMoveThread,
  onDeleteThread,
}: {
  editor: Editor
  threads: readonly CommentThreadView[]
  onFocusThread(threadId: string): void
  onMoveThread(threadId: string, anchor: { x: number; y: number }): void
  onDeleteThread(threadId: string): void
}) {
  const points = useValue('comment pin anchors', () => threads.map((thread) => anchorPoint(editor, thread)), [editor, threads])
  const dragging = useRef<{
    threadId: string
    pointerId: number
    moved: boolean
    start: { clientX: number; clientY: number }
  } | undefined>(undefined)
  const suppressClickFor = useRef<string | undefined>(undefined)
  const [selectedThreadId, setSelectedThreadId] = useState<string>()
  const [contextThreadId, setContextThreadId] = useState<string>()
  const contextItems: MenuItem[] = [
    { key: 'details', label: '查看详情', icon: <Eye aria-hidden="true" /> },
    { type: 'divider' },
    { key: 'delete', label: '删除', icon: <Trash aria-hidden="true" />, danger: true },
  ]

  return <div className="comment-pins" aria-label="评论锚点">
    {threads.flatMap((thread, index) => {
      const point = points[index]
      if (!point) return []
      return <Menu
        key={thread.id}
        items={contextItems}
        open={contextThreadId === thread.id}
        onOpenChange={(open) => { if (!open) setContextThreadId(undefined) }}
        placement="bottom-start"
        onSelect={(key) => {
          setContextThreadId(undefined)
          if (key === 'details') onFocusThread(thread.id)
          if (key === 'delete') onDeleteThread(thread.id)
        }}
      ><button
        key={thread.id}
        className={`comment-pin${thread.status === 'resolved' ? ' comment-pin--resolved' : ''}${selectedThreadId === thread.id ? ' comment-pin--selected' : ''}`}
        type="button"
        aria-pressed={selectedThreadId === thread.id}
        aria-label={`评论 ${index + 1}`}
        style={{ left: point.x, top: point.y }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          dragging.current = {
            threadId: thread.id,
            pointerId: event.pointerId,
            moved: false,
            start: { clientX: event.clientX, clientY: event.clientY },
          }
        }}
        onPointerMove={(event) => {
          if (dragging.current?.threadId !== thread.id || dragging.current.pointerId !== event.pointerId) return
          dragging.current.moved ||= hasMoved(dragging.current.start, event)
          if (!dragging.current.moved) return
          const next = editor.screenToPage({ x: event.clientX, y: event.clientY })
          const screenPoint = editor.pageToScreen(next)
          event.currentTarget.style.left = `${screenPoint.x}px`
          event.currentTarget.style.top = `${screenPoint.y}px`
        }}
        onPointerUp={(event) => {
          if (dragging.current?.threadId !== thread.id || dragging.current.pointerId !== event.pointerId) return
          const moved = dragging.current.moved
          dragging.current = undefined
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          const next = editor.screenToPage({ x: event.clientX, y: event.clientY })
          if (moved) {
            suppressClickFor.current = thread.id
            onMoveThread(thread.id, next)
          }
        }}
        onClick={() => {
          if (suppressClickFor.current === thread.id) {
            suppressClickFor.current = undefined
            return
          }
          setSelectedThreadId(thread.id)
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          setSelectedThreadId(thread.id)
          onFocusThread(thread.id)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          event.preventDefault()
          event.stopPropagation()
          onDeleteThread(thread.id)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setSelectedThreadId(thread.id)
          setContextThreadId(thread.id)
        }}
      >
        <TldrawUiIcon icon="comment" label="评论" />
        <span className="comment-pin__index" aria-hidden="true">{index + 1}</span>
      </button></Menu>
    })}
  </div>
}

export function CommentDraftPin({
  editor,
}: {
  editor: Editor
}) {
  const pinRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const followPointer = (event: PointerEvent) => {
      const pin = pinRef.current
      if (!pin) return
      const isOverCanvas = event.composedPath().some((target) =>
        target instanceof Element && Boolean(target.closest('.canvas-editor')),
      )
      if (!isOverCanvas) {
        pin.classList.remove('comment-pin--visible')
        return
      }
      pin.style.left = `${event.clientX}px`
      pin.style.top = `${event.clientY}px`
      pin.classList.add('comment-pin--visible')
    }

    window.addEventListener('pointermove', followPointer)
    return () => window.removeEventListener('pointermove', followPointer)
  }, [editor])

  return <div className="comment-pins" aria-label="评论草稿锚点">
    <div ref={pinRef} className="comment-pin comment-pin--draft" aria-hidden="true">
      <TldrawUiIcon icon="comment" label="评论" />
    </div>
  </div>
}
