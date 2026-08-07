import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BoardReferenceGraphError } from '@infinite-board/board-core'

import { AssetRepository, AssetUsageRepository } from '../modules/assets/asset-repository.js'
import { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import { BoardRepository, RevisionConflictError } from '../modules/boards/board-repository.js'
import { ProjectRepository } from '../modules/projects/project-repository.js'
import { createDatabase, type LocalDatabase } from './schema.js'

const now = '2026-07-23T00:00:00.000Z'

describe('SQLite repositories', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let projects: ProjectRepository
  let boards: BoardRepository
  let references: BoardReferenceRepository
  let assets: AssetRepository
  let usages: AssetUsageRepository

  beforeEach(() => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-assets-'))
    projects = new ProjectRepository(database)
    boards = new BoardRepository(database)
    references = new BoardReferenceRepository(database)
    assets = new AssetRepository(database, assetDirectory)
    usages = new AssetUsageRepository(database)
  })

  afterEach(() => {
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  function createProjectWithBoards(projectId: string, boardIds: string[]): void {
    projects.create({
      id: projectId,
      title: projectId,
      rootBoardId: boardIds[0]!,
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    for (const boardId of boardIds) {
      boards.create({
        id: boardId,
        projectId,
        title: boardId,
        tldrawSnapshot: { store: [] },
        revision: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  it('persists project, board and reference CRUD with revision CAS', () => {
    createProjectWithBoards('project-1', ['A', 'B'])
    const createdReference = references.create({
      id: 'reference-a-b',
      projectId: 'project-1',
      sourceBoardId: 'A',
      targetBoardId: 'B',
      shapeId: 'shape-a-b',
      kind: 'embed',
      createdAt: now,
      updatedAt: now,
    })

    expect(projects.get('project-1')?.rootBoardId).toBe('A')
    expect(boards.listByProject('project-1').map((board) => board.id)).toEqual(['A', 'B'])
    expect(references.listOutbound('A')).toEqual([createdReference])
    expect(references.listInbound('B')).toEqual([createdReference])

    const saved = boards.saveSnapshot('A', 0, { store: [{ id: 'shape:1' }] })
    expect(saved.revision).toBe(1)
    expect(saved.tldrawSnapshot).toEqual({ store: [{ id: 'shape:1' }] })
    expect(() => boards.saveSnapshot('A', 0, { store: [] })).toThrow(
      expect.objectContaining({ currentRevision: 1 }) satisfies Partial<RevisionConflictError>,
    )

    expect(references.update('reference-a-b', { kind: 'link' }).kind).toBe('link')
    expect(references.remove('reference-a-b')).toBe(true)
    expect(references.listByProject('project-1')).toEqual([])
  })

  it('advances the shared board revision for realtime snapshots', () => {
    createProjectWithBoards('project-1', ['A'])

    const first = boards.saveRealtimeSnapshot('A', { store: [{ id: 'shape:realtime-1' }] })
    expect(first.revision).toBe(1)

    const second = boards.saveRealtimeSnapshot('A', { store: [{ id: 'shape:realtime-2' }] })
    expect(second.revision).toBe(2)
  })

  it('renames projects and orders the project list by recent updates', () => {
    createProjectWithBoards('project-1', ['A'])
    createProjectWithBoards('project-2', ['B'])

    const renamed = projects.rename('project-1', '产品路线图')

    expect(renamed.title).toBe('产品路线图')
    expect(projects.list()[0]).toMatchObject({ id: 'project-1', title: '产品路线图' })
  })

  it('enforces same-project source and target foreign keys', () => {
    createProjectWithBoards('project-1', ['A'])
    createProjectWithBoards('project-2', ['Z'])

    expect(() =>
      references.create({
        id: 'cross-project',
        projectId: 'project-1',
        sourceBoardId: 'A',
        targetBoardId: 'Z',
        shapeId: 'shape-cross',
        kind: 'embed',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow()
    expect(() =>
      references.create({
        id: 'dangling-target',
        projectId: 'project-1',
        sourceBoardId: 'A',
        targetBoardId: 'missing',
        shapeId: 'shape-dangling',
        kind: 'embed',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow()
  })

  it('removes outgoing references with a source board while preserving the target board', () => {
    createProjectWithBoards('project-1', ['A', 'B'])
    references.create({
      id: 'reference-a-b',
      projectId: 'project-1',
      sourceBoardId: 'A',
      targetBoardId: 'B',
      shapeId: 'shape-a-b',
      kind: 'embed',
      createdAt: now,
      updatedAt: now,
    })
    projects.setRootBoardId('project-1', 'B')

    expect(boards.remove('project-1', 'A')).toBe(true)
    expect(boards.get('B')?.id).toBe('B')
    expect(references.listByProject('project-1')).toEqual([])
  })

  it('rejects deletion when a board has inbound references', () => {
    createProjectWithBoards('project-1', ['A', 'B'])
    references.create({
      id: 'reference-a-b',
      projectId: 'project-1',
      sourceBoardId: 'A',
      targetBoardId: 'B',
      shapeId: 'shape-a-b',
      kind: 'embed',
      createdAt: now,
      updatedAt: now,
    })

    expect(() => boards.remove('project-1', 'B')).toThrow(
      expect.objectContaining({ code: 'BOARD_REFERENCED' }) satisfies Partial<BoardReferenceGraphError>,
    )
  })

  it('protects the default root until another project board becomes root', () => {
    createProjectWithBoards('project-1', ['A', 'B'])

    expect(() => boards.remove('project-1', 'A')).toThrow(
      expect.objectContaining({ code: 'ROOT_BOARD_DELETE_FORBIDDEN' }) satisfies Partial<BoardReferenceGraphError>,
    )
    projects.setRootBoardId('project-1', 'B')

    expect(boards.remove('project-1', 'A')).toBe(true)
  })

  it('cleans board, reference and asset-use rows when a project is deleted', () => {
    createProjectWithBoards('project-1', ['A', 'B'])
    references.create({
      id: 'reference-a-b',
      projectId: 'project-1',
      sourceBoardId: 'A',
      targetBoardId: 'B',
      shapeId: 'shape-a-b',
      kind: 'embed',
      createdAt: now,
      updatedAt: now,
    })
    const materialized = assets.materializeForBoard({
      projectId: 'project-1',
      boardId: 'A',
      shapeId: 'shape-image',
      assetRecordId: 'asset-record-1',
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
      createdAt: now,
    })

    expect(materialized.sha256).toHaveLength(64)
    expect(projects.remove('project-1')).toBe(true)
    expect(boards.listByProject('project-1')).toEqual([])
    expect(references.listByProject('project-1')).toEqual([])
    expect(usages.listByProject('project-1')).toEqual([])
  })

  it('deduplicates content hashes across boards and projects', () => {
    createProjectWithBoards('project-1', ['A'])
    createProjectWithBoards('project-2', ['Z'])
    const bytes = new Uint8Array([7, 8, 9])

    const first = assets.materializeForBoard({
      projectId: 'project-1',
      boardId: 'A',
      shapeId: 'shape-a',
      assetRecordId: 'asset-a',
      bytes,
      mime: 'image/png',
      createdAt: now,
    })
    const second = assets.materializeForBoard({
      projectId: 'project-2',
      boardId: 'Z',
      shapeId: 'shape-z',
      assetRecordId: 'asset-z',
      bytes,
      mime: 'image/png',
      createdAt: now,
    })

    expect(second.sha256).toBe(first.sha256)
    expect(readdirSync(assetDirectory)).toEqual([first.sha256])
    expect(usages.listBySha256(first.sha256)).toHaveLength(2)
  })

  it('compensates a fresh asset file when its usage transaction fails', () => {
    createProjectWithBoards('project-1', ['A'])
    assets.materializeForBoard({
      projectId: 'project-1',
      boardId: 'A',
      shapeId: 'shape-a',
      assetRecordId: 'asset-a',
      bytes: new Uint8Array([1]),
      mime: 'image/png',
      createdAt: now,
    })
    const nextBytes = new Uint8Array([2])

    expect(() =>
      assets.materializeForBoard({
        projectId: 'project-1',
        boardId: 'A',
        shapeId: 'shape-a',
        assetRecordId: 'asset-a',
        bytes: nextBytes,
        mime: 'image/png',
        createdAt: now,
      }),
    ).toThrow()
    expect(readdirSync(assetDirectory)).toHaveLength(1)
    expect(usages.listByProject('project-1')).toHaveLength(1)
  })
})
