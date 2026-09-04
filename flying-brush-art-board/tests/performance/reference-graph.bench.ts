import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { beforeAll, bench, describe, expect } from 'vitest'

import {
  assertCanCreateBoardReference,
  getInboundBoardReferences,
  getMaxEmbedBoardLevels,
  getOutboundBoardReferences,
  stableTopologicalBoardOrder,
  type BoardHistoryEntry,
  type BoardReferenceRecord,
  type ProjectRecord,
  type StoredBoard,
} from '../../packages/board-core/src/index.js'
import { createPngFixture } from '../../packages/test-fixtures/src/media.js'
import {
  createIboardMergePlan,
  exportProjectToIboard,
  preflightIboardImport,
  type IboardPreflightResult,
} from '../../packages/interop/src/index.js'
import { createBoardReferenceShape } from '../../packages/tldraw-adapter/src/index.js'
import { createDatabase } from '../../apps/local-api/src/db/schema.js'
import { AssetRepository } from '../../apps/local-api/src/modules/assets/asset-repository.js'
import { BoardRepository } from '../../apps/local-api/src/modules/boards/board-repository.js'
import { commitIboardMerge } from '../../apps/local-api/src/modules/files/import-iboard-service.js'
import { ProjectRepository } from '../../apps/local-api/src/modules/projects/project-repository.js'
import {
  appendReferenceEntry,
  historyBreadcrumbEntries,
} from '../../apps/web/src/features/board-references/navigation-state.js'

const timestamp = '2026-07-23T00:00:00.000Z'
const targetProjectId = 'project-benchmark-target'
const benchOptions = {
  time: 300,
  iterations: 3,
  warmupTime: 100,
  warmupIterations: 1,
}

