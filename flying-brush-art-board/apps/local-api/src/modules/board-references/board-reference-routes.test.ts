import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBoardReferenceShape } from '@infinite-board/tldraw-adapter'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { BoardReferenceRepository } from './board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import {
  createBoardReferenceSchema,
  deleteBoardReferenceSchema,
  updateBoardReferenceSchema,
} from './board-reference-contracts.js'

const now = '2026-07-23T00:00:00.000Z'

const seededReferences = {
  aToC: {
    id: 'a-c',
    projectId: 'project-1',
    sourceBoardId: 'A',
    targetBoardId: 'C',
    shapeId: 'shape-a-c',
    kind: 'embed' as const,
    createdAt: now,
    updatedAt: now,
  },
  bToC: {
    id: 'b-c',
    projectId: 'project-1',
    sourceBoardId: 'B',
    targetBoardId: 'C',
    shapeId: 'shape-b-c',
    kind: 'embed' as const,
    createdAt: now,
    updatedAt: now,
  },
}

describe('board reference routes', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let projects: ProjectRepository
  let boards: BoardRepository
  let references: BoardReferenceRepository

  beforeEach(() => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-api-assets-'))
    projects = new ProjectRepository(database)
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
    for (const id of ['A', 'B', 'C']) {
      const reference = id === 'A' ? seededReferences.aToC : id === 'B' ? seededReferences.bToC : undefined
      boards.create({
        id,
        projectId: 'project-1',
        title: id,
        tldrawSnapshot: {
          store: {
            'page:page': { id: 'page:page', typeName: 'page' },
            ...(reference
              ? { [reference.shapeId]: createBoardReferenceShape(reference, 'C') }
              : {}),
          },
        },
        revision: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
    references.create(seededReferences.aToC)
    references.create(seededReferences.bToC)
  })

  afterEach(() => {
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  it('registers CAS-capable create, update, and delete mutation routes', async () => {
    expect(
      createBoardReferenceSchema.safeParse({
        targetBoardId: 'B',
        shapeId: 'shape:reference',
        kind: 'embed',
        expectedRevision: 0,
        placement: { x: 120, y: 240 },
      }).success,
    ).toBe(true)
    expect(updateBoardReferenceSchema.safeParse({ kind: 'link' }).success).toBe(false)
    expect(deleteBoardReferenceSchema.safeParse({ expectedRevision: 0 }).success).toBe(true)

    const app = await buildApp({ database, assetDirectory })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/boards/A/references',
        payload: {
          targetBoardId: 'B', shapeId: 'shape:reference', kind: 'embed', expectedRevision: 0,
          placement: { x: 120, y: 240 },
        },
      })
      expect(response.statusCode).toBe(201)
      const created = response.json<{ reference: { id: string }; revision: number }>()
      expect(created.revision).toBe(1)
      expect((boards.get('A')!.tldrawSnapshot as { store: Record<string, { x: number; y: number }> }).store['shape:reference'])
        .toMatchObject({ x: 120, y: 240 })

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/references/${created.reference.id}`,
        payload: { targetBoardId: 'C', kind: 'link', expectedRevision: 1 },
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.json()).toMatchObject({
        revision: 2,
        reference: { targetBoardId: 'C', kind: 'link' },
      })

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/references/${created.reference.id}`,
        payload: { expectedRevision: 2 },
      })
      expect(removed.statusCode).toBe(200)
      expect(removed.json()).toMatchObject({ revision: 3 })
      expect(boards.get('C')).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('allows visual autosaves but rejects adding, removing, or retargeting reference semantics', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const original = structuredClone(boards.get('A')!.tldrawSnapshot) as {
        store: Record<string, { x?: number; props?: Record<string, unknown> }>
      }
      const moved = structuredClone(original)
      moved.store['shape-a-c']!.x = 80
      const visual = await app.inject({
        method: 'PUT',
        url: '/api/boards/A/snapshot',
        payload: { expectedRevision: 0, snapshot: moved },
      })
      expect(visual.statusCode).toBe(200)

      const retargeted = structuredClone(moved)
      retargeted.store['shape-a-c']!.props = {
        ...retargeted.store['shape-a-c']!.props,
        targetBoardId: 'B',
      }
      const structural = await app.inject({
        method: 'PUT',
        url: '/api/boards/A/snapshot',
        payload: { expectedRevision: 1, snapshot: retargeted },
      })

      expect(structural.statusCode).toBe(409)
      expect(structural.json()).toEqual({ code: 'BOARD_REFERENCE_COMMAND_REQUIRED' })
      expect(boards.get('A')).toMatchObject({ revision: 1, tldrawSnapshot: moved })
    } finally {
      await app.close()
    }
  })

  it('creates a new embedded target through the same atomic reference route', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/boards/A/references',
        payload: {
          newBoard: {
            id: 'nested-board',
            title: 'Nested board',
            tldrawSnapshot: { store: {} },
          },
          shapeId: 'shape:nested-board',
          kind: 'embed',
          expectedRevision: 0,
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({
        revision: 1,
        reference: { targetBoardId: 'nested-board', kind: 'embed' },
      })
      expect(boards.get('nested-board')).toMatchObject({ title: 'Nested board', revision: 0 })
    } finally {
      await app.close()
    }
  })

  it('renames the target board without rewriting source reference snapshots', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const before = structuredClone(boards.get('A')!.tldrawSnapshot)
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/boards/C',
        payload: { title: 'Renamed C' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: 'C', title: 'Renamed C' })
      expect(boards.get('A')!.tldrawSnapshot).toEqual(before)
    } finally {
      await app.close()
    }
  })

  it('duplicates a Board atomically and rebuilds its reference edges', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/boards/A/duplicate',
        payload: { id: 'A-copy', title: 'A copy' },
      })
      expect(response.statusCode).toBe(201)
      const copiedReferences = references.listOutbound('A-copy')
      expect(copiedReferences).toEqual([
        expect.objectContaining({ sourceBoardId: 'A-copy', targetBoardId: 'C', shapeId: 'shape-a-c', kind: 'embed' }),
      ])
      expect(copiedReferences[0]?.id).not.toBe(seededReferences.aToC.id)
      const copiedShape = (boards.get('A-copy')!.tldrawSnapshot as { store: Record<string, { props: { referenceId: string } }> }).store['shape-a-c']
      expect(copiedShape?.props.referenceId).toBe(copiedReferences[0]?.id)
      expect(references.listOutbound('A')).toEqual([expect.objectContaining({ id: 'a-c' })])
    } finally {
      await app.close()
    }
  })

  it('returns inbound and outbound references by explicit direction', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const inbound = await app.inject({ method: 'GET', url: '/api/boards/C/references?direction=inbound' })
      const outbound = await app.inject({ method: 'GET', url: '/api/boards/A/references?direction=outbound' })
      const invalid = await app.inject({ method: 'GET', url: '/api/boards/C/references?direction=sideways' })

      expect(inbound.statusCode).toBe(200)
      expect(inbound.json().map((reference: { id: string }) => reference.id)).toEqual(['a-c', 'b-c'])
      expect(outbound.statusCode).toBe(200)
      expect(outbound.json().map((reference: { id: string }) => reference.id)).toEqual(['a-c'])
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    } finally {
      await app.close()
    }
  })

  it('returns the complete inbound-reference body when board deletion is blocked', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const response = await app.inject({ method: 'DELETE', url: '/api/boards/C' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({
        code: 'BOARD_REFERENCED',
        inboundReferences: [expect.objectContaining({ id: 'a-c' }), expect.objectContaining({ id: 'b-c' })],
      })
    } finally {
      await app.close()
    }
  })

  it('returns root delete protection and allows deletion after changing the default entry', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const protectedResponse = await app.inject({ method: 'DELETE', url: '/api/boards/A' })
      expect(protectedResponse.statusCode).toBe(409)
      expect(protectedResponse.json()).toEqual({
        code: 'ROOT_BOARD_DELETE_FORBIDDEN',
        projectId: 'project-1',
        rootBoardId: 'A',
      })

      projects.setRootBoardId('project-1', 'B')
      references.remove('a-c')
      const deleted = await app.inject({ method: 'DELETE', url: '/api/boards/A' })
      expect(deleted.statusCode).toBe(204)
    } finally {
      await app.close()
    }
  })

  it('rejects non-loopback host configuration and invalid or oversized asset inputs', async () => {
    await expect(buildApp({ host: '0.0.0.0' })).rejects.toThrow('Loopback host required')

    const app = await buildApp({ database, assetDirectory, maxAssetBytes: 3 })
    try {
      const invalid = await app.inject({ method: 'POST', url: '/api/assets', payload: { mime: 'bad', base64: 'AA==' } })
      const invalidBase64 = await app.inject({ method: 'POST', url: '/api/assets', payload: { mime: 'image/png', base64: 'A===' } })
      const nonCanonicalBase64 = await app.inject({ method: 'POST', url: '/api/assets', payload: { mime: 'image/png', base64: 'TQ=' } })
      const atLimit = await app.inject({
        method: 'POST',
        url: '/api/assets',
        payload: { mime: 'image/png', base64: Buffer.from([1, 2, 3]).toString('base64') },
      })
      const oversized = await app.inject({
        method: 'POST',
        url: '/api/assets',
        payload: { mime: 'image/png', base64: Buffer.from([1, 2, 3, 4]).toString('base64') },
      })

      expect(invalid.statusCode).toBe(400)
      expect(invalidBase64.statusCode).toBe(400)
      expect(nonCanonicalBase64.statusCode).toBe(400)
      expect(atLimit.statusCode).toBe(201)
      expect(oversized.statusCode).toBe(413)
    } finally {
      await app.close()
    }
  })

  it('removes an unused uploaded asset row and blob through the compensation route', async () => {
    const app = await buildApp({ database, assetDirectory })
    const bytes = new Uint8Array([1, 2, 3])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    try {
      const uploaded = await app.inject({
        method: 'POST',
        url: '/api/assets',
        payload: { mime: 'image/png', base64: Buffer.from(bytes).toString('base64') },
      })
      expect(uploaded.statusCode).toBe(201)
      expect(uploaded.json()).toMatchObject({ sha256, created: true })
      expect(existsSync(join(assetDirectory, sha256))).toBe(true)

      const removed = await app.inject({ method: 'DELETE', url: `/api/assets/${sha256}` })

      expect(removed.statusCode).toBe(204)
      expect(database.prepare('SELECT COUNT(*) AS count FROM assets WHERE sha256 = ?').get(sha256)).toEqual({ count: 0 })
      expect(existsSync(join(assetDirectory, sha256))).toBe(false)

      const usedBytes = new Uint8Array([4, 5, 6])
      const usedSha256 = createHash('sha256').update(usedBytes).digest('hex')
      await app.inject({
        method: 'POST',
        url: '/api/assets',
        payload: { mime: 'image/png', base64: Buffer.from(usedBytes).toString('base64') },
      })
      database.prepare(`INSERT INTO asset_usages (
        project_id, board_id, shape_id, asset_record_id, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run('project-1', 'A', 'shape:used-asset', 'asset:used-asset', usedSha256, now)

      const protectedAsset = await app.inject({ method: 'DELETE', url: `/api/assets/${usedSha256}` })
      expect(protectedAsset.statusCode).toBe(404)
      expect(database.prepare('SELECT COUNT(*) AS count FROM assets WHERE sha256 = ?').get(usedSha256)).toEqual({ count: 1 })
      expect(existsSync(join(assetDirectory, usedSha256))).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('rejects malformed path and query parameters with validation errors', async () => {
    const app = await buildApp({ database, assetDirectory })
    try {
      const board = await app.inject({ method: 'GET', url: '/api/boards/%20' })
      const project = await app.inject({ method: 'GET', url: '/api/projects/%20' })
      const reference = await app.inject({ method: 'GET', url: '/api/boards/C/references?direction=sideways' })

      expect(board.statusCode).toBe(400)
      expect(project.statusCode).toBe(400)
      expect(reference.statusCode).toBe(400)
      expect(board.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(project.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    } finally {
      await app.close()
    }
  })
})
