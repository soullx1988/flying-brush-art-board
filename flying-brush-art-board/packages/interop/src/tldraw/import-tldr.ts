import {
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  createTLStore,
  parseTldrawJsonFile,
  toRichText,
  type TLEditorSnapshot,
  type TLStoreSnapshot,
} from 'tldraw'
import {
  createTLSchema,
  defaultShapeSchemas,
} from '@tldraw/tlschema'
import { z } from 'zod'

import {
  createImportCompatibilityReport,
  type ImportCompatibilityIssue,
  type ImportResult,
} from '../scene/compatibility-report.js'

export const MAX_TLDR_SHAPES = 10_000

export type TldrImportErrorCode = 'TLDR_INVALID' | 'TLDR_SCHEMA_UNSUPPORTED' | 'TLDR_LIMIT_EXCEEDED'

export class TldrImportError extends Error {
  readonly code: TldrImportErrorCode

  constructor(code: TldrImportErrorCode, message: string) {
    super(message)
    this.name = 'TldrImportError'
    this.code = code
  }
}

const tldrFileSchema = z.object({
  tldrawFileFormatVersion: z.number().int(),
  schema: z.unknown().refine((value) => Boolean(value && typeof value === 'object'), 'schema is required'),
  records: z.array(z.record(z.string(), z.unknown())),
}).loose()

const boardReferenceShapeProps = {
  w: T.number,
  h: T.number,
  referenceId: T.string,
  targetBoardId: T.string,
  kind: T.literalEnum('embed', 'link'),
  titleFallback: T.string,
  thumbnailAssetId: T.string.optional(),
  previewMode: T.literalEnum('content', 'private').optional(),
}

const boardReferenceMigrationIds = createShapePropsMigrationIds('board-reference', {
  AddPreviewMode: 1,
})
const boardReferenceMigrations = createShapePropsMigrationSequence({
  sequence: [{
    id: boardReferenceMigrationIds.AddPreviewMode,
    up: (props) => {
      if (props.previewMode === undefined) props.previewMode = 'content'
    },
    down: (props) => {
      delete props.previewMode
    },
  }],
})

const tableShapeProps = {
  w: T.number,
  h: T.number,
  columns: T.arrayOf(T.object({ id: T.string, width: T.number })),
  rows: T.arrayOf(T.object({
    id: T.string,
    height: T.number,
    cells: T.arrayOf(T.object({
      id: T.string,
      text: T.string,
      align: T.literalEnum('left', 'center', 'right').optional(),
      background: T.literalEnum('none', 'gray', 'blue', 'yellow', 'green', 'red').optional(),
      border: T.literalEnum('light', 'strong', 'none').optional(),
      header: T.boolean.optional(),
      fontSize: T.number.optional(),
      textColor: T.literalEnum('default', 'gray', 'red', 'orange', 'green', 'blue', 'purple').optional(),
    })),
  })),
}

const mindMapShapeProps = {
  w: T.number,
  h: T.number,
  layout: T.literalEnum('right', 'bilateral'),
  nodes: T.arrayOf(T.object({
    id: T.string,
    parentId: T.string.nullable(),
    text: T.string,
    order: T.number,
    side: T.literalEnum('left', 'right'),
    collapsed: T.boolean,
  })),
}

const importSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    'board-reference': {
      props: boardReferenceShapeProps,
      migrations: boardReferenceMigrations,
    },
    table: { props: tableShapeProps, migrations: { sequence: [] } },
    'mind-map': { props: mindMapShapeProps, migrations: { sequence: [] } },
  },
})

const SUPPORTED_SHAPE_TYPES = new Set([
  ...Object.keys(defaultShapeSchemas),
  'board-reference',
  'table',
  'mind-map',
])

function visualCardProps(text: string) {
  return {
    w: 280,
    h: 140,
    geo: 'rectangle',
    color: 'blue',
    fill: 'solid',
    dash: 'draw',
    growY: 0,
    url: '',
    scale: 1,
    size: 'm',
    font: 'draw',
    align: 'middle',
    verticalAlign: 'middle',
    labelColor: 'black',
    richText: toRichText(text),
  }
}

function visualCardRecord(
  record: Record<string, unknown>,
  text: string,
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: record.id,
    typeName: 'shape',
    type: 'geo',
    parentId: record.parentId,
    index: record.index,
    x: typeof record.x === 'number' ? record.x : 0,
    y: typeof record.y === 'number' ? record.y : 0,
    rotation: typeof record.rotation === 'number' ? record.rotation : 0,
    isLocked: record.isLocked === true,
    opacity: typeof record.opacity === 'number' ? record.opacity : 1,
    props: visualCardProps(text),
    meta,
  }
}

