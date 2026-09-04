import { expect, test, type Page } from './test.js'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'
const TRADING_PANEL_KINDS = ['market-overview', 'stock-pool', 'announcements', 'system-status'] as const

interface TradingWorkspaceResponse {
  status: 'created' | 'existing' | 'retired'
  project?: { id: string; rootBoardId: string }
  boards?: Array<{ id: string; title: string }>
}

async function waitForTemplateReferences(page: Page) {
  await expect(page.locator('.board-reference-shape')).toHaveCount(5)
}

async function readBoardReferences(page: Page) {
  return page.locator('.board-reference-shape').evaluateAll((cards) => cards.map((card) => {
    const preview = card.querySelector<HTMLElement>('.board-reference-shape__preview')
    const title = card.querySelector<HTMLElement>('.board-reference-shape__footer strong')
    return {
      title: title?.textContent?.trim() ?? '',
      previewMode: preview?.dataset.previewMode ?? null,
    }
  }))
}

async function readPanelViewportState(
  page: Page,
  panelKind: typeof TRADING_PANEL_KINDS[number],
) {
  return page.evaluate((kind) => {
    const panel = document.querySelector<HTMLElement>(`.trading-panel[data-panel-kind="${kind}"]`)
    if (!panel) return null
    const navigation = document.querySelector<HTMLElement>('.trading-panel-view-switcher')?.getBoundingClientRect()
    const stylePanel = document.querySelector<HTMLElement>('.tlui-style-panel')?.getBoundingClientRect()
    const mainToolbar = document.querySelector<HTMLElement>('.tlui-main-toolbar__inner')?.getBoundingClientRect()
    const overlapArea = (left?: DOMRect, right?: DOMRect) => {
      if (!left || !right) return 0
      return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
    }
    const rect = panel.getBoundingClientRect()
    const editor = (window as { __INFINITE_BOARD_EDITOR__?: { getZoomLevel?: () => number } }).__INFINITE_BOARD_EDITOR__
    return {
      zoom: editor?.getZoomLevel?.() ?? 0,
      fullyVisible: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      navigationOverlap: overlapArea(rect, navigation),
      stylePanelOverlap: overlapArea(rect, stylePanel),
      mainToolbarOverlap: overlapArea(rect, mainToolbar),
      hasHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    }
  }, panelKind)
}

test('bootstraps five trading boards and redacts the mindset preview', async ({ page, request }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  const response = await request.put(`${API_BASE}/api/bootstrap/personal-trading-workspace`)
  expect(response.ok()).toBe(true)
  const workspace = await response.json() as TradingWorkspaceResponse
  expect(workspace.status).not.toBe('retired')
  expect(workspace.project).toBeDefined()

  await page.goto(`/projects/${workspace.project!.id}/boards/${workspace.project!.rootBoardId}?realtime=0`)
  await waitForTemplateReferences(page)
  let references = await readBoardReferences(page)
  await expect.poll(async () => {
    references = await readBoardReferences(page)
    return references.filter((reference) => reference.title.length > 0).length
  }).toBe(5)
  expect(references).toEqual(expect.arrayContaining([
    { title: '今天怎么看', previewMode: 'content' },
    { title: '数据', previewMode: 'content' },
    { title: '逻辑', previewMode: 'content' },
    { title: '经验', previewMode: 'content' },
    { title: '心态', previewMode: 'private' },
  ]))

  const privatePreview = page.locator('.board-reference-shape__preview[data-preview-mode="private"]')
  await expect(privatePreview).toHaveCount(1)
  await expect(privatePreview).toContainText('私密画板 · 内容预览已隐藏')
  await expect(page.getByText('今天最担心什么')).toHaveCount(0)
  await expect(page.getByText('哪一刻想偏离计划')).toHaveCount(0)
  await expect(page.getByText('结果如何影响判断')).toHaveCount(0)
  expect(pageErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('trading-root-1440x900.png'), fullPage: true })
})

