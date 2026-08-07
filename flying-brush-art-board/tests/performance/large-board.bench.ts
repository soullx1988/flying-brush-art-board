import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  Editor,
  createShapeId,
  defaultAssetUtils,
  defaultBindingUtils,
  defaultShapeUtils,
  defaultTools,
  type TLAnyShapeUtilConstructor,
} from 'tldraw'
import { afterAll, beforeAll, bench, describe, expect } from 'vitest'

import type { BoardClipboardPayload } from '../../packages/board-core/src/index.js'
import {
  boardReferenceShapeUtils,
  createBoardStore,
  getStoreSnapshot,
  loadSnapshotIntoStore,
  materializeClipboardPayload,
} from '../../packages/tldraw-adapter/src/index.js'
import { createDatabase, type LocalDatabase } from '../../apps/local-api/src/db/schema.js'
import { AssetRepository } from '../../apps/local-api/src/modules/assets/asset-repository.js'
import { BoardRepository } from '../../apps/local-api/src/modules/boards/board-repository.js'
import { ProjectRepository } from '../../apps/local-api/src/modules/projects/project-repository.js'
import { BoardSession } from '../../apps/web/src/features/boards/board-session.js'
import {
  WorkspaceTabs,
  type WorkspaceEditor,
  type WorkspaceViewState,
} from '../../apps/web/src/features/board-tabs/workspace-tabs.js'
import { CANVAS_TLDRAW_OPTIONS } from '../../apps/web/src/features/canvas/CanvasEditor.js'

const timestamp = '2026-07-23T00:00:00.000Z'
const benchOptions = {
  time: 300,
  iterations: 3,
  warmupTime: 100,
  warmupIterations: 1,
}

let editor: Editor
let largeSnapshot: ReturnType<typeof getStoreSnapshot>
let database: LocalDatabase
let boards: BoardRepository
let autosaveRevision = 0
let assetDirectory = ''
let clipboardPayload: BoardClipboardPayload
let clipboardAssetBytes: Uint8Array
let workspace: WorkspaceTabs
let activationIndex = 0

function createBenchmarkEditor(): Editor {
  const container = document.createElement('div')
  container.style.width = '1920px'
  container.style.height = '1080px'
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => new DOMRect(0, 0, 1920, 1080),
  })
  document.body.append(container)
  const store = createBoardStore()
  const value = new Editor({
    store,
    shapeUtils: [...defaultShapeUtils, ...boardReferenceShapeUtils] as unknown as TLAnyShapeUtilConstructor[],
    bindingUtils: defaultBindingUtils,
    assetUtils: defaultAssetUtils,
    tools: defaultTools,
    getContainer: () => container,
    options: CANVAS_TLDRAW_OPTIONS,
  })
  value.updateViewportScreenBounds(container)
  return value
}

function snapshotWithShapeLimit(
  snapshot: ReturnType<typeof getStoreSnapshot>,
  shapeLimit: number,
): ReturnType<typeof getStoreSnapshot> {
  let includedShapes = 0
  return {
    ...snapshot,
    store: Object.fromEntries(Object.entries(snapshot.store).filter(([, record]) => {
      if (record.typeName !== 'shape') return true
      includedShapes += 1
      return includedShapes <= shapeLimit
    })),
  }
}

function clipboardFixture(shapeCount: number): {
  payload: BoardClipboardPayload
  bytes: Uint8Array
} {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const assetRecordId = 'asset:shared-source'
  const shapes = Array.from({ length: shapeCount }, (_, index) => ({
    id: `shape:clipboard-${index}`,
    typeName: 'shape',
    type: 'image',
    parentId: 'page:page',
    index: `a${String(index + 1).padStart(6, '0')}`,
    x: (index % 25) * 48,
    y: Math.floor(index / 25) * 48,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    props: { w: 40, h: 40, assetId: assetRecordId },
    meta: {},
  }))
  return {
    bytes,
    payload: {
      version: 1,
      sourceProjectId: 'project-large',
      sourceBoardId: 'board-source',
      shapes,
      bindings: [],
      references: [],
      assets: [{
        assetRecordId,
        sha256,
        mime: 'image/png',
        size: bytes.byteLength,
        record: {
          id: assetRecordId,
          typeName: 'asset',
          type: 'image',
          props: { src: `/api/assets/${sha256}`, mimeType: 'image/png' },
          meta: {},
        },
      }],
      copiedAt: timestamp,
    },
  }
}

function materialize500Shapes() {
  let id = 0
  return materializeClipboardPayload(clipboardPayload, {
    createId: () => `bench:${++id}`,
    targetSnapshot: {
      store: { 'page:page': { id: 'page:page', typeName: 'page' } },
    },
    assetBlobs: [{
      sha256: clipboardPayload.assets[0]!.sha256,
      mime: 'image/png',
      size: clipboardAssetBytes.byteLength,
      bytes: clipboardAssetBytes,
    }],
  })
}

