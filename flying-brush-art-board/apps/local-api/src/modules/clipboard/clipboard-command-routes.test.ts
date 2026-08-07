import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBoardReferenceShape } from '@infinite-board/tldraw-adapter'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { BoardRepository } from '../boards/board-repository.js'
import { AssetUsageRepository } from '../assets/asset-repository.js'
import { AssetRepository } from '../assets/asset-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardOperationQueue } from '../realtime/board-operation-queue.js'
import { registerClipboardCommandRoutes } from './clipboard-command-routes.js'

const now = '2026-07-23T00:00:00.000Z'
const sessionId = 'session:test'

function shape(id: string, x = 10, y = 20) {
  return {
    id,
    typeName: 'shape',
    type: 'geo',
    parentId: 'page:page',
    index: 'a1',
    x,
    y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    props: { w: 100, h: 80 } as Record<string, unknown>,
  }
}

function payload(references: unknown[] = [], shapes: unknown[] = [shape('shape:source')]) {
  return {
    version: 1,
    sourceProjectId: 'project-1',
    sourceBoardId: 'A',
    shapes,
    bindings: [],
    references,
    assets: [],
    copiedAt: now,
  }
}

describe('clipboard command routes', () => {
  let app: FastifyInstance
  let database: LocalDatabase
  let boards: BoardRepository
  let references: BoardReferenceRepository
  let assetDirectory: string

  beforeEach(async () => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-clipboard-routes-'))
    const projects = new ProjectRepository(database)
    boards = new BoardRepository(database)
    references = new BoardReferenceRepository(database)
    projects.create({
      id: 'project-1',
      title: 'Project',
      rootBoardId: 'A',
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    boards.create({
      id: 'A',
      projectId: 'project-1',
      title: 'Source',
      tldrawSnapshot: { store: { 'page:page': { id: 'page:page', typeName: 'page' } } },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    boards.create({
      id: 'B',
      projectId: 'project-1',
      title: 'Target',
      tldrawSnapshot: { store: { 'page:page': { id: 'page:page', typeName: 'page' } } },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    app = await buildApp({ database, assetDirectory })
  })

  afterEach(async () => {
    await app.close()
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  it('pastes an ordinary payload with new ids and placement, then undoes and redoes it', async () => {
    const pasted = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: { payload: payload(), expectedRevision: 0, sessionId, placement: { x: 120, y: 240 } },
    })

    expect(pasted.statusCode).toBe(201)
    const receipt = pasted.json<{
      commandId: string
      revision: number
      idMap: Record<string, string>
      snapshot: { store: Record<string, { x?: number; y?: number }> }
    }>()
    expect(receipt.revision).toBe(1)
    expect(receipt.idMap['shape:source']).not.toBe('shape:source')
    expect(receipt.snapshot.store[receipt.idMap['shape:source']!]).toMatchObject({ x: 120, y: 240 })
    expect(boards.get('A')).toMatchObject({ revision: 0 })

    const undone = await app.inject({
      method: 'POST',
      url: `/api/clipboard/commands/${receipt.commandId}/undo`,
      payload: { expectedRevision: 1, sessionId },
    })
    expect(undone.statusCode).toBe(200)
    expect(undone.json()).toMatchObject({ revision: 2 })
    expect(boards.get('B')?.tldrawSnapshot).toEqual({
      store: { 'page:page': { id: 'page:page', typeName: 'page' } },
    })

    const redone = await app.inject({
      method: 'POST',
      url: `/api/clipboard/commands/${receipt.commandId}/redo`,
      payload: { expectedRevision: 2, sessionId },
    })
    expect(redone.statusCode).toBe(200)
    expect(redone.json()).toMatchObject({ revision: 3 })
  })

  it('creates a new board and applies both ordinary and recoverable reference imports atomically', async () => {
    const ordinary = await app.inject({
      method: 'POST',
      url: '/api/projects/project-1/boards/clipboard-import',
      payload: {
        board: { id: 'C', title: 'Ordinary import', tldrawSnapshot: { store: {} } },
        payload: { ...payload(), sourceBoardId: 'C' },
        sessionId,
      },
    })
    expect(ordinary.statusCode).toBe(201)
    expect(ordinary.json<{ board: { id: string; revision: number } }>().board).toMatchObject({ id: 'C', revision: 1 })

    const copiedReference = {
      id: 'reference:source', projectId: 'project-1', sourceBoardId: 'A', targetBoardId: 'A',
      shapeId: 'shape:source', kind: 'link' as const, createdAt: now, updatedAt: now,
    }
    const referenced = await app.inject({
      method: 'POST',
      url: '/api/projects/project-1/boards/clipboard-import',
      payload: {
        board: { id: 'D', title: 'Reference import', tldrawSnapshot: { store: {} } },
        payload: {
          ...payload([{
            shapeId: copiedReference.shapeId,
            referenceId: copiedReference.id,
            targetBoardId: copiedReference.targetBoardId,
            kind: copiedReference.kind,
          }], [createBoardReferenceShape(copiedReference, 'Source')]),
          sourceBoardId: 'D',
        },
        sessionId,
      },
    })
    expect(referenced.statusCode).toBe(201)
    expect(references.listOutbound('D')).toHaveLength(1)
  })

  it('leaves no new board or reference when an atomic board import fails graph validation', async () => {
    const selfReference = {
      id: 'reference:self', projectId: 'project-1', sourceBoardId: 'C', targetBoardId: 'C',
      shapeId: 'shape:self', kind: 'embed' as const, createdAt: now, updatedAt: now,
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/project-1/boards/clipboard-import',
      payload: {
        board: { id: 'C', title: 'Rejected import', tldrawSnapshot: { store: {} } },
        payload: {
          ...payload([{
            shapeId: selfReference.shapeId,
            referenceId: selfReference.id,
            targetBoardId: selfReference.targetBoardId,
            kind: selfReference.kind,
          }], [createBoardReferenceShape(selfReference, 'Self')]),
          sourceBoardId: 'C',
        },
        sessionId,
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      code: 'CLIPBOARD_REFERENCE_INVALID',
      validation: { code: 'EMBED_CYCLE' },
    })
    expect(boards.get('C')).toBeUndefined()
    expect(references.listOutbound('C')).toEqual([])
    expect(new AssetUsageRepository(database).listByProject('project-1')).toEqual([])
  })

  it('returns the stable expired receipt response when another session replays a command', async () => {
    const pasted = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: { payload: payload(), expectedRevision: 0, sessionId: 'session:one', placement: { viewportCenter: true } },
    })
    const receipt = pasted.json<{ commandId: string }>()

    const replay = await app.inject({
      method: 'POST',
      url: `/api/clipboard/commands/${receipt.commandId}/undo`,
      payload: { expectedRevision: 1, sessionId: 'session:two' },
    })

    expect(replay.statusCode).toBe(410)
    expect(replay.json()).toEqual({ code: 'CLIPBOARD_COMMAND_EXPIRED' })
    expect(boards.get('B')).toMatchObject({ revision: 1 })
  })

  it('rejects malformed payloads and stale revisions without changing the target', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: {
        payload: { ...payload(), version: 2 },
        expectedRevision: 0,
        sessionId,
        placement: { viewportCenter: true },
      },
    })
    const stale = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: { payload: payload(), expectedRevision: 9, sessionId, placement: { viewportCenter: true } },
    })

    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ code: 'REVISION_CONFLICT', currentRevision: 0 })
    expect(boards.get('B')).toMatchObject({ revision: 0 })
  })

  it('serializes paste behind realtime projection and preserves the newer room snapshot', async () => {
    const directApp = Fastify()
    const queue = new BoardOperationQueue()
    let release!: () => void
    const pendingProjection = queue.run('B', async () => {
      await new Promise<void>((resolve) => { release = resolve })
      boards.saveRealtimeSnapshot('B', {
        store: {
          'page:page': { id: 'page:page', typeName: 'page' },
          'shape:realtime': shape('shape:realtime'),
        },
      })
    })
    registerClipboardCommandRoutes(
      directApp,
      database,
      boards,
      new AssetRepository(database, assetDirectory),
      undefined,
      queue,
    )
    try {
      const paste = directApp.inject({
        method: 'POST',
        url: '/api/boards/B/clipboard/paste',
        payload: { payload: payload(), expectedRevision: 0, sessionId, placement: { viewportCenter: true } },
      })
      await Promise.resolve()
      expect(boards.get('B')).toMatchObject({ revision: 0 })

      release()
      await pendingProjection
      const response = await paste

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ code: 'REVISION_CONFLICT', currentRevision: 1 })
      expect(boards.get('B')?.tldrawSnapshot).toEqual({
        store: {
          'page:page': { id: 'page:page', typeName: 'page' },
          'shape:realtime': shape('shape:realtime'),
        },
      })
    } finally {
      await directApp.close()
    }
  })

  it('pastes a same-project reference as one server command and replays its receipt', async () => {
    const copiedReference = {
      id: 'reference:source',
      projectId: 'project-1',
      sourceBoardId: 'A',
      targetBoardId: 'A',
      shapeId: 'shape:source',
      kind: 'link' as const,
      createdAt: now,
      updatedAt: now,
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: {
        payload: payload([
          {
            shapeId: 'shape:source',
            referenceId: 'reference:source',
            targetBoardId: 'A',
            kind: copiedReference.kind,
          },
        ], [createBoardReferenceShape(copiedReference, 'Source')]),
        expectedRevision: 0,
        sessionId,
        placement: { viewportCenter: true },
      },
    })

    expect(response.statusCode).toBe(201)
    const receipt = response.json<{ commandId: string; createdReferenceIds: string[] }>()
    expect(receipt.createdReferenceIds).toHaveLength(1)
    expect(references.listOutbound('B')).toHaveLength(1)

    const undone = await app.inject({
      method: 'POST',
      url: `/api/clipboard/commands/${receipt.commandId}/undo`,
      payload: { expectedRevision: 1, sessionId },
    })
    expect(undone.statusCode).toBe(200)
    expect(references.listOutbound('B')).toEqual([])

    const redone = await app.inject({
      method: 'POST',
      url: `/api/clipboard/commands/${receipt.commandId}/redo`,
      payload: { expectedRevision: 2, sessionId },
    })
    expect(redone.statusCode).toBe(200)
    expect(references.listOutbound('B')).toHaveLength(1)
  })

  it('downgrades a cross-project reference to a visual card without creating an edge', async () => {
    const copiedReference = {
      id: 'reference:source',
      projectId: 'project-other',
      sourceBoardId: 'other-source',
      targetBoardId: 'other-target',
      shapeId: 'shape:source',
      kind: 'embed' as const,
      createdAt: now,
      updatedAt: now,
    }
    const crossProjectPayload = {
      ...payload([{
        shapeId: copiedReference.shapeId,
        referenceId: copiedReference.id,
        targetBoardId: copiedReference.targetBoardId,
        kind: copiedReference.kind,
      }], [createBoardReferenceShape(copiedReference, 'Other target')]),
      sourceProjectId: 'project-other',
      sourceBoardId: 'other-source',
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: {
        payload: crossProjectPayload,
        expectedRevision: 0,
        sessionId,
        placement: { viewportCenter: true },
      },
    })

    expect(response.statusCode).toBe(201)
    const receipt = response.json<{
      downgrade: { code: string; shapeIds: string[] }
      snapshot: { store: Record<string, { type?: string }> }
      idMap: Record<string, string>
    }>()
    expect(receipt.downgrade.code).toBe('CLIPBOARD_REFERENCE_DOWNGRADED_CROSS_PROJECT')
    expect(receipt.snapshot.store[receipt.idMap['shape:source']!]?.type).toBe('geo')
    expect(references.listOutbound('B')).toEqual([])
  })

  it('reuses stored asset bytes by hash while creating distinct pasted usages', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/assets',
      payload: { mime: 'image/png', base64: Buffer.from(bytes).toString('base64') },
    })
    const asset = uploaded.json<{ sha256: string }>()
    const imagePayload = {
      ...payload(),
      shapes: [shape('shape:image', 10, 20)],
      assets: [
        {
          assetRecordId: 'asset:image',
          sha256: asset.sha256,
          mime: 'image/png',
          size: bytes.byteLength,
          record: {
            id: 'asset:image',
            typeName: 'asset',
            type: 'image',
            props: { src: `/api/assets/${asset.sha256}` },
            meta: {},
          },
        },
      ],
    }
    imagePayload.shapes[0]!.props = { ...imagePayload.shapes[0]!.props, assetId: 'asset:image' }

    const first = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: { payload: imagePayload, expectedRevision: 0, sessionId, placement: { viewportCenter: true } },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/boards/B/clipboard/paste',
      payload: { payload: imagePayload, expectedRevision: 1, sessionId, placement: { viewportCenter: true } },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number },
    ).toEqual({ count: 1 })
    expect(new AssetUsageRepository(database).listBySha256(asset.sha256)).toHaveLength(2)
  })
})
