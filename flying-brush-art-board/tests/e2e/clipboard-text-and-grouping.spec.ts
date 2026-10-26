import { expect, test, type APIRequestContext, type Page } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

async function seedBoards(request: APIRequestContext, suffix: string, withTarget = false) {
  const projectId = `project-text-clipboard-${suffix}`
  const sourceBoardId = `board-text-source-${suffix}`
  const targetBoardId = `board-text-target-${suffix}`
  const projectResponse = await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Clipboard text and grouping',
      rootBoard: { id: sourceBoardId, title: 'Source' },
    },
  })
  expect(projectResponse.ok()).toBe(true)

  if (withTarget) {
    const boardResponse = await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
      data: { id: targetBoardId, title: 'Target' },
    })
    expect(boardResponse.ok()).toBe(true)
  }

  return { projectId, sourceBoardId, targetBoardId }
}

async function openBoard(page: Page, projectId: string, boardId: string) {
  await page.goto(`/projects/${projectId}/boards/${boardId}`)
  const canvas = page.locator('.canvas-editor')
  await expect(canvas).toBeVisible()
  await canvas.click({ position: { x: 420, y: 320 } })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  })
  return canvas
}

async function writeClipboard(page: Page, input: { text: string; html?: string }) {
  await page.evaluate(async ({ text, html }) => {
    if (html === undefined) {
      await navigator.clipboard.writeText(text)
      return
    }
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ])
  }, input)
}

async function moveMouseToCanvasPoint(page: Page, canvas: ReturnType<Page['locator']>, position: { x: number; y: number }) {
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas has no bounds')
  const screenPoint = { x: bounds.x + position.x, y: bounds.y + position.y }
  await page.mouse.move(screenPoint.x, screenPoint.y)
  const pagePoint = await page.evaluate((point) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    return editor.screenToPage(point)
  }, screenPoint)
  return { pagePoint, screenPoint }
}

async function textShapes(page: Page) {
  return page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'text')
      .map((shape: any) => {
        const bounds = editor.getShapePageBounds(shape.id)
        return {
          id: shape.id as string,
          text: editor.getShapeUtil(shape).getText(shape) as string,
          richText: shape.props.richText as unknown,
          bounds: bounds
            ? { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY }
            : undefined,
        }
      })
  })
}

test('hides the style settings after clicking blank canvas space', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId } = await seedBoards(request, suffix)
  const canvas = await openBoard(page, projectId, sourceBoardId)

  await page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const id = `shape:style-panel-${crypto.randomUUID()}`
    editor.createShapes([{ id, type: 'geo', x: 120, y: 120, props: { geo: 'rectangle', w: 120, h: 80 } }])
    editor.setSelectedShapes([id])
  })

  await expect(page.getByTestId('style.panel')).toBeVisible()
  await canvas.click({ position: { x: 900, y: 600 } })
  await expect.poll(() => page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor?.getSelectedShapeIds() ?? []
  })).toEqual([])
  await expect(page.getByTestId('style.panel')).toBeHidden()
})

test('pastes multiline plain text as one selected shape at the mouse and supports undo/redo', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId } = await seedBoards(request, suffix)
  const canvas = await openBoard(page, projectId, sourceBoardId)
  const pastedText = 'First clipboard line\nSecond clipboard line'

  await writeClipboard(page, { text: pastedText })
  const { pagePoint } = await moveMouseToCanvasPoint(page, canvas, { x: 610, y: 430 })
  await page.keyboard.press('Control+v')

  await expect.poll(async () => (await textShapes(page)).length).toBe(1)
  const [shape] = await textShapes(page)
  expect(shape.text).toBe(pastedText)
  expect(shape.bounds).toBeDefined()
  expect(pagePoint.x).toBeGreaterThanOrEqual(shape.bounds!.minX - 1)
  expect(pagePoint.x).toBeLessThanOrEqual(shape.bounds!.maxX + 1)
  expect(pagePoint.y).toBeGreaterThanOrEqual(shape.bounds!.minY - 1)
  expect(pagePoint.y).toBeLessThanOrEqual(shape.bounds!.maxY + 1)
  await expect.poll(() => page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor?.getSelectedShapeIds() ?? []
  })).toEqual([shape.id])

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await textShapes(page)).length).toBe(0)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (
    await textShapes(page)
  ).map((candidate: { text: string }) => candidate.text)).toEqual([pastedText])
})

