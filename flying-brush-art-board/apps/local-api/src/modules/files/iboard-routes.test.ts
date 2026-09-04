import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  decodeIboard,
  DEFAULT_IBOARD_MAX_ARCHIVE_BYTES,
  DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES,
  exportProjectToIboard,
  inspectAndDecodeIboard,
  measureIboardArchive,
} from '../../../../../packages/interop/src/index.js'
import { createReferenceGraphProjectFixture } from '../../../../../packages/test-fixtures/src/iboard/reference-graph-project.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { AssetRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import {
  DEFAULT_IBOARD_IMPORT_SESSION_MAX_BYTES,
  IboardImportSessionStore,
} from './iboard-routes.js'
import { IBOARD_BOARD_SNAPSHOT_UNSUPPORTED } from './iboard-runtime-compatibility.js'

function setUint32LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function corruptArchiveWithLargeCentralDirectoryReservation(): Uint8Array {
  const archive = exportProjectToIboard(createReferenceGraphProjectFixture())
  const centralDirectoryOffset = archive.findIndex((_, index) => (
    archive[index] === 0x50 &&
    archive[index + 1] === 0x4b &&
    archive[index + 2] === 0x01 &&
    archive[index + 3] === 0x02
  ))
  if (centralDirectoryOffset < 0) throw new Error('Missing ZIP central directory')
  // The central directory declares a large payload, but the unsupported
  // compressor makes decode/preflight reject the archive without inflating it.
  archive[centralDirectoryOffset + 10] = 99
  archive[centralDirectoryOffset + 11] = 0
  setUint32LittleEndian(archive, centralDirectoryOffset + 24, 64 * 1024 * 1024)
  return archive
}

