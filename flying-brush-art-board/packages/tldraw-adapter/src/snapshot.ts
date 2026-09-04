import {
  getIndices,
  getSnapshot,
  loadSnapshot,
  type TLStore,
  type TLStoreSnapshot,
  type TLRecord,
} from 'tldraw'
import { upgradeLegacyInteropShapeRecord } from './migrations.js'

export class UnknownSnapshotRecordError extends Error {
  constructor(recordId: string) {
    super(`Unknown record in board snapshot: ${recordId}`)
    this.name = 'UnknownSnapshotRecordError'
  }
}

function assertNoUnknownRecords(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new UnknownSnapshotRecordError('snapshot')
  }
  const value = snapshot as {
    document?: { store?: Record<string, unknown> }
    store?: Record<string, unknown>
  }
  const records = value.document?.store ?? value.store
  if (!records) return

  for (const [recordId, record] of Object.entries(records)) {
    if (!record || typeof record !== 'object' || !('typeName' in record)) {
      throw new UnknownSnapshotRecordError(recordId)
    }
    const typeName = (record as { typeName?: unknown }).typeName
    if (typeof typeName !== 'string' || !SUPPORTED_RECORD_TYPES.has(typeName)) {
      throw new UnknownSnapshotRecordError(recordId)
    }
    const shapeType = (record as { type?: unknown }).type
    if (typeName === 'shape' && (typeof shapeType !== 'string' || !SUPPORTED_SHAPE_TYPES.has(shapeType))) {
      throw new UnknownSnapshotRecordError(recordId)
    }
  }
}

const SUPPORTED_RECORD_TYPES = new Set(['document', 'page', 'shape', 'asset', 'binding'])
const SUPPORTED_SHAPE_TYPES = new Set([
  'arrow',
  'bookmark',
  'draw',
  'embed',
  'frame',
  'geo',
  'group',
  'highlight',
  'image',
  'line',
  'note',
  'text',
  'video',
  'board-reference',
  'table',
  'mind-map',
  'trading-panel',
])

interface IndexedLegacyRecord {
  recordId: string
  position?: bigint
}

function normalizeLegacyDecimalIndices(
  store: TLStoreSnapshot['store'],
): TLStoreSnapshot['store'] {
  const next = structuredClone(store) as unknown as Record<string, Record<string, unknown>>
  const groups = new Map<string, IndexedLegacyRecord[]>()

  for (const [recordId, record] of Object.entries(next)) {
    const typeName = record.typeName
    if (typeName !== 'page' && typeName !== 'shape') continue
    const groupId = typeName === 'page'
      ? 'pages'
      : typeof record.parentId === 'string'
        ? `shapes:${record.parentId}`
        : `shapes-without-parent:${recordId}`
    const index = typeof record.index === 'string' ? record.index : ''
    const match = /^a(0|[1-9]\d*)$/.exec(index)
    const group = groups.get(groupId) ?? []
    group.push({
      recordId,
      ...(match ? { position: BigInt(match[1]!) } : {}),
    })
    groups.set(groupId, group)
  }

  for (const group of groups.values()) {
    if (group.some((record) => record.position === undefined)) continue
    const positions = new Set(group.map((record) => record.position!.toString()))
    if (positions.size !== group.length) continue
    group.sort((left, right) => left.position! < right.position! ? -1 : 1)
    const indices = getIndices(group.length)
    for (const [position, record] of group.entries()) {
      next[record.recordId]!.index = indices[position]!
    }
  }

  return next as unknown as TLStoreSnapshot['store']
}

export function loadSnapshotIntoStore(store: TLStore, snapshot: unknown): void {
  assertNoUnknownRecords(snapshot)
  try {
    const value = snapshot as {
      store?: TLStoreSnapshot['store']
      schema?: TLStoreSnapshot['schema']
      document?: {
        store?: TLStoreSnapshot['store']
        schema?: TLStoreSnapshot['schema']
      }
    }
    // Older Board snapshots deliberately stored only document records. Keep
    // both store snapshots and editor snapshot envelopes readable by adding
    // schema metadata at the same level as the records that tldraw will load.
    const documentSchema = value.document?.schema
    const sourceRecords = value.document?.store ?? value.store
    let upgraded = false
    const upgradedStore = sourceRecords
      ? Object.fromEntries(Object.entries(sourceRecords).map(([id, record]) => {
          const result = upgradeLegacyInteropShapeRecord(record)
          upgraded ||= result.upgraded
          return [id, result.record]
        })) as TLStoreSnapshot['store']
      : undefined
    const normalized = value.document?.store
      ? {
          store: documentSchema
            ? upgradedStore!
            : normalizeLegacyDecimalIndices(upgradedStore!),
          schema: upgraded ? store.schema.serialize() : (documentSchema ?? store.schema.serialize()),
        }
      : value.store
        ? {
          store: value.schema
              ? upgradedStore!
              : normalizeLegacyDecimalIndices(upgradedStore!),
            schema: upgraded ? store.schema.serialize() : (value.schema ?? store.schema.serialize()),
          }
        : value
    loadSnapshot(store, normalized as TLStoreSnapshot)
  } catch (error) {
    throw new UnknownSnapshotRecordError(
      error instanceof Error ? error.message : 'unreadable snapshot',
    )
  }
}

export function getStoreSnapshot(store: TLStore): TLStoreSnapshot {
  const persistedRecords = store
    .allRecords()
    .filter((record) =>
      ['document', 'page', 'shape', 'asset', 'binding'].includes(record.typeName),
    )
  const records: TLRecord[] = persistedRecords.length
    ? persistedRecords
    : ([
        {
          id: 'document:document',
          name: '',
          gridSize: 10,
          meta: {},
          typeName: 'document' as const,
        },
        {
          id: 'page:page',
          name: 'Page 1',
          index: 'a1',
          meta: {},
          typeName: 'page' as const,
        },
      ] as unknown as TLRecord[])
  return {
    store: Object.fromEntries(records.map((record) => [record.id, record])),
    schema: store.schema.serialize(),
  }
}
