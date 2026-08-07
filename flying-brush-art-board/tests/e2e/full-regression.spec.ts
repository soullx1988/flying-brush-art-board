import { expect, test, type APIRequestContext, type Page } from './test.js'

import type { StoredBoard } from '../../packages/board-core/src/index.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

async function seedProject(request: APIRequestContext, suffix: string) {
  const projectId = `full-regression-${suffix}`
  const sourceBoardId = `full-regression-source-${suffix}`
  const targetBoardId = `full-regression-target-${suffix}`

  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Full regression project',
      rootBoard: { id: sourceBoardId, title: 'Source journey' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/boards`, {
    data: { id: targetBoardId, title: 'Target journey' },
  })).ok()).toBe(true)

  return { projectId, sourceBoardId, targetBoardId }
}

async function readBoard(request: APIRequestContext, boardId: string): Promise<StoredBoard> {
  const response = await request.get(`${API_BASE}/api/boards/${encodeURIComponent(boardId)}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<StoredBoard>
}

function snapshotStore(board: StoredBoard): Record<string, any> {
  const snapshot = board.tldrawSnapshot as {
    store?: Record<string, any>
    document?: { store?: Record<string, any> }
  }
  return snapshot.document?.store ?? snapshot.store ?? {}
}

async function dropSvgOnCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['probe'], 'probe.svg', { type: 'image/svg+xml' }))
    window.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }))
  })
  await page.locator('.app-drop-overlay').waitFor({ state: 'visible' })

  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" rx="12" fill="#2563eb"/></svg>'
    const transfer = new DataTransfer()
    transfer.items.add(new File([svg], 'Journey asset.svg', { type: 'image/svg+xml' }))
    const target = document.querySelector('[data-drop-target="canvas"]')
    if (!target) throw new Error('Canvas drop target was not rendered')
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 420,
      clientY: 320,
      dataTransfer: transfer,
    }))
  })
}

test('smokes the local multi-board edit, clipboard, drag-import, and export journey', async ({ page, request }) => {
  test.setTimeout(90_000)
  const suffix = crypto.randomUUID()
  const { projectId, sourceBoardId, targetBoardId } = await seedProject(request, suffix)

  await page.goto(`/projects/${projectId}/boards/${sourceBoardId}`)
  await expect(page.getByRole('heading', { name: 'Source journey' })).toBeVisible()
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })

  const sourceShapeId = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const id = `shape:journey-${crypto.randomUUID()}`
    editor.createShapes([{ id, type: 'geo', x: 100, y: 120 }])
    editor.setSelectedShapes([id])
    return id
  })
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', { timeout: 5_000 })
  await expect.poll(async () => snapshotStore(await readBoard(request, sourceBoardId))[sourceShapeId]).toBeDefined()

  await page.reload()
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor?.getShape(shapeId))
  }, sourceShapeId)).toBe(true)

  await page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor?.setSelectedShapes([shapeId])
  }, sourceShapeId)
  await page.keyboard.press('Control+c')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '全部画板', exact: true }).click()
  const targetRow = page.getByRole('listitem', { name: 'Target journey' })
  await targetRow.getByRole('button', { name: 'Target journey 更多操作' }).click()
  await page.getByRole('menuitem', { name: '在新标签打开' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: /Target journey/ })).toHaveAttribute('aria-selected', 'true')

  const pasteResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/boards/${encodeURIComponent(targetBoardId)}/clipboard/paste`)
    && response.request().method() === 'POST')
  await page.keyboard.press('Control+v')
  expect((await pasteResponse).status()).toBe(201)
  await expect.poll(async () => {
    const records = Object.values(snapshotStore(await readBoard(request, targetBoardId)))
    return records.filter((record) => record.typeName === 'shape' && record.type === 'geo').length
  }).toBe(1)

  await page.getByRole('tab', { name: /Source journey/ }).click()
  await expect(page.getByRole('heading', { name: 'Source journey' })).toBeVisible()
  await expect.poll(() => page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor?.getShape(shapeId))
  }, sourceShapeId)).toBe(true)
  await page.getByRole('tab', { name: /Target journey/ }).click()
  await expect(page.getByRole('heading', { name: 'Target journey' })).toBeVisible()

  await dropSvgOnCanvas(page)
  await expect.poll(async () => {
    const records = Object.values(snapshotStore(await readBoard(request, targetBoardId)))
    return {
      imageShapes: records.filter((record) => record.typeName === 'shape' && record.type === 'image').length,
      imageAssets: records.filter((record) => record.typeName === 'asset' && record.type === 'image').length,
    }
  }).toEqual({ imageShapes: 1, imageAssets: 1 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('menuitem', { name: '导出 SVG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Target journey.svg')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString('utf8')).toContain('<svg')

  await expect.poll(async () => Boolean(snapshotStore(await readBoard(request, sourceBoardId))[sourceShapeId]), {
    timeout: 10_000,
  }).toBe(true)
  const sourceBoard = await readBoard(request, sourceBoardId)
  const targetBoard = await readBoard(request, targetBoardId)
  // Realtime document changes do not advance the REST revision reserved for
  // serialized structural commands.
  expect(sourceBoard.revision).toBe(0)
  expect(snapshotStore(sourceBoard)[sourceShapeId]).toBeDefined()
  expect(targetBoard.revision).toBeGreaterThanOrEqual(2)
  expect(Object.keys(snapshotStore(targetBoard)).filter((id) => id.startsWith('shape:'))).not.toContain(sourceShapeId)
})
