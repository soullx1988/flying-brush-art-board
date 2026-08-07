import { expect, test, type APIRequestContext, type Page } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

interface SeededReference {
  id: string
  sourceBoardId: string
  targetBoardId: string
  shapeId: string
  kind: 'embed' | 'link'
}

async function createProject(request: APIRequestContext, suffix: string, titles: string[]) {
  const projectId = `project-navigation-${suffix}`
  const boardIds = titles.map((_, index) => `board-${index + 1}-${suffix}`)
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: `Navigation ${suffix}`,
      rootBoard: { id: boardIds[0], title: titles[0] },
    },
  })).ok()).toBe(true)
  for (let index = 1; index < titles.length; index += 1) {
    expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
      data: { id: boardIds[index], title: titles[index] },
    })).ok()).toBe(true)
  }
  return { projectId, boardIds }
}

async function createReference(
  request: APIRequestContext,
  sourceBoardId: string,
  targetBoardId: string,
  id: string,
  kind: 'embed' | 'link' = 'link',
  expectedRevision = 0,
): Promise<SeededReference> {
  const shapeId = `shape:${id}`
  const response = await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: { targetBoardId, shapeId, kind, expectedRevision },
  })
  expect(response.status()).toBe(201)
  const body = await response.json() as { reference: SeededReference }
  return body.reference
}

async function openReferenceMenu(page: Page, shapeId: string) {
  await page.waitForFunction((id) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor?.getShapePageBounds(id))
  }, shapeId)
  const title = await page.evaluate((id) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const shape = editor?.getShape(id)
    if (!shape) throw new Error(`Reference shape ${id} was not mounted`)
    return shape.props.titleFallback as string
  }, shapeId)
  await page.getByRole('article').filter({ hasText: title }).click({ button: 'right', force: true })
  await expect(page.getByRole('menuitem', { name: '进入画板' })).toBeVisible()
}

async function enterReference(page: Page, reference: SeededReference, newTab = false) {
  await openReferenceMenu(page, reference.shapeId)
  await page.getByRole('menuitem', {
    name: newTab ? '在新标签页打开' : '进入画板',
  }).click()
  await expect(page).toHaveURL(new RegExp(`/boards/${reference.targetBoardId}(?:\\?|$)`))
}

async function setView(
  page: Page,
  camera: { x: number; y: number; z: number },
  selectedShapeId: string,
  currentToolId: string,
) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__),
  )
  await page.evaluate(({ camera: nextCamera, selectedShapeId: shapeId, currentToolId: toolId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__: any }).__INFINITE_BOARD_EDITOR__
    editor.setCurrentTool(toolId)
    editor.setCamera(nextCamera)
    editor.setSelectedShapes([shapeId])
  }, { camera, selectedShapeId, currentToolId })
}

async function currentView(page: Page) {
  return page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__: any }).__INFINITE_BOARD_EDITOR__
    return {
      camera: editor.getCamera(),
      selectedShapeIds: [...editor.getSelectedShapeIds()],
      currentToolId: editor.getCurrentToolId(),
    }
  })
}

test('A→C and B→C return to their actual source view state', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, boardIds } = await createProject(request, suffix, ['Alpha', 'Beta', 'Charlie'])
  const aToC = await createReference(request, boardIds[0]!, boardIds[2]!, `a-c-${suffix}`)
  const bToC = await createReference(request, boardIds[1]!, boardIds[2]!, `b-c-${suffix}`)

  await page.goto(`/projects/${projectId}/boards/${boardIds[0]}`)
  await openReferenceMenu(page, aToC.shapeId)
  await setView(page, { x: 120, y: 45, z: 1.75 }, aToC.shapeId, 'draw')
  await page.getByRole('menuitem', { name: '进入画板' }).click()
  await expect(page).toHaveURL(new RegExp(`/boards/${aToC.targetBoardId}(?:\\?|$)`))
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/boards/${boardIds[0]}(?:\\?|$)`))
  await expect.poll(() => currentView(page)).toMatchObject({
    camera: { x: 120, y: 45, z: 1.75 },
    selectedShapeIds: [aToC.shapeId],
    currentToolId: 'draw',
  })

  await page.goto(`/projects/${projectId}/boards/${boardIds[1]}`)
  await openReferenceMenu(page, bToC.shapeId)
  await setView(page, { x: -80, y: 90, z: 0.8 }, bToC.shapeId, 'select')
  await page.getByRole('menuitem', { name: '进入画板' }).click()
  await expect(page).toHaveURL(new RegExp(`/boards/${bToC.targetBoardId}(?:\\?|$)`))
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/boards/${boardIds[1]}(?:\\?|$)`))
  await expect.poll(() => currentView(page)).toMatchObject({
    camera: { x: -80, y: 90, z: 0.8 },
    selectedShapeIds: [bToC.shapeId],
    currentToolId: 'select',
  })
})

test('a bare C deep link lists both inbound source positions', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, boardIds } = await createProject(request, suffix, ['Alpha', 'Beta', 'Charlie'])
  const aToC = await createReference(request, boardIds[0]!, boardIds[2]!, `a-c-${suffix}`)
  const bToC = await createReference(request, boardIds[1]!, boardIds[2]!, `b-c-${suffix}`, 'embed')

  await page.goto(`/projects/${projectId}/boards/${boardIds[2]}`)

  await expect(page.getByRole('heading', { name: '引用此画板的位置' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Alpha/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Beta/ })).toBeVisible()
  expect(aToC.shapeId).not.toBe(bToC.shapeId)
})