test('opens all five child Boards from the realtime root without a save deadlock', async ({ page, request }) => {
  const response = await request.put(`${API_BASE}/api/bootstrap/personal-trading-workspace`)
  const workspace = await response.json() as TradingWorkspaceResponse
  if (!workspace.project || !workspace.boards) throw new Error('Trading workspace was not bootstrapped')

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const rootUrl = `/projects/${workspace.project.id}/boards/${workspace.project.rootBoardId}`

  for (const title of ['今天怎么看', '数据', '逻辑', '经验', '心态']) {
    const targetBoard = workspace.boards.find((board) => board.title === title)
    if (!targetBoard) throw new Error(`Missing target board: ${title}`)
    await page.goto(rootUrl)
    await waitForTemplateReferences(page)
    const referenceCard = page.locator('.board-reference-shape').filter({ hasText: title }).first()
    await expect(referenceCard).toBeVisible()
    await referenceCard.dblclick()
    await expect(page).toHaveURL(new RegExp(`/boards/${targetBoard.id}(?:\\?|$)`))
    await expect(page.getByText('画板保存失败，请稍后重试。')).toHaveCount(0)
  }

  expect(pageErrors).toEqual([])
})

test('a disabled trading bridge fails closed instead of presenting live facts', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const response = await request.put(`${API_BASE}/api/bootstrap/personal-trading-workspace`)
  const workspace = await response.json() as TradingWorkspaceResponse
  const dataBoard = workspace.boards?.find((board) => board.title === '数据')
  if (!workspace.project || !dataBoard) throw new Error('Trading workspace data board was not bootstrapped')

  await page.goto(`/projects/${workspace.project.id}/boards/${dataBoard.id}?realtime=0`)
  await expect(page.locator('.trading-panel')).toHaveCount(4)
  for (const panelKind of TRADING_PANEL_KINDS) {
    await expect(page.locator(`.trading-panel[data-panel-kind="${panelKind}"]`)).toHaveAttribute('data-fact-state', 'UNAVAILABLE')
  }
  await expect(page.locator('.trading-panel:visible').first().getByText('数据不可用', { exact: true })).toBeVisible()
  await expect(page.getByText('实时推送')).toHaveCount(0)
  await expect(page.getByText('实时数据')).toHaveCount(0)

  const tradingSnapshot = await request.get(`${API_BASE}/api/trading/snapshot`)
  expect(tradingSnapshot.status()).toBe(404)

  await page.screenshot({ path: testInfo.outputPath('trading-data-1440x900.png'), fullPage: true })
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.locator('.trading-panel')).toHaveCount(4)
  await expect(page.locator('.trading-panel-view-switcher button')).toHaveCount(5)
  const stockPoolButton = page.getByRole('button', { name: '数据视图：个人选股池' })
  await stockPoolButton.click()
  await expect(stockPoolButton).toHaveAttribute('aria-pressed', 'true')
  let readableView = await readPanelViewportState(page, 'stock-pool')
  await expect.poll(async () => {
    readableView = await readPanelViewportState(page, 'stock-pool')
    return readableView?.zoom ?? 0
  }).toBeGreaterThanOrEqual(0.75)
  await expect.poll(async () => {
    readableView = await readPanelViewportState(page, 'stock-pool')
    if (!readableView) return null
    return {
      fullyVisible: readableView.fullyVisible,
      navigationOverlap: readableView.navigationOverlap,
      stylePanelOverlap: readableView.stylePanelOverlap,
      mainToolbarOverlap: readableView.mainToolbarOverlap,
      hasHorizontalOverflow: readableView.hasHorizontalOverflow,
    }
  }).toEqual({
    fullyVisible: true,
    navigationOverlap: 0,
    stylePanelOverlap: 0,
    mainToolbarOverlap: 0,
    hasHorizontalOverflow: false,
  })
  await page.screenshot({ path: testInfo.outputPath('trading-data-1024x768.png'), fullPage: true })
})
