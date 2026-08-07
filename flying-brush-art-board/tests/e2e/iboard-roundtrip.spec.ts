import { expect, test, type APIRequestContext } from './test.js'
import type {
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '../../packages/board-core/src/index.js'

import { decodeIboard, exportProjectToIboard } from '../../packages/interop/dist/index.js'
import {
  collectConnectedBoardIds,
  collisionSnapshotFor,
  createTask15ReferenceGraphFixture,
  makeFixtureRootLoadable,
  namespaceTask15Fixture,
  remappableSnapshotRecordIds,
  rewriteFixtureReferenceId,
  semanticGraph,
  type Task15ReferenceGraphFixture,
} from '../helpers/reference-graph-fixture.js'

const API_BASE = 'http://localhost:8787'

interface ProjectState {
  project: ProjectRecord
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
}

async function readProject(request: APIRequestContext, projectId: string): Promise<ProjectState> {
  const response = await request.get(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ProjectState>
}

async function seedCollisionTarget(
  request: APIRequestContext,
  fixture: Task15ReferenceGraphFixture,
  rootBoardId: string,
): Promise<void> {
  const created = await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: fixture.project.id,
      title: 'Import target',
      rootBoard: { id: rootBoardId, title: 'Keep root' },
    },
  })
  expect(created.ok()).toBe(true)

  for (const source of fixture.boards) {
    const response = await request.post(
      `${API_BASE}/api/projects/${encodeURIComponent(fixture.project.id)}/boards`,
      {
        data: {
          id: source.id,
          title: `Collision ${source.title}`,
          tldrawSnapshot: collisionSnapshotFor(source),
        },
      },
    )
    expect(response.ok()).toBe(true)
  }

  const revisions = new Map(fixture.boards.map((board) => [board.id, 0]))
  for (const reference of fixture.references) {
    const response = await request.post(
      `${API_BASE}/api/boards/${encodeURIComponent(reference.sourceBoardId)}/references`,
      {
        data: {
          targetBoardId: reference.targetBoardId,
          shapeId: reference.shapeId,
          kind: reference.kind,
          expectedRevision: revisions.get(reference.sourceBoardId),
        },
      },
    )
    expect(response.ok()).toBe(true)
    const body = await response.json() as {
      reference: BoardReferenceRecord
      revision: number
    }
    revisions.set(reference.sourceBoardId, body.revision)
    rewriteFixtureReferenceId(fixture, reference.shapeId, body.reference.id)
  }

  const asset = fixture.assets[0]!
  const uploaded = await request.post(`${API_BASE}/api/assets`, {
    data: {
      mime: asset.mime,
      base64: Buffer.from(asset.bytes).toString('base64'),
    },
  })
  expect(uploaded.ok()).toBe(true)
  expect((await uploaded.json()).sha256).toBe(asset.sha256)
}

function importedSubgraph(state: ProjectState, rootBoardId: string) {
  const boardIds = collectConnectedBoardIds(rootBoardId, state.references)
  const boards = state.boards.filter((board) => boardIds.has(board.id))
  const references = state.references.filter(
    (reference) => boardIds.has(reference.sourceBoardId) && boardIds.has(reference.targetBoardId),
  )
  return { boardIds, boards, references }
}

function stateRecordIds(state: ProjectState): Set<string> {
  return new Set(state.boards.flatMap((board) => {
    const snapshot = board.tldrawSnapshot as { store?: Record<string, unknown> }
    return Object.keys(snapshot.store ?? {})
  }))
}

function assertReferenceShapeBijection(
  boards: readonly StoredBoard[],
  references: readonly BoardReferenceRecord[],
): void {
  for (const board of boards) {
    const snapshot = board.tldrawSnapshot as { store?: Record<string, any> }
    const store = snapshot.store ?? {}
    const outbound = references.filter((reference) => reference.sourceBoardId === board.id)
    const referenceShapes = Object.values(store).filter(
      (record) => record?.typeName === 'shape' && record?.type === 'board-reference',
    )
    expect(referenceShapes).toHaveLength(outbound.length)
    for (const reference of outbound) {
      expect(store[reference.shapeId]).toMatchObject({
        id: reference.shapeId,
        typeName: 'shape',
        type: 'board-reference',
        props: {
          referenceId: reference.id,
          targetBoardId: reference.targetBoardId,
          kind: reference.kind,
        },
      })
    }
  }
}