beforeAll(async () => {
  editor = createBenchmarkEditor()
  const shapes = Array.from({ length: 5_000 }, (_, index) => ({
    id: createShapeId(`large-${index}`),
    type: 'geo' as const,
    x: (index % 100) * 64,
    y: Math.floor(index / 100) * 64,
    props: { geo: 'rectangle' as const, w: 48, h: 48 },
  }))
  editor.createShapes(shapes)
  expect(editor.getCurrentPageShapeIds().size).toBe(5_000)

  const cameraStarted = performance.now()
  for (let index = 0; index < 200; index += 1) {
    editor.setCamera(
      { x: index * 3, y: index * -2, z: 0.5 + (index % 10) * 0.1 },
      { immediate: true },
    )
    editor.getRenderingShapes()
  }
  expect(performance.now() - cameraStarted).toBeLessThan(2_000)

  largeSnapshot = getStoreSnapshot(editor.store)
  const firstOpenSnapshot = snapshotWithShapeLimit(largeSnapshot, 2_000)
  const firstOpenStarted = performance.now()
  const firstOpenStore = createBoardStore()
  loadSnapshotIntoStore(firstOpenStore, firstOpenSnapshot)
  const firstOpenElapsed = performance.now() - firstOpenStarted
  expect(firstOpenStore.allRecords().filter((record) => record.typeName === 'shape')).toHaveLength(2_000)
  expect(firstOpenElapsed).toBeLessThan(2_000)

  database = createDatabase(':memory:')
  const projects = new ProjectRepository(database)
  boards = new BoardRepository(database)
  projects.create({
    id: 'project-large',
    title: 'Large board benchmark',
    rootBoardId: 'board-large',
    formatVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  boards.create({
    id: 'board-large',
    projectId: 'project-large',
    title: '5000 shapes',
    tldrawSnapshot: { store: {} },
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const autosaveStarted = performance.now()
  boards.saveSnapshot('board-large', autosaveRevision, largeSnapshot)
  autosaveRevision += 1
  expect(performance.now() - autosaveStarted).toBeLessThan(5_000)

  assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-large-bench-'))
  const assets = new AssetRepository(database, assetDirectory)
  const clipboard = clipboardFixture(500)
  clipboardPayload = clipboard.payload
  clipboardAssetBytes = clipboard.bytes
  const firstAsset = assets.putByHashWithResult(clipboard.bytes, {
    mime: 'image/png',
    createdAt: timestamp,
  })
  const reusedAsset = assets.putByHashWithResult(clipboard.bytes, {
    mime: 'image/png',
    createdAt: timestamp,
  })
  expect(firstAsset.created).toBe(true)
  expect(reusedAsset.created).toBe(false)
  expect(readdirSync(assetDirectory)).toHaveLength(1)
  expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 1 })
  const patch = materialize500Shapes()
  expect(Object.keys(patch.idMap)).toHaveLength(501)
  expect(patch.assetUsages).toHaveLength(500)
  expect(patch.assetBlobs).toHaveLength(1)

  let liveEditors = 0
  let maximumLiveEditors = 0
  let saveCalls = 0
  const snapshots: Map<string, ReturnType<typeof getStoreSnapshot>> = new Map(
    Array.from({ length: 20 }, (_, index) => [`board-tab-${index}`, largeSnapshot]),
  )
  workspace = new WorkspaceTabs({
    projectId: 'project-large',
    api: {
      loadBoard: async (boardId) => ({ snapshot: snapshots.get(boardId), revision: 1 }),
      saveSnapshot: async (_boardId, expectedRevision, snapshot) => {
        saveCalls += 1
        return { snapshot, revision: expectedRevision + 1 }
      },
    },
    createSession: () => new BoardSession({
      api: {
        loadBoard: async (boardId) => ({ snapshot: snapshots.get(boardId), revision: 1 }),
        saveSnapshot: async (_boardId, expectedRevision, snapshot) => {
          saveCalls += 1
          return { snapshot, revision: expectedRevision + 1 }
        },
      },
    }),
    createEditor: (snapshot): WorkspaceEditor => {
      liveEditors += 1
      maximumLiveEditors = Math.max(maximumLiveEditors, liveEditors)
      let currentSnapshot = snapshot
      let viewState: WorkspaceViewState = { camera: { x: 0, y: 0, z: 1 }, selectedShapeIds: [], currentToolId: 'select' }
      return {
        getSnapshot: () => currentSnapshot,
        loadSnapshot: (next) => { currentSnapshot = next },
        subscribe: () => () => undefined,
        getViewState: () => viewState,
        setViewState: (next) => { viewState = next },
        setReadOnly: () => undefined,
        dispose: () => { liveEditors -= 1 },
      }
    },
  })
  for (let index = 0; index < 20; index += 1) {
    await workspace.openBoardInNewTab(`board-tab-${index}`)
  }
  expect(workspace.tabs).toHaveLength(20)
  expect(liveEditors).toBe(1)
  expect(maximumLiveEditors).toBe(1)
  expect(saveCalls).toBe(0)
  const activationStarted = performance.now()
  await workspace.activateTab(workspace.tabs[0]!.tabId)
  expect(performance.now() - activationStarted).toBeLessThan(200)
  expect(liveEditors).toBe(1)
})

afterAll(() => {
  workspace?.dispose()
  editor?.dispose()
  database?.close()
  if (assetDirectory) rmSync(assetDirectory, { recursive: true, force: true })
  document.body.replaceChildren()
})

describe('large board and application-session baselines', () => {
  bench('5000-shape tldraw pan/zoom and visible-shape derivation', () => {
    activationIndex += 1
    editor.setCamera({
      x: activationIndex * 5,
      y: activationIndex * -3,
      z: 0.5 + (activationIndex % 10) * 0.1,
    }, { immediate: true })
    editor.getRenderingShapes()
  }, benchOptions)

  bench('5000-shape SQLite autosave snapshot commit', () => {
    const saved = boards.saveSnapshot('board-large', autosaveRevision, largeSnapshot)
    autosaveRevision = saved.revision
    void saved.revision
  }, benchOptions)

  bench('500-element cross-board clipboard materialization', () => {
    materialize500Shapes()
  }, benchOptions)

  bench('cached activation across 20 tabs with one mounted editor', async () => {
    activationIndex = (activationIndex + 1) % workspace.tabs.length
    await workspace.activateTab(workspace.tabs[activationIndex]!.tabId)
  }, benchOptions)
})