describe('.iboard import routes', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-import-routes-'))
    app = await buildApp({ database, assetDirectory })
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: 'target-project',
        title: 'Target title',
        rootBoard: { id: 'target-root', title: 'Target root' },
      },
    })
  })

  afterEach(async () => {
    await app.close()
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  function runtimeCompatibleFixture() {
    const fixture = createReferenceGraphProjectFixture()
    for (const board of fixture.boards) {
      const snapshot = board.tldrawSnapshot as { schema?: unknown; store: Record<string, Record<string, unknown>> }
      delete snapshot.schema
      const image = snapshot.store['shape:image-a']
      if (image) {
        Object.assign(image, { x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1 })
        image.props = {
          assetId: 'asset:image-a', w: 20, h: 20, playing: false, url: '', crop: null,
          flipX: false, flipY: false, altText: '',
        }
      }
      const asset = snapshot.store['asset:image-a']
      if (asset) {
        asset.props = {
          src: asset.props && typeof asset.props === 'object'
            ? (asset.props as { src?: unknown }).src ?? null
            : null,
          name: 'fixture.png', mimeType: 'image/png', w: 20, h: 20, isAnimated: false,
        }
      }
      const binding = snapshot.store['binding:image-to-ref']
      if (binding) {
        binding.props = {
          terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false, isPrecise: false, snap: 'none',
        }
      }
    }
    return fixture
  }

  function archive(): Uint8Array {
    return exportProjectToIboard(runtimeCompatibleFixture())
  }

  function archiveWithUnknownShape(): Uint8Array {
    const fixture = runtimeCompatibleFixture()
    const board = fixture.boards.find((item) => item.id === 'board-c')!
    const snapshot = board.tldrawSnapshot as { store: Record<string, unknown> }
    snapshot.store['shape:alien'] = {
      id: 'shape:alien',
      typeName: 'shape',
      type: 'alien-widget',
      parentId: 'page:board-c',
      index: 'a2',
      x: 0,
      y: 0,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: {},
    }
    return exportProjectToIboard(fixture)
  }

  function seedExportProject() {
    const fixture = createReferenceGraphProjectFixture()
    const projects = new ProjectRepository(database)
    const boards = new BoardRepository(database)
    const references = new BoardReferenceRepository(database)
    const assets = new AssetRepository(database, assetDirectory)
    projects.create(fixture.project)
    for (const board of fixture.boards) boards.create(board)
    for (const reference of fixture.references) references.create(reference)
    for (const asset of fixture.assets) {
      for (const usage of asset.usages) {
        assets.materializeForBoard({
          ...usage,
          bytes: asset.bytes,
          mime: asset.mime,
          projectId: fixture.project.id,
          createdAt: fixture.project.createdAt,
        })
      }
    }
    return fixture
  }

  async function inspect(bytes = archive()) {
    return app.inject({
      method: 'POST',
      url: '/api/import/iboard/inspect',
      headers: {
        'content-type': 'application/octet-stream',
        'x-iboard-file-name': 'fixture.iboard',
      },
      payload: Buffer.from(bytes),
    })
  }

  it('exports a complete project archive with references and materialized assets', async () => {
    const fixture = seedExportProject()

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${fixture.project.id}/export.iboard`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/vnd.infinite-board+zip')
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''")
    const decoded = decodeIboard(new Uint8Array(response.rawPayload))
    expect(decoded.manifest).toMatchObject({
      projectId: fixture.project.id,
      rootBoardId: fixture.project.rootBoardId,
    })
    expect(decoded.boards).toHaveLength(fixture.boards.length)
    expect(decoded.references).toHaveLength(fixture.references.length)
    expect(decoded.assets).toEqual([
      expect.objectContaining({
        sha256: fixture.assets[0]!.sha256,
        bytes: fixture.assets[0]!.bytes,
        usages: fixture.assets[0]!.usages,
      }),
    ])
  })

  it('exports a legacy project whose private root is omitted with a visible replacement root', async () => {
    const fixture = seedExportProject()
    database.prepare(`UPDATE board_access_policies
      SET access_level='owner-only',owner_open_id='another-user'
      WHERE board_id=?`).run(fixture.project.rootBoardId)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${fixture.project.id}/export.iboard`,
    })

    expect(response.statusCode).toBe(200)
    const decoded = decodeIboard(new Uint8Array(response.rawPayload))
    expect(decoded.manifest.rootBoardId).not.toBe(fixture.project.rootBoardId)
    expect(decoded.boards.some((board) => board.id === decoded.manifest.rootBoardId)).toBe(true)
    expect(decoded.boards.some((board) => board.id === fixture.project.rootBoardId)).toBe(false)
  })

  it('reports missing projects and missing asset bytes without returning a partial archive', async () => {
    const missingProject = await app.inject({
      method: 'GET',
      url: '/api/projects/missing/export.iboard',
    })
    expect(missingProject.statusCode).toBe(404)
    expect(missingProject.json()).toEqual({ code: 'PROJECT_NOT_FOUND' })

    const fixture = seedExportProject()
    rmSync(join(assetDirectory, fixture.assets[0]!.sha256))
    const missingAsset = await app.inject({
      method: 'GET',
      url: `/api/projects/${fixture.project.id}/export.iboard`,
    })
    expect(missingAsset.statusCode).toBe(409)
    expect(missingAsset.json()).toEqual({
      code: 'IBOARD_EXPORT_FAILED',
      cause: `IBOARD_EXPORT_ASSET_MISSING:${fixture.assets[0]!.sha256}`,
    })
  })

  it('derives the retained-session logical payload quota from archive limits', () => {
    expect(DEFAULT_IBOARD_IMPORT_SESSION_MAX_BYTES).toBe(
      DEFAULT_IBOARD_MAX_ARCHIVE_BYTES + DEFAULT_IBOARD_MAX_UNCOMPRESSED_BYTES,
    )
  })

  it('creates a read-only inspect session and writes nothing before confirmation', async () => {
    const response = await inspect()
    const body = response.json()

    expect(response.statusCode).toBe(201)
    expect(body).toMatchObject({
      sessionId: expect.any(String),
      fileName: 'fixture.iboard',
      inspection: {
        compatible: true,
        boardCount: 4,
        referenceCount: 6,
        maxEmbedDepth: 3,
        assetBytes: 70,
      },
    })
    expect((await app.inject({ method: 'GET', url: '/api/projects/target-project' })).json()).toMatchObject({
      project: { title: 'Target title', rootBoardId: 'target-root' },
      boards: [{ id: 'target-root' }],
      references: [],
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM asset_usages').get()).toEqual({ count: 0 })
  })

  it('commits the session once, preserves the target root, and returns the imported root', async () => {
    const inspected = (await inspect()).json() as { sessionId: string }
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: inspected.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })
    const body = response.json()

    expect(response.statusCode).toBe(201)
    expect(body).toMatchObject({
      targetProjectId: 'target-project',
      importedRootBoardId: expect.any(String),
      importedBoardIds: expect.arrayContaining([expect.any(String)]),
      importedReferenceIds: expect.arrayContaining([expect.any(String)]),
      importedBoardCount: 4,
      importedReferenceCount: 6,
    })
    expect(body).not.toHaveProperty('idMap')
    const project = (await app.inject({ method: 'GET', url: '/api/projects/target-project' })).json()
    expect(project.project).toMatchObject({
      id: 'target-project', title: 'Target title', rootBoardId: 'target-root', formatVersion: 1,
    })
    expect(project.boards).toHaveLength(5)
    expect(project.references).toHaveLength(6)

    const replay = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: inspected.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })
    expect(replay.statusCode).toBe(404)
    expect(replay.json()).toEqual({ code: 'IBOARD_IMPORT_SESSION_NOT_FOUND' })
  })

  it('reports incompatible files and cancellation removes their sessions', async () => {
    const response = await inspect(new Uint8Array([1, 2, 3]))
    const body = response.json()

    expect(response.statusCode).toBe(201)
    expect(body.inspection).toMatchObject({
      compatible: false,
      issues: [expect.objectContaining({ code: 'IBOARD_ARCHIVE_INVALID', action: expect.any(String) })],
    })
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/import/sessions/${body.sessionId}`,
    })
    expect(cancelled.statusCode).toBe(204)

    const commit = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: body.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })
    expect(commit.statusCode).toBe(404)
  })

  it('fails closed on inspect for an unknown shape and commit leaves no residue', async () => {
    const before = {
      project: (await app.inject({ method: 'GET', url: '/api/projects/target-project' })).json(),
      assetUsages: database.prepare('SELECT COUNT(*) AS count FROM asset_usages').get(),
    }
    const inspected = await inspect(archiveWithUnknownShape())
    const body = inspected.json() as { sessionId: string; inspection: { compatible: boolean; issues: unknown[] } }

    expect(inspected.statusCode).toBe(201)
    expect(body.inspection).toMatchObject({
      compatible: false,
      issues: [{ code: IBOARD_BOARD_SNAPSHOT_UNSUPPORTED }],
    })

    const commit = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: body.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })

    expect(commit.statusCode).toBe(409)
    expect(commit.json()).toMatchObject({
      code: 'IBOARD_IMPORT_INCOMPATIBLE',
      inspection: {
        compatible: false,
        issues: [{ code: IBOARD_BOARD_SNAPSHOT_UNSUPPORTED }],
      },
    })
    expect((await app.inject({ method: 'GET', url: '/api/projects/target-project' })).json()).toEqual(before.project)
    expect(database.prepare('SELECT COUNT(*) AS count FROM asset_usages').get()).toEqual(before.assetUsages)
  })

  it('returns the stable snapshot code when commit defense catches a custom analyzer', async () => {
    await app.close()
    const sessions = new IboardImportSessionStore({ analyzeArchive: inspectAndDecodeIboard })
    app = await buildApp({ database, assetDirectory, iboardImportSessionStore: sessions })
    const before = (await app.inject({ method: 'GET', url: '/api/projects/target-project' })).json()
    const inspected = (await inspect(archiveWithUnknownShape())).json() as { sessionId: string }

    const commit = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: inspected.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })

    expect(commit.statusCode).toBe(409)
    expect(commit.json()).toMatchObject({
      code: IBOARD_BOARD_SNAPSHOT_UNSUPPORTED,
      boardId: expect.any(String),
    })
    expect((await app.inject({ method: 'GET', url: '/api/projects/target-project' })).json()).toEqual(before)
  })

  it('uses the archive preflight limit instead of the unrelated per-asset upload limit', async () => {
    await app.close()
    app = await buildApp({ database, assetDirectory, maxAssetBytes: 1 })

    const response = await inspect()

    expect(archive().byteLength).toBeGreaterThan(1024)
    expect(response.statusCode).toBe(201)
    expect(response.json().inspection.compatible).toBe(true)
  })

  it('expires an unclaimed session and reports it as not found', async () => {
    let now = 0
    await app.close()
    app = await buildApp({
      database,
      assetDirectory,
      iboardImportSessionTtlMs: 10,
      iboardImportSessionNow: () => now,
    })
    const inspected = (await inspect()).json() as { sessionId: string }
    now = 10

    const response = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: inspected.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ code: 'IBOARD_IMPORT_SESSION_NOT_FOUND' })
  })

  it('evicts the oldest idle session at the configured session limit', async () => {
    await app.close()
    app = await buildApp({ database, assetDirectory, iboardImportMaxSessions: 1 })
    const first = (await inspect()).json() as { sessionId: string }
    const second = (await inspect()).json() as { sessionId: string }

    const firstCommit = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: first.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })
    expect(firstCommit.statusCode).toBe(404)

    const secondCommit = await app.inject({
      method: 'POST',
      url: '/api/import/iboard/commit',
      payload: {
        sessionId: second.sessionId,
        targetProjectId: 'target-project',
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })
    expect(secondCommit.statusCode).toBe(201)
  })

  it('rejects an archive whose declared retained payload exceeds the session quota', async () => {
    const bytes = archive()
    await app.close()
    app = await buildApp({
      database,
      assetDirectory,
      iboardImportMaxBytes: bytes.byteLength + 7,
    })

    const response = await inspect(bytes)

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED' })
  })

  it('rejects compressed JSON whose declared retained payload exceeds the session quota', async () => {
    const project = runtimeCompatibleFixture()
    const board = project.boards.find((item) => item.id === 'board-c')!
    const snapshot = board.tldrawSnapshot as { store: Record<string, Record<string, unknown>> }
    snapshot.store['page:board-c']!.meta = { payload: 'x'.repeat(512 * 1024) }
    const bytes = exportProjectToIboard(project)
    expect(bytes.byteLength).toBeLessThan(10 * 1024)

    await app.close()
    app = await buildApp({
      database,
      assetDirectory,
      // This limit accepts the compressed archive and its decoded asset bytes,
      // but must reject the retained decoded board snapshot.
      iboardImportMaxBytes: bytes.byteLength + 8,
    })

    const response = await inspect(bytes)

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED' })
  })

  it('releases capacity when a session is removed', () => {
    const bytes = archive()
    const measuringStore = new IboardImportSessionStore()
    const measuredSession = measuringStore.create(bytes, 'fixture.iboard')
    const store = new IboardImportSessionStore({ maxBytes: measuredSession.byteSize + 8 })
    const first = store.create(bytes, 'fixture.iboard')
    expect(store.claim(first.sessionId)).toBeDefined()
    expect(() => store.create(bytes, 'fixture.iboard')).toThrow('IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED')

    expect(store.remove(first.sessionId)).toBe(true)
    store.create(bytes, 'fixture.iboard')
  })

  it('rejects a predictable reservation after decoding the upload', () => {
    const analyze = vi.fn(inspectAndDecodeIboard)
    const store = new IboardImportSessionStore({
      maxBytes: 100,
      measureArchive: () => 101,
      analyzeArchive: analyze,
    })

    expect(() => store.create(archive(), 'fixture.iboard')).toThrow(
      'IBOARD_IMPORT_SESSION_CAPACITY_EXCEEDED',
    )
    expect(analyze).toHaveBeenCalledOnce()
  })

  it('keeps an idle valid session when a corrupt archive has a large central-directory reservation', () => {
    const valid = archive()
    const corrupt = corruptArchiveWithLargeCentralDirectoryReservation()
    const validByteSize = measureIboardArchive(valid).retainedBytes
    const store = new IboardImportSessionStore({
      maxBytes: validByteSize + corrupt.byteLength,
    })
    const existing = store.create(valid, 'valid.iboard')

    const incompatible = store.create(corrupt, 'corrupt.iboard')

    expect(incompatible.inspection.compatible).toBe(false)
    const claimedExisting = store.claim(existing.sessionId)
    expect(claimedExisting?.archive).toEqual(valid)
    store.release(existing.sessionId)
    expect(store.claim(incompatible.sessionId)).toBeDefined()
  })

  it('evicts idle sessions after decoding and analyzes each accepted upload once', () => {
    const bytes = archive()
    const events: string[] = []
    let store!: IboardImportSessionStore
    let firstSessionId = ''
    const analyze = vi.fn((input: Uint8Array) => {
      events.push('analyze')
      if (firstSessionId) {
        expect(store.claim(firstSessionId)).toBeDefined()
        store.release(firstSessionId)
      }
      return inspectAndDecodeIboard(input)
    })
    store = new IboardImportSessionStore({
      maxBytes: 200,
      measureArchive: () => {
        events.push('measure')
        return 150
      },
      analyzeArchive: analyze,
    })

    firstSessionId = store.create(bytes, 'first.iboard').sessionId
    store.create(bytes, 'second.iboard')

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(events).toEqual(['analyze', 'measure', 'analyze', 'measure'])
  })

  it('cleans import sessions when the app closes', async () => {
    const sessions = new IboardImportSessionStore()
    await app.close()
    app = await buildApp({ database, assetDirectory, iboardImportSessionStore: sessions })
    const session = sessions.create(archive(), 'fixture.iboard')

    await app.close()

    expect(sessions.claim(session.sessionId)).toBeUndefined()
  })
})
