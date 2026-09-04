import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from './app.js'

describe('local API', () => {
  const apps: FastifyInstance[] = []
  const directories: string[] = []

  const buildTestApp = async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-app-'))
    directories.push(dataDirectory)
    return buildApp({
      dataDirectory,
      databasePath: ':memory:',
      assetDirectory: join(dataDirectory, 'assets'),
    })
  }

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
    directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }))
  })

  it('reports Fastify, SQLite, user-directory, and realtime health without configuration details', async () => {
    const app = await buildTestApp()
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      userDirectory: 'not-configured',
      realtime: 'disabled',
      tradingBridge: 'enabled',
    })
  })

  it('cannot be made to listen on a non-loopback interface after construction', async () => {
    const app = await buildTestApp()
    apps.push(app)

    expect(() => app.listen({ host: '0.0.0.0', port: 0 })).toThrow('Loopback host required')
  })

  it('provides a fixed local user for first-stage acceptance when Feishu authentication is disabled', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-app-'))
    directories.push(dataDirectory)
    const app = await buildApp({
      dataDirectory,
      databasePath: ':memory:',
      assetDirectory: join(dataDirectory, 'assets'),
      environment: {
        NODE_ENV: 'development',
        FEISHU_AUTH_ENABLED: 'false',
        FEISHU_WHITELIST_ENABLED: 'false',
      },
      enableRealtime: true,
    })
    apps.push(app)

    const currentUser = await app.inject({ method: 'GET', url: '/api/me' })
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout' })

    expect(currentUser.statusCode).toBe(200)
    expect(currentUser.json()).toEqual({
      openId: 'local-acceptance-user',
      name: 'Local acceptance user',
      realtimeEnabled: true,
    })
    expect(logout.statusCode).toBe(204)

    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: 'acceptance-project',
        title: 'Acceptance project',
        rootBoard: { id: 'acceptance-board', title: 'Acceptance board' },
      },
    })
    expect(project.statusCode).toBe(201)

    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/boards/acceptance-board/snapshot',
    })
    expect(snapshot.statusCode).toBe(200)
    expect(snapshot.json()).toMatchObject({ revision: 0, snapshot: { store: {} } })

    const comment = await app.inject({
      method: 'POST',
      url: '/api/boards/acceptance-board/comments',
      payload: { body: 'Acceptance comment' },
    })
    expect(comment.statusCode).toBe(201)
    expect(comment.json()).toMatchObject({
      thread: { createdBy: 'local-acceptance-user' },
      message: { authorOpenId: 'local-acceptance-user', body: 'Acceptance comment' },
    })
  })
})
