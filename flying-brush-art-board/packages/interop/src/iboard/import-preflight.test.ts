import { createReferenceGraphProjectFixture } from '../../../test-fixtures/src/iboard/reference-graph-project.js'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import * as interop from '../index.js'

type Fixture = ReturnType<typeof createReferenceGraphProjectFixture>

interface PreflightBoard {
  id: string
  projectId: string
  title: string
  revision: number
  sourceMetadata?: { kind: string; importedAt: string; sourceId?: string }
  tldrawSnapshot: unknown
}

interface PreflightResult {
  manifest: {
    projectId: string
    title: string
    rootBoardId: string
  }
  boards: PreflightBoard[]
  references: Fixture['references']
  assets: Array<Fixture['assets'][number]>
}

interface MergePlan {
  targetProjectId: string
  importedRootBoardId: string
  boards: PreflightBoard[]
  references: Fixture['references']
  assets: Array<Fixture['assets'][number]>
  idMap: {
    project: Record<string, string>
    boards: Record<string, string>
    references: Record<string, string>
    recordsByBoard: Record<string, Record<string, string>>
  }
}

interface ImportApi {
  exportProjectToIboard(input: Fixture): Uint8Array
  preflightIboardImport(
    archive: Uint8Array,
    limits?: {
      maxFileCount?: number
      maxEntryBytes?: number
      maxUncompressedBytes?: number
    },
  ): PreflightResult
  createIboardMergePlan(
    preflight: PreflightResult,
    options: { targetProjectId: string; namespace: string },
  ): MergePlan
  encodeIboardJson(value: unknown): Uint8Array
  writeIboardArchive(entries: Array<{ path: string; bytes: Uint8Array }>): Uint8Array
}

const api = interop as unknown as ImportApi
const decoder = new TextDecoder()

function validArchive(): Uint8Array {
  return api.exportProjectToIboard(structuredClone(createReferenceGraphProjectFixture()))
}

function mutateArchive(
  archive: Uint8Array,
  mutate: (entries: Record<string, Uint8Array>) => void,
): Uint8Array {
  const entries = unzipSync(archive)
  mutate(entries)
  return api.writeIboardArchive(
    Object.entries(entries).map(([path, bytes]) => ({ path, bytes })),
  )
}

function readJson(entries: Record<string, Uint8Array>, path: string): any {
  const bytes = entries[path]
  if (!bytes) throw new Error(`Missing ${path}`)
  return JSON.parse(decoder.decode(bytes))
}

function writeJson(entries: Record<string, Uint8Array>, path: string, value: unknown): void {
  entries[path] = api.encodeIboardJson(value)
}

function setUint32LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function archiveWithOversizedCentralDirectoryEntry(): Uint8Array {
  const archive = api.writeIboardArchive([{ path: 'payload', bytes: new Uint8Array([1]) }])
  const centralDirectoryOffset = archive.findIndex((_, index) => (
    archive[index] === 0x50 &&
    archive[index + 1] === 0x4b &&
    archive[index + 2] === 0x01 &&
    archive[index + 3] === 0x02
  ))
  if (centralDirectoryOffset < 0) throw new Error('Missing ZIP central directory')
  // An unsupported compressor makes the old eager inflater fail without allocating the forged size.
  archive[centralDirectoryOffset + 10] = 99
  archive[centralDirectoryOffset + 11] = 0
  setUint32LittleEndian(archive, centralDirectoryOffset + 24, 64 * 1024 * 1024)
  return archive
}

