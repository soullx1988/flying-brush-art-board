import { createHash } from 'node:crypto'

import { createReferenceGraphProjectFixture } from '../../../test-fixtures/src/iboard/reference-graph-project.js'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import * as interop from '../index.js'

type ExportInput = ReturnType<typeof createReferenceGraphProjectFixture>

interface ExportApi {
  exportProjectToIboard(input: ExportInput): Uint8Array
}

const api = interop as unknown as ExportApi
const decoder = new TextDecoder()

function archiveJson(archive: Uint8Array, path: string): unknown {
  const entry = unzipSync(archive)[path]
  if (!entry) throw new Error(`Missing archive entry: ${path}`)
  return JSON.parse(decoder.decode(entry))
}

function cloneFixture(): ExportInput {
  return structuredClone(createReferenceGraphProjectFixture())
}

describe('exportProjectToIboard', () => {
  it('writes the v1 manifest, every board once, references, and content-addressed assets', () => {
    const fixture = cloneFixture()
    const archive = api.exportProjectToIboard(fixture)
    const entries = unzipSync(archive)
    const manifest = archiveJson(archive, 'manifest.json') as {
      format: string
      formatVersion: number
      projectId: string
      title: string
      rootBoardId: string
      boards: Array<{ id: string; path: string }>
      referencesPath: string
      assets: Array<{ sha256: string; path: string; mime: string; size: number }>
    }

    expect(Object.keys(entries).sort()).toEqual([
      `assets/${fixture.assets[0]!.sha256}`,
      'boards/board-a.json',
      'boards/board-b.json',
      'boards/board-c.json',
      'boards/board-d.json',
      'manifest.json',
      'references.json',
    ])
    expect(manifest).toMatchObject({
      format: 'infinite-board',
      formatVersion: 1,
      projectId: fixture.project.id,
      title: fixture.project.title,
      rootBoardId: fixture.project.rootBoardId,
      referencesPath: 'references.json',
    })
    expect(manifest.boards).toEqual([
      { id: 'board-a', path: 'boards/board-a.json' },
      { id: 'board-b', path: 'boards/board-b.json' },
      { id: 'board-c', path: 'boards/board-c.json' },
      { id: 'board-d', path: 'boards/board-d.json' },
    ])
    expect(new Set(manifest.boards.map((board) => board.id)).size).toBe(fixture.boards.length)
    expect(manifest.assets).toEqual([{
      sha256: fixture.assets[0]!.sha256,
      path: `assets/${fixture.assets[0]!.sha256}`,
      mime: 'image/png',
      size: fixture.assets[0]!.bytes.byteLength,
      usages: [{ boardId: 'board-a', shapeId: 'shape:image-a', assetRecordId: 'asset:image-a' }],
    }])
    expect(entries[`assets/${fixture.assets[0]!.sha256}`]).toEqual(fixture.assets[0]!.bytes)
    expect(archiveJson(archive, 'references.json')).toEqual(
      [...fixture.references].sort((left, right) => left.id.localeCompare(right.id)),
    )
  })

  it('exports only persistent board fields and produces deterministic bytes for stable logical content', () => {
    const fixture = cloneFixture()
    const first = api.exportProjectToIboard(fixture)
    const second = api.exportProjectToIboard({
      ...fixture,
      boards: [...fixture.boards].reverse(),
      references: [...fixture.references].reverse(),
      assets: [...fixture.assets].reverse(),
    })
    const board = archiveJson(first, 'boards/board-a.json') as Record<string, unknown>

    expect(first).toEqual(second)
    expect(Object.keys(board).sort()).toEqual(['revision', 'sourceMetadata', 'title', 'tldrawSnapshot'])
    expect(board).not.toHaveProperty('projectId')
    expect(board).not.toHaveProperty('createdAt')
    expect(board).not.toHaveProperty('updatedAt')
    expect(board).not.toHaveProperty('history')
    expect(board).not.toHaveProperty('pendingSnapshot')
  })

  it('allows duplicate, self-referencing, and cyclic link edges', () => {
    const fixture = cloneFixture()
    const duplicateLink = {
      ...fixture.references.find((reference) => reference.id === 'ref-d-a-link')!,
      id: 'ref-d-a-link-duplicate',
      shapeId: 'shape:ref-d-a-link-duplicate',
    }
    const source = fixture.boards.find((board) => board.id === duplicateLink.sourceBoardId)!
    const store = (source.tldrawSnapshot as { store: Record<string, unknown> }).store
    store[duplicateLink.shapeId] = {
      id: duplicateLink.shapeId,
      typeName: 'shape',
      type: 'board-reference',
      props: {
        referenceId: duplicateLink.id,
        targetBoardId: duplicateLink.targetBoardId,
        kind: duplicateLink.kind,
      },
    }
    fixture.references.push(duplicateLink)

    expect(() => api.exportProjectToIboard(fixture)).not.toThrow()
  })

  it.each([
    ['duplicate board ids', (fixture: ExportInput) => fixture.boards.push(structuredClone(fixture.boards[0]!)), 'BOARD_DUPLICATE_ID'],
    ['cross-project boards', (fixture: ExportInput) => { fixture.boards[0]!.projectId = 'other-project' }, 'BOARD_REFERENCE_CROSS_PROJECT'],
    ['dangling references', (fixture: ExportInput) => { fixture.references[0]!.targetBoardId = 'missing-board' }, 'BOARD_REFERENCE_TARGET_NOT_FOUND'],
    ['duplicate reference ids', (fixture: ExportInput) => { fixture.references[1]!.id = fixture.references[0]!.id }, 'BOARD_REFERENCE_DUPLICATE_ID'],
    ['duplicate source shapes', (fixture: ExportInput) => { fixture.references[1]!.sourceBoardId = fixture.references[0]!.sourceBoardId; fixture.references[1]!.shapeId = fixture.references[0]!.shapeId }, 'BOARD_REFERENCE_DUPLICATE_SHAPE'],
  ])('rejects %s before writing an archive', (_name, mutate, errorCode) => {
    const fixture = cloneFixture()
    mutate(fixture)

    expect(() => api.exportProjectToIboard(fixture)).toThrow(errorCode)
  })

  it('rejects embed cycles and an eleventh board level but validates links outside the embed DAG', () => {
    const cyclic = cloneFixture()
    const cycle = cyclic.references.find((reference) => reference.id === 'ref-d-a-link')!
    cycle.kind = 'embed'
    const cycleShape = ((cyclic.boards.find((board) => board.id === 'board-d')!.tldrawSnapshot as {
      store: Record<string, { props?: Record<string, unknown> }>
    }).store[cycle.shapeId])!
    cycleShape.props!.kind = 'embed'
    expect(() => api.exportProjectToIboard(cyclic)).toThrow('EMBED_CYCLE')

    const deep = cloneFixture()
    deep.boards = []
    deep.references = []
    for (let index = 1; index <= 11; index += 1) {
      const id = `deep-${index}`
      const nextId = `deep-${index + 1}`
      const reference = index < 11
        ? {
            id: `deep-ref-${index}`,
            projectId: deep.project.id,
            sourceBoardId: id,
            targetBoardId: nextId,
            shapeId: `shape:deep-ref-${index}`,
            kind: 'embed' as const,
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:00.000Z',
          }
        : undefined
      deep.boards.push({
        id,
        projectId: deep.project.id,
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
      if (reference) deep.references.push(reference)
    }
    deep.project.rootBoardId = 'deep-1'
    deep.assets = []

    expect(() => api.exportProjectToIboard(deep)).toThrow('EMBED_DEPTH_LIMIT_EXCEEDED')
  })

  it('rejects edge/shape divergence and asset hash or metadata mismatches', () => {
    const missingShape = cloneFixture()
    const reference = missingShape.references[0]!
    const source = missingShape.boards.find((board) => board.id === reference.sourceBoardId)!
    delete (source.tldrawSnapshot as { store: Record<string, unknown> }).store[reference.shapeId]
    expect(() => api.exportProjectToIboard(missingShape)).toThrow('BOARD_REFERENCE_SHAPE_MISSING')

    const orphanShape = cloneFixture()
    orphanShape.references = orphanShape.references.filter((candidate) => candidate.id !== 'ref-a-b')
    expect(() => api.exportProjectToIboard(orphanShape)).toThrow('BOARD_REFERENCE_EDGE_MISSING')

    const tampered = cloneFixture()
    tampered.assets[0]!.bytes[0] = 0
    expect(() => api.exportProjectToIboard(tampered)).toThrow('ASSET_HASH_METADATA_MISMATCH')

    const wrongSize = cloneFixture()
    wrongSize.assets[0]!.size += 1
    expect(() => api.exportProjectToIboard(wrongSize)).toThrow('ASSET_HASH_METADATA_MISMATCH')

    const invalidUsage = cloneFixture()
    invalidUsage.assets[0]!.usages[0]!.shapeId = 'shape:missing'
    expect(() => api.exportProjectToIboard(invalidUsage)).toThrow('IBOARD_ASSET_USAGE_SHAPE_MISMATCH')

    const hash = createHash('sha256').update(wrongSize.assets[0]!.bytes).digest('hex')
    expect(hash).toBe(wrongSize.assets[0]!.sha256)
  })

  it('requires every snapshot asset reference to have one declared archive asset usage', () => {
    const fixture = cloneFixture()
    fixture.assets[0]!.usages = []

    expect(() => api.exportProjectToIboard(fixture)).toThrow('IBOARD_ASSET_REFERENCE_UNDECLARED')
  })

  it('rejects orphan tldraw asset records before writing an archive', () => {
    const fixture = cloneFixture()
    const store = (fixture.boards.find((board) => board.id === 'board-a')!.tldrawSnapshot as {
      store: Record<string, unknown>
    }).store
    store['asset:orphan'] = {
      id: 'asset:orphan',
      typeName: 'asset',
      type: 'image',
      props: {},
      meta: {},
    }

    expect(() => api.exportProjectToIboard(fixture)).toThrow('IBOARD_ASSET_RECORD_ORPHAN')
  })

  it('rejects an archive asset descriptor with no snapshot usage', () => {
    const fixture = cloneFixture()
    fixture.assets[0]!.usages = []
    delete (fixture.boards.find((board) => board.id === 'board-a')!.tldrawSnapshot as {
      store: Record<string, unknown>
    }).store['shape:image-a']
    delete (fixture.boards.find((board) => board.id === 'board-a')!.tldrawSnapshot as {
      store: Record<string, unknown>
    }).store['asset:image-a']

    expect(() => api.exportProjectToIboard(fixture)).toThrow('IBOARD_ASSET_DESCRIPTOR_ORPHAN')
  })
})
