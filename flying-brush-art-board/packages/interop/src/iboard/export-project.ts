import { createHash } from 'node:crypto'

import {
  assertBoardReferenceGraphValid,
  BoardReferenceGraphError,
  type BoardReferenceRecord,
  type ProjectRecord,
  type StoredBoard,
} from '@infinite-board/board-core'

import { encodeIboardJson, writeIboardArchive, type IboardArchiveEntry } from './archive-writer.js'
import {
  IBOARD_FORMAT,
  IBOARD_FORMAT_VERSION,
  IBOARD_REFERENCES_PATH,
  type IboardAssetDescriptorV1,
  type IboardAssetInputV1,
  type IboardAssetUsageV1,
  type IboardBoardV1,
  type IboardManifestV1,
} from './schema-v1.js'

export interface ExportProjectToIboardInput {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  assets: readonly IboardAssetInputV1[]
}

export type IboardReferenceConsistencyErrorCode =
  | 'BOARD_REFERENCE_SHAPE_MISSING'
  | 'BOARD_REFERENCE_EDGE_MISSING'
  | 'BOARD_REFERENCE_DUPLICATE_SHAPE'
  | 'BOARD_REFERENCE_DUPLICATE_REFERENCE_ID'
  | 'BOARD_REFERENCE_SEMANTICS_MISMATCH'

export class IboardReferenceConsistencyError extends Error {
  constructor(
    readonly code: IboardReferenceConsistencyErrorCode,
    readonly details: { referenceId?: string; shapeId?: string } = {},
  ) {
    super(code)
    this.name = 'IboardReferenceConsistencyError'
  }
}

export class IboardAssetValidationError extends Error {
  readonly code = 'ASSET_HASH_METADATA_MISMATCH'

  constructor(readonly sha256: string) {
    super('ASSET_HASH_METADATA_MISMATCH')
    this.name = 'IboardAssetValidationError'
  }
}

export type IboardAssetUsageValidationErrorCode =
  | 'IBOARD_ASSET_REFERENCE_UNDECLARED'
  | 'IBOARD_ASSET_DESCRIPTOR_ORPHAN'
  | 'IBOARD_ASSET_RECORD_ORPHAN'
  | 'IBOARD_ASSET_USAGE_DUPLICATE'
  | 'IBOARD_ASSET_USAGE_BOARD_NOT_FOUND'
  | 'IBOARD_ASSET_USAGE_SHAPE_MISMATCH'
  | 'IBOARD_ASSET_RECORD_NOT_FOUND'

export class IboardAssetUsageValidationError extends Error {
  constructor(readonly code: IboardAssetUsageValidationErrorCode) {
    super(code)
    this.name = 'IboardAssetUsageValidationError'
  }
}

interface ReferenceShapeSemantics {
  shapeId: string
  referenceId: string
  targetBoardId: string
  kind: string
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('IBOARD_BOARD_SNAPSHOT_INVALID')
  }
  const envelope = snapshot as {
    store?: unknown
    document?: { store?: unknown }
  }
  const store = envelope.document?.store ?? envelope.store
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('IBOARD_BOARD_SNAPSHOT_INVALID')
  }
  return store as Record<string, unknown>
}

function listReferenceShapes(snapshot: unknown): ReferenceShapeSemantics[] {
  return Object.values(snapshotStore(snapshot)).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const record = value as { id?: unknown; typeName?: unknown; type?: unknown; props?: unknown }
    if (record.typeName !== 'shape' || record.type !== 'board-reference') return []
    if (!record.props || typeof record.props !== 'object' || Array.isArray(record.props)) return []
    const props = record.props as { referenceId?: unknown; targetBoardId?: unknown; kind?: unknown }
    if (
      typeof record.id !== 'string' ||
      typeof props.referenceId !== 'string' ||
      typeof props.targetBoardId !== 'string' ||
      typeof props.kind !== 'string'
    ) {
      return []
    }
    return [{
      shapeId: record.id,
      referenceId: props.referenceId,
      targetBoardId: props.targetBoardId,
      kind: props.kind,
    }]
  })
}

