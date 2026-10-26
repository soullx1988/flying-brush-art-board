import type { Editor, TLShapeId } from 'tldraw'

/** Repair only the known legacy default-page bug when following a reference. */
export function repairImportedReferenceParent(editor: Editor, shapeId: TLShapeId): void {
  const shape = editor.getShape(shapeId)
  if (shape?.type !== 'board-reference' || shape.parentId !== 'page:page') return
  if (editor.store.has(shape.parentId) || editor.getPages().length !== 1) return
  if (editor.getInstanceState().isReadonly) return
  editor.updateShape({id: shape.id, type: shape.type, parentId: editor.getCurrentPageId()})
}
