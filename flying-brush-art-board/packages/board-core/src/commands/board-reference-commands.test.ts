import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardReferenceRecord, ProjectRecord, StoredBoard } from '../index.js'
import {
  planCreateBoardReference,
  planCreateEmbeddedBoard,
  planDeleteBoard,
  planPasteBoardClipboard,
  planRedoBoardCommand,
  planRemoveBoardReference,
  planUndoBoardCommand,
  planUpdateBoardReference,
} from '../index.js'

const project: ProjectRecord = {
  id: 'project-1',
  title: 'Project',
  rootBoardId: 'A',
  formatVersion: 1,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

function boards(ids: string[]): StoredBoard[] {
  return ids.map((id) => ({
    id,
    projectId: project.id,
    title: id,
    tldrawSnapshot: {},
    revision: 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }))
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link' = 'embed',
): BoardReferenceRecord {
  return {
    id,
    projectId: project.id,
    sourceBoardId,
    targetBoardId,
    shapeId: `shape-${id}`,
    kind,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function payload(
  sourceProjectId: string,
  references: Array<{ shapeId: string; referenceId: string; targetBoardId: string; kind: 'embed' | 'link' }>,
) {
  return {
    version: 1 as const,
    sourceProjectId,
    sourceBoardId: 'source',
    shapes: [],
    bindings: [],
    references,
    assets: [],
    copiedAt: project.createdAt,
  }
}

describe('board reference command planners', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('plans multiple edges from and to the same boards', () => {
    const first = planCreateBoardReference({
      boards: boards(['A', 'B', 'C']),
      references: [],
      reference: reference('a-c', 'A', 'C'),
    })
    const second = planCreateBoardReference({
      boards: boards(['A', 'B', 'C']),
      references: [reference('a-c', 'A', 'C'), reference('b-c', 'B', 'C')],
      reference: reference('a-c-second', 'A', 'C'),
    })

    expect(first.validation).toEqual({ ok: true })
    expect(first.mutations.references.create.map((item) => item.id)).toEqual(['a-c'])
    expect(second.validation).toEqual({ ok: true })
    expect(second.mutations.references.create.map((item) => item.id)).toEqual(['a-c-second'])
  })

  it('uses the graph validator for embed cycles and depth, while allowing link loops', () => {
    const cyclic = planCreateBoardReference({
      boards: boards(['A', 'B']),
      references: [reference('a-b', 'A', 'B')],
      reference: reference('b-a', 'B', 'A'),
    })
    const linked = planUpdateBoardReference({
      boards: boards(['A', 'B']),
      references: [reference('a-b', 'A', 'B')],
      reference: reference('a-b', 'A', 'B', 'link'),
    })
    const ids = Array.from({ length: 11 }, (_, index) => `B${index + 1}`)
    const tooDeep = planCreateBoardReference({
      boards: boards(ids),
      references: ids.slice(1, 10).map((target, index) => reference(`r-${index}`, ids[index]!, target)),
      reference: reference('too-deep', ids[9]!, ids[10]!),
    })

    expect(cyclic.validation).toMatchObject({ ok: false, error: { code: 'EMBED_CYCLE' } })
    expect(cyclic.mutations.references.create).toEqual([])
    expect(linked.validation).toEqual({ ok: true })
    expect(linked.mutations.references.update).toEqual([
      {
        before: reference('a-b', 'A', 'B'),
        after: expect.objectContaining({
          ...reference('a-b', 'A', 'B', 'link'),
          updatedAt: expect.any(String),
        }),
      },
    ])
    expect(tooDeep.validation).toMatchObject({ ok: false, error: { code: 'EMBED_DEPTH_LIMIT_EXCEEDED' } })
  })

  it('creates an embedded board with its reference shape on the source board', () => {
    const embeddedBoard = boards(['B'])[0]!
    const edge = reference('a-b', 'A', 'B')

    const plan = planCreateEmbeddedBoard({
      boards: boards(['A']),
      references: [],
      board: embeddedBoard,
      reference: edge,
    })

    expect(plan.validation).toEqual({ ok: true })
    expect(plan.mutations.boards.create).toEqual([embeddedBoard])
    expect(plan.mutations.references.create).toEqual([edge])
    expect(plan.mutations.shapes.create).toEqual([
      { boardId: 'A', shapeId: 'shape-a-b', role: 'reference' },
    ])
  })

  it('rejects updates that change a reference identity field', () => {
    const previous = reference('a-b', 'A', 'B')
    const changes = [
      { projectId: 'project-other' },
      { sourceBoardId: 'C' },
      { shapeId: 'shape-replaced' },
    ]

    for (const change of changes) {
      const plan = planUpdateBoardReference({
        boards: boards(['A', 'B', 'C']),
        references: [previous],
        reference: { ...previous, ...change },
      })

      expect(plan.validation).toMatchObject({
        ok: false,
        error: { code: 'BOARD_REFERENCE_IMMUTABLE_FIELDS', details: { referenceId: 'a-b' } },
      })
      expect(plan.mutations.references.update).toEqual([])
    }
  })

  it('rejects an update that attempts to change the creation timestamp', () => {
    const previous = reference('a-b', 'A', 'B')

    const plan = planUpdateBoardReference({
      boards: boards(['A', 'B']),
      references: [previous],
      reference: { ...previous, createdAt: '2000-01-01T00:00:00.000Z' },
    })

    expect(plan.validation).toMatchObject({
      ok: false,
      error: { code: 'BOARD_REFERENCE_IMMUTABLE_FIELDS', details: { referenceId: 'a-b' } },
    })
    expect(plan.mutations.references.update).toEqual([])
  })

  it('replaces a caller-supplied update timestamp with the planner timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T12:34:56.789Z'))
    const previous = reference('a-b', 'A', 'B')

    const plan = planUpdateBoardReference({
      boards: boards(['A', 'B']),
      references: [previous],
      reference: { ...previous, kind: 'link', updatedAt: '2000-01-01T00:00:00.000Z' },
    })

    expect(plan.validation).toEqual({ ok: true })
    expect(plan.mutations.references.update).toEqual([
      {
        before: previous,
        after: {
          ...previous,
          kind: 'link',
          updatedAt: '2026-07-24T12:34:56.789Z',
        },
      },
    ])
  })

  it('removes only the edge and its source reference shape', () => {
    const edge = reference('a-b', 'A', 'B')
    const plan = planRemoveBoardReference({ references: [edge], referenceId: edge.id })

    expect(plan.validation).toEqual({ ok: true })
    expect(plan.mutations.references.remove).toEqual([edge])
    expect(plan.mutations.shapes.remove).toEqual([{ boardId: 'A', shapeId: 'shape-a-b', role: 'reference' }])
    expect(plan.mutations.boards.remove).toEqual([])
  })

  it('returns deletion guards with API-mappable IDs and cleans only outbound edges', () => {
    const root = planDeleteBoard({ project, boards: boards(['A', 'B', 'C']), references: [], boardId: 'A' })
    const inbound = planDeleteBoard({
      project,
      boards: boards(['A', 'B', 'C']),
      references: [reference('b-c', 'B', 'C')],
      boardId: 'C',
    })
    const deletable = planDeleteBoard({
      project,
      boards: boards(['A', 'B', 'C']),
      references: [reference('b-c', 'B', 'C'), reference('b-a', 'B', 'A')],
      boardId: 'B',
    })

    expect(root.validation).toEqual({
      ok: false,
      error: { code: 'ROOT_BOARD_DELETE_FORBIDDEN', message: 'ROOT_BOARD_DELETE_FORBIDDEN', details: { boardId: 'A', projectId: 'project-1', rootBoardId: 'A' } },
    })
    expect(inbound.validation).toMatchObject({ ok: false, error: { code: 'BOARD_REFERENCED', details: { inboundReferenceIds: ['b-c'] } } })
    expect(deletable.validation).toEqual({ ok: true })
    expect(deletable.mutations.boards.remove).toEqual(['B'])
    expect(deletable.mutations.references.remove.map((item) => item.id)).toEqual(['b-a', 'b-c'])
    expect(deletable.mutations.shapes.remove).toEqual([])
  })

  it('does not delete a board from another project', () => {
    const foreignBoard: StoredBoard = { ...boards(['B'])[0]!, projectId: 'project-other' }
    const plan = planDeleteBoard({
      project,
      boards: [...boards(['A']), foreignBoard],
      references: [],
      boardId: foreignBoard.id,
    })

    expect(plan.validation).toEqual({
      ok: false,
      error: { code: 'BOARD_NOT_FOUND', message: 'BOARD_NOT_FOUND', details: { boardId: 'B' } },
    })
    expect(plan.mutations.boards.remove).toEqual([])
  })

  it('plans same-project references with fresh IDs and cross-project visual downgrades', () => {
    let sequence = 0
    const sameProject = planPasteBoardClipboard({
      project,
      boards: boards(['A', 'B', 'C']),
      references: [],
      targetBoardId: 'B',
      payload: payload(project.id, [{ shapeId: 'old-shape', referenceId: 'old-reference', targetBoardId: 'C', kind: 'embed' }]),
      createId: () => `new-${++sequence}`,
      createdNormalShapeIds: ['shape:ordinary'],
      assetUsages: [{ shapeId: 'shape:ordinary', assetRecordId: 'asset:one', sha256: 'a'.repeat(64) }],
    })
    const crossProject = planPasteBoardClipboard({
      project,
      boards: boards(['A', 'B', 'C']),
      references: [],
      targetBoardId: 'B',
      payload: payload('project-other', [{ shapeId: 'old-shape', referenceId: 'old-reference', targetBoardId: 'C', kind: 'link' }]),
      createId: () => 'unused',
    })

    expect(sameProject.validation).toEqual({ ok: true })
    expect(sameProject.mutations.references.create).toEqual([
      expect.objectContaining({ id: 'new-1', shapeId: 'new-2', sourceBoardId: 'B', targetBoardId: 'C' }),
    ])
    expect(sameProject.commandScope).toEqual({
      normalShapeIds: ['shape:ordinary'],
      referenceShapeIds: ['new-2'],
      references: sameProject.mutations.references.create,
      assetUsages: [{ shapeId: 'shape:ordinary', assetRecordId: 'asset:one', sha256: 'a'.repeat(64) }],
    })
    expect(crossProject.validation).toEqual({ ok: true })
    expect(crossProject.mutations.references.create).toEqual([])
    expect(crossProject.downgrade).toEqual({ code: 'CLIPBOARD_REFERENCE_DOWNGRADED_CROSS_PROJECT', shapeIds: ['old-shape'] })
  })

  it('rejects an entire invalid embed paste batch without partial mutations and permits links', () => {
    const invalid = planPasteBoardClipboard({
      project,
      boards: boards(['A', 'B', 'C']),
      references: [reference('a-b', 'A', 'B'), reference('b-c', 'B', 'C')],
      targetBoardId: 'C',
      payload: payload(project.id, [{ shapeId: 'copied', referenceId: 'copied-ref', targetBoardId: 'A', kind: 'embed' }]),
      createId: () => 'will-not-apply',
      createdNormalShapeIds: ['shape:ordinary'],
    })
    const linked = planPasteBoardClipboard({
      project,
      boards: boards(['A', 'B', 'C']),
      references: [reference('a-b', 'A', 'B'), reference('b-c', 'B', 'C')],
      targetBoardId: 'C',
      payload: payload(project.id, [{ shapeId: 'copied', referenceId: 'copied-ref', targetBoardId: 'A', kind: 'link' }]),
      createId: () => 'link-id',
    })

    expect(invalid.validation).toMatchObject({ ok: false, error: { code: 'EMBED_CYCLE' } })
    expect(invalid.mutations).toEqual({ boards: { create: [], remove: [] }, references: { create: [], update: [], remove: [] }, shapes: { create: [], remove: [] }, assetUsages: { create: [], remove: [] } })
    expect(linked.validation).toEqual({ ok: true })
  })

  it('plans undo and redo for exactly one command scope', () => {
    const command = {
      normalShapeIds: ['shape:ordinary'],
      referenceShapeIds: ['shape:reference'],
      references: [{ ...reference('edge', 'A', 'B'), shapeId: 'shape:reference' }],
      assetUsages: [{ shapeId: 'shape:ordinary', assetRecordId: 'asset:one', sha256: 'a'.repeat(64) }],
    }

    const undo = planUndoBoardCommand({ boardId: 'A', command })
    const redo = planRedoBoardCommand({ boardId: 'A', command })

    expect(undo.mutations.shapes.remove).toEqual([
      { boardId: 'A', shapeId: 'shape:ordinary', role: 'normal' },
      { boardId: 'A', shapeId: 'shape:reference', role: 'reference' },
    ])
    expect(undo.mutations.references.remove).toEqual(command.references)
    expect(undo.mutations.assetUsages.remove).toEqual(command.assetUsages)
    expect(redo.mutations.shapes.create).toEqual([
      { boardId: 'A', shapeId: 'shape:ordinary', role: 'normal' },
      { boardId: 'A', shapeId: 'shape:reference', role: 'reference' },
    ])
    expect(redo.mutations.references.create).toEqual(command.references)
    expect(redo.mutations.assetUsages.create).toEqual(command.assetUsages)
  })

  it('maps each reference shape to its own source board when undoing and redoing', () => {
    const command = {
      normalShapeIds: ['shape:ordinary'],
      referenceShapeIds: ['shape-a-b', 'shape-c-d'],
      references: [reference('a-b', 'A', 'B'), reference('c-d', 'C', 'D')],
      assetUsages: [],
    }

    const undo = planUndoBoardCommand({ boardId: 'A', command })
    const redo = planRedoBoardCommand({ boardId: 'A', command })

    expect(undo.mutations.shapes.remove).toEqual([
      { boardId: 'A', shapeId: 'shape:ordinary', role: 'normal' },
      { boardId: 'A', shapeId: 'shape-a-b', role: 'reference' },
      { boardId: 'C', shapeId: 'shape-c-d', role: 'reference' },
    ])
    expect(redo.mutations.shapes.create).toEqual([
      { boardId: 'A', shapeId: 'shape:ordinary', role: 'normal' },
      { boardId: 'A', shapeId: 'shape-a-b', role: 'reference' },
      { boardId: 'C', shapeId: 'shape-c-d', role: 'reference' },
    ])
  })
})
