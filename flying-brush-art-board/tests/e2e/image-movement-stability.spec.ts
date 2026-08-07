import { expect, test } from './test.js'

const API_BASE = 'http://localhost:8787'

test('keeps an inserted image mounted while it is moved and saved', async ({ page, request }) => {
  const suffix = crypto.randomUUID()
  const projectId = `image-stability-${suffix}`
  const boardId = `image-stability-board-${suffix}`

  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Image stability',
      rootBoard: { id: boardId, title: 'Image movement' },
    },
  })).ok()).toBe(true)

  await page.goto(`/projects/${projectId}/boards/${boardId}`)
  await expect(page.getByRole('heading', { name: 'Image movement' })).toBeVisible()

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
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="110"><rect width="180" height="110" rx="16" fill="#3370ff"/></svg>'
    const transfer = new DataTransfer()
    transfer.items.add(new File([svg], 'stability.svg', { type: 'image/svg+xml' }))
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

  const image = page.locator('img.tl-image').first()
  await expect(image).toBeVisible()
  const imageShapeId = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const shape = editor?.getCurrentPageShapes().find((candidate: any) => candidate.type === 'image')
    if (!shape) throw new Error('Inserted image shape was not found')
    const node = document.querySelector('img.tl-image')
    if (!node) throw new Error('Inserted image element was not rendered')
    ;(window as unknown as { __IMAGE_STABILITY_NODE__?: Element }).__IMAGE_STABILITY_NODE__ = node
    return shape.id as string
  })

  await page.evaluate(async (shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    for (let index = 0; index < 12; index += 1) {
      editor.updateShape({ id: shapeId, type: 'image', x: 420 + index * 8, y: 300 + index * 5 })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, imageShapeId)

  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', { timeout: 5_000 })
  expect(await page.evaluate(() => {
    const node = (window as unknown as { __IMAGE_STABILITY_NODE__?: Element }).__IMAGE_STABILITY_NODE__
    return Boolean(node?.isConnected)
  })).toBe(true)
  await expect(page.locator('img.tl-image')).toHaveCount(1)
})
