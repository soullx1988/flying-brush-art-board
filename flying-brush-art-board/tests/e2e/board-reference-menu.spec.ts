import { expect, loginPage, test, type APIRequestContext } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

interface BoardState {
  revision: number
  tldrawSnapshot: { store?: Record<string, Record<string, unknown>> }
}

async function seedBoards(request: APIRequestContext, suffix: string) {
  const projectId = `project-reference-${suffix}`
  const sourceBoardId = `board-source-${suffix}`
  const targetBoardId = `board-target-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Reference Project',
      rootBoard: { id: sourceBoardId, title: 'Source board' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
    data: { id: targetBoardId, title: 'Target board' },
  })).ok()).toBe(true)
  return { projectId, sourceBoardId, targetBoardId }
}

async function readBoard(request: APIRequestContext, boardId: string): Promise<BoardState> {
  const response = await request.get(`${API_BASE}/api/boards/${encodeURIComponent(boardId)}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<BoardState>
}

function emptyTextShapeCount(board: BoardState): number {
  return Object.values(board.tldrawSnapshot.store ?? {}).filter((record) => (
    record?.typeName === 'shape'
    && record?.type === 'text'
    && typeof record.props === 'object'
    && record.props !== null
    && typeof (record.props as { text?: unknown }).text === 'string'
    && ((record.props as { text: string }).text).trim() === ''
  )).length
}