interface GraphFixture {
  project: ProjectRecord
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
  assets: Array<{
    sha256: string
    mime: string
    size: number
    bytes: Uint8Array
    usages: Array<{ boardId: string; shapeId: string; assetRecordId: string }>
  }>
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link',
): BoardReferenceRecord {
  return {
    id,
    projectId: 'project-reference-benchmark',
    sourceBoardId,
    targetBoardId,
    shapeId: `shape:${id}`,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function createGraphFixture(): GraphFixture {
  const boardIds = Array.from({ length: 100 }, (_, index) => `board-${String(index).padStart(3, '0')}`)
  const references: BoardReferenceRecord[] = []
  for (let layer = 0; layer < 9; layer += 1) {
    for (let offset = 0; offset < 10; offset += 1) {
      const source = boardIds[layer * 10 + offset]!
      for (const targetOffset of [offset, (offset + 1) % 10]) {
        const target = boardIds[(layer + 1) * 10 + targetOffset]!
        references.push(reference(`embed-${layer}-${offset}-${targetOffset}`, source, target, 'embed'))
      }
    }
  }
  references.push(reference('link-self', boardIds[0]!, boardIds[0]!, 'link'))
  references.push(reference('link-cycle-a-b', boardIds[0]!, boardIds[1]!, 'link'))
  references.push(reference('link-cycle-b-a', boardIds[1]!, boardIds[0]!, 'link'))
  for (let index = references.length; index < 1_000; index += 1) {
    references.push(reference(
      `link-${index}`,
      boardIds[index % boardIds.length]!,
      boardIds[(index * 17 + 3) % boardIds.length]!,
      'link',
    ))
  }

  const assetBytes = createPngFixture()
  const sha256 = createHash('sha256').update(assetBytes).digest('hex')
  const usages = [0, 1].map((index) => ({
    boardId: boardIds[index]!,
    shapeId: `shape:shared-image-${index}`,
    assetRecordId: `asset:shared-image-${index}`,
  }))
  const referencesBySource = new Map<string, BoardReferenceRecord[]>()
  for (const item of references) {
    const outbound = referencesBySource.get(item.sourceBoardId) ?? []
    outbound.push(item)
    referencesBySource.set(item.sourceBoardId, outbound)
  }
  const boards = boardIds.map((id, index): StoredBoard => {
    const records: Record<string, unknown>[] = [
      { id: 'page:page', typeName: 'page', name: id, index: 'a1', meta: {} },
      ...(referencesBySource.get(id) ?? []).map((item) =>
        createBoardReferenceShape(item, item.targetBoardId, { parentId: 'page:page' })),
    ]
    const usage = usages.find((candidate) => candidate.boardId === id)
    if (usage) {
      records.push(
        {
          id: usage.assetRecordId,
          typeName: 'asset',
          type: 'image',
          props: { src: `/api/assets/${sha256}`, mimeType: 'image/png' },
          meta: {},
        },
        {
          id: usage.shapeId,
          typeName: 'shape',
          type: 'image',
          parentId: 'page:page',
          index: 'a0',
          x: 0,
          y: 0,
          rotation: 0,
          isLocked: false,
          opacity: 1,
          props: { assetId: usage.assetRecordId, w: 32, h: 32 },
          meta: {},
        },
      )
    }
    return {
      id,
      projectId: 'project-reference-benchmark',
      title: `Board ${index}`,
      revision: 1,
      tldrawSnapshot: {
        store: Object.fromEntries(records.map((record) => [String(record.id), record])),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })
  return {
    project: {
      id: 'project-reference-benchmark',
      title: 'Reference benchmark',
      rootBoardId: boardIds[0]!,
      formatVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    boards,
    references,
    assets: [{
      sha256,
      mime: 'image/png',
      size: assetBytes.byteLength,
      bytes: assetBytes,
      usages,
    }],
  }
}

function expectUnder<T>(label: string, limitMs: number, operation: () => T): T {
  const started = performance.now()
  const result = operation()
  expect(performance.now() - started, label).toBeLessThan(limitMs)
  return result
}

const fixture = createGraphFixture()
const archive = exportProjectToIboard(fixture)
let preflight: IboardPreflightResult
let navigationHistory: BoardHistoryEntry[]
let navigationReference: BoardReferenceRecord
let namespaceCounter = 0

async function commitLargeMerge(namespace: string): Promise<number> {
  const database = createDatabase(':memory:')
  const directory = mkdtempSync(join(tmpdir(), 'infinite-board-reference-bench-'))
  try {
    const projects = new ProjectRepository(database)
    const boards = new BoardRepository(database)
    projects.create({
      id: targetProjectId,
      title: 'Keep target',
      rootBoardId: 'target-root',
      formatVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    boards.create({
      id: 'target-root',
      projectId: targetProjectId,
      title: 'Target root',
      revision: 0,
      tldrawSnapshot: { store: {} },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const started = performance.now()
    const result = await commitIboardMerge(preflight, {
      targetProjectId,
      database,
      assets: new AssetRepository(database, directory),
      namespace,
      now: () => timestamp,
    })
    const elapsed = performance.now() - started
    expect(result.importedBoardCount).toBe(100)
    expect(result.importedReferenceCount).toBe(1_000)
    expect(projects.get(targetProjectId)).toMatchObject({ rootBoardId: 'target-root', title: 'Keep target' })
    expect(boards.listByProject(targetProjectId)).toHaveLength(101)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 1 })
    expect(readdirSync(directory)).toHaveLength(1)
    return elapsed
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

beforeAll(async () => {
  expect(fixture.boards).toHaveLength(100)
  expect(fixture.references).toHaveLength(1_000)
  expect(fixture.references.filter((item) => item.kind === 'embed')).toHaveLength(180)
  expect(fixture.references).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'embed-0-0-0', sourceBoardId: 'board-000', targetBoardId: 'board-010' }),
    expect.objectContaining({ id: 'embed-0-0-1', sourceBoardId: 'board-000', targetBoardId: 'board-011' }),
    expect.objectContaining({ id: 'embed-0-1-1', sourceBoardId: 'board-001', targetBoardId: 'board-011' }),
    expect.objectContaining({ id: 'link-self', sourceBoardId: 'board-000', targetBoardId: 'board-000', kind: 'link' }),
    expect.objectContaining({ id: 'link-cycle-a-b', sourceBoardId: 'board-000', targetBoardId: 'board-001', kind: 'link' }),
    expect.objectContaining({ id: 'link-cycle-b-a', sourceBoardId: 'board-001', targetBoardId: 'board-000', kind: 'link' }),
  ]))

  preflight = expectUnder('100-board .iboard preflight', 5_000, () => preflightIboardImport(archive))
  const inbound = expectUnder('1000-edge inbound query', 200, () =>
    getInboundBoardReferences(fixture.references, 'board-011'))
  const outbound = expectUnder('1000-edge outbound query', 200, () =>
    getOutboundBoardReferences(fixture.references, 'board-000'))
  expect(inbound.map((item) => item.sourceBoardId)).toEqual(expect.arrayContaining(['board-000', 'board-001']))
  expect(outbound.some((item) => item.id === 'link-self')).toBe(true)
  expect(expectUnder('1000-edge depth calculation', 200, () =>
    getMaxEmbedBoardLevels(fixture.boards, fixture.references))).toBe(10)
  expect(expectUnder('1000-edge topological sort', 200, () =>
    stableTopologicalBoardOrder(fixture.project, fixture.boards, fixture.references))).toHaveLength(100)

  const cycleCandidate = reference('embed-cycle-candidate', 'board-099', 'board-000', 'embed')
  const cycleStarted = performance.now()
  expect(() => assertCanCreateBoardReference(
    fixture.boards,
    fixture.references,
    cycleCandidate,
  )).toThrow('EMBED_CYCLE')
  expect(performance.now() - cycleStarted, '1000-edge cycle check').toBeLessThan(200)

  navigationReference = fixture.references.find((item) => item.id === 'embed-0-0-0')!
  navigationHistory = [{
    entryId: 'history-root',
    projectId: fixture.project.id,
    boardId: navigationReference.sourceBoardId,
    viewState: {
      camera: { x: 100, y: -50, z: 1.5 },
      selectedShapeIds: [navigationReference.shapeId],
      currentToolId: 'select',
    },
  }]
  const navigationStarted = performance.now()
  const entered = appendReferenceEntry(navigationHistory, 0, navigationReference, () => 'history-target')
  const returned = historyBreadcrumbEntries(entered.history, 0)
  expect(returned[0]!.viewState).toEqual(navigationHistory[0]!.viewState)
  expect(performance.now() - navigationStarted, 'cached reference entry and history return').toBeLessThan(200)

  const remapped = expectUnder('100-board / 1000-edge ID remap', 5_000, () =>
    createIboardMergePlan(preflight, { targetProjectId, namespace: 'baseline-remap' }))
  expect(remapped.boards).toHaveLength(100)
  expect(remapped.references).toHaveLength(1_000)
  expect(remapped.assets).toHaveLength(1)
  expect(await commitLargeMerge('baseline-commit')).toBeLessThan(30_000)
})

describe('100-board / 1000-edge reference and merge baselines', () => {
  bench('inbound and outbound reference queries', () => {
    getInboundBoardReferences(fixture.references, 'board-011')
    getOutboundBoardReferences(fixture.references, 'board-000')
  }, benchOptions)

  bench('embed cycle, depth, and stable topological checks', () => {
    const levels = getMaxEmbedBoardLevels(fixture.boards, fixture.references)
    const order = stableTopologicalBoardOrder(fixture.project, fixture.boards, fixture.references)
    try {
      assertCanCreateBoardReference(
        fixture.boards,
        fixture.references,
        reference('embed-cycle-bench', 'board-099', 'board-000', 'embed'),
      )
    } catch {
      void levels
      void order
      return
    }
    throw new Error('Cycle candidate was unexpectedly accepted')
  }, benchOptions)

  bench('cached reference entry and history return', () => {
    const entered = appendReferenceEntry(
      navigationHistory,
      0,
      navigationReference,
      () => `history-${++namespaceCounter}`,
    )
    historyBreadcrumbEntries(entered.history, 0)
  }, benchOptions)

  bench('100-board / 1000-edge .iboard preflight', () => {
    preflightIboardImport(archive)
  }, { ...benchOptions, time: 100 })

  bench('100-board / 1000-edge schema-owned ID remap', () => {
    createIboardMergePlan(preflight, {
      targetProjectId,
      namespace: `remap-${++namespaceCounter}`,
    })
  }, { ...benchOptions, time: 100 })

  bench('100-board / 1000-edge atomic SQLite merge with shared resource', async () => {
    await commitLargeMerge(`commit-${++namespaceCounter}`)
  }, {
    time: 1,
    iterations: 1,
    warmupTime: 0,
    warmupIterations: 0,
  })
})
