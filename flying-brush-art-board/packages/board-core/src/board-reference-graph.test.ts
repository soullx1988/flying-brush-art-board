import { describe, expect, it } from 'vitest'

import type { BoardReferenceRecord, ProjectRecord, StoredBoard } from './index.js'
import {
  BoardReferenceGraphError,
  assertBoardCanBeDeleted,
  assertBoardReferenceGraphValid,
  assertCanCreateBoardReference,
  getInboundBoardReferences,
  getMaxEmbedBoardLevels,
  getOutboundBoardReferences,
  planCopiedBoardReferences,
  stableTopologicalBoardOrder,
} from './index.js'

const project: ProjectRecord = {
  id: 'project-1',
  title: 'Project',
  rootBoardId: 'A',
  formatVersion: 1,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

function boards(ids: string[], projectId = project.id): StoredBoard[] {
  return ids.map((id) => ({
    id,
    projectId,
    title: id,
    tldrawSnapshot: {},
    revision: 0,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }))
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link' = 'embed',
  projectId = project.id,
): BoardReferenceRecord {
  return {
    id,
    projectId,
    sourceBoardId,
    targetBoardId,
    shapeId: `shape-${id}`,
    kind,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

function expectGraphError(code: string, run: () => void): void {
  expect(run).toThrow(expect.objectContaining({ code }) satisfies Partial<BoardReferenceGraphError>)
}

describe('board reference graph', () => {
  it('allows A and B to embed the shared board C', () => {
    const references = [reference('a-c', 'A', 'C'), reference('b-c', 'B', 'C')]

    expect(() => assertBoardReferenceGraphValid(boards(['A', 'B', 'C']), references)).not.toThrow()
    expect(getInboundBoardReferences(references, 'C').map((item) => item.id)).toEqual(['a-c', 'b-c'])
    expect(getOutboundBoardReferences(references, 'A').map((item) => item.id)).toEqual(['a-c'])
  })

  it('allows multiple references for one source-target pair when their ids and shapes differ', () => {
    const references = [reference('first', 'A', 'B'), reference('second', 'A', 'B')]

    expect(() => assertBoardReferenceGraphValid(boards(['A', 'B']), references)).not.toThrow()
  })

  it.each([
    ['BOARD_REFERENCE_SOURCE_NOT_FOUND', boards(['A']), [reference('missing-source', 'B', 'A')]],
    ['BOARD_REFERENCE_TARGET_NOT_FOUND', boards(['A']), [reference('missing-target', 'A', 'B')]],
    ['BOARD_REFERENCE_CROSS_PROJECT', boards(['A', 'B']), [reference('cross-project', 'A', 'B', 'embed', 'other-project')]],
    ['BOARD_REFERENCE_DUPLICATE_ID', boards(['A', 'B']), [reference('same', 'A', 'B'), reference('same', 'B', 'A')]],
  ] as const)('rejects %s', (code, inputBoards, references) => {
    expectGraphError(code, () => assertBoardReferenceGraphValid(inputBoards, references))
  })

  it('rejects two references that claim the same source shape', () => {
    const first = reference('first', 'A', 'B')
    const second = { ...reference('second', 'A', 'B'), shapeId: first.shapeId }

    expectGraphError('BOARD_REFERENCE_DUPLICATE_SHAPE', () =>
      assertBoardReferenceGraphValid(boards(['A', 'B']), [first, second]),
    )
  })

  it('rejects embed self loops and cycles', () => {
    expectGraphError('EMBED_CYCLE', () =>
      assertBoardReferenceGraphValid(boards(['A']), [reference('self', 'A', 'A')]),
    )
    expectGraphError('EMBED_CYCLE', () =>
      assertBoardReferenceGraphValid(boards(['A', 'B']), [reference('a-b', 'A', 'B'), reference('b-a', 'B', 'A')]),
    )
  })

  it('permits a 10-board embed path and rejects the 11th board', () => {
    const ids = Array.from({ length: 11 }, (_, index) => `B${index + 1}`)
    const accepted = ids.slice(0, 10).slice(1).map((target, index) => reference(`r${index}`, ids[index]!, target))
    const candidate = reference('too-deep', ids[9]!, ids[10]!)

    expect(() => assertBoardReferenceGraphValid(boards(ids), accepted)).not.toThrow()
    expect(getMaxEmbedBoardLevels(boards(ids), accepted)).toBe(10)
    expectGraphError('EMBED_DEPTH_LIMIT_EXCEEDED', () =>
      assertCanCreateBoardReference(boards(ids), accepted, candidate),
    )
  })

  it('permits link repetition, self links, and cycles without changing embed depth', () => {
    const links = [
      reference('a-b-one', 'A', 'B', 'link'),
      reference('a-b-two', 'A', 'B', 'link'),
      reference('a-a', 'A', 'A', 'link'),
      reference('b-a', 'B', 'A', 'link'),
    ]

    expect(() => assertBoardReferenceGraphValid(boards(['A', 'B']), links)).not.toThrow()
    expect(getMaxEmbedBoardLevels(boards(['A', 'B']), links)).toBe(1)
  })

  it('uses root as a preferred entry, stable board ids for peers, and includes disconnected boards once', () => {
    const inputBoards = boards(['Z', 'B', 'C', 'A', 'D'])
    const references = [
      reference('a-b', 'A', 'B'),
      reference('a-c', 'A', 'C'),
      reference('link-only', 'Z', 'A', 'link'),
    ]

    expect(stableTopologicalBoardOrder(project, inputBoards, references)).toEqual(['A', 'B', 'C', 'D', 'Z'])
  })

  it('creates distinct reference and shape ids for same-project clipboard candidates', () => {
    let sequence = 0
    const plan = planCopiedBoardReferences({
      sourceProjectId: 'project-1',
      targetProjectId: 'project-1',
      targetBoardId: 'B',
      candidates: [{ shapeId: 'copied-shape', referenceId: 'copied-reference', targetBoardId: 'C', kind: 'embed' }],
      createId: () => `new-${++sequence}`,
    })

    expect(plan.references).toEqual([
      expect.objectContaining({
        id: 'new-1',
        sourceBoardId: 'B',
        targetBoardId: 'C',
        shapeId: 'new-2',
        kind: 'embed',
      }),
    ])
    expect(plan.downgrade).toBeUndefined()
  })

  it('downgrades cross-project clipboard candidates without producing a reference edge', () => {
    const plan = planCopiedBoardReferences({
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      targetBoardId: 'B',
      candidates: [{ shapeId: 'copied-shape', referenceId: 'copied-reference', targetBoardId: 'C', kind: 'link' }],
      createId: () => 'must-not-be-called',
    })

    expect(plan.references).toEqual([])
    expect(plan.downgrade).toEqual({
      code: 'CLIPBOARD_REFERENCE_DOWNGRADED_CROSS_PROJECT',
      shapeIds: ['copied-shape'],
    })
  })

  it('protects the default root and then checks inbound references for other boards', () => {
    expectGraphError('ROOT_BOARD_DELETE_FORBIDDEN', () => assertBoardCanBeDeleted(project, [], 'A'))
    expectGraphError('BOARD_REFERENCED', () =>
      assertBoardCanBeDeleted(project, [reference('b-c', 'B', 'C')], 'C'),
    )
    expect(() => assertBoardCanBeDeleted(project, [reference('b-c', 'B', 'C')], 'B')).not.toThrow()
  })

  it('checks a candidate against existing graph invariants before insertion', () => {
    const existing = [reference('a-b', 'A', 'B')]
    expectGraphError('EMBED_CYCLE', () =>
      assertCanCreateBoardReference(boards(['A', 'B']), existing, reference('b-a', 'B', 'A')),
    )
  })

  it('validates 100 boards and 1000 embed edges within the domain performance baseline', () => {
    const inputBoards = boards(Array.from({ length: 100 }, (_, index) => `B${index}`))
    const references = Array.from({ length: 20 }, (_, sourceIndex) =>
      Array.from({ length: 50 }, (_, targetIndex) =>
        reference(`r-${sourceIndex}-${targetIndex}`, `B${sourceIndex}`, `B${targetIndex + 50}`),
      ),
    ).flat()

    const startedAt = performance.now()
    assertBoardReferenceGraphValid(inputBoards, references)
    const order = stableTopologicalBoardOrder(project, inputBoards, references)
    const elapsedMs = performance.now() - startedAt

    expect(order).toHaveLength(100)
    expect(elapsedMs).toBeLessThan(1_000)
  })
})
