import { expect, test, type APIRequestContext } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

async function seedClipboardBoards(request: APIRequestContext, suffix: string) {
  const projectId = `project-clipboard-${suffix}`
  const sourceBoardId = `board-source-${suffix}`
  const targetBoardId = `board-target-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Clipboard Project',
      rootBoard: { id: sourceBoardId, title: 'Source' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
    data: { id: targetBoardId, title: 'Target' },
  })).ok()).toBe(true)
  return { projectId, sourceBoardId, targetBoardId }
}

test('copies an ordinary shape across open boards without changing the source', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedClipboardBoards(request, suffix)
  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  })
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
    const response = await request.get(`${API_BASE}/api/boards/${encodeURIComponent(sourceBoardId)}`)
    const board = await response.json() as { tldrawSnapshot: { store?: Record<string, unknown> } }
    return Boolean(board.tldrawSnapshot.store?.[sourceShapeId])
  }, { timeout: 10_000 }).toBe(true)
  await page.keyboard.press('Control+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
    'application/x-infinite-board-clipboard+json',
  )

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  await page.getByRole('listitem', { name: 'Target' }).getByRole('button', { name: 'Target 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await expect(page.getByRole('tab', { name: /Target/ })).toHaveAttribute('aria-selected', 'true')
  const targetCanvas = page.locator('.canvas-editor')
  const targetBounds = await targetCanvas.boundingBox()
  if (!targetBounds) throw new Error('Target canvas has no bounds')
  await page.mouse.move(targetBounds.x + 620, targetBounds.y + 420)
  const pasteResponse = page.waitForResponse((response) => (
    response.url().includes('/clipboard/paste') && response.status() === 201
  ))
  await page.keyboard.press('Control+v')
  const pasted = await pasteResponse
  expect(pasted.status()).toBe(201)
  const sent = pasted.request().postDataJSON() as { payload: { shapes: unknown[] } }
  expect(sent.payload.shapes).toHaveLength(1)
  const receipt = await pasted.json() as { snapshot: { store: Record<string, unknown> } }
  expect(Object.keys(receipt.snapshot.store).filter((id) => id.startsWith('shape:'))).toHaveLength(1)
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/api/boards/${targetBoardId}`)
    const board = await response.json() as { tldrawSnapshot: { store: Record<string, unknown> } }
    return Object.keys(board.tldrawSnapshot.store).filter((id) => id.startsWith('shape:')).length
  }).toBe(1)

  const sourceResponse = await request.get(`${API_BASE}/api/boards/${sourceBoardId}`)
  const source = await sourceResponse.json() as { tldrawSnapshot: { store: Record<string, unknown> } }
  expect(source.tldrawSnapshot.store[sourceShapeId]).toBeDefined()
  expect(Object.keys(source.tldrawSnapshot.store).filter((id) => id.startsWith('shape:'))).toHaveLength(1)
})
