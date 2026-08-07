import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assertBoardReferenceSnapshotConsistent,
  createBoardReferenceShape,
  getBoardReferenceShape,
} from '@infinite-board/tldraw-adapter'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { BoardReferenceRepository } from './board-reference-repository.js'
import { BoardReferenceService } from './board-reference-service.js'

const now = '2026-07-23T00:00:00.000Z'

describe('BoardReferenceService', () => {
  let database: LocalDatabase
  let boards: BoardRepository
  let references: BoardReferenceRepository
  let service: BoardReferenceService

  beforeEach(() => {
    database = createDatabase(':memory:')
    const projects = new ProjectRepository(database)
    boards = new BoardRepository(database)
    references = new BoardReferenceRepository(database)
    projects.create({
      id: 'project:one',
      title: 'Project',
      rootBoardId: 'board:a',
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    for (const [id, title] of [
      ['board:a', 'Board A'],
      ['board:b', 'Board B'],
      ['board:c', 'Board C'],
    ] as const) {
      boards.create({
        id,
        projectId: 'project:one',
        title,
        tldrawSnapshot: { store: { 'page:page': { id: 'page:page', typeName: 'page' } } },
        revision: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
    let id = 0
    service = new BoardReferenceService(database, boards, references, {
      createId: () => `reference:${++id}`,
      now: () => now,
    })
  })

  afterEach(() => database.close())

  it('atomically creates an edge, its shape, and the source revision', async () => {
    const result = await service.create({
      sourceBoardId: 'board:a',
      targetBoardId: 'board:b',
      shapeId: 'shape:a-b',
      kind: 'embed',
      expectedRevision: 0,
    })

    expect(result).toMatchObject({ boardId: 'board:a', revision: 1 })
    expect(result.reference).toMatchObject({
      sourceBoardId: 'board:a',
      targetBoardId: 'board:b',
      shapeId: 'shape:a-b',
      kind: 'embed',
    })
    expect(getBoardReferenceShape(result.snapshot, 'shape:a-b')?.props.titleFallback).toBe('Board B')
    expect(() =>
      assertBoardReferenceSnapshotConsistent(result.snapshot, references.listOutbound('board:a')),
    ).not.toThrow()
  })

  it('leaves no edge or shape behind when source CAS fails', async () => {
    await expect(
      service.create({
        sourceBoardId: 'board:a',
        targetBoardId: 'board:b',
        shapeId: 'shape:a-b',
        kind: 'embed',
        expectedRevision: 9,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError)

    expect(references.listOutbound('board:a')).toEqual([])
    expect(getBoardReferenceShape(boards.get('board:a')?.tldrawSnapshot, 'shape:a-b')).toBeUndefined()
  })

  it('updates edge and shape semantics together, then removes only the reference', async () => {
    const created = await service.create({
      sourceBoardId: 'board:a',
      targetBoardId: 'board:b',
      shapeId: 'shape:a-b',
      kind: 'embed',
      expectedRevision: 0,
    })
    const updated = await service.update({
      referenceId: created.reference.id,
      targetBoardId: 'board:c',
      kind: 'link',
      expectedRevision: 1,
    })

    expect(updated.reference).toMatchObject({ targetBoardId: 'board:c', kind: 'link' })
    expect(getBoardReferenceShape(updated.snapshot, 'shape:a-b')?.props).toMatchObject({
      targetBoardId: 'board:c',
      kind: 'link',
      titleFallback: 'Board C',
    })

    const removed = await service.remove({
      referenceId: created.reference.id,
      expectedRevision: 2,
    })
    expect(removed).toMatchObject({ boardId: 'board:a', revision: 3 })
    expect(references.get(created.reference.id)).toBeUndefined()
    expect(getBoardReferenceShape(removed.snapshot, 'shape:a-b')).toBeUndefined()
    expect(boards.get('board:c')).toBeDefined()
  })

  it('creates a new embedded target board, edge, shape, and revision in one transaction', async () => {
    const result = await service.createEmbeddedBoard({
      sourceBoardId: 'board:a',
      board: {
        id: 'board:nested',
        projectId: 'ignored-by-service',
        title: 'Nested board',
        tldrawSnapshot: { store: {} },
        revision: 9,
        createdAt: now,
        updatedAt: now,
      },
      shapeId: 'shape:nested',
      expectedRevision: 0,
    })

    expect(result).toMatchObject({ revision: 1, reference: { kind: 'embed', targetBoardId: 'board:nested' } })
    expect(boards.get('board:nested')).toMatchObject({ projectId: 'project:one', revision: 0 })
    expect(getBoardReferenceShape(result.snapshot, 'shape:nested')).toBeDefined()
  })

  it('rolls back a newly embedded board and edge when source CAS fails', async () => {
    await expect(service.createEmbeddedBoard({
      sourceBoardId: 'board:a',
      board: {
        id: 'board:rolled-back',
        projectId: 'project:one',
        title: 'Rolled back',
        tldrawSnapshot: { store: {} },
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
      shapeId: 'shape:rolled-back',
      expectedRevision: 7,
    })).rejects.toBeInstanceOf(RevisionConflictError)

    expect(boards.get('board:rolled-back')).toBeUndefined()
    expect(references.listOutbound('board:a')).toEqual([])
  })

  it('rejects a new embedded board snapshot with an unbacked reference shape without changing source state', async () => {
    const unbackedReference = {
      id: 'reference:unbacked',
      projectId: 'project:one',
      sourceBoardId: 'board:invalid-nested',
      targetBoardId: 'board:b',
      shapeId: 'shape:unbacked',
      kind: 'embed' as const,
      createdAt: now,
      updatedAt: now,
    }

    await expect(service.createEmbeddedBoard({
      sourceBoardId: 'board:a',
      board: {
        id: 'board:invalid-nested',
        projectId: 'project:one',
        title: 'Invalid nested board',
        tldrawSnapshot: {
          store: {
            'shape:unbacked': createBoardReferenceShape(unbackedReference, 'Board B'),
          },
        },
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
      shapeId: 'shape:outer-reference',
      expectedRevision: 0,
    })).rejects.toMatchObject({ code: 'BOARD_REFERENCE_EDGE_MISSING' })

    expect(boards.get('board:invalid-nested')).toBeUndefined()
    expect(references.listOutbound('board:a')).toEqual([])
    expect(boards.get('board:a')).toMatchObject({ revision: 0 })
    expect(getBoardReferenceShape(boards.get('board:a')?.tldrawSnapshot, 'shape:outer-reference')).toBeUndefined()
  })
})