export function assertIboardReferenceShapesConsistent(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): void {
  const referencesByBoard = new Map<string, BoardReferenceRecord[]>()
  for (const board of boards) referencesByBoard.set(board.id, [])
  for (const reference of references) referencesByBoard.get(reference.sourceBoardId)?.push(reference)

  for (const board of boards) {
    const shapes = listReferenceShapes(board.tldrawSnapshot)
    const shapesById = new Map<string, ReferenceShapeSemantics>()
    const shapesByReferenceId = new Map<string, ReferenceShapeSemantics>()
    for (const shape of shapes) {
      if (shapesById.has(shape.shapeId)) {
        throw new IboardReferenceConsistencyError('BOARD_REFERENCE_DUPLICATE_SHAPE', { shapeId: shape.shapeId })
      }
      if (shapesByReferenceId.has(shape.referenceId)) {
        throw new IboardReferenceConsistencyError('BOARD_REFERENCE_DUPLICATE_REFERENCE_ID', {
          referenceId: shape.referenceId,
        })
      }
      shapesById.set(shape.shapeId, shape)
      shapesByReferenceId.set(shape.referenceId, shape)
    }

    const expectedReferenceIds = new Set<string>()
    for (const reference of referencesByBoard.get(board.id) ?? []) {
      expectedReferenceIds.add(reference.id)
      const shape = shapesById.get(reference.shapeId)
      if (!shape) {
        throw new IboardReferenceConsistencyError('BOARD_REFERENCE_SHAPE_MISSING', {
          referenceId: reference.id,
          shapeId: reference.shapeId,
        })
      }
      if (
        shape.referenceId !== reference.id ||
        shape.targetBoardId !== reference.targetBoardId ||
        shape.kind !== reference.kind
      ) {
        throw new IboardReferenceConsistencyError('BOARD_REFERENCE_SEMANTICS_MISMATCH', {
          referenceId: reference.id,
          shapeId: reference.shapeId,
        })
      }
    }

    for (const shape of shapes) {
      if (!expectedReferenceIds.has(shape.referenceId)) {
        throw new IboardReferenceConsistencyError('BOARD_REFERENCE_EDGE_MISSING', {
          referenceId: shape.referenceId,
          shapeId: shape.shapeId,
        })
      }
    }
  }
}

function compareUsage(left: IboardAssetUsageV1, right: IboardAssetUsageV1): number {
  const byBoard = left.boardId.localeCompare(right.boardId)
  if (byBoard !== 0) return byBoard
  const byShape = left.shapeId.localeCompare(right.shapeId)
  return byShape !== 0 ? byShape : left.assetRecordId.localeCompare(right.assetRecordId)
}

function assetUsageKey(usage: IboardAssetUsageV1): string {
  return `${usage.boardId}\u0000${usage.shapeId}\u0000${usage.assetRecordId}`
}

function listSnapshotAssetUsages(
  boards: readonly Pick<StoredBoard, 'id' | 'tldrawSnapshot'>[],
): IboardAssetUsageV1[] {
  const usages: IboardAssetUsageV1[] = []
  for (const board of boards) {
    const store = snapshotStore(board.tldrawSnapshot)
    const referencedAssetRecords = new Set<string>()
    for (const value of Object.values(store)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as { id?: unknown; typeName?: unknown; props?: unknown }
      if (record.typeName !== 'shape' || !record.props || typeof record.props !== 'object' || Array.isArray(record.props)) {
        continue
      }
      const assetId = (record.props as { assetId?: unknown }).assetId
      if (assetId === undefined) continue
      if (typeof record.id !== 'string' || typeof assetId !== 'string') {
        throw new IboardAssetUsageValidationError('IBOARD_ASSET_USAGE_SHAPE_MISMATCH')
      }
      const assetRecord = store[assetId] as { typeName?: unknown } | undefined
      if (assetRecord?.typeName !== 'asset') {
        throw new IboardAssetUsageValidationError('IBOARD_ASSET_RECORD_NOT_FOUND')
      }
      referencedAssetRecords.add(assetId)
      usages.push({ boardId: board.id, shapeId: record.id, assetRecordId: assetId })
    }
    for (const [recordId, value] of Object.entries(store)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      if ((value as { typeName?: unknown }).typeName === 'asset' && !referencedAssetRecords.has(recordId)) {
        throw new IboardAssetUsageValidationError('IBOARD_ASSET_RECORD_ORPHAN')
      }
    }
  }
  return usages
}

export function assertIboardAssetUsagesValid(
  assets: readonly Pick<IboardAssetInputV1, 'sha256' | 'usages'>[],
  boards: readonly Pick<StoredBoard, 'id' | 'tldrawSnapshot'>[],
): void {
  const boardsById = new Map(boards.map((board) => [board.id, board]))
  const usageOwners = new Set<string>()
  for (const asset of assets) {
    for (const usage of asset.usages) {
      const usageKey = assetUsageKey(usage)
      if (usageOwners.has(usageKey)) {
        throw new IboardAssetUsageValidationError('IBOARD_ASSET_USAGE_DUPLICATE')
      }
      usageOwners.add(usageKey)
      const board = boardsById.get(usage.boardId)
      if (!board) throw new IboardAssetUsageValidationError('IBOARD_ASSET_USAGE_BOARD_NOT_FOUND')
      const store = snapshotStore(board.tldrawSnapshot)
      const shape = store[usage.shapeId] as { typeName?: unknown; props?: { assetId?: unknown } } | undefined
      const assetRecord = store[usage.assetRecordId] as { typeName?: unknown } | undefined
      if (shape?.typeName !== 'shape' || shape.props?.assetId !== usage.assetRecordId) {
        throw new IboardAssetUsageValidationError('IBOARD_ASSET_USAGE_SHAPE_MISMATCH')
      }
      if (assetRecord?.typeName !== 'asset') {
        throw new IboardAssetUsageValidationError('IBOARD_ASSET_RECORD_NOT_FOUND')
      }
    }
  }

  for (const usage of listSnapshotAssetUsages(boards)) {
    if (!usageOwners.has(assetUsageKey(usage))) {
      throw new IboardAssetUsageValidationError('IBOARD_ASSET_REFERENCE_UNDECLARED')
    }
  }
  if (assets.some((asset) => asset.usages.length === 0)) {
    throw new IboardAssetUsageValidationError('IBOARD_ASSET_DESCRIPTOR_ORPHAN')
  }
}

