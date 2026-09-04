import { afterEach, describe, expect, it } from 'vitest'

import { createBoardStore } from '@infinite-board/tldraw-adapter'

import { buildTestApp, type TestApp } from '../../../../tests/helpers/build-test-app.js'
import { BoardRepository } from '../modules/boards/board-repository.js'
import { ProjectRepository } from '../modules/projects/project-repository.js'

interface RealtimeCloseEvent {
  type: 'close'
  code: number
  reason: string
  messages: string[]
}

interface RealtimeMessageEvent {
  type: 'message'
  payload: string
  messages: string[]
}

async function connectRealtime(
  testApp: TestApp,
  boardId: string,
  cookie: string,
): Promise<{
  socket: Awaited<ReturnType<TestApp['app']['injectWS']>>
  firstEvent: Promise<RealtimeCloseEvent | RealtimeMessageEvent>
  closed: Promise<RealtimeCloseEvent>
  messages: string[]
}> {
  const messages: string[] = []
  let settle!: (event: RealtimeCloseEvent | RealtimeMessageEvent) => void
  let settleClosed!: (event: RealtimeCloseEvent) => void
  const firstEvent = new Promise<RealtimeCloseEvent | RealtimeMessageEvent>((resolve) => {
    settle = resolve
  })
  const closed = new Promise<RealtimeCloseEvent>((resolve) => {
    settleClosed = resolve
  })
  const socket = await testApp.app.injectWS(
    `/realtime/boards/${encodeURIComponent(boardId)}`,
    { headers: { cookie, host: 'localhost' } },
    {
      onInit(ws) {
        ws.on('message', (data: { toString(): string }) => {
          const payload = data.toString()
          messages.push(payload)
          settle({ type: 'message', payload, messages: [...messages] })
        })
        ws.on('close', (code: number, reason: { toString(): string }) => {
          const event = { type: 'close' as const, code, reason: reason.toString(), messages: [...messages] }
          settle(event)
          settleClosed(event)
        })
      },
      onOpen(ws) {
        ws.send(JSON.stringify({
          type: 'connect',
          connectRequestId: 'privacy-handshake',
          schema: createBoardStore().schema.serialize(),
          protocolVersion: 8,
          lastServerClock: -1,
        }))
      },
    },
  )
  return { socket, firstEvent, closed, messages }
}

async function firstEventWithin(
  event: Promise<RealtimeCloseEvent | RealtimeMessageEvent>,
): Promise<RealtimeCloseEvent | RealtimeMessageEvent> {
  return Promise.race([
    event,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('REALTIME_TEST_TIMEOUT')), 1_000)
      timer.unref?.()
    }),
  ])
}

