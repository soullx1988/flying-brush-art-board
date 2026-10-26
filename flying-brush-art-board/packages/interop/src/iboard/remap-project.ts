import { createHash } from 'node:crypto'

import {
  assertBoardReferenceGraphValid,
  assertProjectNavigationValid,
  type ProjectNavigation,
  type BoardReferenceRecord,
  type StoredBoard,
} from '@infinite-board/board-core'

import { assertIboardReferenceShapesConsistent } from './export-project.js'
import type { IboardPreflightBoard, IboardPreflightResult } from './import-preflight.js'
import type { IboardAssetInputV1 } from './schema-v1.js'

export interface IboardMergeIdMap {
  project: Record<string, string>
  boards: Record<string, string>
  references: Record<string, string>
  recordsByBoard: Record<string, Record<string, string>>
}

export interface IboardMergePlan {
  navigation?: ProjectNavigation
  targetProjectId: string
  importedRootBoardId: string
  boards: IboardPreflightBoard[]
  references: BoardReferenceRecord[]
  assets: IboardAssetInputV1[]
  idMap: IboardMergeIdMap
}

export interface CreateIboardMergePlanOptions {
  targetProjectId: string
  namespace: string
}

const REMAPPED_RECORD_TYPES = new Set(['page', 'shape', 'binding', 'asset'])

function digestId(namespace: string, kind: string, sourceId: string): string {
  const digest = createHash('sha256')
    .update(namespace)
    .update('\0')
    .update(kind)
    .update('\0')
    .update(sourceId)
    .digest('hex')
  return `${kind}:${digest}`
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('IBOARD_BOARD_SNAPSHOT_INVALID')
  }
  const envelope = snapshot as { store?: unknown; document?: { store?: unknown } }
  const store = envelope.document?.store ?? envelope.store
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('IBOARD_BOARD_SNAPSHOT_INVALID')
  }
  return store as Record<string, unknown>
}

function recordMapForBoard(
  namespace: string,
  boardId: string,
  snapshot: unknown,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const value of Object.values(snapshotStore(snapshot))) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as { id?: unknown; typeName?: unknown }
    if (typeof record.id !== 'string' || typeof record.typeName !== 'string') continue
    if (!REMAPPED_RECORD_TYPES.has(record.typeName)) continue
    result[record.id] = digestId(namespace, record.typeName, `${boardId}\0${record.id}`)
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

interface RemapContext {
  localRecords: Record<string, string>
  boards: Record<string, string>
  references: Record<string, string>
  project: Record<string, string>
}

function mappedId(value: string, context: RemapContext): string | undefined {
  return context.localRecords[value]
    ?? context.references[value]
    ?? context.boards[value]
    ?? context.project[value]
}

function remapField(value: string, context: RemapContext): string {
  return mappedId(value, context) ?? value
}

function remapTldrawRecord(value: unknown, context: RemapContext): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(value)
  const record = structuredClone(value) as Record<string, unknown>
  if (typeof record.typeName !== 'string' || !REMAPPED_RECORD_TYPES.has(record.typeName)) return record
  if (typeof record.id === 'string') record.id = remapField(record.id, context)

  if (record.typeName === 'shape') {
    if (typeof record.parentId === 'string') record.parentId = remapField(record.parentId, context)
    if (!record.props || typeof record.props !== 'object' || Array.isArray(record.props)) return record
    const props = record.props as Record<string, unknown>
    if ((record.type === 'image' || record.type === 'video') && typeof props.assetId === 'string') {
      props.assetId = remapField(props.assetId, context)
    }
    if (record.type === 'board-reference') {
      if (typeof props.referenceId === 'string') props.referenceId = remapField(props.referenceId, context)
      if (typeof props.targetBoardId === 'string') props.targetBoardId = remapField(props.targetBoardId, context)
    }
    return record
  }

  if (record.typeName === 'binding') {
    if (typeof record.fromId === 'string') record.fromId = remapField(record.fromId, context)
    if (typeof record.toId === 'string') record.toId = remapField(record.toId, context)
  }
  return record
}

