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
    const testApp = await buildTestApp({ automationProjectTag: 'playwright-e2e' })
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

  it('rejects an automation header when the server did not enable automation marking', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: {
        cookie: testApp.sessionCookie(),
        'x-infinite-board-automation': 'attacker-controlled',
      },
      payload: { id: 'untrusted-p1', title: 'Untrusted marker', rootBoard: { id: 'untrusted-b1', title: 'Overview' } },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'AUTOMATION_MARKING_DENIED' })
    expect(testApp.database.prepare('SELECT 1 FROM projects WHERE id = ?').get('untrusted-p1')).toBeUndefined()
    expect(testApp.database.prepare('SELECT 1 FROM automation_projects WHERE project_id = ?').get('untrusted-p1')).toBeUndefined()
  })

  it('rejects a marker that does not exactly match the server-authorized E2E tag', async () => {
    const testApp = await buildTestApp({ automationProjectTag: 'expected-run' })
    apps.push(testApp)
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: {
        cookie: testApp.sessionCookie(),
        'x-infinite-board-automation': 'other-run',
      },
      payload: { id: 'wrong-run-p1', title: 'Wrong run', rootBoard: { id: 'wrong-run-b1', title: 'Overview' } },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ code: 'AUTOMATION_MARKING_DENIED' })
    expect(testApp.database.prepare('SELECT 1 FROM projects WHERE id = ?').get('wrong-run-p1')).toBeUndefined()
  })

  it('does not allow an owner-only Board to become the project root', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie },
      payload: { id: 'root-policy-project', title: 'Root policy', rootBoard: { id: 'public-root', title: 'Overview' } },
    })
    await testApp.app.inject({
      method: 'POST',
      url: '/api/projects/root-policy-project/boards',
      headers: { cookie },
      payload: { id: 'private-board', title: 'Private', accessLevel: 'owner-only' },
    })

    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/projects/root-policy-project/root-board',
      headers: { cookie },
      payload: { boardId: 'private-board' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'ROOT_BOARD_MUST_BE_PROJECT_ACCESSIBLE' })
    expect(testApp.database.prepare('SELECT root_board_id FROM projects WHERE id=?').get('root-policy-project'))
      .toEqual({ root_board_id: 'public-root' })
  })

  it('cannot replace a protected root or delete a managed trading workspace through ordinary HTTP', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie },
      payload: { id: 'protected-workspace', title: 'Protected workspace', rootBoard: { id: 'protected-root', title: 'Root' } },
    })
    await testApp.app.inject({
      method: 'POST',
      url: '/api/projects/protected-workspace/boards',
      headers: { cookie },
      payload: { id: 'replacement-root', title: 'Replacement' },
    })
    const protectedRecord = {
      id: 'shape:today-entry',
      typeName: 'shape',
      type: 'board-reference',
      parentId: 'page:page',
      opacity: 1,
      meta: { protectedCore: true, template: 'shortline-trading-v1', templateRole: 'today-entry' },
      props: { referenceId: 'reference:today', targetBoardId: 'today-board', kind: 'embed' },
    }
    testApp.database.prepare('UPDATE boards SET tldraw_snapshot = ? WHERE id = ?')
      .run(JSON.stringify({ store: { [protectedRecord.id]: protectedRecord } }), 'protected-root')

    const changedRoot = await testApp.app.inject({
      method: 'PUT',
      url: '/api/projects/protected-workspace/root-board',
      headers: { cookie },
      payload: { boardId: 'replacement-root' },
    })
    expect(changedRoot.statusCode).toBe(409)
    expect(changedRoot.json()).toEqual({
      code: 'PROTECTED_CORE_MUTATION_FORBIDDEN',
      recordId: protectedRecord.id,
      reason: 'root-board-change',
      rootBoardId: 'protected-root',
    })
    expect(testApp.database.prepare('SELECT root_board_id FROM projects WHERE id = ?')
      .get('protected-workspace')).toEqual({ root_board_id: 'protected-root' })

    testApp.database.prepare(`INSERT INTO workspace_bootstrap_markers
      (template_key, owner_open_id, template_version, project_id, applied_at) VALUES (?, ?, ?, ?, ?)`)
      .run('shortline-trading-v1', 'local-acceptance-user', 5, 'protected-workspace', '2026-08-14T00:00:00.000Z')
    const deleted = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/projects/protected-workspace',
      headers: { cookie },
    })
    expect(deleted.statusCode).toBe(409)
    expect(deleted.json()).toEqual({
      code: 'PROTECTED_WORKSPACE_DELETE_REQUIRES_CONFIRMATION',
      projectId: 'protected-workspace',
      templateKey: 'shortline-trading-v1',
      templateVersion: 5,
    })
    expect(testApp.database.prepare('SELECT 1 FROM projects WHERE id = ?').get('protected-workspace')).toBeDefined()
    expect(testApp.database.prepare('SELECT 1 FROM workspace_bootstrap_markers WHERE project_id = ?')
      .get('protected-workspace')).toBeDefined()
  })
})