async function openImportPicker(page: import('@playwright/test').Page, upload: {
  name: string
  mimeType: string
  buffer: Buffer
}) {
  const inspected = page.waitForResponse((response) =>
    response.url().endsWith('/api/import/iboard/inspect') && response.request().method() === 'POST')
  await page.getByLabel('选择导入文件', { exact: true }).setInputFiles(upload)
  const response = await inspected
  expect(response.status()).toBe(201)
  await page.locator('.iboard-import-wizard').waitFor({ state: 'visible' })
  return response.json() as Promise<{ sessionId: string }>
}

async function dropImport(
  page: import('@playwright/test').Page,
  target: 'tab-strip' | 'canvas' | 'global',
  upload: { name: string; mimeType: string; buffer: Buffer },
) {
  const inspected = page.waitForResponse((response) =>
    response.url().endsWith('/api/import/iboard/inspect') && response.request().method() === 'POST')
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array([0])], 'drag-probe.iboard'))
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await page.locator('.app-drop-overlay').waitFor({ state: 'visible' })
  await page.evaluate(({ target, name, mimeType, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], name, { type: mimeType }))
    const dropTarget = target === 'global'
      ? window
      : document.querySelector(`[data-drop-target="${target}"]`)
    if (!dropTarget) throw new Error(`Drop target ${target} was not rendered`)
    dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, {
    target,
    name: upload.name,
    mimeType: upload.mimeType,
    base64: upload.buffer.toString('base64'),
  })
  const response = await inspected
  expect(response.status()).toBe(201)
  await page.locator('.iboard-import-wizard').waitFor({ state: 'visible' })
  return response.json() as Promise<{ sessionId: string }>
}