function validateAssets(assets: readonly IboardAssetInputV1[]): IboardAssetInputV1[] {
  const byHash = new Map<string, IboardAssetInputV1>()
  for (const asset of assets) {
    const actualHash = createHash('sha256').update(asset.bytes).digest('hex')
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      actualHash !== asset.sha256 ||
      asset.size !== asset.bytes.byteLength ||
      asset.mime.length === 0
    ) {
      throw new IboardAssetValidationError(asset.sha256)
    }

    const existing = byHash.get(asset.sha256)
    if (!existing) {
      byHash.set(asset.sha256, {
        ...asset,
        bytes: asset.bytes.slice(),
        usages: [...asset.usages].sort(compareUsage),
      })
      continue
    }
    if (
      existing.mime !== asset.mime ||
      existing.size !== asset.size ||
      Buffer.compare(existing.bytes, asset.bytes) !== 0
    ) {
      throw new IboardAssetValidationError(asset.sha256)
    }
    const usageKeys = new Set(existing.usages.map((usage) => JSON.stringify(usage)))
    const mergedUsages = [...existing.usages]
    for (const usage of asset.usages) {
      const key = JSON.stringify(usage)
      if (!usageKeys.has(key)) {
        usageKeys.add(key)
        mergedUsages.push(usage)
      }
    }
    byHash.set(asset.sha256, { ...existing, usages: mergedUsages.sort(compareUsage) })
  }
  return [...byHash.values()].sort((left, right) => left.sha256.localeCompare(right.sha256))
}

function assertProjectValid(input: ExportProjectToIboardInput): void {
  const boardIds = new Set(input.boards.map((board) => board.id))
  if (!boardIds.has(input.project.rootBoardId)) throw new Error('IBOARD_ROOT_BOARD_NOT_FOUND')
  for (const board of input.boards) {
    if (board.projectId !== input.project.id) {
      throw new BoardReferenceGraphError('BOARD_REFERENCE_CROSS_PROJECT', { boardId: board.id })
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(board.id) || board.id === '.' || board.id === '..') {
      throw new Error('IBOARD_BOARD_ID_UNSAFE')
    }
  }
  assertBoardReferenceGraphValid(input.boards, input.references)
  assertIboardReferenceShapesConsistent(input.boards, input.references)
}

export function exportProjectToIboard(input: ExportProjectToIboardInput): Uint8Array {
  assertProjectValid(input)
  const assets = validateAssets(input.assets)
  assertIboardAssetUsagesValid(assets, input.boards)
  const boards = [...input.boards].sort((left, right) => left.id.localeCompare(right.id))
  const references = [...input.references].sort((left, right) => left.id.localeCompare(right.id))
  const assetDescriptors: IboardAssetDescriptorV1[] = assets.map((asset) => ({
    sha256: asset.sha256,
    path: `assets/${asset.sha256}`,
    mime: asset.mime,
    size: asset.size,
    usages: [...asset.usages],
  }))
  const manifest: IboardManifestV1 = {
    format: IBOARD_FORMAT,
    formatVersion: IBOARD_FORMAT_VERSION,
    projectId: input.project.id,
    title: input.project.title,
    rootBoardId: input.project.rootBoardId,
    boards: boards.map((board) => ({ id: board.id, path: `boards/${board.id}.json` })),
    referencesPath: IBOARD_REFERENCES_PATH,
    assets: assetDescriptors,
  }
  const entries: IboardArchiveEntry[] = [
    { path: 'manifest.json', bytes: encodeIboardJson(manifest) },
    { path: IBOARD_REFERENCES_PATH, bytes: encodeIboardJson(references) },
    ...boards.map((board): IboardArchiveEntry => {
      const payload: IboardBoardV1 = {
        title: board.title,
        revision: board.revision,
        ...(board.sourceMetadata === undefined ? {} : { sourceMetadata: board.sourceMetadata }),
        tldrawSnapshot: board.tldrawSnapshot,
      }
      return { path: `boards/${board.id}.json`, bytes: encodeIboardJson(payload) }
    }),
    ...assets.map((asset) => ({ path: `assets/${asset.sha256}`, bytes: asset.bytes })),
  ]
  return writeIboardArchive(entries)
}