test('keeps basic HTML formatting for Ctrl+V and strips it for Ctrl+Shift+V', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId } = await seedBoards(request, suffix)
  const canvas = await openBoard(page, projectId, sourceBoardId)

  await writeClipboard(page, {
    text: 'Bold clipboard and italic clipboard',
    html: '<p><strong>Bold clipboard</strong> and <em>italic clipboard</em></p>',
  })
  await moveMouseToCanvasPoint(page, canvas, { x: 430, y: 350 })
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await textShapes(page)).length).toBe(1)

  const [richShape] = await textShapes(page)
  expect(richShape.text).toBe('Bold clipboard and italic clipboard')
  const serializedRichText = JSON.stringify(richShape.richText)
  expect(serializedRichText).toContain('"bold"')
  expect(serializedRichText).toContain('"italic"')

  await writeClipboard(page, {
    text: 'Plain clipboard only',
    html: '<p><strong>Plain clipboard only</strong></p>',
  })
  await moveMouseToCanvasPoint(page, canvas, { x: 720, y: 520 })
  await page.keyboard.press('Control+Shift+v')
  await expect.poll(async () => (await textShapes(page)).length).toBe(2)

  const plainShape = (await textShapes(page)).find((shape: { text: string; richText: unknown }) => (
    shape.text === 'Plain clipboard only'
  ))
  expect(plainShape).toBeDefined()
  expect(JSON.stringify(plainShape!.richText)).not.toContain('"bold"')

  await page.evaluate((shapeId) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (shapeId) editor?.setSelectedShapes([shapeId])
  }, richShape.id)
  const backgroundFill = page.getByRole('toolbar', { name: '背景填充' })
  await expect(backgroundFill).toBeVisible()
  await backgroundFill.getByTestId('style.fill.semi').click()
  await expect.poll(() => page.evaluate((shapeId) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor?.getShape(shapeId)?.meta?.infiniteBoardTextBackground
  }, richShape.id)).toEqual({ color: 'yellow', fill: 'semi' })
  await expect(page.getByTestId(`text-background-${richShape.id}`)).toBeVisible()

  await backgroundFill.getByTestId('style.fill.none').click()
  await expect(page.getByTestId(`text-background-${richShape.id}`)).toBeHidden()
})

test('copies a mixed image selection through tldraw and pastes it at the mouse', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId } = await seedBoards(request, suffix)
  const canvas = await openBoard(page, projectId, sourceBoardId)

  const originalIds = await page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const assetId = `asset:clipboard-${crypto.randomUUID()}`
    const imageId = `shape:clipboard-image-${crypto.randomUUID()}`
    const geoId = `shape:clipboard-geo-${crypto.randomUUID()}`
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#38bdf8"/></svg>'
    const src = `data:image/svg+xml;base64,${btoa(svg)}`
    editor.createAssets([{
      id: assetId,
      typeName: 'asset',
      type: 'image',
      props: {
        name: 'Clipboard image.svg',
        src,
        w: 120,
        h: 80,
        mimeType: 'image/svg+xml',
        isAnimated: false,
      },
      meta: {},
    }])
    editor.createShapes([
      {
        id: imageId,
        type: 'image',
        x: 120,
        y: 140,
        props: { w: 120, h: 80, assetId, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' },
      },
      { id: geoId, type: 'geo', x: 290, y: 160, props: { geo: 'rectangle', w: 100, h: 70 } },
    ])
    editor.setSelectedShapes([imageId, geoId])
    return [imageId, geoId]
  })

  await page.keyboard.press('Control+c')
  await expect.poll(() => page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read()
      const htmlItem = items.find((item) => item.types.includes('text/html'))
      if (!htmlItem) return ''
      return (await htmlItem.getType('text/html')).text()
    } catch {
      return ''
    }
  })).toContain('data-tldraw')

  const { pagePoint } = await moveMouseToCanvasPoint(page, canvas, { x: 720, y: 470 })
  await page.keyboard.press('Control+v')

  await expect.poll(() => page.evaluate((sourceIds) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const selectedIds = editor?.getSelectedShapeIds() ?? []
    const selectedTypes = selectedIds.map((id: string) => editor.getShape(id)?.type).sort()
    const copiedIds = selectedIds.filter((id: string) => !sourceIds.includes(id))
    const bounds = editor?.getSelectionPageBounds()
    return {
      copiedIds,
      selectedTypes,
      center: bounds ? { x: bounds.center.x, y: bounds.center.y } : undefined,
    }
  }, originalIds)).toMatchObject({
    copiedIds: [expect.any(String), expect.any(String)],
    selectedTypes: ['geo', 'image'],
    center: {
      x: expect.closeTo(pagePoint.x, 0),
      y: expect.closeTo(pagePoint.y, 0),
    },
  })
})

