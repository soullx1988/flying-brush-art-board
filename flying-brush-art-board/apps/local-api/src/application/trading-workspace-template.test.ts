import { afterEach, describe, expect, it } from 'vitest'

import {
  createBoardStore,
  getStoreSnapshot,
  listBoardReferenceShapes,
  loadSnapshotIntoStore,
} from '@infinite-board/tldraw-adapter'

import { buildTestApp, type TestApp } from '../../../../tests/helpers/build-test-app.js'
import { ProjectRepository } from '../modules/projects/project-repository.js'
import { buildTradingWorkspaceTemplate } from './trading-workspace-template.js'

describe('trading workspace template', () => {
  const apps: TestApp[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it('builds one root board with a protected today board plus four personal layers', () => {
    let sequence = 0
    const template = buildTradingWorkspaceTemplate(
      'owner-a',
      '2026-08-08T08:00:00.000Z',
      () => String(++sequence),
    )

    expect(template.project.title).toBe('短线主线交易工作台')
    expect(template.rootBoard.title).toBe('总览')
    expect(template.boards.map((board) => board.title)).toEqual(['总览', '今天怎么看', '数据', '逻辑', '经验', '心态'])
    expect(template.references).toHaveLength(5)
    expect(template.references.every((reference) => reference.kind === 'embed')).toBe(true)
    expect(template.project.ownerOpenId).toBe('owner-a')
    expect(template.boards.find((board) => board.title === '心态')).toMatchObject({
      accessLevel: 'owner-only',
      ownerOpenId: 'owner-a',
    })

    const shapes = listBoardReferenceShapes(template.rootBoard.tldrawSnapshot)
    expect(shapes).toHaveLength(5)
    expect(shapes.map((shape) => shape.props.titleFallback)).toEqual(['今天怎么看', '数据', '逻辑', '经验', '心态'])
    expect(shapes.map((shape) => shape.props.previewMode)).toEqual([
      'content', 'content', 'content', 'content', 'private',
    ])
    expect(shapes.every((shape) => shape.props.w === 620 && shape.props.h === 330)).toBe(true)
    expect(new Set(shapes.map((shape) => `${shape.x}:${shape.y}`)).size).toBe(5)
    expect(shapes.find((shape) => shape.props.titleFallback === '今天怎么看')?.meta).toMatchObject({
      templateRole: 'today-entry',
      protectedCore: true,
    })

    const dataBoard = template.boards.find((board) => board.title === '数据')!
    const dataShapes = Object.values((dataBoard.tldrawSnapshot as {
      store: Record<string, { type: string; props?: { title?: string; panelKind?: string } }>
    }).store)
    const tradingPanels = dataShapes.filter((shape) => shape.type === 'trading-panel')
    expect(tradingPanels).toHaveLength(5)
    expect(tradingPanels).toContainEqual(expect.objectContaining({
      props: expect.objectContaining({ panelKind: 'announcements', title: '公告观察源' }),
    }))
    expect(tradingPanels).toContainEqual(expect.objectContaining({
      meta: expect.objectContaining({ templateRole: 'yishui-inference-panel' }),
      props: expect.objectContaining({ panelKind: 'yishui-inference', title: '义水北路推演画板' }),
    }))
    const todayBoard = template.boards.find((board) => board.title === '今天怎么看')!
    expect(Object.values((todayBoard.tldrawSnapshot as { store: Record<string, unknown> }).store)).toEqual([
      expect.objectContaining({
        type: 'trading-panel',
        meta: expect.objectContaining({ templateRole: 'today-core', protectedCore: true }),
        props: expect.objectContaining({ panelKind: 'today-overview', title: '今天怎么看' }),
      }),
    ])
    for (const title of ['逻辑', '经验', '心态']) {
      const board = template.boards.find((candidate) => candidate.title === title)!
      expect(Object.values((board.tldrawSnapshot as { store: Record<string, { type: string }> }).store))
        .toEqual([expect.objectContaining({ type: 'table' })])
    }
    const rootStore = createBoardStore()
    loadSnapshotIntoStore(rootStore, template.rootBoard.tldrawSnapshot)
    const serializedShapes = listBoardReferenceShapes(getStoreSnapshot(rootStore))
    expect(serializedShapes.find((shape) => shape.props.titleFallback === '心态')?.props.previewMode)
      .toBe('private')
    expect(serializedShapes.filter((shape) => shape.props.previewMode === 'private')).toHaveLength(1)
    rootStore.dispose()

    for (const board of template.boards) {
      const store = createBoardStore()
      expect(() => loadSnapshotIntoStore(store, board.tldrawSnapshot)).not.toThrow()
      store.dispose()
    }
  })

  it('bootstraps atomically, blocks casual deletion, and recreates after a confirmed reset', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()

    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ status: 'created' })
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 1 })
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM boards').get()).toEqual({ count: 6 })
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM board_references').get()).toEqual({ count: 5 })

    const existing = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })
    expect(existing.statusCode).toBe(200)
    expect(existing.json()).toMatchObject({
      status: 'existing',
      project: { id: created.json().project.id },
    })
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM boards').get()).toEqual({ count: 6 })

    const unconfirmedDelete = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/projects/${created.json().project.id}`,
      headers: { cookie },
    })
    expect(unconfirmedDelete.statusCode).toBe(409)
    expect(unconfirmedDelete.json()).toMatchObject({ code: 'PROTECTED_WORKSPACE_DELETE_REQUIRES_CONFIRMATION' })

    const projects = new ProjectRepository(testApp.database)
    expect(projects.remove(created.json().project.id, { confirmedProtectedWorkspaceDelete: true })).toBe(true)
    const recreated = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })
    expect(recreated.statusCode).toBe(201)
    expect(recreated.json()).toMatchObject({ status: 'created' })
    expect(recreated.json().project.id).not.toBe(created.json().project.id)
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 1 })
  })

  it('does not trust a v5 marker when its protected today structure is incomplete', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    const created = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    const todayReference = (created.json().references as Array<{
      id: string
      targetBoardId: string
      shapeId: string
    }>).find((reference) => {
      const target = (created.json().boards as Array<{ id: string; title: string }>)
        .find((board) => board.id === reference.targetBoardId)
      return target?.title === '今天怎么看'
    })!
    const rootSnapshot = structuredClone(created.json().rootBoard.tldrawSnapshot) as {
      store: Record<string, unknown>
    }
    delete rootSnapshot.store[todayReference.shapeId]
    testApp.database.transaction(() => {
      testApp.database.prepare('DELETE FROM board_references WHERE id = ?').run(todayReference.id)
      testApp.database.prepare('UPDATE boards SET tldraw_snapshot = ? WHERE id = ?')
        .run(JSON.stringify(rootSnapshot), created.json().rootBoard.id)
    })()

    const invalid = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    expect(invalid.statusCode).toBe(500)
    expect(testApp.database.prepare(`SELECT template_version FROM workspace_bootstrap_markers
      WHERE template_key = ? AND owner_open_id = ?`).get('shortline-trading-v1', 'test-user'))
      .toEqual({ template_version: 6 })
  })

  it('repairs a missing Yishui panel behind a v6 marker exactly once', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    const created = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    const dataBoard = (created.json().boards as Array<{
      id: string
      title: string
      revision: number
      tldrawSnapshot: { store: Record<string, any> }
    }>).find((board) => board.title === '数据')!
    const damagedSnapshot = structuredClone(dataBoard.tldrawSnapshot)
    for (const [shapeId, shape] of Object.entries(damagedSnapshot.store)) {
      if (shape.props?.panelKind === 'yishui-inference') delete damagedSnapshot.store[shapeId]
    }
    damagedSnapshot.store['shape:personal-note'] = {
      id: 'shape:personal-note',
      typeName: 'shape',
      type: 'note',
      parentId: 'page:page',
      index: 'a9',
      x: 2200,
      y: 100,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: { text: '必须保留的个人笔记', w: 320, h: 180 },
    }
    testApp.database.prepare('UPDATE boards SET tldraw_snapshot = ? WHERE id = ?')
      .run(JSON.stringify(damagedSnapshot), dataBoard.id)

    const repaired = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    expect(repaired.statusCode).toBe(200)
    const repairedRow = testApp.database.prepare('SELECT tldraw_snapshot, revision FROM boards WHERE id = ?')
      .get(dataBoard.id) as { tldraw_snapshot: string; revision: number }
    const repairedSnapshot = JSON.parse(repairedRow.tldraw_snapshot) as { store: Record<string, any> }
    expect(repairedSnapshot.store['shape:personal-note']).toEqual(damagedSnapshot.store['shape:personal-note'])
    expect(Object.values(repairedSnapshot.store).filter((shape) => shape.props?.panelKind === 'yishui-inference'))
      .toHaveLength(1)
    expect(repairedRow.revision).toBe(dataBoard.revision + 1)

    const repeated = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    expect(repeated.statusCode).toBe(200)
    const repeatedRow = testApp.database.prepare('SELECT tldraw_snapshot, revision FROM boards WHERE id = ?')
      .get(dataBoard.id) as { tldraw_snapshot: string; revision: number }
    const repeatedSnapshot = JSON.parse(repeatedRow.tldraw_snapshot) as { store: Record<string, any> }
    expect(repeatedRow.revision).toBe(repairedRow.revision)
    expect(Object.values(repeatedSnapshot.store).filter((shape) => shape.props?.panelKind === 'yishui-inference'))
      .toHaveLength(1)
  })

  it('creates the default trading workspace even when the owner already has an ordinary project', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    expect((await testApp.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie },
      payload: { id: 'ordinary-project', title: '普通项目', rootBoard: { id: 'ordinary-root', title: '概览' } },
    })).statusCode).toBe(201)

    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ status: 'created', project: { title: '短线主线交易工作台' } })
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 2 })
    expect(testApp.database.prepare('SELECT COUNT(*) AS count FROM boards').get()).toEqual({ count: 7 })
  })

  it('partitions bootstrap markers per owner and resets only the confirmed owner workspace', async () => {
    const ownerA = { openId: 'owner-a', name: 'Owner A' }
    const ownerB = { openId: 'owner-b', name: 'Owner B' }
    const testApp = await buildTestApp({ users: [ownerA, ownerB] })
    apps.push(testApp)
    const cookieA = testApp.sessionCookie(ownerA)
    const cookieB = testApp.sessionCookie(ownerB)

    const createdA = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie: cookieA },
    })
    const createdB = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie: cookieB },
    })
    expect(createdA.statusCode).toBe(201)
    expect(createdB.statusCode).toBe(201)
    expect(createdA.json().project.id).not.toBe(createdB.json().project.id)
    expect(testApp.database.prepare(`SELECT owner_open_id,project_id
      FROM workspace_bootstrap_markers ORDER BY owner_open_id`).all()).toEqual([
      { owner_open_id: 'owner-a', project_id: createdA.json().project.id },
      { owner_open_id: 'owner-b', project_id: createdB.json().project.id },
    ])

    expect((await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie: cookieA },
    })).json()).toMatchObject({ status: 'existing', project: { id: createdA.json().project.id } })
    expect((await testApp.app.inject({
      method: 'DELETE', url: `/api/projects/${createdA.json().project.id}`, headers: { cookie: cookieA },
    })).statusCode).toBe(409)
    const projects = new ProjectRepository(testApp.database)
    expect(projects.remove(createdA.json().project.id, { confirmedProtectedWorkspaceDelete: true })).toBe(true)
    const recreatedA = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie: cookieA },
    })
    expect(recreatedA.statusCode).toBe(201)
    expect(recreatedA.json()).toMatchObject({ status: 'created' })
    expect(recreatedA.json().project.id).not.toBe(createdA.json().project.id)
    expect((await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie: cookieB },
    })).json()).toMatchObject({ status: 'existing', project: { id: createdB.json().project.id } })
  })

  it('persists a free-form personal note on the data board across an API reload', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    const created = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    const dataBoard = created.json().boards.find((board: { title: string }) => board.title === '数据') as {
      id: string
      revision: number
      tldrawSnapshot: { store: Record<string, unknown> }
    }
    const snapshot = structuredClone(dataBoard.tldrawSnapshot)
    snapshot.store['shape:uat-personal-note'] = {
      id: 'shape:uat-personal-note',
      typeName: 'shape',
      type: 'note',
      parentId: 'page:page',
      index: 'a9',
      x: 1900,
      y: 80,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: {
        color: 'black',
        richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '盘中个人备注' }] }] },
        size: 'm',
        font: 'draw',
        align: 'middle',
        verticalAlign: 'middle',
        labelColor: 'black',
        growY: 0,
        fontSizeAdjustment: 1,
        url: '',
        scale: 1,
        textLastEditedBy: null,
      },
    }

    const saved = await testApp.app.inject({
      method: 'PUT',
      url: `/api/boards/${dataBoard.id}/snapshot`,
      headers: { cookie },
      payload: { expectedRevision: dataBoard.revision, snapshot },
    })
    expect(saved.statusCode).toBe(200)
    const reloaded = await testApp.app.inject({
      method: 'GET', url: `/api/boards/${dataBoard.id}/snapshot`, headers: { cookie },
    })
    expect(reloaded.statusCode).toBe(200)
    expect(reloaded.json().snapshot.store['shape:uat-personal-note']).toMatchObject({
      type: 'note',
      props: { richText: expect.objectContaining({ type: 'doc' }) },
    })
    expect(Object.values(reloaded.json().snapshot.store)
      .filter((shape) => (shape as { type?: string }).type === 'trading-panel')).toHaveLength(5)
  })

  it('migrates a real v4 layout without deleting its embedded today panel or personal content', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    const created = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    const workspace = created.json() as {
      rootBoard: { id: string; tldrawSnapshot: { store: Record<string, any> } }
      boards: Array<{ id: string; title: string; tldrawSnapshot: { store: Record<string, any> } }>
      references: Array<{ id: string; sourceBoardId: string; targetBoardId: string; shapeId: string }>
    }
    const todayBoard = workspace.boards.find((board) => board.title === '今天怎么看')!
    const dataBoard = workspace.boards.find((board) => board.title === '数据')!
    const todayReference = workspace.references.find((reference) => reference.targetBoardId === todayBoard.id)!
    const rootSnapshot = structuredClone(workspace.rootBoard.tldrawSnapshot)
    delete rootSnapshot.store[todayReference.shapeId]

    const dataSnapshot = structuredClone(dataBoard.tldrawSnapshot)
    for (const [shapeId, shape] of Object.entries(dataSnapshot.store)) {
      if (shape.props?.panelKind === 'yishui-inference') delete dataSnapshot.store[shapeId]
    }
    const legacyTodayPanel = structuredClone(Object.values(todayBoard.tldrawSnapshot.store)[0]!)
    legacyTodayPanel.id = 'shape:legacy-today-overview'
    legacyTodayPanel.index = 'a0'
    legacyTodayPanel.meta = { template: 'shortline-trading-v1' }
    dataSnapshot.store[legacyTodayPanel.id] = legacyTodayPanel
    dataSnapshot.store['shape:personal-v4-note'] = {
      id: 'shape:personal-v4-note',
      typeName: 'shape',
      type: 'note',
      parentId: 'page:page',
      index: 'a9',
      x: 2100,
      y: 80,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: { text: '必须原样保留的个人内容', w: 320, h: 180 },
    }
    const dataBeforeMigration = JSON.stringify(dataSnapshot)

    testApp.database.transaction(() => {
      testApp.database.prepare('DELETE FROM board_references WHERE id = ?').run(todayReference.id)
      testApp.database.prepare('UPDATE boards SET tldraw_snapshot = ?, revision = 7 WHERE id = ?')
        .run(JSON.stringify(rootSnapshot), workspace.rootBoard.id)
      testApp.database.prepare('UPDATE boards SET tldraw_snapshot = ? WHERE id = ?')
        .run(dataBeforeMigration, dataBoard.id)
      testApp.database.prepare('DELETE FROM board_access_policies WHERE board_id = ?').run(todayBoard.id)
      testApp.database.prepare('DELETE FROM boards WHERE id = ?').run(todayBoard.id)
      testApp.database.prepare(`UPDATE workspace_bootstrap_markers SET template_version = 4
        WHERE template_key = ? AND owner_open_id = ?`).run('shortline-trading-v1', 'test-user')
    })()

    const upgraded = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    expect(upgraded.statusCode).toBe(200)
    expect(upgraded.json().rootBoard.revision).toBe(8)
    const migratedDataRow = testApp.database.prepare('SELECT tldraw_snapshot FROM boards WHERE id = ?').get(dataBoard.id) as {
      tldraw_snapshot: string
    }
    expect(migratedDataRow.tldraw_snapshot).not.toBe(dataBeforeMigration)
    const migratedDataSnapshot = JSON.parse(migratedDataRow.tldraw_snapshot) as { store: Record<string, any> }
    expect(migratedDataSnapshot.store['shape:personal-v4-note']).toEqual(dataSnapshot.store['shape:personal-v4-note'])
    expect(Object.values(migratedDataSnapshot.store).filter((shape) => shape.props?.panelKind === 'yishui-inference'))
      .toHaveLength(1)

    const upgradedRootShapes = listBoardReferenceShapes(upgraded.json().rootBoard.tldrawSnapshot)
    const upgradedTodayEntries = upgradedRootShapes.filter((shape) => (
      (shape.meta as { templateRole?: unknown }).templateRole === 'today-entry'
    ))
    expect(upgradedTodayEntries).toHaveLength(1)
    expect(upgradedTodayEntries[0]?.meta).toMatchObject({ protectedCore: true })
    expect(new Set(upgradedRootShapes.map((shape) => `${shape.x}:${shape.y}`)).size)
      .toBe(upgradedRootShapes.length)

    const dedicatedTodayBoards = (upgraded.json().boards as Array<{ id: string; tldrawSnapshot: { store: Record<string, any> } }>)
      .filter((board) => Object.values(board.tldrawSnapshot.store).some((record) => (
        record.meta?.templateRole === 'today-core' && record.meta?.protectedCore === true
      )))
    expect(dedicatedTodayBoards).toHaveLength(1)
    expect(dedicatedTodayBoards[0]?.id).not.toBe(dataBoard.id)
    expect(testApp.database.prepare(`SELECT template_version FROM workspace_bootstrap_markers
      WHERE template_key = ? AND owner_open_id = ?`).get('shortline-trading-v1', 'test-user'))
      .toEqual({ template_version: 6 })

    const countsBeforeRepeat = {
      boards: testApp.database.prepare('SELECT COUNT(*) AS count FROM boards').get(),
      references: testApp.database.prepare('SELECT COUNT(*) AS count FROM board_references').get(),
    }
    const repeated = await testApp.app.inject({
      method: 'PUT', url: '/api/bootstrap/personal-trading-workspace', headers: { cookie },
    })
    expect(repeated.json().rootBoard.revision).toBe(8)
    expect({
      boards: testApp.database.prepare('SELECT COUNT(*) AS count FROM boards').get(),
      references: testApp.database.prepare('SELECT COUNT(*) AS count FROM board_references').get(),
    }).toEqual(countsBeforeRepeat)
  })

  it('upgrades a legacy generated mindset reference once without changing other previews', async () => {
    const testApp = await buildTestApp()
    apps.push(testApp)
    const cookie = testApp.sessionCookie()
    const created = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })
    const rootBoardId = created.json().rootBoard.id as string
    const rootRow = testApp.database.prepare('SELECT tldraw_snapshot FROM boards WHERE id = ?')
      .get(rootBoardId) as { tldraw_snapshot: string }
    const legacySnapshot = JSON.parse(rootRow.tldraw_snapshot) as unknown
    for (const shape of listBoardReferenceShapes(legacySnapshot)) {
      delete shape.props.previewMode
    }
    testApp.database.prepare('UPDATE boards SET tldraw_snapshot = ?, revision = 0 WHERE id = ?')
      .run(JSON.stringify(legacySnapshot), rootBoardId)
    testApp.database.prepare(`UPDATE workspace_bootstrap_markers
      SET template_version = 1 WHERE template_key = ? AND owner_open_id = ?`)
      .run('shortline-trading-v1', 'test-user')

    const upgraded = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })
    const upgradedShapes = listBoardReferenceShapes(upgraded.json().rootBoard.tldrawSnapshot)

    expect(upgraded.statusCode).toBe(200)
    expect(upgradedShapes.find((shape) => shape.props.titleFallback === '心态')?.props.previewMode)
      .toBe('private')
    expect(upgradedShapes
      .filter((shape) => shape.props.titleFallback !== '心态')
      .every((shape) => shape.props.previewMode === undefined))
      .toBe(true)
    expect(upgraded.json().rootBoard.revision).toBe(1)
    expect(testApp.database.prepare(`SELECT template_version FROM workspace_bootstrap_markers
      WHERE template_key = ? AND owner_open_id = ?`).get('shortline-trading-v1', 'test-user'))
      .toEqual({ template_version: 6 })

    const repeated = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bootstrap/personal-trading-workspace',
      headers: { cookie },
    })
    expect(repeated.json().rootBoard.revision).toBe(1)
  })
})
