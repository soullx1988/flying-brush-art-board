import type { BoardReferenceRecord, StoredBoard } from '../../packages/board-core/src/index.js'

import {
  createIboardMergePlan,
  exportProjectToIboard,
  preflightIboardImport,
} from '../../packages/interop/dist/index.js'
import { createReferenceGraphProjectFixture } from '../../packages/test-fixtures/dist/index.js'
import {
  createBoardReferenceShape,
  createBoardStore,
  getStoreSnapshot,
} from '../../packages/tldraw-adapter/dist/index.js'

export type Task15ReferenceGraphFixture = ReturnType<typeof createReferenceGraphProjectFixture>

type SnapshotRecord = Record<string, unknown> & {
  id?: string
  type?: string
  typeName?: string
  props?: Record<string, unknown>
}

function snapshotStore(board: Pick<StoredBoard, 'tldrawSnapshot'>): Record<string, SnapshotRecord> {
  const snapshot = board.tldrawSnapshot as {
    store?: Record<string, SnapshotRecord>
    document?: { store?: Record<string, SnapshotRecord> }
  }
  const store = snapshot.document?.store ?? snapshot.store
  if (!store) throw new Error(`Board snapshot has no store`)
  return store
}

export function remappableSnapshotRecordIds(board: Pick<StoredBoard, 'tldrawSnapshot'>): string[] {
  return Object.values(snapshotStore(board))
    .filter((record) => ['page', 'shape', 'binding', 'asset'].includes(String(record.typeName)))
    .map((record) => String(record.id))
}

function addReference(
  fixture: Task15ReferenceGraphFixture,
  reference: BoardReferenceRecord,
): void {
  fixture.references.push(reference)
  const source = fixture.boards.find((board) => board.id === reference.sourceBoardId)
  const target = fixture.boards.find((board) => board.id === reference.targetBoardId)
  if (!source || !target) throw new Error(`Task15 fixture reference endpoint is missing`)
  snapshotStore(source)[reference.shapeId] = createBoardReferenceShape(reference, target.title, {
    parentId: `page:${source.id}`,
  }) as unknown as SnapshotRecord
}