test('link A→B→A keeps repeated breadcrumbs and browser/Alt+Left back follows entries', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, boardIds } = await createProject(request, suffix, ['Alpha', 'Beta'])
  const aToB = await createReference(request, boardIds[0]!, boardIds[1]!, `a-b-${suffix}`)
  const bToA = await createReference(request, boardIds[1]!, boardIds[0]!, `b-a-${suffix}`)

  await page.goto(`/projects/${projectId}/boards/${boardIds[0]}`)
  await enterReference(page, aToB)
  await enterReference(page, bToA)

  const breadcrumbs = page.getByRole('navigation', { name: '访问历史' })
  await expect(breadcrumbs.getByText('Alpha')).toHaveCount(1)
  await expect(breadcrumbs.getByText('Beta')).toHaveCount(1)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/boards/${boardIds[1]}(?:\\?|$)`))
  await expect(breadcrumbs.getByText('Alpha')).toHaveCount(1)
  await expect(breadcrumbs.getByText('Beta')).toHaveCount(0)

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page).toHaveURL(new RegExp(`/boards/${boardIds[0]}(?:\\?|$)`))
  await expect(breadcrumbs.getByText('Alpha')).toHaveCount(0)
  await expect(breadcrumbs.getByText('Beta')).toHaveCount(0)
})

test('a 10-board embed path is navigable and creation of level 11 is rejected', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const titles = Array.from({ length: 11 }, (_, index) => `Node ${index + 1}`)
  const { projectId, boardIds } = await createProject(request, suffix, titles)
  const accepted: SeededReference[] = []
  for (let index = 0; index < 9; index += 1) {
    accepted.push(await createReference(
      request,
      boardIds[index]!,
      boardIds[index + 1]!,
      `embed-${index + 1}-${suffix}`,
      'embed',
    ))
  }
  const rejected = await request.post(`${API_BASE}/api/boards/${boardIds[9]}/references`, {
    data: {
      targetBoardId: boardIds[10],
      shapeId: `shape:embed-10-${suffix}`,
      kind: 'embed',
      expectedRevision: 0,
    },
  })
  expect(rejected.status()).toBe(409)
  await expect(rejected.json()).resolves.toMatchObject({ code: 'EMBED_DEPTH_LIMIT_EXCEEDED' })

  await page.goto(`/projects/${projectId}/boards/${boardIds[0]}`)
  for (const reference of accepted) await enterReference(page, reference)

  const breadcrumbs = page.getByRole('navigation', { name: '访问历史' })
  for (const title of titles.slice(0, 9)) {
    await expect(breadcrumbs.getByText(title, { exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: titles[9]!, exact: true })).toBeVisible()
})

test('the same board keeps isolated tab histories/views and only mounts one editor DOM', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, boardIds } = await createProject(request, suffix, ['Alpha', 'Charlie'])
  const aToC = await createReference(request, boardIds[0]!, boardIds[1]!, `a-c-${suffix}`)

  await page.goto(`/projects/${projectId}/boards/${boardIds[0]}`)
  await setView(page, { x: 25, y: 35, z: 1.25 }, aToC.shapeId, 'draw')
  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await page.getByRole('listitem', { name: 'Alpha' }).getByRole('button', { name: 'Alpha 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.locator('.canvas-editor')).toHaveCount(1)
  await setView(page, { x: -40, y: 75, z: 0.7 }, aToC.shapeId, 'select')

  await page.getByRole('tab', { name: /Alpha/ }).first().click()
  await expect.poll(() => currentView(page)).toMatchObject({
    camera: { x: 25, y: 35, z: 1.25 },
    selectedShapeIds: [aToC.shapeId],
    currentToolId: 'draw',
  })
  await page.getByRole('tab', { name: /Alpha/ }).nth(1).click()
  await expect.poll(() => currentView(page)).toMatchObject({
    camera: { x: -40, y: 75, z: 0.7 },
    selectedShapeIds: [aToC.shapeId],
    currentToolId: 'select',
  })
  await expect(page.locator('.canvas-editor')).toHaveCount(1)
})

test('the same Board can be edited from two realtime tabs without a local lease', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, boardIds } = await createProject(request, suffix, ['Alpha'])
  await page.goto(`/projects/${projectId}/boards/${boardIds[0]}`)
  await page.getByLabel('白板画布').click({ position: { x: 100, y: 100 } })
  await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__: any }).__INFINITE_BOARD_EDITOR__
    editor.createShape({ type: 'geo', x: 40, y: 40, props: { geo: 'rectangle', w: 120, h: 80 } })
  })

  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await page.getByRole('listitem', { name: 'Alpha' }).getByRole('button', { name: 'Alpha 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByLabel('白板画布').click({ position: { x: 140, y: 140 } })
  await expect(page.locator('.read-only-badge')).toHaveCount(0)
  const secondTabShapeId = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__: any }).__INFINITE_BOARD_EDITOR__
    const id = `shape:second-tab-${crypto.randomUUID()}`
    editor.createShape({ id, type: 'geo', x: 160, y: 160, props: { geo: 'rectangle', w: 120, h: 80 } })
    return id
  })
  await expect.poll(() => page.evaluate((id) => Boolean(
    (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
  ), secondTabShapeId)).toBe(true)

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: /关闭 Alpha/ }).first().click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await page.getByLabel('白板画布').click({ position: { x: 160, y: 160 } })
  await expect(page.locator('.read-only-badge')).toHaveCount(0)
})