function remapSnapshot(snapshot: unknown, context: RemapContext): unknown {
  const next = structuredClone(snapshot) as {
    store?: Record<string, unknown>
    document?: { store?: Record<string, unknown> }
  }
  const store = next.document?.store ?? next.store
  if (!store) throw new Error('IBOARD_BOARD_SNAPSHOT_INVALID')
  const remappedStore: Record<string, unknown> = {}
  for (const [key, record] of Object.entries(store)) {
    const remappedKey = context.localRecords[key] ?? key
    if (remappedStore[remappedKey]) throw new Error('IBOARD_RECORD_ID_COLLISION')
    remappedStore[remappedKey] = remapTldrawRecord(record, context)
  }
  if (next.document?.store) next.document.store = remappedStore
  else next.store = remappedStore
  return next
}

function storedBoards(boards: readonly IboardPreflightBoard[]): StoredBoard[] {
  return boards.map((board) => ({ ...board, createdAt: '', updatedAt: '' }))
}

export function createIboardMergePlan(
  preflight: IboardPreflightResult,
  options: CreateIboardMergePlanOptions,
): IboardMergePlan {
  if (options.targetProjectId.length === 0 || options.namespace.length === 0) {
    throw new Error('IBOARD_ID_NAMESPACE_INVALID')
  }
  const boardMap = Object.fromEntries(
    preflight.boards
      .map((board) => [board.id, digestId(options.namespace, 'board', board.id)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const referenceMap = Object.fromEntries(
    preflight.references
      .map((reference) => [reference.id, digestId(options.namespace, 'reference', reference.id)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const recordsByBoard = Object.fromEntries(
    preflight.boards.map((board) => [
      board.id,
      recordMapForBoard(options.namespace, board.id, board.tldrawSnapshot),
    ]),
  )
  const projectMap = { [preflight.manifest.projectId]: options.targetProjectId }
  const idMap: IboardMergeIdMap = {
    project: projectMap,
    boards: boardMap,
    references: referenceMap,
    recordsByBoard,
  }

  const boards = preflight.boards.map((board): IboardPreflightBoard => ({
    id: boardMap[board.id]!,
    projectId: options.targetProjectId,
    title: board.title,
    revision: board.revision,
    ...(board.sourceMetadata === undefined ? {} : { sourceMetadata: structuredClone(board.sourceMetadata) }),
    tldrawSnapshot: remapSnapshot(board.tldrawSnapshot, {
      localRecords: recordsByBoard[board.id]!,
      boards: boardMap,
      references: referenceMap,
      project: projectMap,
    }),
  }))
  const references = preflight.references.map((reference): BoardReferenceRecord => ({
    ...reference,
    id: referenceMap[reference.id]!,
    projectId: options.targetProjectId,
    sourceBoardId: boardMap[reference.sourceBoardId]!,
    targetBoardId: boardMap[reference.targetBoardId]!,
    shapeId: recordsByBoard[reference.sourceBoardId]![reference.shapeId]!,
  }))
  const assets = preflight.assets.map((asset): IboardAssetInputV1 => ({
    ...asset,
    bytes: asset.bytes.slice(),
    usages: asset.usages.map((usage) => ({
      boardId: boardMap[usage.boardId]!,
      shapeId: recordsByBoard[usage.boardId]![usage.shapeId]!,
      assetRecordId: recordsByBoard[usage.boardId]![usage.assetRecordId]!,
    })),
  }))

  const remappedStoredBoards = storedBoards(boards)
  const sourceNavigation = preflight.manifest.navigation
  let navigation: ProjectNavigation | undefined
  if (sourceNavigation) {
    assertProjectNavigationValid(sourceNavigation, preflight.boards.map((board) => board.id))
    const topicMap = Object.fromEntries(sourceNavigation.topics.map((topic) => [topic.id, digestId(options.namespace, 'topic', topic.id)]))
    navigation = {
      version: 1, revision: 0,
      topics: sourceNavigation.topics.map((topic) => ({ ...topic, id: topicMap[topic.id]! })),
      parents: Object.fromEntries(Object.entries(sourceNavigation.parents).map(([boardId, parentId]) => [boardMap[boardId]!, topicMap[parentId] ?? boardMap[parentId]!])),
    }
  }
  assertBoardReferenceGraphValid(remappedStoredBoards, references)
  assertIboardReferenceShapesConsistent(remappedStoredBoards, references)

  return {
    targetProjectId: options.targetProjectId,
    ...(navigation ? { navigation } : {}),
    importedRootBoardId: boardMap[preflight.manifest.rootBoardId]!,
    boards,
    references,
    assets,
    idMap,
  }
}
