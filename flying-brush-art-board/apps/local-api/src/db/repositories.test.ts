import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BoardReferenceGraphError } from '@infinite-board/board-core'
import { createPngFixture } from '../../../../packages/test-fixtures/src/media.js'

import { AssetRepository, AssetUsageRepository } from '../modules/assets/asset-repository.js'
import { BoardReferenceRepository } from '../modules/board-references/board-reference-repository.js'
import {
  BoardRepository,
  ProtectedCoreMutationError,
  RevisionConflictError,
} from '../modules/boards/board-repository.js'
import { ProjectRepository, ProtectedWorkspaceDeleteError } from '../modules/projects/project-repository.js'
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

  it('advances the shared content revision for changed realtime snapshots but not identical echoes', () => {
    createProjectWithBoards('project-1', ['A'])

    const first = boards.saveRealtimeSnapshot('A', { store: [{ id: 'shape:realtime-1' }] })
    expect(first.revision).toBe(1)

    const second = boards.saveRealtimeSnapshot('A', { store: [{ id: 'shape:realtime-2' }] })
    expect(second.revision).toBe(2)
    expect(second.tldrawSnapshot).toEqual({ store: [{ id: 'shape:realtime-2' }] })

    const echoed = boards.saveRealtimeSnapshot('A', { store: [{ id: 'shape:realtime-2' }] })
    expect(echoed.revision).toBe(2)
    expect(() => boards.saveSnapshot('A', 0, { store: [] })).toThrow(
      expect.objectContaining({ currentRevision: 2 }) satisfies Partial<RevisionConflictError>,
    )
  })

  it('allows protected core movement and resizing but rejects deletion or semantic retagging', () => {
    createProjectWithBoards('project-protected', ['protected-board'])
    const protectedPanel = {
      id: 'shape:today-core',
      typeName: 'shape',
      type: 'trading-panel',
      parentId: 'page:page',
      index: 'a1',
      x: 0,
      y: 0,
      opacity: 1,
      meta: {
        template: 'shortline-trading-v1',
        templateRole: 'today-core',
        protectedCore: true,
      },
      props: { panelKind: 'today-overview', title: '今天怎么看', w: 900, h: 600 },
    }
    database.prepare('UPDATE boards SET tldraw_snapshot = ? WHERE id = ?')
      .run(JSON.stringify({ store: { [protectedPanel.id]: protectedPanel } }), 'protected-board')

    const moved = structuredClone(protectedPanel)
    moved.x = 120
    moved.y = 80
    moved.props.w = 1080
    expect(boards.saveSnapshot('protected-board', 0, { store: { [moved.id]: moved } }).revision).toBe(1)

    expect(() => boards.saveSnapshot('protected-board', 1, { store: {} })).toThrow(
      expect.objectContaining({ code: 'PROTECTED_CORE_MUTATION_FORBIDDEN', reason: 'removed' }) satisfies Partial<ProtectedCoreMutationError>,
    )
    const retagged = structuredClone(moved)
    retagged.props.panelKind = 'market-overview'
    expect(() => boards.saveRealtimeSnapshot('protected-board', { store: { [retagged.id]: retagged } })).toThrow(
      expect.objectContaining({ code: 'PROTECTED_CORE_MUTATION_FORBIDDEN', reason: 'panel-kind-changed' }) satisfies Partial<ProtectedCoreMutationError>,
    )
    expect(boards.get('protected-board')).toMatchObject({ revision: 1 })
  })

  it('does not let an ordinary snapshot save invent a protected core marker', () => {
    createProjectWithBoards('project-forged-protection', ['forged-board'])
    const forged = {
      id: 'shape:forged',
      typeName: 'shape',
      type: 'trading-panel',
      parentId: 'page:page',
      opacity: 1,
      meta: { protectedCore: true, template: 'shortline-trading-v1', templateRole: 'today-core' },
      props: { panelKind: 'today-overview' },
    }

    expect(() => boards.saveSnapshot('forged-board', 0, { store: { [forged.id]: forged } })).toThrow(
      expect.objectContaining({ code: 'PROTECTED_CORE_MUTATION_FORBIDDEN', reason: 'introduced' }),
    )
    expect(() => boards.saveRealtimeSnapshot('forged-board', { store: { [forged.id]: forged } })).toThrow(
      expect.objectContaining({ code: 'PROTECTED_CORE_MUTATION_FORBIDDEN', reason: 'introduced' }),
    )

    const timestamp = new Date().toISOString()
    expect(() => boards.create({
      id: 'forged-created-board',
      projectId: 'project-forged-protection',
      title: 'Forged protected board',
      tldrawSnapshot: { store: { [forged.id]: forged } },
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })).toThrow(
      expect.objectContaining({ code: 'PROTECTED_CORE_MUTATION_FORBIDDEN', reason: 'introduced' }),
    )

    const protectedBoard = boards.createTemplate({
      id: 'template-protected-board',
      projectId: 'project-forged-protection',
      title: 'Template protected board',
      tldrawSnapshot: { store: { [forged.id]: forged } },
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect(protectedBoard.id).toBe('template-protected-board')
    expect(() => boards.duplicate(protectedBoard.id, {
      id: 'duplicated-protected-board',
      title: 'Duplicated protected board',
    })).toThrow(
      expect.objectContaining({ code: 'PROTECTED_CORE_MUTATION_FORBIDDEN', reason: 'introduced' }),
    )
  })

  it('rejects deleting a board that contains a protected core even when it is not the project root', () => {
    createProjectWithBoards('project-protected-delete', ['ordinary-root'])
    const protectedRecord = {
      id: 'shape:protected-delete',
      typeName: 'shape',
      type: 'trading-panel',
      parentId: 'page:page',
      opacity: 1,
      meta: { protectedCore: true, template: 'shortline-trading-v1', templateRole: 'today-core' },
      props: { panelKind: 'today-overview' },
    }
    boards.createTemplate({
      id: 'protected-child',
      projectId: 'project-protected-delete',
      title: 'Protected child',
      tldrawSnapshot: { store: { [protectedRecord.id]: protectedRecord } },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })

    expect(() => boards.remove('project-protected-delete', 'protected-child')).toThrow(
      expect.objectContaining({
        code: 'PROTECTED_CORE_MUTATION_FORBIDDEN',
        recordId: protectedRecord.id,
        reason: 'board-delete',
      }) satisfies Partial<ProtectedCoreMutationError>,
    )
    expect(boards.get('protected-child')).toBeDefined()
  })

  it('does not let a protected root be replaced with another board', () => {
    createProjectWithBoards('project-protected-root', ['protected-root', 'other-board'])
    const protectedRecord = {
      id: 'shape:protected-root-entry',
      typeName: 'shape',
      type: 'board-reference',
      parentId: 'page:page',
      opacity: 1,
      meta: { protectedCore: true, template: 'shortline-trading-v1', templateRole: 'today-entry' },
      props: { referenceId: 'reference:today', targetBoardId: 'today-board', kind: 'embed' },
    }
    database.prepare('UPDATE boards SET tldraw_snapshot = ? WHERE id = ?')
      .run(JSON.stringify({ store: { [protectedRecord.id]: protectedRecord } }), 'protected-root')

    expect(() => projects.setRootBoardId('project-protected-root', 'other-board')).toThrow(
      expect.objectContaining({
        code: 'PROTECTED_CORE_MUTATION_FORBIDDEN',
        recordId: protectedRecord.id,
        reason: 'root-board-change',
      }) satisfies Partial<ProtectedCoreMutationError>,
    )
    expect(projects.get('project-protected-root')?.rootBoardId).toBe('protected-root')
  })

  it('requires an explicit confirmed path to delete a managed workspace and clears its marker', () => {
    createProjectWithBoards('project-managed-workspace', ['managed-root'])
    database.prepare(`INSERT INTO workspace_bootstrap_markers
      (template_key, owner_open_id, template_version, project_id, applied_at) VALUES (?, ?, ?, ?, ?)`)
      .run('shortline-trading-v1', 'owner-a', 5, 'project-managed-workspace', now)

    expect(() => projects.remove('project-managed-workspace')).toThrow(
      expect.objectContaining({
        code: 'PROTECTED_WORKSPACE_DELETE_REQUIRES_CONFIRMATION',
        projectId: 'project-managed-workspace',
        templateKey: 'shortline-trading-v1',
        templateVersion: 5,
      }) satisfies Partial<ProtectedWorkspaceDeleteError>,
    )
    expect(projects.get('project-managed-workspace')).toBeDefined()

    expect(projects.remove('project-managed-workspace', { confirmedProtectedWorkspaceDelete: true })).toBe(true)
    expect(projects.get('project-managed-workspace')).toBeUndefined()
    expect(database.prepare('SELECT 1 FROM workspace_bootstrap_markers WHERE project_id = ?')
      .get('project-managed-workspace')).toBeUndefined()
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
      bytes: createPngFixture(),
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
    const bytes = createPngFixture()

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
      bytes: createPngFixture(),
      mime: 'image/png',
      createdAt: now,
    })
    const nextBytes = createPngFixture(2, 1)

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

  it('fails closed before writing invalid content and refuses a legacy corrupt blob on read', () => {
    expect(() => assets.putByHash(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
      mime: 'image/png',
      createdAt: now,
    })).toThrow('ASSET_CONTENT_INVALID:TRUNCATED')
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })
    expect(readdirSync(assetDirectory)).toEqual([])

    const legacyBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const sha256 = createHash('sha256').update(legacyBytes).digest('hex')
    database.prepare('INSERT INTO assets(sha256,mime,size,created_at) VALUES (?,?,?,?)')
      .run(sha256, 'image/png', legacyBytes.byteLength, now)
    writeFileSync(join(assetDirectory, sha256), legacyBytes)

    expect(assets.readBytes(sha256)).toBeUndefined()
  })
})