test('creates a board reference and exposes its transactional right-click actions', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix)
  const shapeId = `shape:context-menu-${crypto.randomUUID()}`
  const created = await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: { targetBoardId, shapeId, kind: 'embed', expectedRevision: 0 },
  })
  expect(created.status()).toBe(201)
  const receipt = await created.json() as { reference: { id: string; shapeId: string } }
  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await page.waitForFunction((id) => Boolean(
    (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
  ), shapeId)

  await page.getByRole('article').filter({ hasText: 'Target board' }).click({ button: 'right', force: true })

  await expect(page.getByTestId('context-menu')).toHaveCount(1)
  await expect(page.locator('.board-reference-menu')).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: '进入画板' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '在新标签页打开' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '重命名目标画板' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '移除引用（目标画板会保留）' })).toBeVisible()

  await page.getByRole('article').filter({ hasText: 'Target board' }).click({ button: 'right', force: true })
  await expect(page.getByTestId('context-menu')).toHaveCount(1)
  await expect(page.getByRole('menuitem', { name: '进入画板' })).toBeVisible()

  const updateResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/references/${receipt.reference.id}`) && response.request().method() === 'PATCH',
  )
  await page.getByRole('menuitem', { name: '切换为普通链接' }).click()
  expect((await updateResponse).status()).toBe(200)

  await expect(page.getByTestId('context-menu')).toHaveCount(0)
  await page.getByRole('article').filter({ hasText: 'Target board' }).click({ button: 'right', force: true })
  await expect(page.getByTestId('context-menu')).toHaveCount(1)
  await expect(page.getByRole('menuitem', { name: '切换为嵌入画板' })).toBeVisible()

  const target = await request.get(`${API_BASE}/api/boards/${targetBoardId}`)
  expect(target.ok()).toBe(true)
})

test('places a child board before opening its creation dialog', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix)
  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await expect(page.locator('.canvas-editor')).toBeVisible()

  const childBoardTool = page.getByTestId('tools.child-board')
  await expect(childBoardTool).toBeVisible()
  await childBoardTool.click()
  await expect(childBoardTool).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#board-reference-form')).toHaveCount(0)

  const canvas = page.locator('.canvas-editor')
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas has no bounds')
  const position = { x: 420, y: 300 }
  const expectedCenter = await page.evaluate(({ x, y }) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const point = editor.screenToPage({ x, y })
    return { x: point.x, y: point.y }
  }, { x: bounds.x + position.x, y: bounds.y + position.y })
  const expectedPlacement = {
    x: expectedCenter.x - 150,
    y: expectedCenter.y - 84,
  }

  await canvas.click({ position })
  await expect(page.locator('#board-reference-form')).toBeVisible()
  await expect(childBoardTool).toHaveAttribute('aria-pressed', 'false')

  const createRequest = page.waitForRequest((outgoing) =>
    outgoing.url().endsWith(`/api/boards/${sourceBoardId}/references`)
      && outgoing.method() === 'POST',
  )
  const createResponse = page.waitForResponse((incoming) =>
    incoming.url().endsWith(`/api/boards/${sourceBoardId}/references`)
      && incoming.request().method() === 'POST',
  )
  await page.locator('button[form="board-reference-form"]').click()
  const outgoing = await createRequest
  expect(outgoing.postDataJSON()).toMatchObject({
    targetBoardId,
    kind: 'embed',
    placement: expectedPlacement,
  })
  expect((await createResponse).status()).toBe(201)
  await expect(page.getByRole('article').filter({ hasText: 'Target board' })).toBeVisible()
  const shapeId = outgoing.postDataJSON().shapeId as string
  const placedCenter = await page.evaluate((id) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const shapeBounds = editor?.getShapePageBounds(id)
    if (!shapeBounds) throw new Error(`Reference shape ${id} was not mounted`)
    return { x: shapeBounds.center.x, y: shapeBounds.center.y }
  }, shapeId)
  expect(placedCenter.x).toBeCloseTo(expectedCenter.x)
  expect(placedCenter.y).toBeCloseTo(expectedCenter.y)
})

test('routes realtime direct deletion through the reference command and retries a stale peer', async ({ browser, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix)
  const firstShapeId = `shape:delete-first-${crypto.randomUUID()}`
  expect((await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: {
      targetBoardId,
      shapeId: firstShapeId,
      kind: 'embed',
      expectedRevision: 0,
    },
  })).status()).toBe(201)

  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  try {
    await Promise.all([loginPage(first), loginPage(second)])
    await Promise.all([
      first.goto(`/projects/${projectId}/boards/${sourceBoardId}`),
      second.goto(`/projects/${projectId}/boards/${sourceBoardId}`),
    ])
    await Promise.all([first, second].map((client) => client.waitForFunction((id) => Boolean(
      (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
    ), firstShapeId)))

    await first.evaluate((id) => {
      const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      editor.select(id)
      editor.deleteShapes([id])
    }, firstShapeId)
    await Promise.all([first, second].map((client) => client.waitForFunction((id) => !(
      window as Window & { __INFINITE_BOARD_EDITOR__?: any }
    ).__INFINITE_BOARD_EDITOR__?.getShape(id), firstShapeId)))

    const firstRemovalState = await request.get(
      `${API_BASE}/api/boards/${sourceBoardId}/references?direction=outbound`,
    )
    expect(firstRemovalState.ok()).toBe(true)
    expect(await firstRemovalState.json()).toEqual([])

    const revisionResponse = await request.get(`${API_BASE}/api/boards/${sourceBoardId}`)
    expect(revisionResponse.ok()).toBe(true)
    const { revision: currentRevision } = await revisionResponse.json() as { revision: number }

    const secondShapeId = `shape:delete-second-${crypto.randomUUID()}`
    const recreated = await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
      data: {
        targetBoardId,
        shapeId: secondShapeId,
        kind: 'embed',
        expectedRevision: currentRevision,
      },
    })
    expect(recreated.status()).toBe(201)
    await Promise.all([first, second].map((client) => client.waitForFunction((id) => Boolean(
      (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
    ), secondShapeId)))

    await second.evaluate((id) => {
      const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      editor.select(id)
      editor.deleteShapes([id])
    }, secondShapeId)
    await Promise.all([first, second].map((client) => client.waitForFunction((id) => !(
      window as Window & { __INFINITE_BOARD_EDITOR__?: any }
    ).__INFINITE_BOARD_EDITOR__?.getShape(id), secondShapeId)))

    const finalReferences = await request.get(
      `${API_BASE}/api/boards/${sourceBoardId}/references?direction=outbound`,
    )
    expect(finalReferences.ok()).toBe(true)
    expect(await finalReferences.json()).toEqual([])
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()])
  }
})

test('opens the native menu when right-clicking two different child boards in sequence', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix)
  const secondTargetBoardId = `board-target-second-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
    data: { id: secondTargetBoardId, title: 'Second target' },
  })).ok()).toBe(true)

  const firstShapeId = `shape:first-context-menu-${crypto.randomUUID()}`
  const secondShapeId = `shape:second-context-menu-${crypto.randomUUID()}`
  expect((await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: {
      targetBoardId,
      shapeId: firstShapeId,
      kind: 'embed',
      expectedRevision: 0,
      placement: { x: 40, y: 120 },
    },
  })).status()).toBe(201)
  expect((await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: {
      targetBoardId: secondTargetBoardId,
      shapeId: secondShapeId,
      kind: 'embed',
      expectedRevision: 1,
      placement: { x: 720, y: 120 },
    },
  })).status()).toBe(201)

  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await page.waitForFunction(([firstId, secondId]) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor?.getShape(firstId) && editor?.getShape(secondId))
  }, [firstShapeId, secondShapeId])

  const menu = page.getByTestId('context-menu')
  const getShapeCenter = (shapeId: string) => page.evaluate((id) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const bounds = editor?.getShapePageBounds(id)
    if (!editor || !bounds) throw new Error(`Reference shape ${id} was not mounted`)
    return editor.pageToScreen(bounds.center)
  }, shapeId)
  const assertMenuAt = async (shapeId: string, point: { x: number; y: number }) => {
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    await expect(menu).toBeVisible()
    const menuBounds = await menu.boundingBox()
    expect(menuBounds).not.toBeNull()
    const distanceX = Math.max(menuBounds!.x - point.x, 0, point.x - (menuBounds!.x + menuBounds!.width))
    const distanceY = Math.max(menuBounds!.y - point.y, 0, point.y - (menuBounds!.y + menuBounds!.height))
    expect(Math.hypot(distanceX, distanceY)).toBeLessThan(32)
    expect(await page.evaluate(() => (
      window as Window & { __INFINITE_BOARD_EDITOR__?: any }
    ).__INFINITE_BOARD_EDITOR__?.getOnlySelectedShape()?.id)).toBe(shapeId)
  }
  const rightClickShape = async (shapeId: string) => {
    const point = await getShapeCenter(shapeId)
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await assertMenuAt(shapeId, point)
  }

  // Keep the menu open while alternating targets. This exercises both the fast
  // pointer sequence and the next-animation-frame reopen path used by tldraw.
  for (const shapeId of [firstShapeId, secondShapeId, firstShapeId, secondShapeId]) {
    await rightClickShape(shapeId)
  }

  // A left click on tldraw's native menu capture must let Radix close its own
  // uncontrolled state. Clearing only tldraw's global menu record leaves the
  // next contextmenu stuck until the browser window loses focus.
  const leftClosePoint = await getShapeCenter(firstShapeId)
  await page.mouse.click(leftClosePoint.x, leftClosePoint.y)
  await expect(menu).toHaveCount(0)
  await rightClickShape(secondShapeId)

  // Reopen immediately and during the closing animation. The old uncontrolled
  // Radix state intermittently stayed open after tldraw cleared its global menu.
  for (const [shapeId, delay] of [
    [firstShapeId, 0],
    [secondShapeId, 16],
    [firstShapeId, 50],
    [secondShapeId, 150],
  ] as const) {
    await page.keyboard.press('Escape')
    if (delay) await page.waitForTimeout(delay)
    await rightClickShape(shapeId)
  }

  // Keep observing past the delayed fallback window so a late close or stale
  // replay cannot turn this into another count-only false positive.
  await page.waitForTimeout(160)
  await assertMenuAt(secondShapeId, await getShapeCenter(secondShapeId))

  await page.getByRole('menuitem', { name: '进入画板' }).click()
  await expect(page).toHaveURL(new RegExp(`/boards/${secondTargetBoardId}(?:\\?|$)`))
})

