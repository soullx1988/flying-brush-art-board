import { describe, expect, it } from 'vitest'
import type { BoardReferenceRecord } from '@infinite-board/board-core'
import { getBoardReferenceShape, insertBoardReferenceShape } from './board-reference-snapshot-operations.js'

const reference: BoardReferenceRecord = {
  id: 'reference:placement', projectId: 'project:test', sourceBoardId: 'board:source',
  targetBoardId: 'board:target', shapeId: 'shape:placement', kind: 'link',
  createdAt: '2026-10-26', updatedAt: '2026-10-26',
}

describe('inserting a board reference into an imported board', () => {
  const store = {
    'page:imported': {id: 'page:imported', typeName: 'page', index: 'a1'},
    'shape:title': {id: 'shape:title', typeName: 'shape', parentId: 'page:imported', index: 'a1'},
    'shape:body': {id: 'shape:body', typeName: 'shape', parentId: 'page:imported', index: 'a2'},
  }

  it.each([
    {store},
    {document: {store}},
  ])('attaches to the real page and above existing shapes for either snapshot envelope', (snapshot) => {
    const updated = insertBoardReferenceShape(snapshot, reference, 'Current placement', {x: 120, y: 40})
    const shape = getBoardReferenceShape(updated, reference.shapeId)!
    expect(shape.parentId).toBe('page:imported')
    expect(shape.index > 'a2').toBe(true)
    expect(shape.x).toBe(120)
    expect(shape.y).toBe(40)
    expect(getBoardReferenceShape(snapshot, reference.shapeId)).toBeUndefined()
  })

  it('keeps explicit parent and stacking placement', () => {
    const updated = insertBoardReferenceShape({store}, reference, 'Target', {parentId: 'shape:frame', index: 'a5'})
    expect(getBoardReferenceShape(updated, reference.shapeId)).toMatchObject({parentId: 'shape:frame', index: 'a5'})
  })

  it('does not collide with a prior inserted reference', () => {
    const first = insertBoardReferenceShape({store}, reference, 'First')
    const secondReference = {...reference, id: 'reference:second', shapeId: 'shape:second'}
    const second = insertBoardReferenceShape(first, secondReference, 'Second')
    expect(getBoardReferenceShape(second, secondReference.shapeId)!.index > getBoardReferenceShape(first, reference.shapeId)!.index).toBe(true)
  })
})