test('round-trips a colliding multi-source graph, cancels cleanly, and merges twice independently', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID()
  const projectId = `iboard-target-${suffix}`
  const rootBoardId = `iboard-target-root-${suffix}`
  const sourceFixture = createTask15ReferenceGraphFixture()
  makeFixtureRootLoadable(sourceFixture)
  const fixture = namespaceTask15Fixture(
    sourceFixture,
    `source-${suffix}`,
    projectId,
  )
  await seedCollisionTarget(request, fixture, rootBoardId)
  const archive = exportProjectToIboard(fixture)
  const upload = {
    name: 'reference-graph.iboard',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(archive),
  }
  const initial = await readProject(request, projectId)
  const sourceBoardIds = new Set(fixture.boards.map((board) => board.id))
  const sourceReferenceIds = new Set(fixture.references.map((reference) => reference.id))
  const sourceRecordIds = new Set(fixture.boards.flatMap(remappableSnapshotRecordIds))
  const boardBySourceId = new Map(fixture.boards.map((board) => [board.sourceMetadata?.sourceId, board.id]))
  const boardA = boardBySourceId.get('external:board-a')!
  const boardB = boardBySourceId.get('external:board-b')!
  const boardC = boardBySourceId.get('external:board-c')!
  const aToB = fixture.references.filter((reference) =>
    reference.sourceBoardId === boardA && reference.targetBoardId === boardB)
  expect(aToB).toHaveLength(2)
  expect(aToB).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'embed' }),
      expect.objectContaining({ kind: 'link' }),
    ]),
  )
  expect(fixture.references).toContainEqual(expect.objectContaining({
    sourceBoardId: boardB,
    targetBoardId: boardA,
    kind: 'link',
  }))
  expect(fixture.references.filter((reference) =>
    reference.targetBoardId === boardC && reference.kind === 'embed').map((reference) => reference.sourceBoardId))
    .toEqual(expect.arrayContaining([boardA, boardB]))
  expect(initial.project.id).toBe(fixture.project.id)
  expect(initial.boards.filter((board) => sourceBoardIds.has(board.id))).toHaveLength(fixture.boards.length)
  expect(new Set(initial.references.map((reference) => reference.id))).toEqual(sourceReferenceIds)
  expect([...sourceRecordIds].every((recordId) => stateRecordIds(initial).has(recordId))).toBe(true)

  await page.goto(`/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: 'Import target' })).toBeVisible()
  for (const target of ['tab-strip', 'canvas', 'global'] as const) {
    const droppedSession = await dropImport(page, target, upload)
    await expect(page.getByRole('button', { name: '确认合并' })).toBeEnabled()
    expect(await readProject(request, projectId)).toEqual(initial)
    const cancelledDrop = page.waitForResponse((response) =>
      response.url().includes('/api/import/sessions/') && response.request().method() === 'DELETE')
    await page.getByRole('button', { name: '取消' }).click()
    expect((await cancelledDrop).status()).toBe(204)
    await page.locator('.iboard-import-wizard').waitFor({ state: 'hidden' })
    const cancelledDropCommit = await request.post(`${API_BASE}/api/import/iboard/commit`, {
      data: {
        sessionId: droppedSession.sessionId,
        targetProjectId: projectId,
        mode: 'merge',
        openImportedRootInNewTab: true,
      },
    })
    expect(cancelledDropCommit.status()).toBe(404)
    expect(await readProject(request, projectId)).toEqual(initial)
  }
  const cancelledSession = await openImportPicker(page, upload)
  const importDialog = page.getByRole('dialog', { name: '导入 .iboard 项目包' })
  await expect(importDialog).toContainText('合并到 Import target')
  await expect(importDialog.getByText('4 个画板')).toBeVisible()
  await expect(importDialog.getByText('9 条引用')).toBeVisible()
  await expect(importDialog.getByText('最长嵌套 4 层')).toBeVisible()
  await expect(importDialog.getByText('1 个资源')).toBeVisible()
  expect(page.url()).toMatch(new RegExp(`/projects/${projectId}$`))
  expect(await readProject(request, projectId)).toEqual(initial)

  const cancelled = page.waitForResponse((response) =>
    response.url().includes('/api/import/sessions/') && response.request().method() === 'DELETE')
  await page.getByRole('button', { name: '取消' }).click()
  expect((await cancelled).status()).toBe(204)
  await expect(page.getByRole('dialog', { name: '导入 .iboard 项目包' })).toBeHidden()
  expect(await readProject(request, projectId)).toEqual(initial)
  const cancelledCommit = await request.post(`${API_BASE}/api/import/iboard/commit`, {
    data: {
      sessionId: cancelledSession.sessionId,
      targetProjectId: projectId,
      mode: 'merge',
      openImportedRootInNewTab: true,
    },
  })
  expect(cancelledCommit.status()).toBe(404)

  await dropImport(page, 'canvas', upload)
  const firstCommitResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/import/iboard/commit') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认合并' }).click()
  const firstCommit = await (await firstCommitResponse).json() as {
    importedRootBoardId: string
    importedBoardCount: number
    importedReferenceCount: number
  }
  expect(firstCommit).toMatchObject({ importedBoardCount: 4, importedReferenceCount: 9 })
  const afterFirstCommit = await readProject(request, projectId)
  expect(afterFirstCommit.boards.find((board) =>
    board.sourceMetadata?.sourceId === 'external:board-c' && !sourceBoardIds.has(board.id))?.id)
    .toBe(firstCommit.importedRootBoardId)
  await expect(page).toHaveURL(`/projects/${projectId}/boards/${encodeURIComponent(firstCommit.importedRootBoardId)}`)
  await expect(page.getByRole('tablist', { name: '已打开画板' }).getByRole('tab')).toHaveCount(1)

  await page.getByRole('button', { name: '项目首页' }).click()
  await expect(page.getByRole('heading', { name: 'Import target' })).toBeVisible()
  await openImportPicker(page, upload)
  const secondCommitResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/import/iboard/commit') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认合并' }).click()
  const secondCommit = await (await secondCommitResponse).json() as {
    importedRootBoardId: string
    importedBoardCount: number
    importedReferenceCount: number
  }
  expect(secondCommit).toMatchObject({ importedBoardCount: 4, importedReferenceCount: 9 })
  expect(secondCommit.importedRootBoardId).not.toBe(firstCommit.importedRootBoardId)
  await expect(page).toHaveURL(`/projects/${projectId}/boards/${encodeURIComponent(secondCommit.importedRootBoardId)}`)
  await expect(page.getByRole('tablist', { name: '已打开画板' }).getByRole('tab')).toHaveCount(2)

  const importedTabs = page.getByRole('tablist', { name: '已打开画板' }).getByRole('tab')
  await importedTabs.nth(0).click()
  await expect(page).toHaveURL(`/projects/${projectId}/boards/${encodeURIComponent(firstCommit.importedRootBoardId)}`)
  await importedTabs.nth(1).click()
  await expect(page).toHaveURL(`/projects/${projectId}/boards/${encodeURIComponent(secondCommit.importedRootBoardId)}`)

  const final = await readProject(request, projectId)
  expect(final.project).toEqual(initial.project)
  expect(final.boards.find((board) => board.id === rootBoardId)).toEqual(
    initial.boards.find((board) => board.id === rootBoardId),
  )
  expect(final.boards.filter((board) => sourceBoardIds.has(board.id))).toEqual(
    initial.boards.filter((board) => sourceBoardIds.has(board.id)),
  )
  expect(final.references.filter((reference) => sourceReferenceIds.has(reference.id))).toEqual(initial.references)

  const first = importedSubgraph(final, firstCommit.importedRootBoardId)
  const second = importedSubgraph(final, secondCommit.importedRootBoardId)
  expect(first.boards.find((board) => board.sourceMetadata?.sourceId === 'external:board-c')?.id)
    .toBe(firstCommit.importedRootBoardId)
  expect(second.boards.find((board) => board.sourceMetadata?.sourceId === 'external:board-c')?.id)
    .toBe(secondCommit.importedRootBoardId)
  expect(first.boards).toHaveLength(fixture.boards.length)
  expect(second.boards).toHaveLength(fixture.boards.length)
  expect(first.references).toHaveLength(fixture.references.length)
  expect(second.references).toHaveLength(fixture.references.length)
  expect([...first.boardIds].some((boardId) => second.boardIds.has(boardId))).toBe(false)
  expect(first.references.some((reference) => second.boardIds.has(reference.targetBoardId))).toBe(false)
  expect(second.references.some((reference) => first.boardIds.has(reference.targetBoardId))).toBe(false)
  expect(semanticGraph(first.boards, first.references)).toEqual(
    semanticGraph(fixture.boards, fixture.references),
  )
  expect(semanticGraph(second.boards, second.references)).toEqual(
    semanticGraph(fixture.boards, fixture.references),
  )
  assertReferenceShapeBijection(first.boards, first.references)
  assertReferenceShapeBijection(second.boards, second.references)

  for (const graph of [first, second]) {
    expect(graph.boards.every((board) => !sourceBoardIds.has(board.id))).toBe(true)
    expect(graph.references.every((reference) => !sourceReferenceIds.has(reference.id))).toBe(true)
    expect(graph.boards.flatMap(remappableSnapshotRecordIds).every((id) => !sourceRecordIds.has(id))).toBe(true)
    const shared = graph.boards.filter((board) => board.sourceMetadata?.sourceId === 'external:board-d')
    expect(shared).toHaveLength(1)
    expect(graph.references.filter((reference) =>
      reference.targetBoardId === shared[0]!.id && reference.kind === 'embed')).toHaveLength(2)
  }

  const exported = await request.get(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/export.iboard`)
  expect(exported.ok()).toBe(true)
  const decoded = decodeIboard(new Uint8Array(await exported.body()))
  expect(decoded.manifest).toMatchObject({
    projectId,
    title: 'Import target',
    rootBoardId,
  })
  expect(decoded.assets).toHaveLength(1)
  expect(decoded.assets[0]).toMatchObject({
    sha256: fixture.assets[0]!.sha256,
    bytes: fixture.assets[0]!.bytes,
  })
  expect(decoded.assets[0]!.usages).toHaveLength(2)
  expect(new Set(decoded.assets[0]!.usages.map((usage) => usage.boardId))).toEqual(new Set([
    first.boards.find((board) => board.sourceMetadata?.sourceId === 'external:board-a')!.id,
    second.boards.find((board) => board.sourceMetadata?.sourceId === 'external:board-a')!.id,
  ]))

  await page.getByRole('button', { name: '全部画板' }).click()
  await expect(page.getByRole('heading', { name: `全部画板 ${initial.boards.length + 8}` })).toBeVisible()
  await page.getByRole('dialog', { name: '全部画板' }).getByRole('button', { name: '关闭' }).click()
  await expect(page.getByRole('tablist', { name: '已打开画板' }).getByRole('tab')).toHaveCount(2)
})