describe('realtime owner-only Board privacy', () => {
  const apps: TestApp[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it('rejects a member before hydrating a public Board whose snapshot hides an owner-only reference', async () => {
    const owner = { openId: 'owner-realtime', name: 'Owner' }
    const member = { openId: 'member-realtime', name: 'Member' }
    const testApp = await buildTestApp({ users: [owner, member], enableRealtime: true })
    apps.push(testApp)
    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie: testApp.sessionCookie(owner) },
    })
    const projectId = created.json().project.id as string
    const projects = new ProjectRepository(testApp.database)
    const boards = new BoardRepository(testApp.database)
    projects.addMember(projectId, member.openId)
    const projectBoards = boards.listByProject(projectId)
    const rootBoard = projectBoards.find((board) => board.id === created.json().project.rootBoardId)!
    const privateBoard = projectBoards.find((board) => board.title === '心态')!

    const connection = await connectRealtime(
      testApp,
      rootBoard.id,
      testApp.sessionCookie(member),
    )
    const event = await firstEventWithin(connection.firstEvent)

    expect(event).toEqual({
      type: 'close',
      code: 4403,
      reason: 'BOARD_REALTIME_PROJECTED_READ_ONLY',
      messages: [],
    })
    expect(JSON.stringify(event)).not.toContain(privateBoard.id)
  })

  it('still hydrates an ordinary public child Board for a project member', async () => {
    const owner = { openId: 'owner-public', name: 'Owner' }
    const member = { openId: 'member-public', name: 'Member' }
    const testApp = await buildTestApp({ users: [owner, member], enableRealtime: true })
    apps.push(testApp)
    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie: testApp.sessionCookie(owner) },
    })
    const projectId = created.json().project.id as string
    const projects = new ProjectRepository(testApp.database)
    const boards = new BoardRepository(testApp.database)
    projects.addMember(projectId, member.openId)
    const publicBoard = boards.listByProject(projectId).find((board) => board.title === '数据')!

    const connection = await connectRealtime(
      testApp,
      publicBoard.id,
      testApp.sessionCookie(member),
    )
    const event = await firstEventWithin(connection.firstEvent)

    expect(event.type).toBe('message')
    expect(event.type === 'message' ? JSON.parse(event.payload) : undefined)
      .toMatchObject({ type: 'connect', isReadonly: false })
    connection.socket.close()
  })

  it('closes an existing public room before dynamically adding an owner-only reference', async () => {
    const owner = { openId: 'owner-dynamic', name: 'Owner' }
    const member = { openId: 'member-dynamic', name: 'Member' }
    const testApp = await buildTestApp({ users: [owner, member], enableRealtime: true })
    apps.push(testApp)
    const ownerCookie = testApp.sessionCookie(owner)
    const memberCookie = testApp.sessionCookie(member)
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: ownerCookie },
      payload: {
        id: 'project-dynamic-privacy',
        title: 'Dynamic privacy',
        rootBoard: {
          id: 'board-dynamic-root',
          title: 'Public root',
        },
      },
    })
    expect(created.statusCode).toBe(201)
    const projectId = created.json().project.id as string
    const rootBoardId = created.json().rootBoard.id as string
    const projects = new ProjectRepository(testApp.database)
    const boards = new BoardRepository(testApp.database)
    projects.addMember(projectId, member.openId)
    const privateBoard = boards.create({
      id: 'board-dynamic-private',
      projectId,
      title: '心态动态私密板',
      tldrawSnapshot: { store: {} },
      accessLevel: 'owner-only',
      ownerOpenId: owner.openId,
      revision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const memberConnection = await connectRealtime(testApp, rootBoardId, memberCookie)
    expect((await firstEventWithin(memberConnection.firstEvent)).type).toBe('message')

    const reference = await testApp.app.inject({
      method: 'POST',
      url: `/api/boards/${rootBoardId}/references`,
      headers: { cookie: ownerCookie },
      payload: {
        targetBoardId: privateBoard.id,
        shapeId: 'shape:dynamic-private-reference',
        kind: 'embed',
        expectedRevision: 0,
      },
    })
    expect(reference.statusCode).toBe(201)
    const close = await firstEventWithin(memberConnection.closed)
    expect(close.type).toBe('close')
    expect(JSON.stringify(memberConnection.messages)).not.toContain(privateBoard.id)
    expect(JSON.stringify(memberConnection.messages)).not.toContain(privateBoard.title)

    const deniedReconnect = await connectRealtime(testApp, rootBoardId, memberCookie)
    expect(await firstEventWithin(deniedReconnect.firstEvent)).toMatchObject({
      type: 'close',
      code: 4403,
      reason: 'BOARD_REALTIME_PROJECTED_READ_ONLY',
      messages: [],
    })

    const ownerReconnect = await connectRealtime(testApp, rootBoardId, ownerCookie)
    const ownerEvent = await firstEventWithin(ownerReconnect.firstEvent)
    expect(ownerEvent.type).toBe('message')
    expect(ownerEvent.type === 'message' ? ownerEvent.payload : '').toContain(privateBoard.id)
    ownerReconnect.socket.close()
  })

  it('disconnects a legacy mindset member room before upgrading it to owner-only', async () => {
    const owner = { openId: 'owner-legacy-upgrade', name: 'Owner' }
    const member = { openId: 'member-legacy-upgrade', name: 'Member' }
    const testApp = await buildTestApp({ users: [owner, member], enableRealtime: true })
    apps.push(testApp)
    const ownerCookie = testApp.sessionCookie(owner)
    const memberCookie = testApp.sessionCookie(member)
    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie: ownerCookie },
    })
    const projectId = created.json().project.id as string
    const projects = new ProjectRepository(testApp.database)
    const boards = new BoardRepository(testApp.database)
    projects.addMember(projectId, member.openId)
    const mindset = boards.listByProject(projectId).find((board) => board.title === '心态')!
    boards.setAccess(mindset.id, 'project')
    testApp.database.prepare(`UPDATE workspace_bootstrap_markers SET template_version = 2
      WHERE template_key = ? AND owner_open_id = ?`)
      .run('shortline-trading-v1', owner.openId)

    const legacyConnection = await connectRealtime(testApp, mindset.id, memberCookie)
    expect((await firstEventWithin(legacyConnection.firstEvent)).type).toBe('message')

    const upgraded = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie: ownerCookie },
    })
    expect(upgraded.statusCode).toBe(200)
    expect(upgraded.json().boards).toContainEqual(expect.objectContaining({
      id: mindset.id,
      accessLevel: 'owner-only',
      ownerOpenId: owner.openId,
    }))
    expect((await firstEventWithin(legacyConnection.closed)).type).toBe('close')

    try {
      legacyConnection.socket.send('late-private-write-marker')
    } catch {
      // A closed WebSocket may reject synchronously; either behavior is safe.
    }
    await Promise.resolve()
    const durableRealtimeState = testApp.database.prepare(`SELECT snapshot_json AS value
      FROM realtime_room_snapshots WHERE board_id = ?
      UNION ALL SELECT payload AS value FROM realtime_room_updates WHERE board_id = ?`)
      .all(mindset.id, mindset.id) as Array<{ value: string }>
    expect(JSON.stringify(durableRealtimeState)).not.toContain('late-private-write-marker')

    const deniedReconnect = await connectRealtime(testApp, mindset.id, memberCookie)
    expect(await firstEventWithin(deniedReconnect.firstEvent)).toMatchObject({
      type: 'close',
      code: 4403,
      reason: 'BOARD_ACCESS_DENIED',
      messages: [],
    })
    expect((await testApp.app.inject({
      method: 'GET', url: `/api/boards/${mindset.id}`, headers: { cookie: memberCookie },
    })).statusCode).toBe(403)
    expect((await testApp.app.inject({
      method: 'PUT',
      url: `/api/boards/${mindset.id}/snapshot`,
      headers: { cookie: memberCookie },
      payload: { expectedRevision: mindset.revision, snapshot: { store: { latePrivateWrite: true } } },
    })).statusCode).toBe(403)
  })
})
