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
    return decodeIboard(exportProjectToIboard(createReferenceGraphProjectFixture()))
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

  it('merges navigation with existing topics and preserves it when exporting again', async () => {
    projects.saveNavigation('project-target', {version:1,revision:0,topics:[{id:'topic:existing',title:'Existing',description:''}],parents:{'target-root':'topic:existing'}})
    const fixture=createReferenceGraphProjectFixture()
    fixture.project.navigation={version:1,revision:4,topics:[{id:'topic:source',title:'Imported',description:''}],parents:Object.fromEntries(fixture.boards.map(board=>[board.id,board.id===fixture.project.rootBoardId?'topic:source':fixture.project.rootBoardId]))}
    const result=await commitIboardMerge(decodeIboard(exportProjectToIboard(fixture)),{targetProjectId:'project-target',database,assets,namespace:'with-navigation'})
    const navigation=projects.get('project-target')!.navigation!
    expect(navigation.topics).toHaveLength(2)
    expect(navigation.parents['target-root']).toBe('topic:existing')
    expect(navigation.parents[result.importedRootBoardId]).toBe(navigation.topics[1]!.id)
    expect(navigation.revision).toBe(2)
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
})
