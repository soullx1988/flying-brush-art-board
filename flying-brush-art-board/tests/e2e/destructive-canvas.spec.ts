import { createHash } from 'node:crypto'

import { expect, test, type APIRequestContext, type Page } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

interface TestProject {
  projectId: string
  rootBoardId: string
}

async function createTestProject(request: APIRequestContext, prefix: string): Promise<TestProject> {
  const suffix = `${Date.now()}-${crypto.randomUUID()}`
  const projectId = `project-${prefix}-${suffix}`
  const rootBoardId = `board-${prefix}-${suffix}`
  const response = await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: `Destructive ${prefix}`,
      rootBoard: { id: rootBoardId, title: 'Destructive canvas' },
    },
  })
  expect(response.status()).toBe(201)
  return { projectId, rootBoardId }
}

async function openEditableBoard(page: Page, project: TestProject): Promise<void> {
  await page.goto(`/projects/${project.projectId}/boards/${project.rootBoardId}`)
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await page.getByLabel('白板画布').click({ position: { x: 80, y: 80 } })
  await expect(page.locator('.read-only-badge')).toHaveCount(0)
}

async function waitForClean(page: Page): Promise<void> {
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', {
    timeout: 10_000,
  })
}

async function waitForPersistedState(
  request: APIRequestContext,
  boardId: string,
  predicate: (records: Record<string, any>) => boolean,
): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/api/boards/${boardId}`)
    if (!response.ok()) return false
    const board = await response.json() as { tldrawSnapshot?: { store?: Record<string, any> } }
    return predicate(board.tldrawSnapshot?.store ?? {})
  }, { timeout: 10_000 }).toBe(true)
}

function collectAssetAndTranslationErrors(page: Page): string[] {
  const problems: string[] = []
  const isRelevant = (message: string) => /Language zh-cn: missing messages|NetworkError|Failed to fetch/.test(message)
  page.on('console', (message) => {
    if (isRelevant(message.text())) problems.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    if (isRelevant(error.message)) problems.push(`pageerror: ${error.message}`)
  })
  return problems
}

async function performToolStroke(
  page: Page,
  toolId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.evaluate((id) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.setCurrentTool(id)
  }, toolId)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.mouse.up()
}

async function dropSvgOnCanvas(page: Page, name: string, x: number, y: number): Promise<void> {
  const imageIdsBefore = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'image')
      .map((shape: { id: string }) => shape.id)
  })
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
  await page.evaluate(({ fileName, clientX, clientY }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="10" fill="#2563eb"/></svg>'
    const transfer = new DataTransfer()
    transfer.items.add(new File([svg], fileName, { type: 'image/svg+xml' }))
    const target = document.querySelector('[data-drop-target="canvas"]')
    if (!target) throw new Error('Canvas drop target was not rendered')
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      dataTransfer: transfer,
    }))
  }, { fileName: name, clientX: x, clientY: y })
  await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string; id: string }) => shape.type === 'image' && !before.includes(shape.id))
      .length
  }, imageIdsBefore), { timeout: 10_000 }).toBe(1)
  await waitForClean(page)
}

test('destructive content matrix exercises every persistent and transient canvas tool @destructive', async ({ page, request }) => {
  test.setTimeout(90_000)
  const consoleProblems = collectAssetAndTranslationErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const project = await createTestProject(request, 'content-matrix')
  const childBoardIds = [`board-child-a-${crypto.randomUUID()}`, `board-child-b-${crypto.randomUUID()}`]
  const crossProjectId = `project-cross-${crypto.randomUUID()}`
  const crossRootBoardId = `board-cross-${crypto.randomUUID()}`
  for (const [index, boardId] of childBoardIds.entries()) {
    const response = await request.post(`${API_BASE}/api/projects/${project.projectId}/boards`, {
      data: { id: boardId, title: `Child ${index + 1}` },
    })
    expect(response.status()).toBe(201)
  }
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: crossProjectId,
      title: 'Cross project isolation',
      rootBoard: { id: crossRootBoardId, title: 'Cross root' },
    },
  })).status()).toBe(201)
  for (const [index, targetBoardId] of childBoardIds.entries()) {
    const response = await request.post(`${API_BASE}/api/boards/${project.rootBoardId}/references`, {
      data: {
        targetBoardId,
        shapeId: `shape:child-reference-${index + 1}-${crypto.randomUUID()}`,
        kind: index === 0 ? 'embed' : 'link',
        expectedRevision: index,
      },
    })
    expect(response.status()).toBe(201)
  }

  await openEditableBoard(page, project)
  await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const richText = (text: string) => ({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    editor.createShapes([
      { type: 'text', x: 80, y: 80, props: { w: 160, autoSize: false, richText: richText('Text one') } },
      { type: 'text', x: 280, y: 80, props: { w: 160, autoSize: false, richText: richText('Text two') } },
      { type: 'note', x: 80, y: 180, props: { richText: richText('Note one') } },
      { type: 'note', x: 280, y: 180, props: { richText: richText('Note two') } },
      { type: 'geo', x: 520, y: 90, props: { geo: 'rectangle', w: 140, h: 90 } },
      { type: 'geo', x: 720, y: 90, props: { geo: 'ellipse', w: 140, h: 90 } },
    ])
  })

  await performToolStroke(page, 'line', { x: 560, y: 350 }, { x: 720, y: 400 })
  await performToolStroke(page, 'line', { x: 760, y: 350 }, { x: 920, y: 400 })
  await performToolStroke(page, 'highlight', { x: 100, y: 500 }, { x: 300, y: 530 })
  await performToolStroke(page, 'highlight', { x: 360, y: 500 }, { x: 560, y: 530 })

  const shapeCountBeforeLaser = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes().length
  })
  await performToolStroke(page, 'laser', { x: 650, y: 520 }, { x: 850, y: 560 })
  await performToolStroke(page, 'laser', { x: 900, y: 520 }, { x: 1100, y: 560 })
  expect(await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes().length
  })).toBe(shapeCountBeforeLaser)

  const drawIdsBefore = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes().filter((shape: any) => shape.type === 'draw').map((shape: any) => shape.id)
  })
  await performToolStroke(page, 'draw', { x: 120, y: 680 }, { x: 320, y: 710 })
  await performToolStroke(page, 'draw', { x: 400, y: 680 }, { x: 620, y: 710 })
  const createdDrawIds = await page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: any) => shape.type === 'draw' && !before.includes(shape.id))
      .map((shape: any) => shape.id)
  }, drawIdsBefore)
  expect(createdDrawIds).toHaveLength(2)

  const firstDrawBounds = await page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const bounds = editor.getShapePageBounds(shapeId)
    const left = editor.pageToScreen({ x: bounds.x - 8, y: bounds.center.y })
    const right = editor.pageToScreen({ x: bounds.maxX + 8, y: bounds.center.y })
    return { left, right }
  }, createdDrawIds[0])
  await performToolStroke(page, 'eraser', firstDrawBounds.left, firstDrawBounds.right)
  await expect.poll(() => page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor.getShape(shapeId))
  }, createdDrawIds[0])).toBe(false)

  const secondDrawPoint = await page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const bounds = editor.getShapePageBounds(shapeId)
    return editor.pageToScreen({ x: bounds.x + bounds.w * 0.2, y: bounds.center.y })
  }, createdDrawIds[1])
  const partialEraseStateBefore = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return JSON.stringify(editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'draw')
      .map((shape: { id: string; props: unknown }) => ({ id: shape.id, props: shape.props })))
  })
  await performToolStroke(
    page,
    'eraser',
    { x: secondDrawPoint.x - 4, y: secondDrawPoint.y - 4 },
    { x: secondDrawPoint.x + 4, y: secondDrawPoint.y + 4 },
  )
  await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return JSON.stringify(editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'draw')
      .map((shape: { id: string; props: unknown }) => ({ id: shape.id, props: shape.props }))) !== before
  }, partialEraseStateBefore)).toBe(true)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate((shapeIds) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return shapeIds.every((shapeId: string) => Boolean(editor.getShape(shapeId)))
  }, createdDrawIds)).toBe(true)

  await dropSvgOnCanvas(page, 'Media one.svg', 980, 260)
  await dropSvgOnCanvas(page, 'Media two.svg', 1160, 380)
  for (const [index, body] of ['Comment one', 'Comment two'].entries()) {
    const response = await request.post(`${API_BASE}/api/boards/${project.rootBoardId}/comments`, {
      data: { body, x: 160 + index * 120, y: 300 },
    })
    expect(response.status()).toBe(201)
  }

  await expect.poll(() => page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const counts: Record<string, number> = {}
    for (const shape of editor.getCurrentPageShapes()) counts[shape.type] = (counts[shape.type] ?? 0) + 1
    return counts
  }), { timeout: 10_000 }).toMatchObject({
    text: expect.any(Number),
    note: expect.any(Number),
    geo: expect.any(Number),
    line: expect.any(Number),
    highlight: expect.any(Number),
    image: expect.any(Number),
    draw: expect.any(Number),
    'board-reference': expect.any(Number),
  })
  const contentCounts = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const counts: Record<string, number> = {}
    for (const shape of editor.getCurrentPageShapes()) counts[shape.type] = (counts[shape.type] ?? 0) + 1
    return counts
  })
  for (const type of ['text', 'note', 'geo', 'line', 'highlight', 'image', 'draw', 'board-reference']) {
    expect(contentCounts[type], `${type} should have at least two persisted shapes`).toBeGreaterThanOrEqual(2)
  }

  await waitForPersistedState(request, project.rootBoardId, (records) => {
    const counts: Record<string, number> = {}
    for (const record of Object.values(records)) {
      if (record.typeName === 'shape') counts[record.type] = (counts[record.type] ?? 0) + 1
    }
    return ['text', 'note', 'geo', 'line', 'highlight', 'image', 'draw', 'board-reference']
      .every((type) => (counts[type] ?? 0) >= 2)
  })
  const comments = await request.get(`${API_BASE}/api/boards/${project.rootBoardId}/comment-state`)
  expect(comments.ok()).toBe(true)
  await expect(comments.json()).resolves.toMatchObject({
    threads: expect.arrayContaining([expect.any(Object), expect.any(Object)]),
    messages: expect.arrayContaining([
      expect.objectContaining({ body: 'Comment one' }),
      expect.objectContaining({ body: 'Comment two' }),
    ]),
  })
  expect(consoleProblems).toEqual([])
})

async function createElbowConnection(
  page: Page,
  sourceId: string,
  targetId: string,
  handleName: '从上边连接' | '从右边连接' | '从下边连接' | '从左边连接',
): Promise<string> {
  const before = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'arrow')
      .map((shape: { id: string }) => shape.id)
  })
  const targetPoint = await page.evaluate(({ sourceId: source, targetId: target }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(source)
    return editor.pageToScreen(editor.getShapePageBounds(target).center)
  }, { sourceId, targetId })

  await expect(page.getByRole('button', { name: '从上边连接' })).toBeVisible()
  await expect(page.getByRole('button', { name: '从右边连接' })).toBeVisible()
  await expect(page.getByRole('button', { name: '从下边连接' })).toBeVisible()
  await expect(page.getByRole('button', { name: '从左边连接' })).toBeVisible()
  const handle = page.getByRole('button', { name: handleName })
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error(`${handleName} has no bounds`)

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 16 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate((existing) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string; id: string }) => shape.type === 'arrow' && !existing.includes(shape.id))
      .map((shape: { id: string }) => shape.id)
  }, before)).toHaveLength(1)

  return page.evaluate((existing) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .find((shape: { type: string; id: string }) => shape.type === 'arrow' && !existing.includes(shape.id)).id
  }, before)
}

test('destructive connector lifecycle keeps routing and bindings consistent @destructive', async ({ page, request }) => {
  test.setTimeout(90_000)
  const consoleProblems = collectAssetAndTranslationErrors(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  const project = await createTestProject(request, 'connectors')
  await openEditableBoard(page, project)

  const ids = {
    start: `shape:start-${crypto.randomUUID()}`,
    process: `shape:process-${crypto.randomUUID()}`,
    review: `shape:review-${crypto.randomUUID()}`,
    finish: `shape:finish-${crypto.randomUUID()}`,
  }
  await page.evaluate((shapeIds) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const richText = (text: string) => ({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const at = (x: number, y: number) => editor.screenToPage({ x, y })
    const start = at(130, 220)
    const process = at(430, 220)
    const review = at(430, 500)
    const finish = at(760, 500)
    editor.createShapes([
      { id: shapeIds.start, type: 'geo', x: start.x, y: start.y, props: { geo: 'rectangle', w: 140, h: 90, richText: richText('开始') } },
      { id: shapeIds.process, type: 'geo', x: process.x, y: process.y, props: { geo: 'rectangle', w: 150, h: 100, richText: richText('处理') } },
      { id: shapeIds.review, type: 'geo', x: review.x, y: review.y, props: { geo: 'diamond', w: 150, h: 100, richText: richText('审核') } },
      { id: shapeIds.finish, type: 'geo', x: finish.x, y: finish.y, props: { geo: 'ellipse', w: 140, h: 90, richText: richText('完成') } },
    ])
  }, ids)

  const startToProcess = await createElbowConnection(page, ids.start, ids.process, '从右边连接')
  const processToReview = await createElbowConnection(page, ids.process, ids.review, '从下边连接')
  const reviewToFinish = await createElbowConnection(page, ids.review, ids.finish, '从右边连接')
  const topAnchorProbe = await createElbowConnection(page, ids.finish, ids.review, '从上边连接')
  const leftAnchorProbe = await createElbowConnection(page, ids.review, ids.start, '从左边连接')

  await expect.poll(() => page.evaluate((arrowIds) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return arrowIds.every((arrowId) =>
      editor.getShape(arrowId)?.props.kind === 'elbow'
      && editor.getBindingsFromShape(arrowId, 'arrow').length === 2)
  }, [topAnchorProbe, leftAnchorProbe])).toBe(true)
  await page.evaluate((arrowIds) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.deleteShapes(arrowIds)
  }, [topAnchorProbe, leftAnchorProbe])

  await expect.poll(() => page.evaluate(({ firstArrow, secondArrow, thirdArrow, shapeIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const state = (arrowId: string) => ({
      kind: editor.getShape(arrowId)?.props.kind,
      bindings: editor.getBindingsFromShape(arrowId, 'arrow').map((binding: any) => ({
        terminal: binding.props.terminal,
        toId: binding.toId,
        snap: binding.props.snap,
        anchor: binding.props.normalizedAnchor,
      })),
    })
    return { first: state(firstArrow), second: state(secondArrow), third: state(thirdArrow), shapeIds }
  }, {
    firstArrow: startToProcess,
    secondArrow: processToReview,
    thirdArrow: reviewToFinish,
    shapeIds: ids,
  })).toMatchObject({
    first: {
      kind: 'elbow',
      bindings: expect.arrayContaining([
        { terminal: 'start', toId: ids.start, snap: 'edge-point', anchor: { x: 1, y: 0.5 } },
        { terminal: 'end', toId: ids.process, snap: 'center', anchor: { x: 0.5, y: 0.5 } },
      ]),
    },
    second: {
      kind: 'elbow',
      bindings: expect.arrayContaining([
        { terminal: 'start', toId: ids.process, snap: 'edge-point', anchor: { x: 0.5, y: 1 } },
        { terminal: 'end', toId: ids.review, snap: 'center', anchor: { x: 0.5, y: 0.5 } },
      ]),
    },
    third: {
      kind: 'elbow',
      bindings: expect.arrayContaining([
        { terminal: 'start', toId: ids.review, snap: 'edge-point', anchor: { x: 1, y: 0.5 } },
        { terminal: 'end', toId: ids.finish, snap: 'center', anchor: { x: 0.5, y: 0.5 } },
      ]),
    },
  })

  const routeBefore = await page.evaluate(({ arrowId, targetId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const target = editor.getShape(targetId)
    const bounds = editor.getShapePageBounds(arrowId)
    editor.updateShape({
      id: target.id,
      type: target.type,
      x: target.x + 80,
      y: target.y + 70,
      props: { w: target.props.w + 40, h: target.props.h + 30 },
    })
    return { minX: bounds.minX, maxY: bounds.maxY }
  }, { arrowId: startToProcess, targetId: ids.process })
  await expect.poll(() => page.evaluate(({ arrowId, targetId, previous }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const bounds = editor.getShapePageBounds(arrowId)
    return {
      rerouted: bounds.minX !== previous.minX || bounds.maxY !== previous.maxY,
      bound: editor.getBindingsFromShape(arrowId, 'arrow').some((binding: any) => binding.toId === targetId),
    }
  }, { arrowId: startToProcess, targetId: ids.process, previous: routeBefore })).toEqual({
    rerouted: true,
    bound: true,
  })

  const translated = await page.evaluate(({ sourceId, targetId, arrowId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const before = editor.getShapePageBounds(arrowId)
    const source = editor.getShape(sourceId)
    const target = editor.getShape(targetId)
    editor.updateShapes([
      { id: source.id, type: source.type, x: source.x + 60, y: source.y + 40 },
      { id: target.id, type: target.type, x: target.x + 60, y: target.y + 40 },
    ])
    const after = editor.getShapePageBounds(arrowId)
    return { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) }
  }, { sourceId: ids.start, targetId: ids.process, arrowId: startToProcess })
  expect(translated).toEqual({ dx: 60, dy: 40 })

  await page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(shapeId)
  }, ids.process)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(({ deletedId, arrows }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      targetExists: Boolean(editor.getShape(deletedId)),
      arrowsExist: arrows.every((id) => Boolean(editor.getShape(id))),
      dangling: arrows.flatMap((id) => editor.getBindingsFromShape(id, 'arrow'))
        .some((binding: any) => binding.toId === deletedId),
    }
  }, { deletedId: ids.process, arrows: [startToProcess, processToReview] })).toEqual({
    targetExists: false,
    arrowsExist: true,
    dangling: false,
  })

  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(({ restoredId, arrows }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor.getShape(restoredId)) && arrows.every((id) =>
      editor.getBindingsFromShape(id, 'arrow').some((binding: any) => binding.toId === restoredId))
  }, { restoredId: ids.process, arrows: [startToProcess, processToReview] })).toBe(true)

  const duplicateClosure = await page.evaluate(({ sourceId, targetId, arrowId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(sourceId, targetId, arrowId)
    return editor.getCurrentPageShapes().map((shape: { id: string }) => shape.id)
  }, { sourceId: ids.start, targetId: ids.process, arrowId: startToProcess })
  await page.keyboard.press('Control+d')
  await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes().filter((shape: { id: string }) => !before.includes(shape.id)).length
  }, duplicateClosure)).toBe(3)
  const duplicatedBindingState = await page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const created = editor.getCurrentPageShapes().filter((shape: { id: string }) => !before.includes(shape.id))
    const arrow = created.find((shape: { type: string }) => shape.type === 'arrow')
    const nodeIds = created.filter((shape: { type: string }) => shape.type === 'geo').map((shape: { id: string }) => shape.id)
    return {
      createdCount: created.length,
      bindingTargets: editor.getBindingsFromShape(arrow.id, 'arrow').map((binding: any) => binding.toId),
      nodeIds,
    }
  }, duplicateClosure)
  expect(duplicatedBindingState.createdCount).toBe(3)
  expect(new Set(duplicatedBindingState.bindingTargets)).toEqual(new Set(duplicatedBindingState.nodeIds))

  const arrowsBeforeIsolatedDuplicate = await page.evaluate((arrowId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(arrowId)
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'arrow')
      .map((shape: { id: string }) => shape.id)
  }, startToProcess)
  await page.keyboard.press('Control+d')
  await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const arrow = editor.getCurrentPageShapes()
      .find((shape: { type: string; id: string }) => shape.type === 'arrow' && !before.includes(shape.id))
    return arrow ? editor.getBindingsFromShape(arrow.id, 'arrow').length : -1
  }, arrowsBeforeIsolatedDuplicate)).toBe(0)

  const shapesBeforeEndpointDuplicate = await page.evaluate((sourceId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(sourceId)
    return editor.getCurrentPageShapes().map((shape: { id: string }) => shape.id)
  }, ids.start)
  await page.keyboard.press('Control+d')
  await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const duplicatedEndpoint = editor.getCurrentPageShapes()
      .find((shape: { id: string; type: string }) => shape.type === 'geo' && !before.includes(shape.id))
    if (!duplicatedEndpoint) return null
    const referencedByBinding = editor.getBindingsToShape(duplicatedEndpoint.id, 'arrow').length > 0
    return { duplicatedEndpointId: duplicatedEndpoint.id, referencedByBinding }
  }, shapesBeforeEndpointDuplicate)).toMatchObject({
    duplicatedEndpointId: expect.stringMatching(/^shape:/),
    referencedByBinding: false,
  })

  await waitForClean(page)
  await waitForPersistedState(request, project.rootBoardId, (records) =>
    [startToProcess, processToReview, reviewToFinish, ...Object.values(ids)].every((id) => Boolean(records[id]))
      && [startToProcess, processToReview, reviewToFinish].every((arrowId) =>
        Object.values(records).filter((record) =>
          record.typeName === 'binding' && record.type === 'arrow' && record.fromId === arrowId).length === 2),
  )
  await page.reload()
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => page.evaluate(({ arrows, shapeIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return arrows.every((id) => Boolean(editor?.getShape(id)))
      && Object.values(shapeIds).every((id) => Boolean(editor?.getShape(id)))
      && arrows.every((id) => editor.getBindingsFromShape(id, 'arrow').length === 2)
  }, { arrows: [startToProcess, processToReview, reviewToFinish], shapeIds: ids })).toBe(true)
  const connectorEvidence = await page.evaluate(({ arrows, shapeIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      shapeIds,
      arrows: arrows.map((arrowId) => ({
        id: arrowId,
        kind: editor.getShape(arrowId)?.props.kind,
        parentId: editor.getShape(arrowId)?.parentId,
        bindings: editor.getBindingsFromShape(arrowId, 'arrow').map((binding: any) => ({
          terminal: binding.props.terminal,
          toId: binding.toId,
          snap: binding.props.snap,
          normalizedAnchor: binding.props.normalizedAnchor,
        })),
      })),
    }
  }, { arrows: [startToProcess, processToReview, reviewToFinish], shapeIds: ids })
  await test.info().attach('connector-binding-state.json', {
    body: Buffer.from(JSON.stringify(connectorEvidence, null, 2)),
    contentType: 'application/json',
  })
  await test.info().attach('connector-lifecycle.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  expect(consoleProblems).toEqual([])
})

test('destructive frame lifecycle preserves real parent-child semantics @destructive', async ({ page, request }) => {
  test.setTimeout(90_000)
  const consoleProblems = collectAssetAndTranslationErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const project = await createTestProject(request, 'frames')
  await openEditableBoard(page, project)

  const ids = {
    requirementText: `shape:requirement-text-${crypto.randomUUID()}`,
    requirementNote: `shape:requirement-note-${crypto.randomUUID()}`,
    requirementShape: `shape:requirement-geo-${crypto.randomUUID()}`,
    workflowStart: `shape:workflow-start-${crypto.randomUUID()}`,
    workflowFinish: `shape:workflow-finish-${crypto.randomUUID()}`,
    external: `shape:external-${crypto.randomUUID()}`,
  }
  await page.evaluate((shapeIds) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const richText = (text: string) => ({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const at = (x: number, y: number) => editor.screenToPage({ x, y })
    const requirementText = at(240, 250)
    const requirementNote = at(440, 250)
    const requirementShape = at(340, 410)
    const workflowStart = at(850, 260)
    const workflowFinish = at(1080, 260)
    const external = at(1080, 650)
    editor.createShapes([
      { id: shapeIds.requirementText, type: 'text', x: requirementText.x, y: requirementText.y, props: { w: 150, autoSize: false, richText: richText('需求一') } },
      { id: shapeIds.requirementNote, type: 'note', x: requirementNote.x, y: requirementNote.y, props: { richText: richText('需求二') } },
      { id: shapeIds.requirementShape, type: 'geo', x: requirementShape.x, y: requirementShape.y, props: { geo: 'rectangle', w: 130, h: 80, richText: richText('范围') } },
      { id: shapeIds.workflowStart, type: 'geo', x: workflowStart.x, y: workflowStart.y, props: { geo: 'rectangle', w: 150, h: 90, richText: richText('交付开始') } },
      { id: shapeIds.workflowFinish, type: 'geo', x: workflowFinish.x, y: workflowFinish.y, props: { geo: 'ellipse', w: 150, h: 90, richText: richText('交付完成') } },
      { id: shapeIds.external, type: 'geo', x: external.x, y: external.y, props: { geo: 'diamond', w: 120, h: 90, richText: richText('外部元素') } },
    ])
  }, ids)

  const requirementArrow = await createElbowConnection(
    page,
    ids.requirementText,
    ids.requirementShape,
    '从下边连接',
  )

  const framesBeforeDrag = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes().filter((shape: { type: string }) => shape.type === 'frame').map((shape: any) => shape.id)
  })
  await page.getByRole('button', { name: /分区|Frame/ }).click()
  await page.mouse.move(180, 180)
  await page.mouse.down()
  await page.mouse.move(700, 560, { steps: 12 })
  await page.mouse.up()
  const requirementFrame = await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string; id: string }) => shape.type === 'frame' && !before.includes(shape.id))
      .map((shape: { id: string }) => shape.id)
  }, framesBeforeDrag)).toHaveLength(1).then(async () => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes().find((shape: any) => shape.type === 'frame' && !before.includes(shape.id)).id
  }, framesBeforeDrag))

  await expect.poll(() => page.evaluate(({ frameId, childIds, arrowId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      childrenParented: childIds.every((id) => editor.getShape(id)?.parentId === frameId),
      arrowParent: editor.getShape(arrowId)?.parentId,
    }
  }, {
    frameId: requirementFrame,
    childIds: [ids.requirementText, ids.requirementNote, ids.requirementShape],
    arrowId: requirementArrow,
  })).toEqual({ childrenParented: true, arrowParent: requirementFrame })
  await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.updateShape({ id: frameId, type: 'frame', props: { name: '需求梳理' } })
  }, requirementFrame)

  const moveBefore = await page.evaluate(({ frameId, childId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const frame = editor.getShape(frameId)
    const child = editor.getShape(childId)
    const childBounds = editor.getShapePageBounds(childId)
    editor.updateShape({ id: frame.id, type: frame.type, x: frame.x + 80, y: frame.y + 50 })
    return {
      frameX: frame.x,
      frameY: frame.y,
      childLocalX: child.x,
      childLocalY: child.y,
      childPageX: childBounds.x,
      childPageY: childBounds.y,
    }
  }, { frameId: requirementFrame, childId: ids.requirementText })
  const moveAfter = await page.evaluate(({ frameId, childId, previous }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const frame = editor.getShape(frameId)
    const child = editor.getShape(childId)
    const childBounds = editor.getShapePageBounds(childId)
    return {
      frameDelta: { x: Math.round(frame.x), y: Math.round(frame.y) },
      childLocal: { x: child.x, y: child.y },
      childPageDelta: {
        x: Math.round(childBounds.x - previous.childPageX),
        y: Math.round(childBounds.y - previous.childPageY),
      },
    }
  }, { frameId: requirementFrame, childId: ids.requirementText, previous: moveBefore })
  expect(moveAfter.frameDelta).toEqual({ x: Math.round(moveBefore.frameX + 80), y: Math.round(moveBefore.frameY + 50) })
  expect(moveAfter.childLocal).toEqual({ x: moveBefore.childLocalX, y: moveBefore.childLocalY })
  expect(moveAfter.childPageDelta).toEqual({ x: 80, y: 50 })

  const resizeState = await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const frame = editor.getShape(frameId)
    const childIds = editor.getSortedChildIdsForParent(frameId)
    const before = childIds.map((id: string) => ({ id, shape: editor.getShape(id) }))
    editor.updateShape({ id: frameId, type: 'frame', props: { w: frame.props.w + 100, h: frame.props.h + 80 } })
    return {
      before: before.map(({ id, shape }: any) => ({ id, x: shape.x, y: shape.y })),
      after: childIds.map((id: string) => {
        const shape = editor.getShape(id)
        return { id, x: shape.x, y: shape.y }
      }),
    }
  }, requirementFrame)
  expect(resizeState.after).toEqual(resizeState.before)
  await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const frame = editor.getShape(frameId)
    editor.updateShape({ id: frameId, type: 'frame', x: frame.x - 220 })
  }, requirementFrame)

  const imagesBeforeWorkflowMedia = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string }) => shape.type === 'image')
      .map((shape: { id: string }) => shape.id)
  })
  await dropSvgOnCanvas(page, 'Workflow media.svg', 980, 470)
  const workflowMedia = await expect.poll(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .filter((shape: { type: string; id: string }) => shape.type === 'image' && !before.includes(shape.id))
      .map((shape: { id: string }) => shape.id)
  }, imagesBeforeWorkflowMedia)).toHaveLength(1).then(() => page.evaluate((before) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getCurrentPageShapes()
      .find((shape: { type: string; id: string }) => shape.type === 'image' && !before.includes(shape.id)).id
  }, imagesBeforeWorkflowMedia))
  const workflowArrow = await createElbowConnection(
    page,
    ids.workflowStart,
    ids.workflowFinish,
    '从右边连接',
  )
  await expect.poll(() => page.evaluate((arrowId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      exists: Boolean(editor.getShape(arrowId)),
      bindingCount: editor.getBindingsFromShape(arrowId, 'arrow').length,
    }
  }, workflowArrow)).toEqual({ exists: true, bindingCount: 2 })

  await page.evaluate(({ firstId, secondId, arrowId, mediaId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(firstId, secondId, arrowId, mediaId)
  }, {
    firstId: ids.workflowStart,
    secondId: ids.workflowFinish,
    arrowId: workflowArrow,
    mediaId: workflowMedia,
  })
  const workflowStartPoint = await page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.pageToScreen(editor.getShapePageBounds(shapeId).center)
  }, ids.workflowStart)
  await page.mouse.click(workflowStartPoint.x, workflowStartPoint.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /编辑|Edit/ }).click()
  await page.getByRole('menuitem', { name: /为所选内容创建分区|Frame selection/ }).click()
  const workflowFrame = await expect.poll(() => page.evaluate(({ firstId, secondId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const firstParent = editor.getShape(firstId)?.parentId
    return firstParent === editor.getShape(secondId)?.parentId && editor.getShape(firstParent)?.type === 'frame'
      ? firstParent
      : null
  }, { firstId: ids.workflowStart, secondId: ids.workflowFinish })).not.toBeNull().then(() => page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getShape(shapeId)?.parentId
  }, ids.workflowStart))

  await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.updateShape({ id: frameId, type: 'frame', props: { name: '交付流程' } })
  }, workflowFrame)
  await expect.poll(() => page.evaluate(({ frameId, childIds, arrowId, endpointIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      childrenParented: childIds.every((id) => editor.getShape(id)?.parentId === frameId),
      arrowParent: editor.getShape(arrowId)?.parentId,
      bindingTargets: editor.getBindingsFromShape(arrowId, 'arrow').map((binding: any) => binding.toId).sort(),
      expectedTargets: [...endpointIds].sort(),
    }
  }, {
    frameId: workflowFrame,
    childIds: [ids.workflowStart, ids.workflowFinish, workflowArrow, workflowMedia],
    arrowId: workflowArrow,
    endpointIds: [ids.workflowStart, ids.workflowFinish],
  })).toEqual({
    childrenParented: true,
    arrowParent: workflowFrame,
    bindingTargets: [ids.workflowFinish, ids.workflowStart].sort(),
    expectedTargets: [ids.workflowFinish, ids.workflowStart].sort(),
  })

  const finishMoveOutside = await page.evaluate(({ shapeId, frameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.setCurrentTool('select')
    editor.select(shapeId)
    const shapeCenter = editor.pageToScreen(editor.getShapePageBounds(shapeId).center)
    const frameBounds = editor.getShapePageBounds(frameId)
    const target = editor.pageToScreen({ x: frameBounds.maxX + 100, y: frameBounds.maxY + 100 })
    return { shapeCenter, target }
  }, { shapeId: ids.workflowFinish, frameId: workflowFrame })
  await page.mouse.move(finishMoveOutside.shapeCenter.x, finishMoveOutside.shapeCenter.y)
  await page.mouse.down()
  await page.mouse.move(finishMoveOutside.target.x, finishMoveOutside.target.y, { steps: 12 })
  await page.waitForTimeout(350)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(({ shapeId, arrowId, endpointIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      endpointOnPage: String(editor.getShape(shapeId)?.parentId).startsWith('page:'),
      arrowOnPage: String(editor.getShape(arrowId)?.parentId).startsWith('page:'),
      bindingTargets: editor.getBindingsFromShape(arrowId, 'arrow').map((binding: any) => binding.toId).sort(),
      expectedTargets: [...endpointIds].sort(),
    }
  }, {
    shapeId: ids.workflowFinish,
    arrowId: workflowArrow,
    endpointIds: [ids.workflowStart, ids.workflowFinish],
  })).toEqual({
    endpointOnPage: true,
    arrowOnPage: true,
    bindingTargets: [ids.workflowFinish, ids.workflowStart].sort(),
    expectedTargets: [ids.workflowFinish, ids.workflowStart].sort(),
  })

  const finishMoveInside = await page.evaluate(({ shapeId, frameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.setCurrentTool('select')
    editor.select(shapeId)
    const shapeCenter = editor.pageToScreen(editor.getShapePageBounds(shapeId).center)
    const frameBounds = editor.getShapePageBounds(frameId)
    const target = editor.pageToScreen({ x: frameBounds.maxX - 100, y: frameBounds.y + 120 })
    return { shapeCenter, target }
  }, { shapeId: ids.workflowFinish, frameId: workflowFrame })
  await page.mouse.move(finishMoveInside.shapeCenter.x, finishMoveInside.shapeCenter.y)
  await page.mouse.down()
  await page.mouse.move(finishMoveInside.target.x, finishMoveInside.target.y, { steps: 12 })
  await page.waitForTimeout(350)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(({ shapeId, arrowId, frameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      endpointParent: editor.getShape(shapeId)?.parentId,
      arrowParent: editor.getShape(arrowId)?.parentId,
      bindingCount: editor.getBindingsFromShape(arrowId, 'arrow').length,
    }
  }, { shapeId: ids.workflowFinish, arrowId: workflowArrow, frameId: workflowFrame })).toEqual({
    endpointParent: workflowFrame,
    arrowParent: workflowFrame,
    bindingCount: 2,
  })

  const externalStart = await page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const bounds = editor.getShapePageBounds(shapeId)
    return editor.pageToScreen(bounds.center)
  }, ids.external)
  const workflowTarget = await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.pageToScreen(editor.getShapePageBounds(frameId).center)
  }, workflowFrame)
  await page.mouse.move(externalStart.x, externalStart.y)
  await page.mouse.down()
  await page.mouse.move(workflowTarget.x, workflowTarget.y, { steps: 12 })
  await page.waitForTimeout(350)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(({ shapeId, frameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getShape(shapeId)?.parentId === frameId
  }, { shapeId: ids.external, frameId: workflowFrame })).toBe(true)

  const partiallyOutside = await page.evaluate(({ shapeId, frameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const frameBounds = editor.getShapePageBounds(frameId)
    const shape = editor.getShape(shapeId)
    editor.updateShape({ id: shapeId, type: shape.type, x: frameBounds.w - shape.props.w / 2, y: shape.y })
    return editor.getShape(shapeId)?.parentId
  }, { shapeId: ids.external, frameId: workflowFrame })
  expect(partiallyOutside).toBe(workflowFrame)

  await page.evaluate(({ shapeId, frameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const shape = editor.getShape(shapeId)
    editor.reparentShapes([shapeId], editor.getCurrentPageId())
    editor.updateShape({ id: shapeId, type: shape.type, x: 1150, y: 650 })
  }, { shapeId: ids.external, frameId: workflowFrame })
  await expect.poll(() => page.evaluate((shapeId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return String(editor.getShape(shapeId)?.parentId).startsWith('page:')
  }, ids.external)).toBe(true)

  const outerFrame = await page.evaluate((innerFrameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const innerBounds = editor.getShapePageBounds(innerFrameId)
    const outerId = `shape:outer-frame-${crypto.randomUUID()}`
    editor.createShape({
      id: outerId,
      type: 'frame',
      x: innerBounds.x - 40,
      y: innerBounds.y - 40,
      props: { w: innerBounds.w + 80, h: innerBounds.h + 80, name: '交付流程外层' },
    })
    editor.reparentShapes([innerFrameId], outerId)
    return outerId
  }, workflowFrame)
  expect(await page.evaluate(({ innerId, outerId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor.getShape(innerId)?.parentId === outerId
  }, { innerId: workflowFrame, outerId: outerFrame })).toBe(true)
  expect(await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return String(editor.getShape(frameId)?.parentId)
  }, requirementFrame)).toMatch(/^page:/)

  await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(frameId)
  }, outerFrame)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(({ outerId, innerId, childIds, unrelatedFrameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      targetTreeDeleted: [outerId, innerId, ...childIds].every((id) => !editor.getShape(id)),
      unrelatedFramePreserved: Boolean(editor.getShape(unrelatedFrameId)),
    }
  }, {
    outerId: outerFrame,
    innerId: workflowFrame,
    childIds: [ids.workflowStart, ids.workflowFinish, workflowArrow, workflowMedia],
    unrelatedFrameId: requirementFrame,
  })).toEqual({ targetTreeDeleted: true, unrelatedFramePreserved: true })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(({ outerId, innerId, childIds, unrelatedFrameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      targetTreeRestored: [outerId, innerId, ...childIds].every((id) => Boolean(editor.getShape(id)))
        && editor.getShape(innerId)?.parentId === outerId,
      unrelatedFramePreserved: Boolean(editor.getShape(unrelatedFrameId)),
    }
  }, {
    outerId: outerFrame,
    innerId: workflowFrame,
    childIds: [ids.workflowStart, ids.workflowFinish, workflowArrow, workflowMedia],
    unrelatedFrameId: requirementFrame,
  })).toEqual({ targetTreeRestored: true, unrelatedFramePreserved: true })
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => page.evaluate(({ frameId, unrelatedFrameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      targetTreeDeleted: !editor.getShape(frameId),
      unrelatedFramePreserved: Boolean(editor.getShape(unrelatedFrameId)),
    }
  }, { frameId: outerFrame, unrelatedFrameId: requirementFrame })).toEqual({
    targetTreeDeleted: true,
    unrelatedFramePreserved: true,
  })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(({ frameId, unrelatedFrameId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      targetTreeRestored: Boolean(editor.getShape(frameId)),
      unrelatedFramePreserved: Boolean(editor.getShape(unrelatedFrameId)),
    }
  }, { frameId: outerFrame, unrelatedFrameId: requirementFrame })).toEqual({
    targetTreeRestored: true,
    unrelatedFramePreserved: true,
  })

  const requirementFramePoint = await page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.select(frameId)
    const bounds = editor.getShapePageBounds(frameId)
    return editor.pageToScreen({ x: bounds.center.x, y: bounds.y + 2 })
  }, requirementFrame)
  await page.mouse.click(requirementFramePoint.x, requirementFramePoint.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /编辑|Edit/ }).click()
  await page.getByRole('menuitem', { name: /移除框架|Remove frame/ }).click()
  await expect.poll(() => page.evaluate(({ frameId, childIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return {
      frameExists: Boolean(editor.getShape(frameId)),
      childrenExist: childIds.every((id) => Boolean(editor.getShape(id))),
      childrenOnPage: childIds.every((id) => String(editor.getShape(id)?.parentId).startsWith('page:')),
    }
  }, {
    frameId: requirementFrame,
    childIds: [ids.requirementText, ids.requirementNote, ids.requirementShape, requirementArrow],
  })).toEqual({ frameExists: false, childrenExist: true, childrenOnPage: true })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(({ frameId, childIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor.getShape(frameId)) && childIds.every((id) => editor.getShape(id)?.parentId === frameId)
  }, {
    frameId: requirementFrame,
    childIds: [ids.requirementText, ids.requirementNote, ids.requirementShape, requirementArrow],
  })).toBe(true)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => page.evaluate((frameId) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return !editor.getShape(frameId)
  }, requirementFrame)).toBe(true)
  await page.keyboard.press('Control+z')

  await waitForClean(page)
  await waitForPersistedState(request, project.rootBoardId, (records) =>
    Boolean(records[requirementFrame])
      && [ids.requirementText, ids.requirementNote, ids.requirementShape]
        .every((id) => records[id]?.parentId === requirementFrame)
      && records[workflowFrame]?.parentId === outerFrame
      && [ids.workflowStart, ids.workflowFinish, workflowArrow, workflowMedia]
        .every((id) => records[id]?.parentId === workflowFrame)
      && Object.values(records).filter((record) =>
        record.typeName === 'binding' && record.type === 'arrow' && record.fromId === requirementArrow).length === 2
      && Object.values(records).filter((record) =>
        record.typeName === 'binding' && record.type === 'arrow' && record.fromId === workflowArrow).length === 2,
  )
  await page.reload()
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => page.evaluate(({
    requirementFrameId,
    workflowFrameId,
    outerFrameId,
    requirementChildIds,
    workflowChildIds,
    arrowIds,
  }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor?.getShape(requirementFrameId))
      && requirementChildIds.every((id) => editor.getShape(id)?.parentId === requirementFrameId)
      && editor.getShape(workflowFrameId)?.parentId === outerFrameId
      && workflowChildIds.every((id) => editor.getShape(id)?.parentId === workflowFrameId)
      && arrowIds.every((arrowId) => editor.getBindingsFromShape(arrowId, 'arrow').length === 2)
  }, {
    requirementFrameId: requirementFrame,
    workflowFrameId: workflowFrame,
    outerFrameId: outerFrame,
    requirementChildIds: [ids.requirementText, ids.requirementNote, ids.requirementShape, requirementArrow],
    workflowChildIds: [ids.workflowStart, ids.workflowFinish, workflowArrow, workflowMedia],
    arrowIds: [requirementArrow, workflowArrow],
  })).toBe(true)

  const frameEvidence = await page.evaluate(({ frameIds, arrowIds }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const serializeFrame = (frameId: string) => ({
      id: frameId,
      name: editor.getShape(frameId)?.props.name,
      parentId: editor.getShape(frameId)?.parentId,
      children: editor.getSortedChildIdsForParent(frameId).map((childId: string) => ({
        id: childId,
        type: editor.getShape(childId)?.type,
        parentId: editor.getShape(childId)?.parentId,
      })),
    })
    return {
      frames: frameIds.map(serializeFrame),
      arrows: arrowIds.map((arrowId) => ({
        id: arrowId,
        parentId: editor.getShape(arrowId)?.parentId,
        bindingTargets: editor.getBindingsFromShape(arrowId, 'arrow').map((binding: any) => binding.toId),
      })),
    }
  }, {
    frameIds: [requirementFrame, workflowFrame, outerFrame],
    arrowIds: [requirementArrow, workflowArrow],
  })
  await test.info().attach('frame-parent-tree.json', {
    body: Buffer.from(JSON.stringify(frameEvidence, null, 2)),
    contentType: 'application/json',
  })
  await test.info().attach('frame-lifecycle.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })

  const archiveResponse = await request.get(`${API_BASE}/api/projects/${project.projectId}/export.iboard`)
  expect(archiveResponse.status()).toBe(200)
  const archiveBytes = await archiveResponse.body()
  const sourceArchiveHash = createHash('sha256').update(archiveBytes).digest('hex')
  const importTarget = await createTestProject(request, 'frames-reimport')
  const inspectResponse = await request.post(`${API_BASE}/api/import/iboard/inspect`, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-iboard-file-name': 'destructive-frames.iboard',
    },
    data: archiveBytes,
  })
  expect(inspectResponse.status()).toBe(201)
  const inspection = await inspectResponse.json() as { sessionId: string }
  const commitResponse = await request.post(`${API_BASE}/api/import/iboard/commit`, {
    data: {
      sessionId: inspection.sessionId,
      targetProjectId: importTarget.projectId,
      mode: 'merge',
      openImportedRootInNewTab: true,
    },
  })
  expect(commitResponse.status()).toBe(201)
  const commit = await commitResponse.json() as { importedRootBoardId: string }
  await waitForPersistedState(request, commit.importedRootBoardId, (records) => {
    const shapes = Object.values(records).filter((record) => record.typeName === 'shape')
    const frames = shapes.filter((record) => record.type === 'frame')
    const requirement = frames.find((record) => record.props?.name === '需求梳理')
    const workflow = frames.find((record) => record.props?.name === '交付流程')
    const outer = frames.find((record) => record.props?.name === '交付流程外层')
    if (!requirement || !workflow || !outer || workflow.parentId !== outer.id) return false

    const requirementChildren = shapes.filter((record) => record.parentId === requirement.id)
    const workflowChildren = shapes.filter((record) => record.parentId === workflow.id)
    const requirementTypes = new Set(requirementChildren.map((record) => record.type))
    const workflowTypes = new Set(workflowChildren.map((record) => record.type))
    const arrowIds = [...requirementChildren, ...workflowChildren]
      .filter((record) => record.type === 'arrow')
      .map((record) => record.id)
    const bindings = Object.values(records).filter((record) => record.typeName === 'binding' && record.type === 'arrow')
    return ['text', 'note', 'geo', 'arrow'].every((type) => requirementTypes.has(type))
      && ['geo', 'image', 'arrow'].every((type) => workflowTypes.has(type))
      && arrowIds.length === 2
      && arrowIds.every((arrowId) => {
        const arrowBindings = bindings.filter((binding) => binding.fromId === arrowId)
        return arrowBindings.length === 2 && arrowBindings.every((binding) => Boolean(records[binding.toId]))
      })
  })
  const importedArchiveResponse = await request.get(`${API_BASE}/api/projects/${importTarget.projectId}/export.iboard`)
  expect(importedArchiveResponse.status()).toBe(200)
  const importedArchiveBytes = await importedArchiveResponse.body()
  const importedArchiveHash = createHash('sha256').update(importedArchiveBytes).digest('hex')
  const archiveEvidence = {
    sourceProjectId: project.projectId,
    sourceArchiveBytes: archiveBytes.length,
    sourceArchiveSha256: sourceArchiveHash,
    importedProjectId: importTarget.projectId,
    importedArchiveBytes: importedArchiveBytes.length,
    importedArchiveSha256: importedArchiveHash,
  }
  console.log(`[destructive-artifact] ${JSON.stringify(archiveEvidence)}`)
  await test.info().attach('iboard-export-hashes.json', {
    body: Buffer.from(JSON.stringify(archiveEvidence, null, 2)),
    contentType: 'application/json',
  })
  expect(consoleProblems).toEqual([])
})
