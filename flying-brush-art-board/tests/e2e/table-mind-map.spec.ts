import { expect, test, type APIRequestContext } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

async function createProject(request: APIRequestContext, suffix: string) {
  const projectId = `project-table-mind-map-${suffix}`
  const sourceBoardId = `board-table-mind-map-source-${suffix}`
  const targetBoardId = `board-table-mind-map-target-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Table and mind map',
      rootBoard: { id: sourceBoardId, title: 'Source' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
    data: { id: targetBoardId, title: 'Target' },
  })).ok()).toBe(true)
  return { projectId, sourceBoardId, targetBoardId }
}

async function downloadBytes(download: import('@playwright/test').Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('creates, edits, syncs, exports, copies, and reloads table and mind-map shapes', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID()
  const { projectId, sourceBoardId, targetBoardId } = await createProject(request, suffix)
  const observer = await context.newPage()
  try {
    await Promise.all([
      page.goto(`/projects/${projectId}/boards/${sourceBoardId}`),
      observer.goto(`/projects/${projectId}/boards/${sourceBoardId}`),
    ])
    const canvas = page.getByLabel('白板画布')
    await expect(canvas).toBeVisible()
    await expect(observer.getByLabel('白板画布')).toBeVisible()
    await canvas.click({ position: { x: 40, y: 40 } })

    const canvasBox = await canvas.boundingBox()
    if (!canvasBox) throw new Error('Canvas has no bounds')

    await page.keyboard.press('Shift+T')
    await page.mouse.move(canvasBox.x + 180, canvasBox.y + 180)
    await page.mouse.down()
    await page.mouse.move(canvasBox.x + 540, canvasBox.y + 360, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.canvas-table-shape')).toBeVisible()
    const firstTableCell = page.locator('.canvas-table-cell').first()
    await firstTableCell.click()
    const tableEditor = page.locator('.canvas-table-cell__editor')
    const tableTextPanel = page.getByTestId('style.panel')
    await expect(tableTextPanel).toBeVisible()
    await page.getByTestId('style.font.serif').click()
    await page.getByTestId('style.size.xl').click()
    await page.getByTestId('table-style-italic').click()
    await page.getByTestId('style.align.end').click()
    await expect(firstTableCell).toHaveCSS('font-style', 'italic')
    await expect(firstTableCell).toHaveCSS('text-align', 'right')
    await firstTableCell.dblclick()
    await tableEditor.fill('Roadmap')
    await tableEditor.press('Tab')
    await tableEditor.fill('Owner')
    await canvas.click({ position: { x: 60, y: 520 } })

    const tableShape = page.locator('.canvas-table-shape')
    await page.locator('.canvas-table-cell').first().click()
    const tableDragHandle = page.getByTestId('table-drag-handle')
    await expect(tableDragHandle).toBeVisible()
    await expect(tableDragHandle).toHaveCSS('opacity', '1')
    const [tableBeforeDrag, tableDragHandleBox] = await Promise.all([tableShape.boundingBox(), tableDragHandle.boundingBox()])
    if (!tableBeforeDrag || !tableDragHandleBox) throw new Error('Table drag controls have no bounds')
    await page.mouse.move(tableDragHandleBox.x + tableDragHandleBox.width / 2, tableDragHandleBox.y + tableDragHandleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(tableDragHandleBox.x + tableDragHandleBox.width / 2 + 32, tableDragHandleBox.y + tableDragHandleBox.height / 2 + 24, { steps: 6 })
    await page.mouse.up()
    const tableAfterDrag = await tableShape.boundingBox()
    expect((tableAfterDrag?.x ?? 0) - tableBeforeDrag.x).toBeGreaterThan(25)
    expect((tableAfterDrag?.y ?? 0) - tableBeforeDrag.y).toBeGreaterThan(18)

    await page.getByRole('button', { name: '选择第 1 行' }).click()
    const tableContextToolbar = page.locator('.canvas-table-context-toolbar')
    await expect(tableContextToolbar).toBeVisible()
    await tableContextToolbar.getByRole('button', { name: '在下方插入行' }).click()
    await expect(tableShape).toHaveAttribute('data-selection-kind', 'row')
    await expect(tableShape.locator('.canvas-table-cell[data-selected="true"]')).toHaveCount(3)
    await page.getByRole('button', { name: '选择第 3 列' }).click()
    await tableContextToolbar.getByRole('button', { name: '在右侧插入列' }).click()
    await expect(page.locator('.canvas-table-shape')).toHaveAttribute('aria-label', '4 行 4 列表格')
    await expect(tableShape).toHaveAttribute('data-selection-kind', 'column')
    await expect(tableShape.locator('.canvas-table-cell[data-selected="true"]')).toHaveCount(4)
    const moreTableActions = tableContextToolbar.getByRole('button', { name: '更多操作' })
    await expect(moreTableActions).toBeVisible()
    await moreTableActions.click()
    await expect(page.getByRole('menuitem', { name: '平均分布列宽' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      const table = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'table')
      const rowHeights = table?.props.rows.map((row: { height: number }) => row.height) ?? []
      const columnWidths = table?.props.columns.map((column: { width: number }) => column.width) ?? []
      return {
        rowDelta: Math.max(...rowHeights) - Math.min(...rowHeights),
        columnDelta: Math.max(...columnWidths) - Math.min(...columnWidths),
      }
    })).toEqual({ rowDelta: 0, columnDelta: 0 })
    await canvas.click({ position: { x: 70, y: 540 } })
    await page.locator('.canvas-table-cell').first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '复制所在行' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '复制所在列' })).toBeVisible()
    await page.getByRole('menuitem', { name: '切换单元格背景色' }).click()
    await expect(page.locator('.canvas-table-cell').first()).toHaveAttribute('data-background', 'gray')

    await page.keyboard.press('m')
    await canvas.click({ position: { x: 560, y: 430 } })
    const mindMapEditor = page.locator('.canvas-mind-map-node--editing')
    await expect(mindMapEditor).toBeVisible()
    await mindMapEditor.fill('Launch plan')
    await mindMapEditor.press('Tab')
    await mindMapEditor.fill('Milestone')
    await mindMapEditor.press('Tab')
    await mindMapEditor.fill('Deliverable')
    await mindMapEditor.press('Enter')
    await mindMapEditor.fill('QA')
    await canvas.click({ position: { x: 70, y: 540 } })

    const rootNode = page.locator('.canvas-mind-map-node[data-root="true"]')
    const rootNodeShell = rootNode.locator('..')
    const qaNode = page.getByRole('button', { name: 'QA', exact: true })
    await qaNode.click()
    const mindMapToolbar = page.getByTestId('mind-map-node-toolbar')
    const mindMapTextPanel = page.getByTestId('style.panel')
    await expect(mindMapToolbar).toBeVisible()
    await expect(mindMapTextPanel).toBeVisible()
    const [toolbarBox, textPanelBox] = await Promise.all([mindMapToolbar.boundingBox(), mindMapTextPanel.boundingBox()])
    if (!toolbarBox || !textPanelBox) throw new Error('Mind-map style controls have no bounds')
    expect(
      toolbarBox.x < textPanelBox.x + textPanelBox.width
      && toolbarBox.x + toolbarBox.width > textPanelBox.x
      && toolbarBox.y < textPanelBox.y + textPanelBox.height
      && toolbarBox.y + toolbarBox.height > textPanelBox.y,
    ).toBe(false)
    await page.getByTestId('mind-map-style-shape').click()
    await page.getByRole('button', { name: '胶囊' }).click()
    await expect(qaNode).toHaveAttribute('data-shape', 'pill')
    await expect(page.getByTestId('menu-click-capture.content')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      return editor?.getCurrentPageShapes().some((shape: { type: string; props: { geo?: string } }) => (
        shape.type === 'geo' && shape.props.geo === 'pill'
      )) ?? false
    })).toBe(false)
    await page.getByTestId('mind-map-style-fill').click()
    await page.getByRole('radio', { name: '节点填充：purple' }).click()
    await page.getByTestId('mind-map-style-edge').click()
    await page.getByRole('button', { name: '虚线' }).click()
    await page.getByTestId('mind-map-style-edge').click()
    await page.getByRole('button', { name: '3 级粗细' }).click()
    await expect(page.getByTestId('style.panel')).toBeVisible()
    await page.getByTestId('style.font.serif').click()
    await page.getByTestId('style.size.xl').click()
    await page.getByRole('button', { name: '斜体' }).click()
    await page.getByTestId('style.align.end').click()
    await expect(qaNode).toHaveCSS('font-style', 'italic')
    await expect(qaNode).toHaveCSS('font-synthesis', 'weight style')
    await expect(qaNode.locator('.canvas-mind-map-node__label')).toHaveCSS('text-align', 'right')
    await expect.poll(() => page.evaluate(() => document.fonts.check('italic 700 24px "tldraw_serif"'))).toBe(true)

    await qaNode.focus()
    await qaNode.press('Enter')
    const activeMindMapEditor = page.locator('.canvas-mind-map-node--editing')
    await activeMindMapEditor.fill('Quality gate')
    await page.getByTestId('style.color.red').click()
    await expect(activeMindMapEditor).toBeFocused()
    await page.getByTestId('mind-map-style-fill').click()
    await page.getByRole('radio', { name: '节点填充：coral' }).click()
    await expect(activeMindMapEditor).toBeVisible()
    await activeMindMapEditor.press('Escape')

    const qualityNode = page.getByRole('button', { name: 'Quality gate', exact: true })
    const rootBeforeDrag = await rootNode.boundingBox()
    const qualityBox = await qualityNode.boundingBox()
    const rootBox = await rootNode.boundingBox()
    if (!qualityBox || !rootBox || !rootBeforeDrag) throw new Error('Mind-map nodes have no bounds')
    await page.mouse.move(qualityBox.x + qualityBox.width / 2, qualityBox.y + qualityBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y - 10, { steps: 8 })
    await expect(rootNodeShell).toHaveAttribute('data-drop-mode', 'child')
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      const mindMap = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'mind-map')
      const root = mindMap?.props.nodes.find((node: { parentId: string | null }) => node.parentId === null)
      return mindMap?.props.nodes.find((node: { text: string }) => node.text === 'Quality gate')?.parentId === root?.id
    })).toBe(true)
    const rootAfterDrag = await rootNode.boundingBox()
    expect(Math.abs((rootAfterDrag?.x ?? 0) - rootBeforeDrag.x)).toBeLessThan(3)
    expect(Math.abs((rootAfterDrag?.y ?? 0) - rootBeforeDrag.y)).toBeLessThan(3)

    await rootNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '切换为双向布局' }).click()
    const bilateralRootBox = await rootNode.boundingBox()
    const qualityAfterReparent = await qualityNode.boundingBox()
    if (!bilateralRootBox || !qualityAfterReparent) throw new Error('Mind-map nodes have no bilateral bounds')
    await page.mouse.move(qualityAfterReparent.x + qualityAfterReparent.width / 2, qualityAfterReparent.y + qualityAfterReparent.height / 2)
    await page.mouse.down()
    await page.mouse.move(bilateralRootBox.x + 2, bilateralRootBox.y + bilateralRootBox.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      const mindMap = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'mind-map')
      const node = mindMap?.props.nodes.find((candidate: { text: string }) => candidate.text === 'Quality gate')
      return [mindMap?.props.layout, node?.side]
    })).toEqual(['bilateral', 'left'])

    await rootNode.click()
    await rootNodeShell.getByRole('button', { name: '折叠分支' }).click()
    await expect(rootNodeShell.getByRole('button', { name: '展开分支' })).toHaveText('3')
    await expect(page.locator('.canvas-mind-map-node')).toHaveCount(1)
    await rootNodeShell.getByRole('button', { name: '展开分支' }).click()
    await rootNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '切换导图主题' }).click()
    await expect(page.locator('.canvas-mind-map-shape')).toHaveAttribute('data-theme', 'colorful')
    await page.evaluate(() => { (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.undo() })
    await expect(page.locator('.canvas-mind-map-shape')).toHaveAttribute('data-theme', 'classic')
    await page.evaluate(() => { (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.redo() })
    await expect(page.locator('.canvas-mind-map-shape')).toHaveAttribute('data-theme', 'colorful')

    const shapeIds = await page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      const table = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'table')
      const mindMap = editor?.getCurrentPageShapes().find((shape: { type: string }) => shape.type === 'mind-map')
      if (!table || !mindMap) throw new Error('Expected both custom shapes')
      return { tableId: table.id as string, mindMapId: mindMap.id as string }
    })

    await expect.poll(() => observer.evaluate(({ tableId, mindMapId }) => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      const table = editor?.getShape(tableId)
      const mindMap = editor?.getShape(mindMapId)
      return {
        table: table?.props.rows?.[0]?.cells?.slice(0, 2).map((cell: { text: string }) => cell.text),
        tableSize: [table?.props.rows?.length, table?.props.columns?.length],
        tableBackground: table?.props.rows?.[0]?.cells?.[0]?.background,
        mindMap: mindMap?.props.nodes?.map((node: { text: string }) => node.text),
        mindMapTheme: mindMap?.props.theme,
        mindMapStyle: mindMap?.props.nodes?.find((node: { text: string }) => node.text === 'Quality gate')?.style,
      }
    }, shapeIds), { timeout: 10_000 }).toEqual({
      table: ['Roadmap', 'Owner'],
      tableSize: [4, 4],
      tableBackground: 'gray',
      mindMap: ['Launch plan', 'Milestone', 'Deliverable', 'Quality gate'],
      mindMapTheme: 'colorful',
      mindMapStyle: expect.objectContaining({
        fillColor: 'coral', textColor: 'red', fontSize: 'xl', fontFamily: 'serif', textAlign: 'right', italic: true,
        edgeDash: 'dashed', edgeWidth: 3,
      }),
    })

    // The current single-record model must converge under concurrent edits.
    // It may retain one or both writes; the TODO records the overwrite risk.
    await Promise.all([
      page.evaluate(({ tableId }) => {
        const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
        const table = editor.getShape(tableId)
        const rows = table.props.rows.map((row: any, rowIndex: number) => ({
          ...row,
          cells: row.cells.map((cell: any, columnIndex: number) => rowIndex === 2 && columnIndex === 0 ? { ...cell, text: 'Editor A' } : cell),
        }))
        editor.updateShape({ id: table.id, type: table.type, props: { ...table.props, rows } })
      }, shapeIds),
      observer.evaluate(({ tableId }) => {
        const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
        const table = editor.getShape(tableId)
        const rows = table.props.rows.map((row: any, rowIndex: number) => ({
          ...row,
          cells: row.cells.map((cell: any, columnIndex: number) => rowIndex === 2 && columnIndex === 1 ? { ...cell, text: 'Editor B' } : cell),
        }))
        editor.updateShape({ id: table.id, type: table.type, props: { ...table.props, rows } })
      }, shapeIds),
    ])
    await expect.poll(async () => {
      const values = await Promise.all([page, observer].map((client) => client.evaluate(({ tableId }) => {
        const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
        return editor.getShape(tableId)?.props.rows?.[2]?.cells?.slice(0, 2).map((cell: { text: string }) => cell.text)
      }, shapeIds)))
      return JSON.stringify(values[0]) === JSON.stringify(values[1]) ? values[0] : null
    }, { timeout: 10_000 }).not.toBeNull()

    const originalCamera = await page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      const camera = editor.getCamera()
      return { x: camera.x, y: camera.y, z: camera.z }
    })
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByRole('button', { name: '表格' })).toBeVisible()
    await expect(page.getByRole('button', { name: '思维导图' })).toBeVisible()
    for (const zoom of [0.5, 1, 2]) {
      await page.evaluate(({ camera, zoomLevel }) => {
        const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
        editor.setCamera({ ...camera, z: zoomLevel })
      }, { camera: originalCamera, zoomLevel: zoom })
      await expect(page.locator('.canvas-table-shape')).toBeVisible()
      await test.info().attach(`table-mind-map-${zoom * 100}-percent.png`, {
        body: await page.screenshot(), contentType: 'image/png',
      })
    }
    await page.evaluate((camera) => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      editor.setCamera(camera)
    }, originalCamera)
    await page.setViewportSize({ width: 1280, height: 720 })

    await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'clean', { timeout: 10_000 })
    await expect.poll(async () => {
      const response = await request.get(`${API_BASE}/api/boards/${sourceBoardId}`)
      const board = await response.json() as { tldrawSnapshot: { store: Record<string, { type?: string }> } }
      return [shapeIds.tableId, shapeIds.mindMapId].map((id) => board.tldrawSnapshot.store[id]?.type)
    }, { timeout: 10_000 }).toEqual(['table', 'mind-map'])

    const svgDownloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('menuitem', { name: '导出 SVG', exact: true }).click()
    const svg = (await downloadBytes(await svgDownloadPromise)).toString('utf8')
    expect(svg).toContain('Roadmap')
    expect(svg).toContain('Launch plan')

    const pngDownloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('menuitem', { name: '导出 PNG', exact: true }).click()
    expect((await downloadBytes(await pngDownloadPromise)).byteLength).toBeGreaterThan(500)

    const pdfResponse = await request.post(`${API_BASE}/api/boards/${sourceBoardId}/export.pdf`)
    expect(pdfResponse.ok()).toBe(true)
    expect((await pdfResponse.body()).byteLength).toBeGreaterThan(500)

    await page.evaluate(({ tableId, mindMapId }) => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      editor.setEditingShape(null)
      editor.setSelectedShapes([tableId, mindMapId])
      ;(document.activeElement as HTMLElement | null)?.blur()
    }, shapeIds)
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '全部画板', exact: true }).click()
    await page.getByRole('listitem', { name: 'Target' })
      .getByRole('button', { name: 'Target 更多操作' }).click()
    await page.getByRole('menuitem', { name: '在新标签打开' }).click()
    await expect(page.getByRole('tab', { name: /Target/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('白板画布')).toBeVisible()
    await page.getByLabel('白板画布').click({ position: { x: 40, y: 40 } })
    const pasteResponse = page.waitForResponse((response) =>
      response.url().includes('/clipboard/paste') && response.status() === 201,
    )
    await page.keyboard.press('Control+v')
    const pasteResult = await pasteResponse
    expect(pasteResult.status()).toBe(201)

    await expect.poll(() => page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      return editor?.getCurrentPageShapes().map((shape: { type: string }) => shape.type).sort() ?? []
    })).toEqual(['mind-map', 'table'])
    await page.reload()
    await expect(page.getByLabel('白板画布')).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const editor = (window as unknown as { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
      return editor?.getCurrentPageShapes().map((shape: { type: string }) => shape.type).sort() ?? []
    })).toEqual(['mind-map', 'table'])
  } finally {
    await observer.close()
  }
})