function sanitizeRecords(records: readonly Record<string, unknown>[]) {
  const issues: ImportCompatibilityIssue[] = []
  let downgradedElementCount = 0
  let unsupportedElementCount = 0
  const sanitized = records.map((record) => {
    if (record.typeName !== 'shape' || typeof record.type !== 'string') return structuredClone(record)
    const props = record.props && typeof record.props === 'object'
      ? record.props as Record<string, unknown>
      : {}
    if (record.type === 'board-reference') {
      downgradedElementCount += 1
      issues.push({
        code: 'BOARD_REFERENCE_DOWNGRADED',
        message: 'The .tldr format has no project reference graph; the board reference was imported as a visual card.',
        severity: 'warning',
        ...(typeof record.id === 'string' ? { elementId: record.id } : {}),
        sourceType: 'board-reference',
      })
      const title = typeof props.titleFallback === 'string' ? props.titleFallback : 'Linked board'
      return visualCardRecord(record, title)
    }
    if (!SUPPORTED_SHAPE_TYPES.has(record.type)) {
      unsupportedElementCount += 1
      issues.push({
        code: 'UNSUPPORTED_ELEMENT',
        message: `Unsupported tldraw shape was retained as a visual card: ${record.type}`,
        severity: 'warning',
        ...(typeof record.id === 'string' ? { elementId: record.id } : {}),
        sourceType: record.type,
      })
      return visualCardRecord(record, `Unsupported: ${record.type}`, {
        sourcePayload: structuredClone(record),
      })
    }
    return structuredClone(record)
  })
  return { sanitized, issues, downgradedElementCount, unsupportedElementCount }
}

function digestBytes(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

const REMAPPED_RECORD_TYPES = new Set(['page', 'shape', 'binding', 'asset'])

function remappedRecordId(typeName: string, namespace: string, sourceId: string): string {
  const bytes = new TextEncoder().encode(`${namespace}\0${typeName}\0${sourceId}`)
  return `${typeName}:${digestBytes(bytes)}`
}

function remapRecord(
  source: unknown,
  idMap: Readonly<Record<string, string>>,
): unknown {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return structuredClone(source)
  const record = structuredClone(source) as Record<string, unknown>
  if (typeof record.typeName !== 'string' || !REMAPPED_RECORD_TYPES.has(record.typeName)) return record
  if (typeof record.id === 'string') record.id = idMap[record.id] ?? record.id
  if (record.typeName === 'shape') {
    if (typeof record.parentId === 'string') record.parentId = idMap[record.parentId] ?? record.parentId
    if (record.props && typeof record.props === 'object' && !Array.isArray(record.props)) {
      const props = record.props as Record<string, unknown>
      if ((record.type === 'image' || record.type === 'video') && typeof props.assetId === 'string') {
        props.assetId = idMap[props.assetId] ?? props.assetId
      }
    }
  }
  if (record.typeName === 'binding') {
    if (typeof record.fromId === 'string') record.fromId = idMap[record.fromId] ?? record.fromId
    if (typeof record.toId === 'string') record.toId = idMap[record.toId] ?? record.toId
  }
  return record
}

function remapSnapshot(snapshot: TLStoreSnapshot, namespace: string): TLStoreSnapshot {
  const idMap: Record<string, string> = {}
  for (const record of Object.values(snapshot.store) as unknown as Array<Record<string, unknown>>) {
    if (
      typeof record.id === 'string'
      && typeof record.typeName === 'string'
      && REMAPPED_RECORD_TYPES.has(record.typeName)
    ) {
      idMap[record.id] = remappedRecordId(record.typeName, namespace, record.id)
    }
  }

  const store: Record<string, unknown> = {}
  for (const [sourceId, record] of Object.entries(snapshot.store)) {
    const nextId = idMap[sourceId] ?? sourceId
    if (store[nextId]) throw new TldrImportError('TLDR_INVALID', `Record id collision after migration: ${sourceId}`)
    store[nextId] = remapRecord(record, idMap)
  }
  return { store, schema: snapshot.schema } as TLStoreSnapshot
}

export function importTldr(bytes: Uint8Array): ImportResult<TLEditorSnapshot> {
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new TldrImportError('TLDR_INVALID', 'Invalid .tldr JSON')
  }

  const parsedFile = tldrFileSchema.safeParse(json)
  if (!parsedFile.success) {
    throw new TldrImportError('TLDR_SCHEMA_UNSUPPORTED', 'Invalid or unsupported .tldr schema')
  }
  if (parsedFile.data.tldrawFileFormatVersion !== 1) {
    throw new TldrImportError(
      'TLDR_SCHEMA_UNSUPPORTED',
      `Unsupported .tldr file version: ${parsedFile.data.tldrawFileFormatVersion}`,
    )
  }
  const shapeCount = parsedFile.data.records.filter((record) => record.typeName === 'shape').length
  if (shapeCount > MAX_TLDR_SHAPES) {
    throw new TldrImportError('TLDR_LIMIT_EXCEEDED', `The .tldr file contains more than ${MAX_TLDR_SHAPES} shapes`)
  }

  const sanitized = sanitizeRecords(parsedFile.data.records)
  const controlledFile = {
    ...parsedFile.data,
    records: sanitized.sanitized,
  }
  const parsed = parseTldrawJsonFile({
    schema: importSchema,
    json: JSON.stringify(controlledFile),
  })
  if (!parsed.ok) {
    const cause = 'cause' in parsed.error ? parsed.error.cause : undefined
    const detail = cause instanceof Error ? `: ${cause.message}` : ''
    throw new TldrImportError(
      'TLDR_SCHEMA_UNSUPPORTED',
      `Unable to migrate .tldr schema (${parsed.error.type})${detail}`,
    )
  }

  const namespace = digestBytes(bytes)
  const document = remapSnapshot(parsed.value.getStoreSnapshot(), namespace)
  return {
    value: {
      document,
      session: {} as TLEditorSnapshot['session'],
    },
    report: createImportCompatibilityReport({
      issues: sanitized.issues,
      unsupportedElementCount: sanitized.unsupportedElementCount,
      downgradedElementCount: sanitized.downgradedElementCount,
      migrations: ['tldraw-5.2.5-controlled-migration', 'record-id-remap'],
    }),
  }
}