export function createTask15ReferenceGraphFixture(): Task15ReferenceGraphFixture {
  const fixture = createReferenceGraphProjectFixture()
  const timestamp = fixture.project.createdAt
  addReference(fixture, {
    id: 'ref-b-c',
    projectId: fixture.project.id,
    sourceBoardId: 'board-b',
    targetBoardId: 'board-c',
    shapeId: 'shape:ref-b-c',
    kind: 'embed',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  addReference(fixture, {
    id: 'ref-a-b-link',
    projectId: fixture.project.id,
    sourceBoardId: 'board-a',
    targetBoardId: 'board-b',
    shapeId: 'shape:ref-a-b-link',
    kind: 'link',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  addReference(fixture, {
    id: 'ref-b-a-link',
    projectId: fixture.project.id,
    sourceBoardId: 'board-b',
    targetBoardId: 'board-a',
    shapeId: 'shape:ref-b-a-link',
    kind: 'link',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return fixture
}

export function makeFixtureRootLoadable(
  fixture: Task15ReferenceGraphFixture,
  sourceId = 'external:board-c',
): void {
  const board = fixture.boards.find((candidate) => candidate.sourceMetadata?.sourceId === sourceId)
  if (!board) throw new Error(`Task15 fixture root ${sourceId} was not found`)
  const snapshot = getStoreSnapshot(createBoardStore()) as unknown as { store: Record<string, SnapshotRecord> }
  for (const reference of fixture.references.filter((candidate) => candidate.sourceBoardId === board.id)) {
    const target = fixture.boards.find((candidate) => candidate.id === reference.targetBoardId)
    if (!target) throw new Error(`Task15 fixture target ${reference.targetBoardId} was not found`)
    snapshot.store[reference.shapeId] = createBoardReferenceShape(reference, target.title, {
      parentId: 'page:page',
    }) as unknown as SnapshotRecord
  }
  fixture.project.rootBoardId = board.id
  board.tldrawSnapshot = snapshot
}

export function namespaceTask15Fixture(
  fixture: Task15ReferenceGraphFixture,
  namespace: string,
  projectId: string,
): Task15ReferenceGraphFixture {
  const plan = createIboardMergePlan(
    preflightIboardImport(exportProjectToIboard(fixture)),
    { namespace, targetProjectId: projectId },
  )
  return {
    project: {
      ...fixture.project,
      id: projectId,
      rootBoardId: plan.importedRootBoardId,
    },
    boards: plan.boards.map((board) => ({
      ...board,
      createdAt: fixture.project.createdAt,
      updatedAt: fixture.project.updatedAt,
    })),
    references: plan.references,
    assets: plan.assets.map((asset) => ({
      ...asset,
      bytes: asset.bytes.slice(),
      usages: asset.usages.map((usage) => ({ ...usage })),
    })),
  }
}

export function collisionSnapshotFor(board: StoredBoard): unknown {
  const snapshot = structuredClone(board.tldrawSnapshot) as {
    store?: Record<string, SnapshotRecord>
    document?: { store?: Record<string, SnapshotRecord> }
  }
  const store = snapshot.document?.store ?? snapshot.store
  if (!store) throw new Error(`Board snapshot has no store`)

  for (const [id, record] of Object.entries(store)) {
    if (record.typeName === 'shape' && record.type === 'board-reference') {
      delete store[id]
      continue
    }
    if (record.typeName === 'asset') {
      store[id] = {
        id,
        typeName: 'shape',
        type: 'text',
        parentId: `page:${board.id}`,
        index: 'a8',
        props: { text: 'asset id collision sentinel' },
        meta: {},
      }
      continue
    }
    if (record.typeName === 'shape' && record.props?.assetId !== undefined) {
      store[id] = {
        ...record,
        type: 'text',
        props: { text: 'shape id collision sentinel' },
      }
    }
  }
  return snapshot
}

export function rewriteFixtureReferenceId(
  fixture: Task15ReferenceGraphFixture,
  shapeId: string,
  referenceId: string,
): void {
  const reference = fixture.references.find((candidate) => candidate.shapeId === shapeId)
  if (!reference) throw new Error(`Fixture reference ${shapeId} was not found`)
  reference.id = referenceId
  const source = fixture.boards.find((board) => board.id === reference.sourceBoardId)
  const shape = source ? snapshotStore(source)[shapeId] : undefined
  if (!shape?.props) throw new Error(`Fixture reference shape ${shapeId} was not found`)
  shape.props.referenceId = referenceId
}

export function collectConnectedBoardIds(
  rootBoardId: string,
  references: readonly BoardReferenceRecord[],
): Set<string> {
  const result = new Set([rootBoardId])
  const queue = [rootBoardId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const reference of references) {
      if (reference.sourceBoardId !== current || result.has(reference.targetBoardId)) continue
      result.add(reference.targetBoardId)
      queue.push(reference.targetBoardId)
    }
  }
  return result
}

function sourceBoardKey(board: StoredBoard): string {
  const sourceId = board.sourceMetadata?.sourceId
  if (typeof sourceId !== 'string' || !sourceId.startsWith('external:')) {
    throw new Error(`Board ${board.id} has no Task15 source identity`)
  }
  return sourceId.slice('external:'.length)
}

function referenceSemanticKey(
  reference: BoardReferenceRecord,
  boardKeys: ReadonlyMap<string, string>,
): string {
  return `${boardKeys.get(reference.sourceBoardId)}->${boardKeys.get(reference.targetBoardId)}:${reference.kind}`
}

function normalizeSnapshot(
  board: StoredBoard,
  boardKeys: ReadonlyMap<string, string>,
  references: readonly BoardReferenceRecord[],
): unknown {
  const store = snapshotStore(board)
  const referenceKeys = new Map(
    references.map((reference) => [reference.id, referenceSemanticKey(reference, boardKeys)]),
  )
  const recordKeys = new Map<string, string>()
  let shapeIndex = 0
  let assetIndex = 0
  let bindingIndex = 0
  for (const record of Object.values(store)) {
    if (typeof record.id !== 'string') continue
    if (record.typeName === 'page') {
      recordKeys.set(record.id, `page:${sourceBoardKey(board)}`)
    } else if (record.typeName === 'shape' && record.type === 'board-reference') {
      const referenceId = record.props?.referenceId
      recordKeys.set(record.id, `shape:reference:${referenceKeys.get(String(referenceId))}`)
    } else if (record.typeName === 'shape') {
      recordKeys.set(record.id, `shape:${String(record.type)}:${shapeIndex++}`)
    } else if (record.typeName === 'asset') {
      recordKeys.set(record.id, `asset:${String(record.type)}:${assetIndex++}`)
    } else if (record.typeName === 'binding') {
      recordKeys.set(record.id, `binding:${String(record.type)}:${bindingIndex++}`)
    }
  }

  const mapId = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    return recordKeys.get(value) ?? referenceKeys.get(value) ?? boardKeys.get(value) ?? value
  }
  const records = Object.values(store).map((source) => {
    const record = structuredClone(source)
    if (record.id !== undefined) record.id = mapId(record.id) as string
    if (record.parentId !== undefined) record.parentId = mapId(record.parentId)
    if (record.fromId !== undefined) record.fromId = mapId(record.fromId)
    if (record.toId !== undefined) record.toId = mapId(record.toId)
    if (record.props) {
      if (record.props.assetId !== undefined) record.props.assetId = mapId(record.props.assetId)
      if (record.props.referenceId !== undefined) record.props.referenceId = mapId(record.props.referenceId)
      if (record.props.targetBoardId !== undefined) record.props.targetBoardId = mapId(record.props.targetBoardId)
    }
    return record
  }).sort((left, right) => String(left.id).localeCompare(String(right.id)))
  const envelope = board.tldrawSnapshot as { schema?: unknown; document?: { schema?: unknown } }
  return {
    records,
    schema: structuredClone(envelope.document?.schema ?? envelope.schema),
  }
}

export function semanticGraph(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): unknown {
  const boardKeys = new Map(boards.map((board) => [board.id, sourceBoardKey(board)]))
  return {
    boards: boards
      .map((board) => ({
        key: sourceBoardKey(board),
        title: board.title,
        sourceMetadata: structuredClone(board.sourceMetadata),
        snapshot: normalizeSnapshot(board, boardKeys, references),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    references: references
      .map((reference) => ({
        key: referenceSemanticKey(reference, boardKeys),
        kind: reference.kind,
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  }
}