test('shows Feishu-style group actions and keeps group history undoable', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId } = await seedBoards(request, suffix)
  await openBoard(page, projectId, sourceBoardId)

  const shapeIds = await page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const ids = [`shape:group-a-${crypto.randomUUID()}`, `shape:group-b-${crypto.randomUUID()}`]
    editor.createShapes([
      { id: ids[0], type: 'geo', x: 160, y: 180, props: { geo: 'rectangle', w: 120, h: 80 } },
      { id: ids[1], type: 'geo', x: 360, y: 220, props: { geo: 'ellipse', w: 120, h: 80 } },
    ])
    editor.setSelectedShapes(ids)
    return ids
  })

  const groupingState = () => page.evaluate((expectedChildIds) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const shapes = editor?.getCurrentPageShapes() ?? []
    const groups = shapes.filter((shape: { type: string }) => shape.type === 'group')
    const group = groups[0]
    return {
      groupCount: groups.length,
      groupId: group?.id as string | undefined,
      groupedChildIds: group
        ? shapes
          .filter((shape: { parentId: string }) => shape.parentId === group.id)
          .map((shape: { id: string }) => shape.id)
          .sort()
        : [],
      rootChildIds: shapes
        .filter((shape: { id: string; parentId: string }) => expectedChildIds.includes(shape.id) && shape.parentId !== group?.id)
        .map((shape: { id: string }) => shape.id)
        .sort(),
      selectedShapeIds: (editor?.getSelectedShapeIds() ?? []).slice().sort(),
    }
  }, [...shapeIds].sort())

  await page.keyboard.press('Control+g')
  await expect.poll(groupingState).toMatchObject({
    groupCount: 1,
    groupedChildIds: [...shapeIds].sort(),
    rootChildIds: [],
  })
  const grouped = await groupingState()
  expect(grouped.selectedShapeIds).toEqual([grouped.groupId])

  await page.keyboard.press('Control+z')
  await expect.poll(groupingState).toMatchObject({
    groupCount: 0,
    groupedChildIds: [],
    rootChildIds: [...shapeIds].sort(),
  })

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(groupingState).toMatchObject({ groupCount: 1, groupedChildIds: [...shapeIds].sort() })
  const regrouped = await groupingState()

  const childLefts = () => page.evaluate((ids) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return ids.map((id) => editor?.getShapePageBounds(id)?.minX as number)
  }, shapeIds)
  const initialLefts = await childLefts()
  expect(Math.abs(initialLefts[0]! - initialLefts[1]!)).toBeGreaterThan(1)

  await page.getByTestId('actions-menu.button').click()
  const alignLeft = page.getByTestId('actions-menu.align-left')
  await expect(alignLeft).toBeEnabled()
  await alignLeft.click()
  await expect.poll(async () => {
    const lefts = await childLefts()
    return Math.abs(lefts[0]! - lefts[1]!)
  }).toBeLessThan(0.1)
  await expect.poll(async () => (await groupingState()).selectedShapeIds).toEqual([regrouped.groupId])
  await page.keyboard.press('Escape')
  await page.evaluate((groupId) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (groupId) editor?.setSelectedShapes([groupId])
  }, regrouped.groupId)

  const selectChildren = page.getByTestId('group-selection-toolbar.select-children')
  const ungroup = page.getByTestId('group-selection-toolbar.ungroup')
  const more = page.getByTestId('group-selection-toolbar.more')
  await expect(selectChildren).toBeVisible()
  await expect(ungroup).toBeVisible()
  await expect(page.getByTestId('contextual-toolbar')).toHaveAttribute('data-interactive', 'true')
  await more.click()
  await expect(page.getByRole('menuitem', { name: /^(编辑|Edit)$/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.evaluate((groupId) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (groupId) editor?.setSelectedShapes([groupId])
  }, regrouped.groupId)
  await expect(selectChildren).toBeVisible()
  await selectChildren.click()
  await expect.poll(async () => (await groupingState()).selectedShapeIds).toEqual([...shapeIds].sort())
  await page.evaluate((groupId) => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (groupId) editor?.setSelectedShapes([groupId])
  }, regrouped.groupId)
  await expect(ungroup).toBeVisible()

  await page.keyboard.press('Control+g')
  await expect.poll(groupingState).toMatchObject({
    groupCount: 1,
    groupId: regrouped.groupId,
    groupedChildIds: [...shapeIds].sort(),
  })

  await ungroup.click()
  await expect.poll(groupingState).toMatchObject({
    groupCount: 0,
    groupedChildIds: [],
    rootChildIds: [...shapeIds].sort(),
  })

  await page.keyboard.press('Control+z')
  await expect.poll(groupingState).toMatchObject({ groupCount: 1, groupedChildIds: [...shapeIds].sort() })
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(groupingState).toMatchObject({ groupCount: 0, rootChildIds: [...shapeIds].sort() })
})

