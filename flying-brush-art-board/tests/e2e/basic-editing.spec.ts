import { expect, test, type APIRequestContext } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

async function createProject(request: APIRequestContext, suffix: string) {
  const projectId = `project-basic-${suffix}`
  const rootBoardId = `board-root-${suffix}`
  const response = await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Task 9 Project',
      rootBoard: { id: rootBoardId, title: 'Overview' },
    },
  })
  expect(response.ok()).toBe(true)
  return { projectId, rootBoardId }
}

test('creates a board, edits the tldraw surface, refreshes, and restores it', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId } = await createProject(request, suffix)
  await page.goto(`/projects/${projectId}`)

  await expect(page.getByRole('heading', { name: 'Task 9 Project' })).toBeVisible()
  await page.locator('.project-home__actions').getByRole('button', { name: '新建画板' }).click()
  await page.getByRole('textbox', { name: '画板名称' }).fill('Launch Plan')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByText('全部画板 2')).toBeVisible()

  const row = page.getByRole('listitem', { name: 'Launch Plan' })
  await row.locator('.board-list__open').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/boards/board-`))
  await expect(page.getByLabel('白板画布')).toBeVisible()
  // Board tabs acquire their write lease from the first real edit intent.
  await page.getByLabel('白板画布').click({ position: { x: 420, y: 320 } })

  const shapeId = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const id = `shape:e2e-${crypto.randomUUID()}`
    editor.createShapes([{ id, type: 'geo', x: 120, y: 160 }])
    return id
  })
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', { timeout: 5_000 })
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/api/boards/${encodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!)}`)
    const board = await response.json() as { tldrawSnapshot: { store?: Record<string, unknown> } }
    return Boolean(board.tldrawSnapshot.store?.[shapeId])
  }, { timeout: 10_000 }).toBe(true)

  await page.reload()
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => page.evaluate((id) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return Boolean(editor?.getShape(id))
  }, shapeId)).toBe(true)
})

test('creates an auto-routed elbow connector between shape midpoint anchors', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, rootBoardId } = await createProject(request, suffix)
  await page.goto(`/projects/${projectId}/boards/${rootBoardId}`)
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await page.getByLabel('白板画布').click({ position: { x: 420, y: 320 } })

  const connection = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const sourceId = `shape:source-${crypto.randomUUID()}`
    const targetId = `shape:target-${crypto.randomUUID()}`
    editor.createShapes([
      { id: sourceId, type: 'geo', x: 160, y: 180, props: { geo: 'rectangle', w: 140, h: 90 } },
      { id: targetId, type: 'geo', x: 520, y: 190, props: { geo: 'rectangle', w: 150, h: 100 } },
    ])
    editor.select(sourceId)
    const targetBounds = editor.getShapePageBounds(targetId)
    return {
      sourceId,
      targetId,
      targetPoint: editor.pageToScreen(targetBounds.center),
    }
  })

  const rightHandle = page.getByRole('button', { name: '从右边连接' })
  await expect(rightHandle).toBeVisible()
  await expect(page.getByRole('button', { name: /从.+边连接/ })).toHaveCount(4)
  const sourceBox = await rightHandle.boundingBox()
  if (!sourceBox) throw new Error('Connection handle has no bounds')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(connection.targetPoint.x, connection.targetPoint.y, { steps: 12 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate(({ sourceId, targetId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const arrow = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'arrow')
    if (!arrow) return false
    const bindings = editor.getBindingsFromShape(arrow.id, 'arrow')
    const start = bindings.find((binding: { props: { terminal: string } }) => binding.props.terminal === 'start')
    const end = bindings.find((binding: { props: { terminal: string } }) => binding.props.terminal === 'end')
    return arrow.props.kind === 'elbow'
      && start?.toId === sourceId
      && start.props.snap === 'edge-point'
      && start.props.normalizedAnchor.x === 1
      && start.props.normalizedAnchor.y === 0.5
      && end?.toId === targetId
      && end.props.snap === 'center'
      && end.props.isPrecise === false
      && end.props.normalizedAnchor.x === 0.5
      && end.props.normalizedAnchor.y === 0.5
  }, connection)).toBe(true)

  const routeBeforeMove = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const arrow = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'arrow')
    if (!arrow) throw new Error('Expected an elbow connector')
    return { arrowId: arrow.id, maxY: editor.getShapePageBounds(arrow).maxY }
  })

  await page.evaluate(({ targetId }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    editor.updateShape({ id: targetId, type: 'geo', x: 520, y: 420 })
  }, connection)

  await expect.poll(() => page.evaluate(({ arrowId, targetId, previousMaxY }) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    const arrow = editor?.getShape(arrowId)
    if (!arrow) return false
    const remainsBound = editor.getBindingsFromShape(arrowId, 'arrow')
      .some((binding: { toId: string }) => binding.toId === targetId)
    return remainsBound && editor.getShapePageBounds(arrow).maxY > previousMaxY + 100
  }, {
    arrowId: routeBeforeMove.arrowId,
    targetId: connection.targetId,
    previousMaxY: routeBeforeMove.maxY,
  })).toBe(true)
})

