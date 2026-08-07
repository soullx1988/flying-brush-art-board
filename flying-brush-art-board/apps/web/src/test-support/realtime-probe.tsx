import { useEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Tldraw, type TLShapeId } from 'tldraw'

import { useRealtimeBoardStore } from '../features/realtime/use-realtime-board-store'

function Writer({ boardId, shapeId, onWritten }: { boardId: string; shapeId: TLShapeId; onWritten(written: boolean): void }) {
  const remote = useRealtimeBoardStore(boardId)
  const hasWritten = useRef(false)
  useEffect(() => {
    if (remote.status !== 'synced-remote' || hasWritten.current) return
    if (hasWritten.current) return
    hasWritten.current = true
    remote.store.put([{
      id: shapeId,
      typeName: 'shape',
      type: 'geo',
      parentId: 'page:page',
      index: 'a1',
      x: 10,
      y: 20,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: {
        w: 80, h: 40, geo: 'rectangle', dash: 'draw', growY: 0, url: '', scale: 1,
        color: 'black', labelColor: 'black', fill: 'none', size: 'm', font: 'draw',
        align: 'middle', verticalAlign: 'middle', richText: { type: 'doc', content: [] },
      },
    }] as never)
    onWritten(Boolean(remote.store.get(shapeId)))
  }, [onWritten, remote, shapeId])
  return null
}

function Reader({ boardId, shapeId, onRestored }: { boardId: string; shapeId: TLShapeId; onRestored(restored: boolean): void }) {
  const remote = useRealtimeBoardStore(boardId)
  useEffect(() => {
    if (remote.status !== 'synced-remote') return
    const report = () => onRestored(Boolean(remote.store.get(shapeId)))
    report()
    return remote.store.listen(report, { scope: 'document' })
  }, [onRestored, remote, shapeId])
  return null
}

function CanvasWriter({ boardId, shapeId, onWritten }: { boardId: string; shapeId: TLShapeId; onWritten(written: boolean): void }) {
  const remote = useRealtimeBoardStore(boardId)
  const hasWritten = useRef(false)
  if (remote.status !== 'synced-remote') return null
  return <Tldraw store={remote.store} onMount={(editor) => {
    if (hasWritten.current) return
    hasWritten.current = true
    editor.createShapes([{ id: shapeId, type: 'geo', x: 10, y: 20, props: { geo: 'rectangle', w: 80, h: 40 } }])
    onWritten(Boolean(editor.getShape(shapeId)))
  }} />
}

function CanvasReader({ boardId, shapeId, onRestored }: { boardId: string; shapeId: TLShapeId; onRestored(restored: boolean): void }) {
  const remote = useRealtimeBoardStore(boardId)
  useEffect(() => {
    if (remote.status !== 'synced-remote') return
    const report = () => onRestored(Boolean(remote.store.get(shapeId)))
    report()
    return remote.store.listen(report, { scope: 'document' })
  }, [onRestored, remote, shapeId])
  if (remote.status !== 'synced-remote') return null
  return <Tldraw store={remote.store} />
}

function mount(element: ReactNode): { root: Root; remove(): void } {
  const host = document.createElement('div')
  host.style.width = '800px'
  host.style.height = '600px'
  document.body.append(host)
  const root = createRoot(host)
  root.render(element)
  return { root, remove: () => { root.unmount(); host.remove() } }
}

export function mountRealtimeWriter(boardId: string, shapeId: string, onWritten: (written: boolean) => void) {
  return mount(<Writer boardId={boardId} shapeId={shapeId as TLShapeId} onWritten={onWritten} />)
}

export function mountRealtimeReader(boardId: string, shapeId: string, onRestored: (restored: boolean) => void) {
  return mount(<Reader boardId={boardId} shapeId={shapeId as TLShapeId} onRestored={onRestored} />)
}

export function mountRealtimeCanvasWriter(boardId: string, shapeId: string, onWritten: (written: boolean) => void) {
  return mount(<CanvasWriter boardId={boardId} shapeId={shapeId as TLShapeId} onWritten={onWritten} />)
}

export function mountRealtimeCanvasReader(boardId: string, shapeId: string, onRestored: (restored: boolean) => void) {
  return mount(<CanvasReader boardId={boardId} shapeId={shapeId as TLShapeId} onRestored={onRestored} />)
}
