import type { Editor } from 'tldraw'
import type { MindMapBranchSnapshot, MindMapVisualStyleSnapshot } from './operations.js'

const branchClipboard = new WeakMap<Editor, MindMapBranchSnapshot>()
const styleClipboard = new WeakMap<Editor, MindMapVisualStyleSnapshot>()

export function setMindMapBranchClipboard(editor: Editor, snapshot: MindMapBranchSnapshot): void {
  branchClipboard.set(editor, snapshot)
}

export function getMindMapBranchClipboard(editor: Editor): MindMapBranchSnapshot | undefined {
  return branchClipboard.get(editor)
}

export function setMindMapStyleClipboard(editor: Editor, snapshot: MindMapVisualStyleSnapshot): void {
  styleClipboard.set(editor, structuredClone(snapshot))
}

export function getMindMapStyleClipboard(editor: Editor): MindMapVisualStyleSnapshot | undefined {
  const snapshot = styleClipboard.get(editor)
  return snapshot ? structuredClone(snapshot) : undefined
}
