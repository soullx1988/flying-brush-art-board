import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import type { AllowedUser, AllowedUserDirectory } from '../auth/allowed-user-directory.js'
import { OAuthStateRepository } from '../auth/oauth-state-repository.js'
import { SESSION_COOKIE_NAME } from '../auth/auth-plugin.js'
import { SessionRepository } from '../auth/session-repository.js'
import { UserDirectoryCache } from '../auth/user-directory-cache.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { FeishuImportSessionStore } from './import-routes.js'

const now = '2026-07-24T00:00:00.000Z'

describe('Feishu import routes', () => {
  let database: LocalDatabase
  let directory: string

  beforeEach(() => {
    database = createDatabase(':memory:')
    directory = mkdtempSync(join(tmpdir(), 'feishu-routes-'))
    new ProjectRepository(database).create({ id: 'project', title: 'Project', rootBoardId: 'root', formatVersion: 1, createdAt: now, updatedAt: now })
    new BoardRepository(database).create({ id: 'root', projectId: 'project', title: 'Root', tldrawSnapshot: { store: {} }, revision: 0, createdAt: now, updatedAt: now })
  })

  afterEach(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })

  it('inspects with zero writes, then commits exactly one board and no inferred references', async () => {
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [{ id: 'link', type: 'text', x: 0, y: 0, width: 200, height: 20, text: 'https://example.feishu.cn/board/other' }] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({ backgroundColor: '#fff' }),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        downloadMedia: vi.fn(),
      },
      now: () => now,
      id: () => 'session',
    } })
    const before = new BoardRepository(database).listByProject('project')
    const inspected = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'https://example.feishu.cn/board/board_token' } })
    expect(inspected.statusCode).toBe(200)
    expect(new BoardRepository(database).listByProject('project')).toEqual(before)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })

    const sessionId = inspected.json().sessionId as string
    const committed = await app.inject({ method: 'POST', url: '/api/import/feishu/commit', payload: { sessionId, target: { kind: 'existing', projectId: 'project' }, confirmed: true } })
    expect(committed.statusCode).toBe(200)
    expect(new BoardRepository(database).listByProject('project')).toHaveLength(before.length + 1)
    expect(new BoardReferenceRepository(database).listByProject('project')).toEqual([])
    expect(new BoardRepository(database).get(committed.json().boardId)?.sourceMetadata).toMatchObject({ kind: 'feishu-whiteboard', sourceId: 'board_token' })
    expect(await app.inject({ method: 'POST', url: '/api/import/feishu/commit', payload: { sessionId, target: { kind: 'existing', projectId: 'project' }, confirmed: true } })).toMatchObject({ statusCode: 404 })
    await app.close()
  })

  it('requires a connection and explicit confirmation and cleans cancelled sessions', async () => {
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: { connected: () => false } })
    expect(await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'token' } })).toMatchObject({ statusCode: 401 })
    await app.close()
  })

  it('passes the authenticated actor through import clients and prevents B from deleting or committing A session', async () => {
    const userA = { openId: 'user-a', name: 'User A' }
    const userB = { openId: 'user-b', name: 'User B' }
    const users = new Map<string, AllowedUser>([[userA.openId, userA], [userB.openId, userB]])
    const allowedUsers: AllowedUserDirectory = {
      async findByOpenId(openId) { return users.get(openId) },
      async checkHealth() { return 'ok' },
      async close() {},
    }
    const loginSessions = new SessionRepository(database)
    const connected = vi.fn((openId: string) => openId === userA.openId)
    const resolveToken = vi.fn().mockResolvedValue('board_token')
    const client = {
      listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }),
      getWhiteboardTheme: vi.fn().mockResolvedValue({}),
      downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
      downloadMedia: vi.fn(),
    }
    const app = await buildApp({
      database,
      assetDirectory: directory,
      authentication: {
        oauth: {
          createAuthorizationUrl: ({ state }) => new URL(`https://accounts.example.test/authorize?state=${state}`),
          async exchangeCode() { return userA },
        },
        states: new OAuthStateRepository(database, undefined, 'test-only OAuth state secret with at least 32 bytes'),
        sessions: loginSessions,
        users: new UserDirectoryCache(allowedUsers),
      },
      feishuImport: { connected, resolveWhiteboardToken: resolveToken, client },
    })
    const cookieA = `${SESSION_COOKIE_NAME}=${loginSessions.create(userA)}`
    const cookieB = `${SESSION_COOKIE_NAME}=${loginSessions.create(userB)}`
    const inspected = await app.inject({
      method: 'POST', url: '/api/import/feishu/inspect', headers: { cookie: cookieA }, payload: { url: 'board_token' },
    })
    expect(inspected.statusCode).toBe(200)
    const sessionId = inspected.json().sessionId as string
    expect(connected).toHaveBeenCalledWith(userA.openId)
    expect(resolveToken).toHaveBeenCalledWith('board_token', expect.objectContaining({ actorOpenId: userA.openId }))
    expect(client.listWhiteboardNodes).toHaveBeenCalledWith('board_token', expect.objectContaining({ actorOpenId: userA.openId }))

    expect(await app.inject({ method: 'DELETE', url: `/api/import/feishu/sessions/${encodeURIComponent(sessionId)}`, headers: { cookie: cookieB } })).toMatchObject({ statusCode: 204 })
    const crossUserCommit = await app.inject({
      method: 'POST', url: '/api/import/feishu/commit', headers: { cookie: cookieB },
      payload: { sessionId, target: { kind: 'existing', projectId: 'project' }, confirmed: true },
    })
    expect(crossUserCommit.statusCode).toBe(404)
    expect(crossUserCommit.json()).toEqual({ code: 'FEISHU_IMPORT_SESSION_NOT_FOUND' })
    const ownerCommit = await app.inject({
      method: 'POST', url: '/api/import/feishu/commit', headers: { cookie: cookieA },
      payload: { sessionId, target: { kind: 'existing', projectId: 'project' }, confirmed: true },
    })
    expect(ownerCommit.statusCode).toBe(200)
    await app.close()
  })

  it('passes one request signal through nodes, theme, preview, and media without committing aborted work', async () => {
    const signals: AbortSignal[] = []
    const cancelled = new Error('FEISHU_REQUEST_CANCELLED')
    const client = {
      listWhiteboardNodes: vi.fn(async (_token: string, options?: { signal?: AbortSignal }) => {
        signals.push(options!.signal!)
        return { nodes: [{ id: 'image', type: 'image', x: 0, y: 0, width: 10, height: 10, mediaToken: 'media' }] }
      }),
      getWhiteboardTheme: vi.fn(async (_token: string, options?: { signal?: AbortSignal }) => { signals.push(options!.signal!); return {} }),
      downloadWhiteboardPreview: vi.fn(async (_token: string, options?: { signal?: AbortSignal }) => { signals.push(options!.signal!); return new Uint8Array([1]) }),
      downloadMedia: vi.fn(async (_token: string, options?: { signal?: AbortSignal }) => { signals.push(options!.signal!); throw cancelled }),
    }
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true, resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'), client,
    } })
    const response = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })
    expect(response.statusCode).toBe(422)
    expect(new Set(signals).size).toBe(1)
    expect(new BoardRepository(database).listByProject('project')).toHaveLength(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })
    await app.close()
  })

  it('does not abort a normal HTTP inspect after the request body has completed', async () => {
    let inspectSignal: AbortSignal | undefined
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn(async (_input, options) => {
        inspectSignal = options?.signal
        await new Promise((resolve) => setTimeout(resolve, 20))
        options?.signal?.throwIfAborted()
        return 'board_token'
      }),
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
        downloadMedia: vi.fn(),
      },
    } })
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })

    const response = await fetch(`${origin}/api/import/feishu/inspect`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'board_token' }),
    })

    expect(response.status).toBe(200)
    expect(inspectSignal?.aborted).toBe(false)
    await app.close()
  })

  it('propagates an actual client disconnect to the in-flight Feishu request signal', async () => {
    let observedSignal: AbortSignal | undefined
    let signalReceived!: () => void
    const received = new Promise<void>((resolve) => { signalReceived = resolve })
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn((_input, options) => new Promise<string>((_resolve, reject) => {
        observedSignal = options?.signal
        signalReceived()
        options?.signal?.addEventListener('abort', () => reject(new Error('FEISHU_REQUEST_CANCELLED')), { once: true })
      })),
      client: {
        listWhiteboardNodes: vi.fn(), getWhiteboardTheme: vi.fn(),
        downloadWhiteboardPreview: vi.fn(), downloadMedia: vi.fn(),
      },
    } })
    const origin = new URL(await app.listen({ host: '127.0.0.1', port: 0 }))
    const body = JSON.stringify({ url: 'board_token' })
    const outgoing = httpRequest({ hostname: origin.hostname, port: origin.port, path: '/api/import/feishu/inspect', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    outgoing.on('error', () => undefined)
    outgoing.end(body)
    await received

    outgoing.destroy()

    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true))
    await app.close()
  })

  it('cleans a created inspect session when the client disconnects before the response finishes', async () => {
    const sessions = new FeishuImportSessionStore()
    let releaseResponse!: () => void
    const responseReleased = new Promise<void>((resolve) => { releaseResponse = resolve })
    let responsePaused!: () => void
    const paused = new Promise<void>((resolve) => { responsePaused = resolve })
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      sessionStore: sessions,
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [{ id: 'image', type: 'image', x: 0, y: 0, width: 10, height: 10, mediaToken: 'media' }] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array([1])),
        downloadMedia: vi.fn().mockResolvedValue({ bytes: new Uint8Array([7]), mime: 'image/png', sha256: 'ca358758f6d27e6cf45272937977a748fd8833e5ae38dfe1607b0f68ffa48b82' }),
      },
    } })
    app.addHook('onSend', async (request) => {
      if (request.url !== '/api/import/feishu/inspect') return
      responsePaused()
      await responseReleased
    })
    const origin = new URL(await app.listen({ host: '127.0.0.1', port: 0 }))
    const body = JSON.stringify({ url: 'board_token' })
    const outgoing = httpRequest({ hostname: origin.hostname, port: origin.port, path: '/api/import/feishu/inspect', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    outgoing.on('error', () => undefined)
    outgoing.end(body)

    await paused
    expect(sessions.size).toBe(1)
    outgoing.destroy()

    await vi.waitFor(() => expect(sessions.size).toBe(0))
    expect(new BoardRepository(database).listByProject('project')).toHaveLength(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })
    releaseResponse()
    await app.close()
  })

  it('actively expires sessions without waiting for another store operation', async () => {
    const sessions = new FeishuImportSessionStore(Date.now, 10)
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true, resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'), sessionStore: sessions,
      client: { listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }), getWhiteboardTheme: vi.fn().mockResolvedValue({}), downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()), downloadMedia: vi.fn() },
    } })
    expect((await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })).statusCode).toBe(200)
    expect(sessions.size).toBe(1)
    await vi.waitFor(() => expect(sessions.size).toBe(0), { timeout: 500 })
    expect(sessions.totalRetainedByteLength).toBe(0)
    await app.close()
  })

  it('rejects an oversized node list before downloading preview or retaining a session', async () => {
    const sessions = new FeishuImportSessionStore()
    const downloadWhiteboardPreview = vi.fn().mockResolvedValue(new Uint8Array())
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      sessionStore: sessions,
      limits: { maxNodes: 1 },
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [
          { id: 'one', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'one' },
          { id: 'two', type: 'text', x: 10, y: 0, width: 10, height: 10, text: 'two' },
        ] }),
        getWhiteboardTheme: vi.fn(),
        downloadWhiteboardPreview,
        downloadMedia: vi.fn(),
      },
    } })

    const response = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'FEISHU_IMPORT_NODE_LIMIT_EXCEEDED' })
    expect(downloadWhiteboardPreview).not.toHaveBeenCalled()
    expect(sessions.size).toBe(0)
    expect(sessions.totalRetainedByteLength).toBe(0)
    await app.close()
  })

  it('rejects an oversized preview without retaining a session', async () => {
    const sessions = new FeishuImportSessionStore()
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      sessionStore: sessions,
      limits: { maxPreviewBytes: 2 },
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        downloadMedia: vi.fn(),
      },
    } })

    const response = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'FEISHU_IMPORT_PREVIEW_TOO_LARGE' })
    expect(sessions.size).toBe(0)
    expect(sessions.totalRetainedByteLength).toBe(0)
    await app.close()
  })

  it('rejects a single oversized media download without retaining bytes or assets', async () => {
    const sessions = new FeishuImportSessionStore()
    const bytes = new Uint8Array([1, 2, 3])
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      sessionStore: sessions,
      limits: { maxMediaItemBytes: 2 },
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [{ id: 'image', type: 'image', x: 0, y: 0, width: 10, height: 10, mediaToken: 'media' }] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
        downloadMedia: vi.fn().mockResolvedValue({ bytes, mime: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') }),
      },
    } })

    const response = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'FEISHU_IMPORT_MEDIA_TOO_LARGE' })
    expect(sessions.size).toBe(0)
    expect(sessions.totalRetainedByteLength).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })
    await app.close()
  })

  it('rejects aggregate media overflow and clears already downloaded media', async () => {
    const sessions = new FeishuImportSessionStore()
    const bytes = new Uint8Array([1, 2])
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      sessionStore: sessions,
      limits: { maxMediaItemBytes: 2, maxTotalMediaBytes: 3 },
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [
          { id: 'image-one', type: 'image', x: 0, y: 0, width: 10, height: 10, mediaToken: 'media-one' },
          { id: 'image-two', type: 'image', x: 10, y: 0, width: 10, height: 10, mediaToken: 'media-two' },
        ] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
        downloadMedia: vi.fn().mockResolvedValue({ bytes, mime: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') }),
      },
    } })

    const response = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'FEISHU_IMPORT_TOTAL_MEDIA_TOO_LARGE' })
    expect(sessions.size).toBe(0)
    expect(sessions.totalRetainedByteLength).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })
    await app.close()
  })

  it('bounds repeated inspect sessions and rejects before another download', async () => {
    const sessions = new FeishuImportSessionStore(Date.now, 60_000, { maxSessions: 1, maxRetainedSessionBytes: 1024 * 1024 })
    const resolveWhiteboardToken = vi.fn().mockResolvedValue('board_token')
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken,
      sessionStore: sessions,
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
        downloadMedia: vi.fn(),
      },
    } })

    expect((await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })).statusCode).toBe(200)
    const rejected = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(rejected.statusCode).toBe(429)
    expect(rejected.json()).toEqual({ code: 'FEISHU_IMPORT_SESSION_CAPACITY_EXCEEDED' })
    expect(resolveWhiteboardToken).toHaveBeenCalledTimes(1)
    expect(sessions.size).toBe(1)
    expect(sessions.totalRetainedByteLength).toBeGreaterThan(0)
    await app.close()
  })

  it('rejects a session that would exceed the retained-byte budget without residual accounting', async () => {
    const sessions = new FeishuImportSessionStore(Date.now, 60_000, { maxSessions: 2, maxRetainedSessionBytes: 1 })
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken: vi.fn().mockResolvedValue('board_token'),
      sessionStore: sessions,
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
        downloadMedia: vi.fn(),
      },
    } })

    const response = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'FEISHU_IMPORT_SESSION_BYTES_EXCEEDED' })
    expect(sessions.size).toBe(0)
    expect(sessions.totalRetainedByteLength).toBe(0)
    await app.close()
  })

  it('bounds concurrent inspect downloads before allocating another session', async () => {
    const sessions = new FeishuImportSessionStore()
    let releaseFirst!: (token: string) => void
    let firstStarted!: () => void
    const started = new Promise<void>((resolve) => { firstStarted = resolve })
    const resolveWhiteboardToken = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { releaseFirst = resolve; firstStarted() }))
      .mockResolvedValue('board_token')
    const app = await buildApp({ database, assetDirectory: directory, feishuImport: {
      connected: () => true,
      resolveWhiteboardToken,
      sessionStore: sessions,
      limits: { maxConcurrentInspects: 1 },
      client: {
        listWhiteboardNodes: vi.fn().mockResolvedValue({ nodes: [] }),
        getWhiteboardTheme: vi.fn().mockResolvedValue({}),
        downloadWhiteboardPreview: vi.fn().mockResolvedValue(new Uint8Array()),
        downloadMedia: vi.fn(),
      },
    } })

    const first = app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })
    await started
    const rejected = await app.inject({ method: 'POST', url: '/api/import/feishu/inspect', payload: { url: 'board_token' } })

    expect(rejected.statusCode).toBe(429)
    expect(rejected.json()).toEqual({ code: 'FEISHU_IMPORT_CONCURRENCY_EXCEEDED' })
    expect(resolveWhiteboardToken).toHaveBeenCalledTimes(1)
    expect(sessions.size).toBe(0)
    releaseFirst('board_token')
    expect((await first).statusCode).toBe(200)
    expect(sessions.size).toBe(1)
    await app.close()
  })
})
