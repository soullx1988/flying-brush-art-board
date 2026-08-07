import { describe, expect, it } from 'vitest'

import type { BoardReferenceRecord } from '@infinite-board/board-core'

import {
  BoardReferenceConsistencyError,
  assertBoardReferenceSemanticsUnchanged,
  assertBoardReferenceSnapshotConsistent,
} from './board-reference-consistency.js'
import { createBoardReferenceShape } from './board-reference-snapshot-operations.js'

const now = '2026-07-23T00:00:00.000Z'

const reference: BoardReferenceRecord = {
  id: 'reference:a-b',
  projectId: 'project:one',
  sourceBoardId: 'board:a',
  targetBoardId: 'board:b',
  shapeId: 'shape:a-b',
  kind: 'embed',
  createdAt: now,
  updatedAt: now,
}

function snapshot(shape = createBoardReferenceShape(reference, 'Board B')) {
  return {
    store: {
      'page:page': { id: 'page:page', typeName: 'page' },
      [shape.id]: shape,
    },
  }
}

describe('board reference snapshot consistency', () => {
  it('accepts a one-to-one edge and shape mapping with equal semantic props', () => {
    expect(() => assertBoardReferenceSnapshotConsistent(snapshot(), [reference])).not.toThrow()
  })

  it.each([
    ['a dangling edge', { store: {} }, [reference], 'BOARD_REFERENCE_SHAPE_MISSING'],
    ['a dangling shape', snapshot(), [], 'BOARD_REFERENCE_EDGE_MISSING'],
    [
      'different semantic props',
      snapshot(createBoardReferenceShape({ ...reference, kind: 'link' }, 'Board B')),
      [reference],
      'BOARD_REFERENCE_SEMANTICS_MISMATCH',
    ],
  ])('rejects %s', (_label, candidateSnapshot, references, code) => {
    expect(() => assertBoardReferenceSnapshotConsistent(candidateSnapshot, references)).toThrow(
      expect.objectContaining({ code }) satisfies Partial<BoardReferenceConsistencyError>,
    )
  })

  it('allows geometry and fallback-title autosaves but rejects structural reference changes', () => {
    const before = snapshot()
    const moved = snapshot({
      ...createBoardReferenceShape(reference, 'Renamed fallback'),
      x: 120,
      y: 240,
      props: { ...createBoardReferenceShape(reference, 'Renamed fallback').props, w: 360 },
    })
    const retargeted = snapshot(
      createBoardReferenceShape({ ...reference, targetBoardId: 'board:c' }, 'Board C'),
    )

    expect(() => assertBoardReferenceSemanticsUnchanged(before, moved)).not.toThrow()
    expect(() => assertBoardReferenceSemanticsUnchanged(before, retargeted)).toThrow(
      expect.objectContaining({ code: 'BOARD_REFERENCE_COMMAND_REQUIRED' }),
    )
  })
})
