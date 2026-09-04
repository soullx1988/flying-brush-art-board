import { createHash } from 'node:crypto'

import type {
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'
import { tinyPngFixture } from '../media.js'

export interface ReferenceGraphProjectAsset {
  sha256: string
  mime: string
  size: number
  bytes: Uint8Array
  usages: Array<{
    boardId: string
    shapeId: string
    assetRecordId: string
  }>
}

export interface ReferenceGraphProjectFixture {
  project: ProjectRecord
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
  assets: ReferenceGraphProjectAsset[]
}

const timestamp = '2026-07-22T00:00:00.000Z'

function referenceShape(reference: BoardReferenceRecord): Record<string, unknown> {
  return {
    id: reference.shapeId,
    typeName: 'shape',
    type: 'board-reference',
    parentId: `page:${reference.sourceBoardId}`,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      w: 300,
      h: 168,
      referenceId: reference.id,
      targetBoardId: reference.targetBoardId,
      kind: reference.kind,
      titleFallback: reference.targetBoardId,
    },
  }
}

function board(
  id: string,
  title: string,
  references: readonly BoardReferenceRecord[],
  records: readonly Record<string, unknown>[] = [],
): StoredBoard {
  const page = {
    id: `page:${id}`,
    typeName: 'page',
    name: title,
    index: 'a1',
    meta: {},
  }
  const store = Object.fromEntries(
    [page, ...records, ...references.map(referenceShape)].map((record) => [String(record.id), record]),
  )
  return {
    id,
    projectId: 'project-source',
    title,
    revision: 7,
    sourceMetadata: {
      kind: 'native',
      importedAt: timestamp,
      sourceId: `external:${id}`,
    },
    tldrawSnapshot: {
      store,
      schema: { schemaVersion: 2, storeVersion: 4, recordVersions: {} },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
  kind: 'embed' | 'link',
): BoardReferenceRecord {
  return {
    id,
    projectId: 'project-source',
    sourceBoardId,
    targetBoardId,
    shapeId: `shape:${id}`,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createReferenceGraphProjectFixture(): ReferenceGraphProjectFixture {
  const references = [
    reference('ref-a-b', 'board-a', 'board-b', 'embed'),
    reference('ref-a-c', 'board-a', 'board-c', 'embed'),
    reference('ref-b-d', 'board-b', 'board-d', 'embed'),
    reference('ref-c-d', 'board-c', 'board-d', 'embed'),
    reference('ref-d-a-link', 'board-d', 'board-a', 'link'),
    reference('ref-a-a-link', 'board-a', 'board-a', 'link'),
  ]
  const assetBytes = tinyPngFixture
  const sha256 = createHash('sha256').update(assetBytes).digest('hex')
  const imageShape = {
    id: 'shape:image-a',
    typeName: 'shape',
    type: 'image',
    parentId: 'page:board-a',
    index: 'a0',
    props: { assetId: 'asset:image-a', w: 20, h: 20 },
    meta: {},
  }
  const assetRecord = {
    id: 'asset:image-a',
    typeName: 'asset',
    type: 'image',
    props: {
      src: `/api/assets/${sha256}`,
      name: 'fixture.png',
      mimeType: 'image/png',
      externalToken: 'asset-token-must-not-change',
    },
    meta: { sourcePayload: { id: 'shape:image-a', boardId: 'board-a' } },
  }
  const binding = {
    id: 'binding:image-to-ref',
    typeName: 'binding',
    type: 'arrow',
    fromId: 'shape:image-a',
    toId: 'shape:ref-a-b',
    props: {},
    meta: {},
  }

  return {
    project: {
      id: 'project-source',
      title: 'Reference graph fixture',
      rootBoardId: 'board-a',
      formatVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    boards: [
      board('board-d', 'D', references.filter((item) => item.sourceBoardId === 'board-d')),
      board('board-b', 'B', references.filter((item) => item.sourceBoardId === 'board-b')),
      board('board-a', 'A', references.filter((item) => item.sourceBoardId === 'board-a'), [
        imageShape,
        assetRecord,
        binding,
      ]),
      board('board-c', 'C', references.filter((item) => item.sourceBoardId === 'board-c')),
    ],
    references: [...references].reverse(),
    assets: [{
      sha256,
      mime: 'image/png',
      size: assetBytes.byteLength,
      bytes: assetBytes,
      usages: [{ boardId: 'board-a', shapeId: 'shape:image-a', assetRecordId: 'asset:image-a' }],
    }],
  }
}