test('preserves a group and its remapped children when pasted across boards at the mouse', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, sourceBoardId, targetBoardId } = await seedBoards(request, suffix, true)
  await openBoard(page, projectId, sourceBoardId)

  await page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const ids = [`shape:copy-group-a-${crypto.randomUUID()}`, `shape:copy-group-b-${crypto.randomUUID()}`]
    editor.createShapes([
      { id: ids[0], type: 'geo', x: 120, y: 160, props: { geo: 'rectangle', w: 100, h: 70 } },
      { id: ids[1], type: 'geo', x: 300, y: 200, props: { geo: 'ellipse', w: 100, h: 70 } },
    ])
    editor.setSelectedShapes(ids)
  })
  await page.keyboard.press('Control+g')
  await expect.poll(() => page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor?.getCurrentPageShapes().filter((shape: { type: string }) => shape.type === 'group').length ?? 0
  })).toBe(1)

  await page.keyboard.press('Control+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
    'application/x-infinite-board-clipboard+json',
  )

  const targetCanvas = await openBoard(page, projectId, targetBoardId)
  const { pagePoint } = await moveMouseToCanvasPoint(page, targetCanvas, { x: 650, y: 420 })
  const pasteResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/boards/${targetBoardId}/clipboard/paste`)
      && response.request().method() === 'POST'
  ))
  await page.keyboard.press('Control+v')
  const response = await pasteResponse
  expect(response.status()).toBe(201)
  const requestBody = response.request().postDataJSON() as {
    payload: { shapes: Array<{ id: string; type?: string }> }
    placement: { x: number; y: number } | { viewportCenter: true }
  }
  expect(requestBody.payload.shapes).toHaveLength(3)
  expect(requestBody.placement).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  if ('x' in requestBody.placement) {
    expect(requestBody.placement.x).toBeCloseTo(pagePoint.x, 1)
    expect(requestBody.placement.y).toBeCloseTo(pagePoint.y, 1)
  }

  await expect.poll(() => page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const shapes = editor?.getCurrentPageShapes() ?? []
    const groups = shapes.filter((shape: { type: string }) => shape.type === 'group')
    const group = groups[0]
    return {
      groupCount: groups.length,
      childCount: group
        ? shapes.filter((shape: { parentId: string }) => shape.parentId === group.id).length
        : 0,
    }
  })).toMatchObject({ groupCount: 1, childCount: 2 })
})
