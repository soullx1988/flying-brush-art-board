import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeIboard, exportProjectToIboard } from '../../../../../packages/interop/src/index.js'
import { createReferenceGraphProjectFixture } from '../../../../../packages/test-fixtures/src/iboard/reference-graph-project.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import {
  commitIboardMerge,
  type IboardMergeFaultPoint,
} from './import-iboard-service.js'
import {
  IBOARD_BOARD_SNAPSHOT_UNSUPPORTED,
  normalizeIboardBoardSnapshot,
} from './iboard-runtime-compatibility.js'

const now = '2026-07-23T00:00:00.000Z'

describe('commitIboardMerge', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let projects: ProjectRepository
  let boards: BoardRepository
  let references: BoardReferenceRepository
  let assets: AssetRepository
  let usages: AssetUsageRepository

  beforeEach(() => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-import-'))
    projects = new ProjectRepository(database)
    boards = new BoardRepository(database)
    references = new BoardReferenceRepository(database)
    assets = new AssetRepository(database, assetDirectory)
    usages = new AssetUsageRepository(database)
    projects.create({
      id: 'project-target',
      title: 'Keep this title',
      rootBoardId: 'target-root',
      formatVersion: 9,
      createdAt: now,
      updatedAt: now,
    })
    boards.create({
      id: 'target-root',
      projectId: 'project-target',
      title: 'Existing root',
      tldrawSnapshot: { store: {} },
      revision: 4,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterEach(() => {
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  function decodedFixture() {
    const fixture = createReferenceGraphProjectFixture()
    for (const board of fixture.boards) {
      normalizeRuntimeSnapshot(board.tldrawSnapshot)
    }
    return decodeIboard(exportProjectToIboard(fixture))
  }

  function normalizeRuntimeSnapshot(value: unknown): void {
    const snapshot = value as { schema?: unknown; store: Record<string, Record<string, unknown>> }
    delete snapshot.schema
    const image = snapshot.store['shape:image-a']
    if (image) {
      Object.assign(image, { x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1 })
      image.props = {
        assetId: 'asset:image-a', w: 20, h: 20, playing: false, url: '', crop: null,
        flipX: false, flipY: false, altText: '',
      }
    }
    const asset = snapshot.store['asset:image-a']
    if (asset) {
      asset.props = {
        src: asset.props && typeof asset.props === 'object'
          ? (asset.props as { src?: unknown }).src ?? null
          : null,
        name: 'fixture.png', mimeType: 'image/png', w: 20, h: 20, isAnimated: false,
      }
    }
    const binding = snapshot.store['binding:image-to-ref']
    if (binding) {
      binding.props = {
        terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false, isPrecise: false, snap: 'none',
      }
    }
  }

  function decodedFixtureWithShape(type: string, props: Record<string, unknown>) {
    const fixture = createReferenceGraphProjectFixture()
    for (const board of fixture.boards) {
      normalizeRuntimeSnapshot(board.tldrawSnapshot)
    }
    const board = fixture.boards.find((item) => item.id === 'board-c')!
    const boardSnapshot = board.tldrawSnapshot as { store: Record<string, unknown> }
    boardSnapshot.store[`shape:${type}`] = {
      id: `shape:${type}`,
      typeName: 'shape',
      type,
      parentId: 'page:board-c',
      index: 'a2',
      x: 0,
      y: 0,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props,
    }
    return decodeIboard(exportProjectToIboard(fixture))
  }

  function snapshot() {
    return {
      project: projects.get('project-target'),
      boards: boards.listByProject('project-target'),
      references: references.listByProject('project-target'),
      usages: usages.listByProject('project-target'),
      files: readdirSync(assetDirectory),
    }
  }

  it('atomically merges the full graph while preserving the target project entry point', async () => {
    const originalProject = projects.get('project-target')
    const result = await commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target',
      database,
      assets,
      namespace: 'import-one',
      now: () => now,
    })

    expect(projects.get('project-target')).toEqual(originalProject)
    expect(result.importedRootBoardId).toBe(result.idMap.boards['board-a'])
    expect(result.importedBoardIds).toEqual(Object.values(result.idMap.boards))
    expect(result.importedReferenceIds).toEqual(Object.values(result.idMap.references))
    expect(boards.listByProject('project-target')).toHaveLength(5)
    expect(references.listByProject('project-target')).toHaveLength(6)
    expect(usages.listByProject('project-target')).toEqual([
      expect.objectContaining({
        boardId: result.idMap.boards['board-a'],
        shapeId: result.idMap.recordsByBoard['board-a']!['shape:image-a'],
        assetRecordId: result.idMap.recordsByBoard['board-a']!['asset:image-a'],
      }),
    ])
    expect(readdirSync(assetDirectory)).toHaveLength(1)
  })

  it('creates an independent remap graph for each successful merge and reuses content hashes', async () => {
    const first = await commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target', database, assets, namespace: 'import-one', now: () => now,
    })
    const second = await commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target', database, assets, namespace: 'import-two', now: () => now,
    })

    expect(second.importedRootBoardId).not.toBe(first.importedRootBoardId)
    expect(boards.listByProject('project-target')).toHaveLength(9)
    expect(references.listByProject('project-target')).toHaveLength(12)
    expect(usages.listByProject('project-target')).toHaveLength(2)
    expect(readdirSync(assetDirectory)).toHaveLength(1)
  })

  it('canonicalizes imported board snapshots before persistence', async () => {
    const result = await commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target',
      database,
      assets,
      namespace: 'normalized-import',
      now: () => now,
    })

    const importedBoards = result.importedBoardIds.map((boardId) => boards.get(boardId)!)
    expect(importedBoards).toHaveLength(result.importedBoardCount)
    for (const board of importedBoards) {
      expect(board.tldrawSnapshot).toEqual(normalizeIboardBoardSnapshot(board.tldrawSnapshot))
    }
  })

  it.each([
    'asset-materialize',
    'id-remap',
    'third-board',
    'reference',
    'database-commit',
  ] satisfies IboardMergeFaultPoint[])('leaves no database or file residue after %s failure', async (faultAt) => {
    const before = snapshot()

    await expect(commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target',
      database,
      assets,
      namespace: `fault-${faultAt}`,
      now: () => now,
      faultAt,
    })).rejects.toThrow(`IBOARD_IMPORT_FAULT:${faultAt}`)

    expect(snapshot()).toEqual(before)
  })

  it('rolls back a constraint conflict without changing the previously imported graph', async () => {
    await commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target', database, assets, namespace: 'collision', now: () => now,
    })
    const before = snapshot()

    await expect(commitIboardMerge(decodedFixture(), {
      targetProjectId: 'project-target', database, assets, namespace: 'collision', now: () => now,
    })).rejects.toThrow()
    expect(snapshot()).toEqual(before)
  })

  it('rejects a missing target project before materializing assets', async () => {
    await expect(commitIboardMerge(decodedFixture(), {
      targetProjectId: 'missing', database, assets, namespace: 'missing', now: () => now,
    })).rejects.toThrow('IBOARD_TARGET_PROJECT_NOT_FOUND')
    expect(readdirSync(assetDirectory)).toEqual([])
  })

  it('rejects a MIME-spoofed archive asset before any database or file write', async () => {
    const decoded = decodedFixture()
    const invalidBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const invalidSha256 = createHash('sha256').update(invalidBytes).digest('hex')
    decoded.assets[0] = {
      ...decoded.assets[0]!,
      sha256: invalidSha256,
      size: invalidBytes.byteLength,
      bytes: invalidBytes,
    }
    const before = snapshot()

    await expect(commitIboardMerge(decoded, {
      targetProjectId: 'project-target', database, assets, namespace: 'invalid-asset', now: () => now,
    })).rejects.toThrow('ASSET_CONTENT_INVALID:TRUNCATED')
    expect(snapshot()).toEqual(before)
  })

  it.each([
    ['unknown shape', 'alien-widget', {}],
    ['malformed known shape', 'table', {}],
  ])('rejects a runtime-incompatible %s before any database or file write', async (
    _label,
    type,
    props,
  ) => {
    const before = snapshot()

    await expect(commitIboardMerge(decodedFixtureWithShape(type, props), {
      targetProjectId: 'project-target',
      database,
      assets,
      namespace: `unsupported-${type}`,
      now: () => now,
    })).rejects.toMatchObject({
      code: IBOARD_BOARD_SNAPSHOT_UNSUPPORTED,
      boardId: expect.any(String),
    })

    expect(snapshot()).toEqual(before)
  })
})
