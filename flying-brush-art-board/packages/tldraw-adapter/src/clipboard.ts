import type {
  BoardClipboardPayload,
  ClipboardAsset,
  CopiedBoardReference,
  MaterializedClipboardPatch,
} from '@infinite-board/board-core'

export type {
  BoardClipboardPayload,
  ClipboardAsset,
  CopiedBoardReference,
  MaterializedClipboardPatch,
} from '@infinite-board/board-core'

export interface ClipboardStore {
  allRecords(): readonly Record<string, unknown>[]
}

export interface ClipboardEditor {
  getShapeAndDescendantIds(shapeId: string): ReadonlySet<string>
  store: ClipboardStore
}

export interface ClipboardSourceContext {
  sourceProjectId: string
  sourceBoardId: string
  copiedAt?: string
  assets?: readonly Omit<ClipboardAsset, 'record'>[]
  references?: readonly CopiedBoardReference[]
}

export interface ClipboardTargetContext {
  createId(): string
  targetSnapshot: unknown
  assetBlobs: readonly MaterializedClipboardPatch['assetBlobs'][number][]
}

/** The local binding report is not part of the transferable payload. */
export type CollectedClipboardPayload = BoardClipboardPayload & {
  brokenBindingIds: string[]
}

const clone = <T>(value: T): T => structuredClone(value)

function isShape(record: Record<string, unknown>): boolean {
  return record.typeName === 'shape'
}

function isBinding(record: Record<string, unknown>): boolean {
  return record.typeName === 'binding'
}

export function collectClipboardPayload(
  editor: ClipboardEditor,
  selectedShapeIds: readonly string[],
  sourceContext: ClipboardSourceContext,
): CollectedClipboardPayload {
  const copiedIds = new Set<string>()
  for (const shapeId of selectedShapeIds) {
    for (const id of editor.getShapeAndDescendantIds(shapeId)) copiedIds.add(id)
  }

  const records = editor.store.allRecords()
  const shapes = records.filter((record) => isShape(record) && copiedIds.has(String(record.id))).map(clone)
  const bindings: Record<string, unknown>[] = []
  const brokenBindingIds: string[] = []

  for (const binding of records.filter(isBinding)) {
    const fromId = String(binding.fromId)
    const toId = String(binding.toId)
    if (copiedIds.has(fromId) && copiedIds.has(toId)) {
      bindings.push(clone(binding))
    } else if (copiedIds.has(fromId) || copiedIds.has(toId)) {
      brokenBindingIds.push(String(binding.id))
    }
  }

  const assetIds = new Set(
    shapes.flatMap((shape) => {
      const assetId = (shape.props as { assetId?: unknown } | undefined)?.assetId
      return typeof assetId === 'string' ? [assetId] : []
    }),
  )
  const assetMetadata = new Map(
    (sourceContext.assets ?? []).map((asset) => [asset.assetRecordId, asset]),
  )
  const assetRecordsById = new Map(
    records
      .filter((record) => record.typeName === 'asset' && assetIds.has(String(record.id)))
      .map((record) => [String(record.id), record]),
  )
  const assets = [...assetIds].map((assetId) => {
    const asset = assetMetadata.get(assetId)
    if (!asset) throw new Error(`Missing clipboard asset metadata: ${assetId}`)
    const record = assetRecordsById.get(assetId)
    if (!record) throw new Error(`Missing tldraw asset record for clipboard payload: ${assetId}`)
    return { ...clone(asset), record: clone(record) }
  })

  return {
    version: 1,
    sourceProjectId: sourceContext.sourceProjectId,
    sourceBoardId: sourceContext.sourceBoardId,
    shapes,
    bindings,
    references: (sourceContext.references ?? [])
      .filter((reference) => copiedIds.has(reference.shapeId))
      .map(clone),
    assets,
    copiedAt: sourceContext.copiedAt ?? new Date().toISOString(),
    brokenBindingIds,
  }
}

function remap(value: unknown, idMap: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => remap(item, idMap))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      (key === 'id' || key.endsWith('Id')) && typeof child === 'string' && idMap[child]
        ? idMap[child]
        : remap(child, idMap),
    ]),
  )
}

