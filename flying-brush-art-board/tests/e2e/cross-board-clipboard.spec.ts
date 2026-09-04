import { expect, test, type APIRequestContext, type Page } from './test.js'

async function seedClipboardBoards(request: APIRequestContext, suffix: string) {
  const projectId = `project-clipboard-${suffix}`
  const sourceBoardId = `board-source-${suffix}`
  const targetBoardId = `board-target-${suffix}`
  const otherBoardId = `board-other-${suffix}`
  expect((await request.post('http://localhost:8787/api/projects', {
    data: {
      id: projectId,
      title: 'Clipboard Project',
      rootBoard: { id: sourceBoardId, title: 'Source' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`http://localhost:8787/api/projects/${projectId}/boards`, {
    data: { id: targetBoardId, title: 'Target' },
  })).ok()).toBe(true)
  expect((await request.post(`http://localhost:8787/api/projects/${projectId}/boards`, {
    data: { id: otherBoardId, title: 'Other' },
  })).ok()).toBe(true)
  return { projectId, sourceBoardId, targetBoardId, otherBoardId }
}

async function waitForBoardCanvasReady(page: Page, title: string) {
  await expect(page.getByRole('tab', { name: new RegExp(title) })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.locator('.loading-state').filter({ hasText: '正在加载画板' })).toHaveCount(0)
  await expect(page.getByLabel('白板画布')).toBeVisible()
}

test('copies an ordinary shape across open boards without changing the source', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedClipboardBoards(request, suffix)
  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })

  const sourceShapeId = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const id = `shape:clipboard-${crypto.randomUUID()}`
    editor.createShapes([{ id, type: 'geo', x: 80, y: 90 }])
    editor.setSelectedShapes([id])
    return id
  })
  await expect.poll(() => page.evaluate((id) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      exists: Boolean(editor?.getShape(id)),
      selectedShapeIds: editor?.getSelectedShapeIds() ?? [],
    }
  }, sourceShapeId)).toEqual({ exists: true, selectedShapeIds: [sourceShapeId] })
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', { timeout: 5_000 })
  await expect.poll(async () => {
    const response = await request.get(`http://localhost:8787/api/boards/${encodeURIComponent(sourceBoardId)}`)
    const board = await response.json() as { tldrawSnapshot: { store?: Record<string, unknown> } }
    return Boolean(board.tldrawSnapshot.store?.[sourceShapeId])
  }, { timeout: 10_000 }).toBe(true)
  await page.keyboard.press('Control+c')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await page.getByRole('listitem', { name: 'Target' }).getByRole('button', { name: 'Target 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await waitForBoardCanvasReady(page, 'Target')
  const pasteResponse = page.waitForResponse((response) => response.url().includes('/clipboard/paste'))
  await page.keyboard.press('Control+v')
  const pasted = await pasteResponse
  expect(pasted.status()).toBe(201)
  const sent = pasted.request().postDataJSON() as { payload: { shapes: unknown[] } }
  expect(sent.payload.shapes).toHaveLength(1)
  const receipt = await pasted.json() as { snapshot: { store: Record<string, unknown> } }
  expect(Object.keys(receipt.snapshot.store).filter((id) => id.startsWith('shape:'))).toHaveLength(1)
  await expect.poll(async () => {
    const response = await request.get(`http://localhost:8787/api/boards/${targetBoardId}`)
    const board = await response.json() as { tldrawSnapshot: { store: Record<string, unknown> } }
    return Object.keys(board.tldrawSnapshot.store).filter((id) => id.startsWith('shape:')).length
  }).toBe(1)

  const sourceResponse = await request.get(`http://localhost:8787/api/boards/${sourceBoardId}`)
  const source = await sourceResponse.json() as { revision: number; tldrawSnapshot: { store: Record<string, unknown> } }
  // Realtime and structural writes share one durable content revision so a
  // later whole-snapshot command cannot silently overwrite the realtime edit.
  expect(source.revision).toBeGreaterThan(0)
  expect(source.tldrawSnapshot.store[sourceShapeId]).toBeDefined()
})

test('uses strict stacked undo/redo order and never replays history after the tab changes boards', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId, otherBoardId } = await seedClipboardBoards(request, suffix)
  const shapeCount = async (boardId: string) => {
    const response = await request.get(`http://localhost:8787/api/boards/${encodeURIComponent(boardId)}`)
    const board = await response.json() as { tldrawSnapshot: { store?: Record<string, unknown> } }
    return Object.keys(board.tldrawSnapshot.store ?? {}).filter((id) => id.startsWith('shape:')).length
  }
  const command = async (pathSuffix: string, key: string) => {
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(pathSuffix) && response.request().method() === 'POST',
    )
    await page.keyboard.press(key)
    const response = await responsePromise
    expect(response.ok()).toBe(true)
  }

  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__: any }).__INFINITE_BOARD_EDITOR__
    editor.createShapes([{ id: 'shape:stack-A', type: 'geo', x: 80, y: 90 }])
    editor.setSelectedShapes(['shape:stack-A'])
  })
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await page.getByRole('listitem', { name: 'Target' }).getByRole('button', { name: 'Target 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await waitForBoardCanvasReady(page, 'Target')
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await command('/clipboard/paste', 'Control+v')
  await expect.poll(() => shapeCount(targetBoardId)).toBe(1)

  await page.getByRole('tab', { name: /Source/ }).click()
  await waitForBoardCanvasReady(page, 'Source')
  await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__: any }).__INFINITE_BOARD_EDITOR__
    editor.createShapes([{ id: 'shape:stack-B', type: 'geo', x: 220, y: 190 }])
    editor.setSelectedShapes(['shape:stack-B'])
  })
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: /Target/ }).click()
  await waitForBoardCanvasReady(page, 'Target')
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await command('/clipboard/paste', 'Control+v')
  await expect.poll(() => shapeCount(targetBoardId)).toBe(2)

  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await command('/undo', 'Control+z')
  await expect.poll(() => shapeCount(targetBoardId)).toBe(1)
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await command('/undo', 'Control+z')
  await expect.poll(() => shapeCount(targetBoardId)).toBe(0)
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await command('/redo', 'Control+y')
  await expect.poll(() => shapeCount(targetBoardId)).toBe(1)
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  await command('/redo', 'Control+y')
  await expect.poll(() => shapeCount(targetBoardId)).toBe(2)

  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await page.getByRole('listitem', { name: 'Other' }).locator('.board-list__open').click()
  await waitForBoardCanvasReady(page, 'Other')
  await expect(page).toHaveURL(new RegExp(`/boards/${otherBoardId}(?:\\?|$)`))
  const clipboardReplayRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/clipboard/commands/')) clipboardReplayRequests.push(request.url())
  })
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)

  expect(clipboardReplayRequests).toEqual([])
  await expect.poll(() => shapeCount(targetBoardId)).toBe(2)
  await expect.poll(() => shapeCount(otherBoardId)).toBe(0)
})