describe('preflightIboardImport', () => {
  it('loads each declared board once with the full reference graph and verified asset bytes', () => {
    const fixture = createReferenceGraphProjectFixture()
    const result = api.preflightIboardImport(validArchive())

    expect(result.manifest).toMatchObject({
      projectId: fixture.project.id,
      title: fixture.project.title,
      rootBoardId: fixture.project.rootBoardId,
    })
    expect(result.boards.map((board) => board.id)).toEqual(['board-a', 'board-b', 'board-c', 'board-d'])
    expect(new Set(result.boards.map((board) => board.id)).size).toBe(result.boards.length)
    expect(result.boards.every((board) => board.projectId === fixture.project.id)).toBe(true)
    expect(result.references.map((reference) => reference.id)).toEqual(
      [...fixture.references].sort((left, right) => left.id.localeCompare(right.id)).map((reference) => reference.id),
    )
    expect(result.assets).toEqual(fixture.assets)
  })

  it.each([
    ['dangling targets', (entries: Record<string, Uint8Array>) => {
      const references = readJson(entries, 'references.json')
      references[0].targetBoardId = 'missing-board'
      writeJson(entries, 'references.json', references)
    }, 'BOARD_REFERENCE_TARGET_NOT_FOUND'],
    ['cross-project references', (entries: Record<string, Uint8Array>) => {
      const references = readJson(entries, 'references.json')
      references[0].projectId = 'other-project'
      writeJson(entries, 'references.json', references)
    }, 'BOARD_REFERENCE_CROSS_PROJECT'],
    ['duplicate reference ids', (entries: Record<string, Uint8Array>) => {
      const references = readJson(entries, 'references.json')
      references[1].id = references[0].id
      writeJson(entries, 'references.json', references)
    }, 'BOARD_REFERENCE_DUPLICATE_ID'],
    ['duplicate source-board shape pairs', (entries: Record<string, Uint8Array>) => {
      const references = readJson(entries, 'references.json')
      references[1].sourceBoardId = references[0].sourceBoardId
      references[1].shapeId = references[0].shapeId
      writeJson(entries, 'references.json', references)
    }, 'BOARD_REFERENCE_DUPLICATE_SHAPE'],
    ['embed cycles', (entries: Record<string, Uint8Array>) => {
      const references = readJson(entries, 'references.json')
      const edge = references.find((reference: { id: string }) => reference.id === 'ref-d-a-link')
      edge.kind = 'embed'
      writeJson(entries, 'references.json', references)
      const board = readJson(entries, 'boards/board-d.json')
      board.tldrawSnapshot.store[edge.shapeId].props.kind = 'embed'
      writeJson(entries, 'boards/board-d.json', board)
    }, 'EMBED_CYCLE'],
  ])('rejects %s during preflight', (_name, mutate, code) => {
    const archive = mutateArchive(validArchive(), mutate)

    expect(() => api.preflightIboardImport(archive)).toThrow(code)
  })

  it('rejects duplicate board declarations, unsafe paths, missing resources, and asset tampering', () => {
    const duplicateBoard = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      manifest.boards.push({ ...manifest.boards[0] })
      writeJson(entries, 'manifest.json', manifest)
    })
    expect(() => api.preflightIboardImport(duplicateBoard)).toThrow('IBOARD_BOARD_DUPLICATE_ID')

    const unsafePath = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      manifest.boards[0].path = '../board-a.json'
      writeJson(entries, 'manifest.json', manifest)
    })
    expect(() => api.preflightIboardImport(unsafePath)).toThrow('IBOARD_ARCHIVE_PATH_UNSAFE')

    const missingAsset = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      delete entries[manifest.assets[0].path]
    })
    expect(() => api.preflightIboardImport(missingAsset)).toThrow('IBOARD_ARCHIVE_ENTRY_MISSING')

    const tamperedAsset = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      entries[manifest.assets[0].path]![0] = 0
    })
    expect(() => api.preflightIboardImport(tamperedAsset)).toThrow('ASSET_HASH_METADATA_MISMATCH')

    const wrongMimeMetadata = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      manifest.assets[0].size += 1
      writeJson(entries, 'manifest.json', manifest)
    })
    expect(() => api.preflightIboardImport(wrongMimeMetadata)).toThrow('ASSET_HASH_METADATA_MISMATCH')
  })

  it('rejects undeclared snapshot asset references and orphan asset records', () => {
    const missingDescriptor = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      delete entries[manifest.assets[0].path]
      manifest.assets = []
      writeJson(entries, 'manifest.json', manifest)
    })
    expect(() => api.preflightIboardImport(missingDescriptor)).toThrow('IBOARD_ASSET_REFERENCE_UNDECLARED')

    const orphanAssetRecord = mutateArchive(validArchive(), (entries) => {
      const board = readJson(entries, 'boards/board-a.json')
      board.tldrawSnapshot.store['asset:orphan'] = {
        id: 'asset:orphan',
        typeName: 'asset',
        type: 'image',
        props: {},
        meta: {},
      }
      writeJson(entries, 'boards/board-a.json', board)
    })
    expect(() => api.preflightIboardImport(orphanAssetRecord)).toThrow('IBOARD_ASSET_RECORD_ORPHAN')
  })

  it('rejects an archive asset descriptor with no snapshot usage', () => {
    const archive = mutateArchive(validArchive(), (entries) => {
      const manifest = readJson(entries, 'manifest.json')
      manifest.assets[0].usages = []
      const board = readJson(entries, 'boards/board-a.json')
      delete board.tldrawSnapshot.store['shape:image-a']
      delete board.tldrawSnapshot.store['asset:image-a']
      writeJson(entries, 'manifest.json', manifest)
      writeJson(entries, 'boards/board-a.json', board)
    })

    expect(() => api.preflightIboardImport(archive)).toThrow('IBOARD_ASSET_DESCRIPTOR_ORPHAN')
  })

  it('rejects an oversized central-directory entry before attempting to inflate it', () => {
    expect(() => api.preflightIboardImport(archiveWithOversizedCentralDirectoryEntry(), {
      maxUncompressedBytes: 1024,
    })).toThrow('IBOARD_ARCHIVE_SIZE_LIMIT_EXCEEDED')
  })

  it('enforces the published archive file-count, single-entry, and total-size limits', () => {
    expect(interop.DEFAULT_IBOARD_MAX_ARCHIVE_BYTES).toBe(256 * 1024 * 1024)
    expect(interop.DEFAULT_IBOARD_MAX_FILE_COUNT).toBe(1_000)
    expect(interop.DEFAULT_IBOARD_MAX_ENTRY_BYTES).toBe(100 * 1024 * 1024)
    expect(interop.DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES).toBe(512 * 1024 * 1024)

    const tooManyEntries = api.writeIboardArchive(
      Array.from({ length: 1_001 }, (_, index) => ({
        path: `entry-${index}`,
        bytes: new Uint8Array([index % 255]),
      })),
    )
    expect(() => api.preflightIboardImport(tooManyEntries)).toThrow(
      'IBOARD_ARCHIVE_FILE_LIMIT_EXCEEDED',
    )

    const oversizedEntry = api.writeIboardArchive([
      { path: 'entry', bytes: new Uint8Array(2_048) },
    ])
    expect(() => api.preflightIboardImport(oversizedEntry, { maxEntryBytes: 1_024 })).toThrow(
      'IBOARD_ARCHIVE_ENTRY_SIZE_LIMIT_EXCEEDED',
    )
  })

  it('rejects edge/reference-shape divergence before producing a merge plan', () => {
    const missingShape = mutateArchive(validArchive(), (entries) => {
      const board = readJson(entries, 'boards/board-a.json')
      delete board.tldrawSnapshot.store['shape:ref-a-b']
      writeJson(entries, 'boards/board-a.json', board)
    })
    expect(() => api.preflightIboardImport(missingShape)).toThrow('BOARD_REFERENCE_SHAPE_MISSING')

    const orphanShape = mutateArchive(validArchive(), (entries) => {
      const references = readJson(entries, 'references.json')
      writeJson(entries, 'references.json', references.filter((reference: { id: string }) => reference.id !== 'ref-a-b'))
    })
    expect(() => api.preflightIboardImport(orphanShape)).toThrow('BOARD_REFERENCE_EDGE_MISSING')
  })

  it('rejects an embed graph whose longest path contains eleven boards', () => {
    const fixture = createReferenceGraphProjectFixture()
    fixture.boards = []
    fixture.references = []
    fixture.assets = []
    for (let index = 1; index <= 11; index += 1) {
      const id = `board-${index}`
      const reference = index < 11
        ? {
            id: `ref-${index}`,
            projectId: fixture.project.id,
            sourceBoardId: id,
            targetBoardId: `board-${index + 1}`,
            shapeId: `shape:ref-${index}`,
            kind: 'link' as const,
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:00.000Z',
          }
        : undefined
      fixture.boards.push({
        id,
        projectId: fixture.project.id,
        title: id,
        revision: 1,
        tldrawSnapshot: {
          store: reference
            ? {
                [reference.shapeId]: {
                  id: reference.shapeId,
                  typeName: 'shape',
                  type: 'board-reference',
                  props: {
                    referenceId: reference.id,
                    targetBoardId: reference.targetBoardId,
                    kind: reference.kind,
                  },
                },
              }
            : {},
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      })
      if (reference) fixture.references.push(reference)
    }
    fixture.project.rootBoardId = 'board-1'
    const archive = api.exportProjectToIboard(fixture)
    const tooDeep = mutateArchive(archive, (entries) => {
      const references = readJson(entries, 'references.json')
      for (const reference of references) {
        reference.kind = 'embed'
        const board = readJson(entries, `boards/${reference.sourceBoardId}.json`)
        board.tldrawSnapshot.store[reference.shapeId].props.kind = 'embed'
        writeJson(entries, `boards/${reference.sourceBoardId}.json`, board)
      }
      writeJson(entries, 'references.json', references)
    })

    expect(() => api.preflightIboardImport(tooDeep)).toThrow('EMBED_DEPTH_LIMIT_EXCEEDED')
  })
})

