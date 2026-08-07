import { afterEach, describe, expect, it } from 'vitest'

import { buildTestApp, type TestApp } from '../../../../../tests/helpers/build-test-app.js'

describe('project routes', () => {
  const apps: TestApp[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it('returns project card metadata and supports rename and delete', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()

    expect((await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie },
      payload: { id: 'p1', title: 'Project One', rootBoard: { id: 'b1', title: 'Overview' } },
    })).statusCode).toBe(201)
    expect((await testApp.app.inject({
      method: 'POST',
      url: '/api/projects/p1/boards',
      headers: { cookie },
      payload: { id: 'b2', title: 'Research Notes' },
    })).statusCode).toBe(201)

    const listed = await testApp.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual([
      expect.objectContaining({
        id: 'p1',
        boardCount: 2,
        rootBoardTitle: 'Overview',
        boardTitles: ['Overview', 'Research Notes'],
      }),
    ])

    const renamed = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/projects/p1',
      headers: { cookie },
      payload: { title: 'Renamed Project' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({ id: 'p1', title: 'Renamed Project' })

    testApp.database.prepare(`
      INSERT INTO board_references
        (id, project_id, source_board_id, target_board_id, shape_id, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('r1', 'p1', 'b1', 'b2', 'shape:link', 'link', '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z')

    expect((await testApp.app.inject({ method: 'DELETE', url: '/api/projects/p1', headers: { cookie } })).statusCode).toBe(204)
    expect((await testApp.app.inject({ method: 'GET', url: '/api/projects/p1', headers: { cookie } })).statusCode).toBe(404)
    expect((await testApp.app.inject({ method: 'GET', url: '/api/boards/b1', headers: { cookie } })).statusCode).toBe(404)
    expect(testApp.database.prepare('SELECT 1 FROM board_references WHERE project_id = ?').get('p1')).toBeUndefined()
    const audit = (await testApp.app.inject({ method: 'GET', url: '/api/audit?projectId=p1&limit=20', headers: { cookie } })).json() as { events: Array<{ action: string }> }
    expect(audit.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'project.rename' }),
      expect.objectContaining({ action: 'project.delete' }),
    ]))
  })

  it('marks projects created by automation requests', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: {
        cookie: testApp.sessionCookie(),
        'x-infinite-board-automation': 'playwright-e2e',
      },
      payload: { id: 'automation-p1', title: 'Automation project', rootBoard: { id: 'automation-b1', title: 'Overview' } },
    })
    expect(response.statusCode).toBe(201)
    expect(testApp.database.prepare('SELECT tag FROM automation_projects WHERE project_id = ?').get('automation-p1'))
      .toEqual({ tag: 'playwright-e2e' })
    expect((await testApp.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: testApp.sessionCookie() } })).json())
      .toEqual([expect.objectContaining({ id: 'automation-p1', automationTag: 'playwright-e2e' })])
  })
})
