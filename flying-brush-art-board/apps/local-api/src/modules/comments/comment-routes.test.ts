import { afterEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../../../../../tests/helpers/build-test-app.js'

describe('comment routes', () => {
  const apps: TestApp[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it('uses the authenticated user as author and exposes thread lifecycle routes', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    testApp.database.exec("INSERT INTO projects VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{}',NULL,0,'t','t')")
    const cookie = testApp.sessionCookie()
    expect((await testApp.app.inject({ method: 'POST', url: '/api/boards/b/comments', payload: { body: 'Review', shapeId: 'shape:1', x: 2, y: 3 } })).statusCode).toBe(401)
    const created = await testApp.app.inject({ method: 'POST', url: '/api/boards/b/comments', headers: { cookie }, payload: { body: 'Review', shapeId: 'shape:1', x: 2, y: 3 } })
    expect(created.statusCode).toBe(201)
    const body = created.json() as { thread: { id: string; createdBy: string }; message: { id: string; authorOpenId: string } }
    expect(body.thread.createdBy).toBe('test-user')
    expect(body.message.authorOpenId).toBe('test-user')
    expect((await testApp.app.inject({
      method: 'POST',
      url: `/api/comment-threads/${body.thread.id}/messages`,
      headers: { cookie },
      payload: { body: 'Reply' },
    })).statusCode).toBe(201)
    const state = await testApp.app.inject({ method: 'GET', url: '/api/boards/b/comment-state', headers: { cookie } })
    expect(state.statusCode).toBe(200)
    expect(state.json()).toMatchObject({ threads: [{ id: body.thread.id }], messages: [{ threadId: body.thread.id }, { threadId: body.thread.id }] })
    expect((await testApp.app.inject({
      method: 'PATCH',
      url: `/api/comment-threads/${body.thread.id}`,
      headers: { cookie },
      payload: { x: 40, y: 50 },
    })).json()).toMatchObject({ x: 40, y: 50 })
    expect((await testApp.app.inject({ method: 'PATCH', url: `/api/comment-threads/${body.thread.id}`, headers: { cookie }, payload: { status: 'resolved' } })).json()).toMatchObject({ status: 'resolved' })
    expect((await testApp.app.inject({ method: 'PATCH', url: `/api/comment-threads/${body.thread.id}`, headers: { cookie }, payload: { status: 'open' } })).json()).toMatchObject({ status: 'open' })
    expect((await testApp.app.inject({ method: 'DELETE', url: `/api/comment-messages/${body.message.id}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await testApp.app.inject({ method: 'GET', url: `/api/comment-threads/${body.thread.id}/messages`, headers: { cookie } })).json()).toEqual(expect.arrayContaining([expect.objectContaining({ deletedAt: expect.any(String) })]))
    expect((await testApp.app.inject({ method: 'DELETE', url: `/api/comment-threads/${body.thread.id}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await testApp.app.inject({ method: 'GET', url: `/api/comment-threads/${body.thread.id}/messages`, headers: { cookie } })).statusCode).toBe(404)
    expect((await testApp.app.inject({ method: 'DELETE', url: `/api/comment-threads/${body.thread.id}`, headers: { cookie } })).json()).toEqual({ code: 'COMMENT_THREAD_NOT_FOUND' })

    const audit = await testApp.app.inject({ method: 'GET', url: '/api/audit?projectId=p&limit=20', headers: { cookie } })
    expect(audit.statusCode).toBe(200)
    const actions = (audit.json() as { events: Array<{ action: string; projectId?: string; boardId?: string }> }).events
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'comment.create', projectId: 'p', boardId: 'b' }),
      expect.objectContaining({ action: 'comment.reply', projectId: 'p', boardId: 'b' }),
      expect.objectContaining({ action: 'comment.move', projectId: 'p', boardId: 'b' }),
      expect.objectContaining({ action: 'comment.resolve', projectId: 'p', boardId: 'b' }),
      expect.objectContaining({ action: 'comment.reopen', projectId: 'p', boardId: 'b' }),
      expect.objectContaining({ action: 'comment.delete', projectId: 'p', boardId: 'b' }),
    ]))
  })
})