describe('createIboardMergePlan', () => {
  it('deterministically remaps project, board, reference, and board-local tldraw IDs', () => {
    const preflight = api.preflightIboardImport(validArchive())
    const first = api.createIboardMergePlan(preflight, {
      targetProjectId: 'project-target',
      namespace: 'import-session-1',
    })
    const second = api.createIboardMergePlan(preflight, {
      targetProjectId: 'project-target',
      namespace: 'import-session-1',
    })
    const independent = api.createIboardMergePlan(preflight, {
      targetProjectId: 'project-target',
      namespace: 'import-session-2',
    })

    expect(first).toEqual(second)
    expect(first.idMap.project).toEqual({ 'project-source': 'project-target' })
    expect(first.importedRootBoardId).toBe(first.idMap.boards['board-a'])
    expect(first.boards).toHaveLength(preflight.boards.length)
    expect(new Set(first.boards.map((board) => board.id)).size).toBe(first.boards.length)
    expect(first.boards.every((board) => board.projectId === 'project-target')).toBe(true)
    expect(independent.boards.map((board) => board.id)).not.toEqual(first.boards.map((board) => board.id))

    const sourceReference = preflight.references.find((reference) => reference.id === 'ref-a-b')!
    const remappedReference = first.references.find(
      (reference) => reference.id === first.idMap.references[sourceReference.id],
    )!
    expect(remappedReference).toMatchObject({
      projectId: 'project-target',
      sourceBoardId: first.idMap.boards[sourceReference.sourceBoardId],
      targetBoardId: first.idMap.boards[sourceReference.targetBoardId],
      shapeId: first.idMap.recordsByBoard[sourceReference.sourceBoardId]![sourceReference.shapeId],
      kind: sourceReference.kind,
    })

    const sourceBoard = preflight.boards.find((board) => board.id === 'board-a')!
    const remappedBoard = first.boards.find((board) => board.id === first.idMap.boards[sourceBoard.id])!
    const sourceStore = (sourceBoard.tldrawSnapshot as { store: Record<string, any> }).store
    const remappedStore = (remappedBoard.tldrawSnapshot as { store: Record<string, any> }).store
    const boardRecordMap = first.idMap.recordsByBoard[sourceBoard.id]!
    const bindingId = boardRecordMap['binding:image-to-ref']!
    const imageShapeId = boardRecordMap['shape:image-a']!
    const referenceShapeId = boardRecordMap['shape:ref-a-b']!
    const assetRecordId = boardRecordMap['asset:image-a']!
    expect(Object.keys(remappedStore).sort()).toEqual(Object.values(boardRecordMap).sort())
    expect(remappedStore[bindingId]).toMatchObject({
      id: bindingId,
      fromId: imageShapeId,
      toId: referenceShapeId,
    })
    expect(remappedStore[imageShapeId].props.assetId).toBe(assetRecordId)
    expect(remappedStore[referenceShapeId].props).toMatchObject({
      referenceId: first.idMap.references['ref-a-b'],
      targetBoardId: first.idMap.boards['board-b'],
      kind: 'embed',
    })
    expect(remappedStore[assetRecordId].props.externalToken).toBe(
      sourceStore['asset:image-a'].props.externalToken,
    )
    expect(remappedStore[assetRecordId].meta.sourcePayload).toEqual(
      sourceStore['asset:image-a'].meta.sourcePayload,
    )
    expect(remappedBoard.sourceMetadata).toEqual(sourceBoard.sourceMetadata)

    expect(first.assets[0]!.sha256).toBe(preflight.assets[0]!.sha256)
    expect(first.assets[0]!.bytes).toEqual(preflight.assets[0]!.bytes)
    expect(first.assets[0]!.usages).toEqual([{
      boardId: first.idMap.boards['board-a'],
      shapeId: imageShapeId,
      assetRecordId,
    }])
  })

  it('remaps only documented owned pointers and preserves opaque external IDs', () => {
    const preflight = api.preflightIboardImport(validArchive())
    const sourceBoard = preflight.boards.find((board) => board.id === 'board-a')!
    const sourceStore = (sourceBoard.tldrawSnapshot as { store: Record<string, any> }).store
    sourceBoard.sourceMetadata!.sourceId = 'board-a'
    sourceStore['shape:image-a'].meta.externalId = 'shape:ref-a-b'
    sourceStore['shape:image-a'].props.externalId = 'asset:image-a'
    sourceStore['asset:image-a'].meta.sourcePayload = {
      id: 'shape:image-a',
      boardId: 'board-a',
      referenceId: 'ref-a-b',
    }
    sourceStore['custom:opaque-id'] = {
      id: 'shape:image-a',
      typeName: 'custom',
      props: { externalId: 'board-a' },
    }

    const plan = api.createIboardMergePlan(preflight, {
      targetProjectId: 'project-target',
      namespace: 'opaque-ids',
    })
    const boardMap = plan.idMap.recordsByBoard['board-a']!
    const remappedBoard = plan.boards.find((board) => board.id === plan.idMap.boards['board-a'])!
    const store = (remappedBoard.tldrawSnapshot as { store: Record<string, any> }).store

    expect(remappedBoard.sourceMetadata!.sourceId).toBe('board-a')
    expect(store[boardMap['shape:image-a']!].parentId).toBe(boardMap['page:board-a'])
    expect(store[boardMap['shape:image-a']!].props.assetId).toBe(boardMap['asset:image-a'])
    expect(store[boardMap['binding:image-to-ref']!]).toMatchObject({
      fromId: boardMap['shape:image-a'],
      toId: boardMap['shape:ref-a-b'],
    })
    expect(store[boardMap['shape:ref-a-b']!].props).toMatchObject({
      referenceId: plan.idMap.references['ref-a-b'],
      targetBoardId: plan.idMap.boards['board-b'],
    })
    expect(store[boardMap['shape:image-a']!].meta.externalId).toBe('shape:ref-a-b')
    expect(store[boardMap['shape:image-a']!].props.externalId).toBe('asset:image-a')
    expect(store[boardMap['asset:image-a']!].meta.sourcePayload).toEqual({
      id: 'shape:image-a',
      boardId: 'board-a',
      referenceId: 'ref-a-b',
    })
    expect(store['custom:opaque-id']).toEqual({
      id: 'shape:image-a',
      typeName: 'custom',
      props: { externalId: 'board-a' },
    })
  })
})
