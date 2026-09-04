import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { AssetRepository } from '../assets/asset-repository.js'
import type { AllowedUser, AllowedUserDirectory } from '../auth/allowed-user-directory.js'
import { registerAuthenticationPlugin, SESSION_COOKIE_NAME } from '../auth/auth-plugin.js'
import { SessionRepository } from '../auth/session-repository.js'
import { UserDirectoryCache } from '../auth/user-directory-cache.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { registerFeishuImportRoutes } from './import-routes.js'

const timestamp = '2026-08-10T00:00:00.000Z'
const userA = { openId: 'import-user-a', name: 'Import User A' }
const userB = { openId: 'import-user-b', name: 'Import User B' }

describe('Feishu import actor isolation', () => {
  const databases: LocalDatabase[] = []
  const directories: string[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('uses the request actor for all reads and prevents another member from consuming or deleting a session', async () => {
    const database = createDatabase(':memory:')
    databases.push(database)
    const directory = mkdtempSync(join(tmpdir(), 'feishu-import-actor-'))
    directories.push(directory)
    const projects = new ProjectRepository(database)
    projects.create({
      id: 'shared-project',
      title: 'Shared project',
      rootBoardId: 'shared-root',
      formatVersion: 1,
      ownerOpenId: userA.openId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    projects.addMember('shared-project', userB.openId)
    new BoardRepository(database).create({
      id: 'shared-root',
      projectId: 'shared-project',
      title: 'Shared root',
      tldrawSnapshot: { store: {} },
      accessLevel: 'project',
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const sessions = new SessionRepository(database)
    const users = new Map<string, AllowedUser>([[userA.openId, userA], [userB.openId, userB]])
    const directoryClient: AllowedUserDirectory = {
      async findByOpenId(openId) { return users.get(openId) },
      async checkHealth() { return 'ok' },
      async close() {},
    }
    const connected = vi.fn((actorOpenId: string) => actorOpenId === userA.openId)
    const resolveWhiteboardToken = vi.fn(async (_input: string, options: { actorOpenId: string }) => {
      expect(options.actorOpenId).toBe(userA.openId)
      return 'board_token'
    })
    const listWhiteboardNodes = vi.fn(async (_token: string, options?: { actorOpenId?: string }) => {
      expect(options?.actorOpenId).toBe(userA.openId)
      return { nodes: [] }
    })
    const getWhiteboardTheme = vi.fn(async (_token: string, options?: { actorOpenId?: string }) => {
      expect(options?.actorOpenId).toBe(userA.openId)
      return {}
    })
    const downloadWhiteboardPreview = vi.fn(async (_token: string, options?: { actorOpenId?: string }) => {
      expect(options?.actorOpenId).toBe(userA.openId)
      return new Uint8Array()
    })
    const app = Fastify({ logger: false })
    await app.register(cookie)
    registerAuthenticationPlugin(app, { sessions, users: new UserDirectoryCache(directoryClient) })
    registerFeishuImportRoutes(app, database, new AssetRepository(database, directory), {
      connected,
      resolveWhiteboardToken,
      client: {
        listWhiteboardNodes,
        getWhiteboardTheme,
        downloadWhiteboardPreview,
        downloadMedia: vi.fn(),
      },
      now: () => timestamp,
    })
    const cookieFor = (user: AllowedUser) => `${SESSION_COOKIE_NAME}=${sessions.create(user)}`
    const cookieA = cookieFor(userA)
    const cookieB = cookieFor(userB)

    const deniedB = await app.inject({
      method: 'POST',
      url: '/api/import/feishu/inspect',
      headers: { cookie: cookieB },
      payload: { url: 'board_token' },
    })
    expect(deniedB.statusCode).toBe(401)
    expect(deniedB.json()).toEqual({ code: 'FEISHU_ACCOUNT_NOT_CONNECTED' })

    const inspectA = await app.inject({
      method: 'POST',
      url: '/api/import/feishu/inspect',
      headers: { cookie: cookieA },
      payload: { url: 'board_token' },
    })
    expect(inspectA.statusCode).toBe(200)
    const sessionId = inspectA.json().sessionId as string
    expect(connected).toHaveBeenNthCalledWith(1, userB.openId)
    expect(connected).toHaveBeenNthCalledWith(2, userA.openId)

    const commitPayload = {
      sessionId,
      target: { kind: 'existing', projectId: 'shared-project' },
      confirmed: true,
    }
    const crossUserCommit = await app.inject({
      method: 'POST',
      url: '/api/import/feishu/commit',
      headers: { cookie: cookieB },
      payload: commitPayload,
    })
    expect(crossUserCommit.statusCode).toBe(404)
    expect(crossUserCommit.json()).toEqual({ code: 'FEISHU_IMPORT_SESSION_NOT_FOUND' })
    expect((await app.inject({
      method: 'POST',
      url: '/api/import/feishu/commit',
      headers: { cookie: cookieA },
      payload: commitPayload,
    })).statusCode).toBe(200)

    const secondInspect = await app.inject({
      method: 'POST',
      url: '/api/import/feishu/inspect',
      headers: { cookie: cookieA },
      payload: { url: 'board_token' },
    })
    const secondSessionId = secondInspect.json().sessionId as string
    expect((await app.inject({
      method: 'DELETE',
      url: `/api/import/feishu/sessions/${encodeURIComponent(secondSessionId)}`,
      headers: { cookie: cookieB },
    })).statusCode).toBe(204)
    expect((await app.inject({
      method: 'POST',
      url: '/api/import/feishu/commit',
      headers: { cookie: cookieA },
      payload: { ...commitPayload, sessionId: secondSessionId },
    })).statusCode).toBe(200)

    await app.close()
  })
})