test('double-clicking a board reference enters it without creating canvas text', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix)
  const shapeId = `shape:double-click-${crypto.randomUUID()}`
  const created = await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: { targetBoardId, shapeId, kind: 'embed', expectedRevision: 0 },
  })
  expect(created.status()).toBe(201)

  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await page.waitForFunction((id) => Boolean(
    (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShapePageBounds(id),
  ), shapeId)
  const sourceBoardBefore = await readBoard(request, sourceBoardId)
  const point = await page.evaluate((id) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const bounds = editor?.getShapePageBounds(id)
    if (!editor || !bounds) throw new Error(`Reference shape ${id} was not mounted`)
    return editor.pageToScreen(bounds.center)
  }, shapeId)

  await page.mouse.dblclick(point.x, point.y)

  await expect(page).toHaveURL(new RegExp(`/boards/${targetBoardId}(?:\\?|$)`))
  const sourceBoardAfter = await readBoard(request, sourceBoardId)
  expect(sourceBoardAfter.revision).toBe(sourceBoardBefore.revision)
  expect(emptyTextShapeCount(sourceBoardAfter)).toBe(emptyTextShapeCount(sourceBoardBefore))
})

test('an existing reference shape is available after an opt-in realtime cold start', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix)
  const shapeId = `shape:preseeded-${crypto.randomUUID()}`
  const created = await request.post(`${API_BASE}/api/boards/${sourceBoardId}/references`, {
    data: { targetBoardId, shapeId, kind: 'embed', expectedRevision: 0 },
  })
  expect(created.status()).toBe(201)

  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}?realtime=1`)
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => page.evaluate((id) => Boolean(
    (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
  ), shapeId)).toBe(true)
})
