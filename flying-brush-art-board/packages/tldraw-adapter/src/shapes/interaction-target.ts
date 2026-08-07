import type { Editor } from 'tldraw'
import type { TableCellRange } from './table/operations.js'

export type CanvasShapeInteractionTarget =
  | {
    type: 'table'
    shapeId: string
    rowId: string
    columnId: string
    cellId: string
    cellIds?: string[]
    range?: TableCellRange
  }
  | { type: 'mind-map'; shapeId: string; nodeId: string }

const targets = new WeakMap<Editor, CanvasShapeInteractionTarget>()
const listeners = new WeakMap<Editor, Set<() => void>>()

export function setCanvasShapeInteractionTarget(editor: Editor, target: CanvasShapeInteractionTarget): void {
  targets.set(editor, target)
  listeners.get(editor)?.forEach((listener) => listener())
}

export function clearCanvasShapeInteractionTarget(editor: Editor, shapeId?: string): void {
  const current = targets.get(editor)
  if (!current || (shapeId && current.shapeId !== shapeId)) return
  targets.delete(editor)
  listeners.get(editor)?.forEach((listener) => listener())
}

export function getCanvasShapeInteractionTarget(editor: Editor): CanvasShapeInteractionTarget | undefined {
  return targets.get(editor)
}

export function subscribeCanvasShapeInteractionTarget(editor: Editor, listener: () => void): () => void {
  let editorListeners = listeners.get(editor)
  if (!editorListeners) {
    editorListeners = new Set()
    listeners.set(editor, editorListeners)
  }
  editorListeners.add(listener)
  return () => {
    editorListeners?.delete(listener)
    if (editorListeners?.size === 0) listeners.delete(editor)
  }
}
