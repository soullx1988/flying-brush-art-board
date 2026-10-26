import { afterEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../../../../../tests/helpers/build-test-app.js'

describe('audit routes', () => {
  const apps: TestApp[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('records successful authenticated mutations without serializing request content', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    const create = await testApp.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { id: 'p', title: 'Sensitive project title', rootBoard: { id: 'b', title: 'Sensitive board title' } } })
    expect(create.statusCode).toBe(201)
    const audits = await testApp.app.inject({ method: 'GET', url: '/api/audit-events', headers: { cookie } })
    expect(audits.json()).toEqual([expect.objectContaining({ actorOpenId: 'test-user', action: 'project.create', summary: { method: 'POST', route: '/api/projects', statusCode: 201 } })])
    expect(audits.body).not.toContain('Sensitive')
  })

  it('supports filtered cursor pagination through the public audit endpoint', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    await testApp.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { id: 'p', title: 'P', rootBoard: { id: 'b', title: 'B' } } })
    await testApp.app.inject({ method: 'POST', url: '/api/projects/p/boards', headers: { cookie }, payload: { id: 'b2', title: 'B2' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const response = await testApp.app.inject({ method: 'GET', url: '/api/audit?projectId=p&actorOpenId=test-user&limit=1', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ events: [expect.objectContaining({ projectId: 'p', actorOpenId: 'test-user' })] })
  })

  it('records semantic comment status and delete actions without storing content', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    testApp.database.exec("INSERT INTO projects (id,title,root_board_id,format_version,created_at,updated_at) VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
    const cookie = testApp.sessionCookie()
    const created = await testApp.app.inject({ method: 'POST', url: '/api/boards/b/comments', headers: { cookie }, payload: { body: 'Sensitive comment' } })
    const threadId = (created.json() as { thread: { id: string } }).thread.id
    await testApp.app.inject({ method: 'PATCH', url: `/api/comment-threads/${threadId}`, headers: { cookie }, payload: { status: 'resolved' } })
    await testApp.app.inject({ method: 'DELETE', url: `/api/comment-threads/${threadId}`, headers: { cookie } })
    const events = (await testApp.app.inject({ method: 'GET', url: '/api/audit?action=comment.resolve', headers: { cookie } })).json() as { events: Array<{ action: string; summary: unknown }> }
    expect(events.events).toEqual([expect.objectContaining({ action: 'comment.resolve' })])
    expect(JSON.stringify(events)).not.toContain('Sensitive comment')
    const deleted = (await testApp.app.inject({ method: 'GET', url: '/api/audit?action=comment.delete', headers: { cookie } })).json() as { events: Array<{ action: string }> }
    expect(deleted.events).toEqual([expect.objectContaining({ action: 'comment.delete' })])
  })

  it('associates duplicate and delete events with the new or deleted Board instead of the source Board', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    await testApp.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { id: 'p', title: 'P', rootBoard: { id: 'root', title: 'Root' } } })
    await testApp.app.inject({ method: 'POST', url: '/api/projects/p/boards', headers: { cookie }, payload: { id: 'source', title: 'Source' } })
    expect((await testApp.app.inject({ method: 'POST', url: '/api/boards/source/duplicate', headers: { cookie }, payload: { id: 'copy', title: 'Copy' } })).statusCode).toBe(201)
    expect((await testApp.app.inject({ method: 'DELETE', url: '/api/boards/copy', headers: { cookie } })).statusCode).toBe(204)

    const created = (await testApp.app.inject({ method: 'GET', url: '/api/audit?projectId=p&boardId=copy&action=board.create', headers: { cookie } })).json() as { events: Array<{ boardId?: string }> }
    const deleted = (await testApp.app.inject({ method: 'GET', url: '/api/audit?projectId=p&boardId=copy&action=board.delete', headers: { cookie } })).json() as { events: Array<{ boardId?: string }> }
    expect(created.events).toEqual([expect.objectContaining({ boardId: 'copy' })])
    expect(deleted.events).toEqual([expect.objectContaining({ boardId: 'copy' })])
  })
})
