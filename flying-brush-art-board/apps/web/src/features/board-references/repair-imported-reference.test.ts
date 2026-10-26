import {describe, expect, it, vi} from 'vitest'
import type {Editor, TLShapeId} from 'tldraw'
import {repairImportedReferenceParent} from './repair-imported-reference'

function editorFixture(type = 'board-reference', parentId = 'page:page', parentExists = false, pageCount = 1, isReadonly = false) {
  const updateShape = vi.fn()
  const editor = {
    getShape: () => ({id: 'shape:old', type, parentId}),
    store: {has: () => parentExists}, getPages: () => Array.from({length: pageCount}),
    getInstanceState: () => ({isReadonly}),
    getCurrentPageId: () => 'page:imported', updateShape,
  } as unknown as Editor
  return {editor, updateShape}
}

describe('following a legacy imported board reference', () => {
  it('reattaches the invisible default-page reference to the sole real page', () => {
    const {editor, updateShape} = editorFixture()
    repairImportedReferenceParent(editor, 'shape:old' as TLShapeId)
    expect(updateShape).toHaveBeenCalledWith({id: 'shape:old', type: 'board-reference', parentId: 'page:imported'})
  })
  it.each([
    ['geo', 'page:page', false, 1],
    ['board-reference', 'page:valid', false, 1],
    ['board-reference', 'page:page', true, 1],
    ['board-reference', 'page:page', false, 2],
  ] as const)('leaves unrelated or ambiguous parents alone (%s, %s, %s, %s)', (type, parent, exists, pages) => {
    const {editor, updateShape} = editorFixture(type, parent, exists, pages)
    repairImportedReferenceParent(editor, 'shape:old' as TLShapeId)
    expect(updateShape).not.toHaveBeenCalled()
  })
  it('does not change a board opened without edit access', () => {
    const {editor, updateShape} = editorFixture('board-reference', 'page:page', false, 1, true)
    repairImportedReferenceParent(editor, 'shape:old' as TLShapeId)
    expect(updateShape).not.toHaveBeenCalled()
  })
})