export function materializeClipboardPayload(
  payload: BoardClipboardPayload,
  targetContext: ClipboardTargetContext,
): MaterializedClipboardPatch {
  const assetRecords = getAssetRecords(payload)
  const idMap: Record<string, string> = {}
  for (const record of [...payload.shapes, ...payload.bindings, ...assetRecords]) {
    idMap[getRecordId(record)] = targetContext.createId()
  }
  const shapes = payload.shapes.map((shape) => remap(shape, idMap) as Record<string, unknown>)
  const bindings = payload.bindings.map((binding) => remap(binding, idMap) as Record<string, unknown>)
  const assets = assetRecords.map((asset) => remap(asset, idMap) as Record<string, unknown>)
  const assetBlobs = materializeAssetBlobs(payload.assets, targetContext.assetBlobs)

  return {
    nextSnapshot: appendRecordsToSnapshot(targetContext.targetSnapshot, [...shapes, ...bindings, ...assets]),
    idMap,
    assetBlobs,
    assetUsages: assetUsages(payload.assets, payload.shapes, idMap),
    // Task 11 owns reference mutation. Preserve candidates, but point them at
    // the freshly materialized shape IDs so its later transaction can consume them.
    referenceCandidates: payload.references.map((reference) => ({
      ...clone(reference),
      shapeId: idMap[reference.shapeId] ?? reference.shapeId,
    })),
  }
}

function getRecordId(record: unknown): string {
  if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') {
    throw new Error('Clipboard payload contains a record without an id')
  }
  return (record as { id: string }).id
}

function getAssetRecords(payload: BoardClipboardPayload): Record<string, unknown>[] {
  const declaredAssetIds = new Set(payload.assets.map((asset) => asset.assetRecordId))
  if (declaredAssetIds.size !== payload.assets.length) {
    throw new Error('Clipboard payload declares duplicate asset metadata')
  }

  const referencedAssetIds = new Set(
    payload.shapes.flatMap((shape) => {
      const assetId = (shape as { props?: { assetId?: unknown } }).props?.assetId
      return typeof assetId === 'string' ? [assetId] : []
    }),
  )
  for (const assetId of referencedAssetIds) {
    if (!declaredAssetIds.has(assetId)) {
      throw new Error(`Clipboard payload is missing declared asset metadata: ${assetId}`)
    }
  }

  return payload.assets.map((asset) => {
    if (!asset.record || typeof asset.record !== 'object' || Array.isArray(asset.record)) {
      throw new Error('Clipboard asset is missing a declared tldraw asset record')
    }
    if (getRecordId(asset.record) !== asset.assetRecordId) {
      throw new Error('Clipboard asset record id does not match asset metadata')
    }
    if (asset.record.typeName !== 'asset') {
      throw new Error('Clipboard asset record must have typeName "asset"')
    }
    return asset.record
  })
}

function materializeAssetBlobs(
  assets: readonly ClipboardAsset[],
  sourceBlobs: readonly MaterializedClipboardPatch['assetBlobs'][number][],
): MaterializedClipboardPatch['assetBlobs'] {
  return assets.map((asset) => {
    const blob = sourceBlobs.find((candidate) => candidate.sha256 === asset.sha256)
    if (!blob || blob.mime !== asset.mime || blob.size !== asset.size) {
      throw new Error(`Missing clipboard asset bytes for hash: ${asset.sha256}`)
    }
    return { ...blob, bytes: blob.bytes.slice() }
  })
}

function assetUsages(
  assets: readonly ClipboardAsset[],
  shapes: readonly unknown[],
  idMap: Record<string, string>,
): MaterializedClipboardPatch['assetUsages'] {
  const assetsById = new Map(assets.map((asset) => [asset.assetRecordId, asset]))
  return shapes.flatMap((shape) => {
    const record = shape as { id?: unknown; props?: { assetId?: unknown } }
    const assetId = record.props?.assetId
    const asset = typeof assetId === 'string' ? assetsById.get(assetId) : undefined
    const shapeId = typeof record.id === 'string' ? idMap[record.id] : undefined
    const assetRecordId = typeof assetId === 'string' ? idMap[assetId] : undefined
    return asset && shapeId && assetRecordId
      ? [{ shapeId, assetRecordId, sha256: asset.sha256 }]
      : []
  })
}

function appendRecordsToSnapshot(snapshot: unknown, records: readonly Record<string, unknown>[]): unknown {
  const nextSnapshot = clone(snapshot)
  if (!nextSnapshot || typeof nextSnapshot !== 'object') {
    throw new Error('Clipboard target snapshot is invalid')
  }
  const snapshotObject = nextSnapshot as {
    store?: Record<string, unknown>
    document?: { store?: Record<string, unknown> }
  }
  const store = snapshotObject.document?.store ?? snapshotObject.store
  if (!store) throw new Error('Clipboard target snapshot has no record store')
  for (const record of records) store[String(record.id)] = record
  return nextSnapshot
}
