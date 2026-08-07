import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../../app.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
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
    await app.close()
  })
})