test('shows and drags a midpoint handle for every elbow-arrow segment', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const { projectId, rootBoardId } = await createProject(request, suffix)
  await page.goto(`/projects/${projectId}/boards/${rootBoardId}`)
  await expect(page.locator('.canvas-editor')).toBeVisible()
  await page.locator('.canvas-editor').click({ position: { x: 420, y: 320 } })

  const result = await page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Editor was not mounted')
    const results: Array<{ before: number; after: number; orthogonal: boolean; hasManualRoute: boolean }> = []
    const ids: string[] = []
    for (let scenario = 0; scenario < 3; scenario += 1) {
      const id = `shape:manual-elbow-${scenario}-${crypto.randomUUID()}`
      ids.push(id)
      editor.createShape({
        id,
        type: 'arrow',
        x: 120,
        y: 100 + scenario * 190,
        props: {
          kind: 'elbow',
          start: { x: 0, y: 0 },
          end: { x: 340, y: 120 },
          dash: 'solid',
        },
      })
      editor.select(id)
      const shape = editor.getShape(id)
      const util = editor.getShapeUtil(shape)
      const beforeHandles = editor.getShapeHandles(shape)
        .filter((handle: { id: string }) => handle.id.startsWith('manual-elbow-segment:'))
      if (beforeHandles.length < 3) throw new Error(`Expected at least three segment handles, received ${beforeHandles.length}`)
      const selectedIndex = scenario === 0 ? 0 : scenario === 1 ? Math.floor(beforeHandles.length / 2) : beforeHandles.length - 1
      const selected = beforeHandles[selectedIndex]
      const dragged = { ...selected, x: selected.x + 55, y: selected.y + 55 }
      const dragInfo = { handle: dragged, isPrecise: false, initial: selected }
      const update = util.onHandleDrag(shape, dragInfo)
      if (!update) throw new Error('Segment drag did not produce an update')
      editor.updateShape(update)
      const current = editor.getShape(id)
      const endUpdate = util.onHandleDragEnd?.(current, dragInfo)
      if (endUpdate) editor.updateShape(endUpdate)
      const finalShape = editor.getShape(id)
      const route = finalShape.meta.manualElbowRoute
      const segments = route?.segments ?? []
      const orthogonal = segments.every((segment: { orientation: string }, index: number) => (
        (segment.orientation === 'horizontal' || segment.orientation === 'vertical')
        && (index === 0 || segments[index - 1].orientation !== segment.orientation)
      ))
      const afterHandles = editor.getShapeHandles(finalShape)
        .filter((handle: { id: string }) => handle.id.startsWith('manual-elbow-segment:'))
      results.push({
        before: beforeHandles.length,
        after: afterHandles.length,
        orthogonal,
        hasManualRoute: route?.version === 1,
      })
    }
    return { results, ids }
  })

  expect(result.results).toHaveLength(3)
  for (const scenario of result.results) {
    expect(scenario.before).toBeGreaterThanOrEqual(3)
    expect(scenario.after).toBeGreaterThanOrEqual(3)
    expect(scenario.orthogonal).toBe(true)
    expect(scenario.hasManualRoute).toBe(true)
  }
  const exportedSvg = await page.evaluate(async (id) => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return (await editor.getSvgString([id], { background: false }))?.svg ?? ''
  }, result.ids[1])
  expect(exportedSvg).toContain('<path')
  expect(exportedSvg).not.toContain('NaN')
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', { timeout: 5_000 })
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/api/boards/${encodeURIComponent(rootBoardId)}`)
    const board = await response.json() as { tldrawSnapshot: { store?: Record<string, { meta?: { manualElbowRoute?: { version?: number } } }> } }
    return result.ids.filter((id) => board.tldrawSnapshot.store?.[id]?.meta?.manualElbowRoute?.version === 1).length
  }, { timeout: 10_000 }).toBe(3)
  await page.reload()
  await expect.poll(() => page.evaluate(() => {
    const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    return editor?.getCurrentPageShapes().filter((shape: any) => shape.meta?.manualElbowRoute?.version === 1).length
  })).toBe(3)
})
