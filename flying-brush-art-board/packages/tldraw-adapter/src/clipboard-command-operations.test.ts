import { describe, expect, it } from 'vitest'

import type { BoardReferenceRecord, CopiedBoardReference } from '@infinite-board/board-core'

import {
  applyClipboardReferenceRecords,
  downgradeClipboardReferenceRecords,
} from './clipboard-command-operations.js'
import {
  createBoardReferenceShape,
  getBoardReferenceShape,
} from './board-reference-snapshot-operations.js'

const now = '2026-07-23T00:00:00.000Z'
const copiedReference: BoardReferenceRecord = {
  id: 'reference:old',
  projectId: 'project:one',
  sourceBoardId: 'board:source',
  targetBoardId: 'board:target',
  shapeId: 'shape:pasted',
  kind: 'embed',
  createdAt: now,
  updatedAt: now,
}
const candidate: CopiedBoardReference = {
  shapeId: 'shape:pasted',
  referenceId: 'reference:old',
  targetBoardId: 'board:target',
  kind: 'embed',
}

function snapshot() {
  return {
    store: {
      'page:page': { id: 'page:page', typeName: 'page' },
      'shape:pasted': createBoardReferenceShape(copiedReference, 'Target board'),
    },
  }
}

describe('clipboard board-reference operations', () => {
  it('adopts fresh reference semantics on the already remapped pasted shape', () => {
    const fresh = { ...copiedReference, id: 'reference:fresh', sourceBoardId: 'board:destination' }

    const next = applyClipboardReferenceRecords(snapshot(), [fresh], new Map([
      ['board:target', 'Live target title'],
    ]))

    expect(getBoardReferenceShape(next, 'shape:pasted')?.props).toMatchObject({
      referenceId: 'reference:fresh',
      targetBoardId: 'board:target',
      kind: 'embed',
      titleFallback: 'Live target title',
    })
  })

  it('degrades cross-project references into non-navigable cards with no structural fields', () => {
    const next = downgradeClipboardReferenceRecords(snapshot(), [candidate], 'project:one') as {
      store: Record<string, { type: string; props: Record<string, unknown> }>
    }
    const card = next.store['shape:pasted']!

    expect(card.type).toBe('geo')
    expect(card.props).not.toHaveProperty('referenceId')
    expect(card.props).not.toHaveProperty('targetBoardId')
    expect(card.props).not.toHaveProperty('kind')
    expect(card.props.url).toBe('')
    expect(JSON.stringify(card)).not.toMatch(/project%3Aone|board%3Atarget|\/projects\//)
  })
})
