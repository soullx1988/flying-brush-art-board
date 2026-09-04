import { expect, test, type APIRequestContext, type Page } from './test.js'
import type { TestInfo } from '@playwright/test'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8977'
const TRADING_PANEL_KINDS = ['market-overview', 'stock-pool', 'announcements', 'system-status'] as const

interface TradingWorkspaceResponse {
  project: { id: string }
  boards: Array<{ id: string; title: string }>
}

interface TodayReadabilityMetrics {
  zoom: number
  minEffectiveFontPx: number
  visibleTexts: string[]
}

async function updateSource(
  request: APIRequestContext,
  payload: Record<string, unknown>,
) {
  const configuredHeaders = test.info().project.use.extraHTTPHeaders as Record<string, string> | undefined
  const controlToken = configuredHeaders?.['x-e2e-shutdown-token']
  if (!controlToken) throw new Error('Trading E2E control token is missing')
  const response = await request.put(`${API_BASE}/__e2e/trading-source`, {
    headers: { 'x-e2e-shutdown-token': controlToken },
    data: payload,
  })
  if (!response.ok()) throw new Error(`Trading E2E control failed: ${response.status()} ${await response.text()}`)
}

async function readTodayReadabilityMetrics(page: Page): Promise<TodayReadabilityMetrics> {
  return page.evaluate(() => {
    const editor = (window as { __INFINITE_BOARD_EDITOR__?: { getZoomLevel?: () => number } }).__INFINITE_BOARD_EDITOR__
    const zoom = editor?.getZoomLevel?.() ?? 1
    const selectors = [
      '.trading-panel__today-answer small',
      '.trading-panel__today-fact-row > small',
      '.trading-panel__today-section p',
      '.trading-panel__decision-chain li > small',
      '.trading-panel__today-list span',
      '.trading-panel__evidence-open',
    ]
    const effectiveSizes = selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map((node) => {
      const fontSize = Number.parseFloat(window.getComputedStyle(node).fontSize || '0')
      return Number((fontSize * zoom).toFixed(2))
    }))
    const visibleTexts = [
      '现在能不能参与',
      '当前阶段',
      '下一关键时间',
      '这轮判断怎么来的',
      '从上一步到现在',
      '为什么这样看',
      '如果我没空',
      '查看依据',
    ].filter((label) => {
      const node = Array.from(document.querySelectorAll<HTMLElement>('body *')).find((element) => element.textContent?.includes(label))
      if (!node) return false
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    return {
      zoom,
      minEffectiveFontPx: effectiveSizes.length ? Math.min(...effectiveSizes) : 0,
      visibleTexts,
    }
  })
}

async function verifyTodayOverviewViewport(
  page: Page,
  boardUrl: string,
  viewport: { width: number; height: number },
  screenshotName: string,
  testInfo: TestInfo,
  options: { verifyEvidenceDialog: boolean },
) {
  await page.setViewportSize(viewport)
  await page.goto(boardUrl)
  await expect(page.locator('.trading-panel[data-panel-kind="today-overview"]')).toHaveCount(1)
  await expect(page.locator('.trading-panel[data-panel-kind="today-overview"]')).toHaveAttribute('data-fact-state', 'CURRENT')
  await expect(page.getByText('现在能不能参与')).toBeVisible()
  await expect(page.getByText('可以参与', { exact: true })).toBeVisible()
  await expect(page.getByText('当前阶段')).toBeVisible()
  await expect(page.getByText('下一关键时间')).toBeVisible()
  await expect(page.getByText('这轮判断怎么来的')).toBeVisible()
  await expect(page.getByRole('heading', { name: '从上一步到现在' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '为什么这样看' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '如果我没空' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '查看依据' })).toBeVisible()
  await expect(page.getByText('09:25 竞价事实')).toBeVisible()
  if (options.verifyEvidenceDialog) {
    await page.getByRole('button', { name: '打开全部（1）' }).click()
    const evidenceDialog = page.getByRole('dialog', { name: '这轮判断的全部依据' })
    await expect(evidenceDialog).toBeVisible()
    await evidenceDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(evidenceDialog).toHaveCount(0)
  }
  const metrics = await readTodayReadabilityMetrics(page)
  console.log(`[today-readability ${viewport.width}x${viewport.height}] ${JSON.stringify(metrics)}`)
  expect(metrics.visibleTexts).toEqual(expect.arrayContaining([
    '现在能不能参与',
    '当前阶段',
    '下一关键时间',
    '这轮判断怎么来的',
    '从上一步到现在',
    '为什么这样看',
    '如果我没空',
    '查看依据',
  ]))
  expect(metrics.minEffectiveFontPx).toBeGreaterThanOrEqual(11.8)
  await page.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: true })
}

test('shows the independent today board, streams 06 snapshots, fails closed, and recovers @trading-live', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const bootstrap = await request.put(`${API_BASE}/api/bootstrap/personal-trading-workspace`)
  expect(bootstrap.ok()).toBe(true)
  const workspace = await bootstrap.json() as TradingWorkspaceResponse
  const dataBoard = workspace.boards.find((board) => board.title === '数据')
  const todayBoard = workspace.boards.find((board) => board.title === '今天怎么看')
  if (!dataBoard) throw new Error('Trading data Board was not bootstrapped')
  if (!todayBoard) throw new Error('Trading today Board was not bootstrapped')

  const todayBoardUrl = `/projects/${workspace.project.id}/boards/${todayBoard.id}?realtime=0`
  await verifyTodayOverviewViewport(page, todayBoardUrl, { width: 1280, height: 720 }, 'trading-today-1280x720.png', testInfo, { verifyEvidenceDialog: true })
  await verifyTodayOverviewViewport(page, todayBoardUrl, { width: 1024, height: 768 }, 'trading-today-1024x768.png', testInfo, { verifyEvidenceDialog: false })

  await updateSource(request, { score: 67.3, announcementTitle: 'UAT 只看快照', mode: 'blocked' })
  await expect(page.getByText('不能参与', { exact: true })).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('.trading-panel')).toHaveAttribute('data-fact-state', 'DEGRADED')

  await updateSource(request, { corrupt: true })
  await expect(page.getByText('数据降级').first()).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('不能参与', { exact: true })).toBeVisible()

  await updateSource(request, { score: 67.3, announcementTitle: 'UAT 恢复快照', mode: 'ready' })
  await expect(page.getByText('可以参与', { exact: true })).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('.trading-panel')).toHaveAttribute('data-fact-state', 'CURRENT')

  await page.goto(`/projects/${workspace.project.id}/boards/${dataBoard.id}?realtime=0`)
  await expect(page.locator('.trading-panel')).toHaveCount(4)
  for (const panelKind of TRADING_PANEL_KINDS) {
    await expect(page.locator(`.trading-panel[data-panel-kind="${panelKind}"]`)).toHaveAttribute('data-fact-state', 'CURRENT')
  }
  await expect(page.getByText('一博科技').first()).toBeVisible()
  await expect(page.getByText('UAT 恢复快照').first()).toBeVisible()
  await expect(page.locator('.trading-panel:visible').first().getByText('更新通道：推送已连接')).toBeVisible()

  const marketViewButton = page.getByRole('button', { name: '数据视图：市场主线' })
  await marketViewButton.click()
  await expect(marketViewButton).toHaveAttribute('aria-pressed', 'true')
  const marketPanel = page.locator('.trading-panel[data-panel-kind="market-overview"]')
  await expect(marketPanel.getByText('双周期观察画板', { exact: true })).toBeVisible()
  await expect(marketPanel.getByText('只读关注画板', { exact: true })).toBeVisible()
  await expect(marketPanel.getByText('只作关注，不构成交易许可', { exact: true })).toBeVisible()
  await expect(marketPanel.getByRole('heading', { name: '义水情绪六镜头' })).toBeVisible()
  await expect(marketPanel.getByText('5 / 5 个交易日')).toBeVisible()
  await expect(marketPanel.getByText('250 / 250 个交易日')).toBeVisible()
  await expect(marketPanel.getByRole('heading', { name: '情绪事件链' })).toBeVisible()
  await expect(marketPanel.getByText('第 1 次冰点')).toBeVisible()
  await expect(marketPanel.getByText('第 2 次冰点')).toBeVisible()
  await expect(marketPanel.getByRole('heading', { name: '模型先生战略历史' })).toBeVisible()
  await expect(marketPanel.getByText('双周期核心只提供关注与复核，不提供交易授权。')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dual-cycle-market-1440x900.png'), fullPage: true })

  await page.setViewportSize({ width: 1024, height: 768 })
  await marketViewButton.click()
  await expect(marketPanel.getByRole('heading', { name: '义水情绪六镜头' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dual-cycle-market-1024x768.png'), fullPage: true })
  const strategicHistoryHeading = marketPanel.getByRole('heading', { name: '模型先生战略历史' })
  await strategicHistoryHeading.scrollIntoViewIfNeeded()
  await expect(strategicHistoryHeading).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('dual-cycle-market-history-1024x768.png'), fullPage: true })

  const stockViewButton = page.getByRole('button', { name: '数据视图：个人选股池' })
  await stockViewButton.click()
  await expect(stockViewButton).toHaveAttribute('aria-pressed', 'true')
  const stockPanel = page.locator('.trading-panel[data-panel-kind="stock-pool"]')
  await expect(stockPanel.getByRole('heading', { name: '候选泳道' })).toBeVisible()
  await expect(stockPanel.getByText('战略研究', { exact: true })).toBeVisible()
  await expect(stockPanel.getByText('战术观察', { exact: true })).toBeVisible()
  await expect(stockPanel.getByText('联合复核', { exact: true })).toBeVisible()
  await expect(stockPanel.getByText('回归股份')).toBeVisible()
  await expect(stockPanel.getByText('节奏股份')).toBeVisible()
  await expect(stockPanel.getByText('共振股份')).toBeVisible()
  await expect(stockPanel.getByText('保留生命周期字段，不展示综合分、动作建议或参与许可')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dual-cycle-candidates-1024x768.png'), fullPage: true })
  await stockPanel.getByText('共振股份').scrollIntoViewIfNeeded()
  await expect(stockPanel.getByText('共振股份')).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('dual-cycle-candidates-joint-1024x768.png'), fullPage: true })

  const before = await (await request.get(`${API_BASE}/api/trading/snapshot`)).json() as { revision: string }
  await updateSource(request, { score: 88.8, announcementTitle: 'UAT 实时推送公告', mode: 'ready' })
  await expect.poll(async () => {
    const snapshot = await (await request.get(`${API_BASE}/api/trading/snapshot`)).json() as { revision: string }
    return snapshot.revision
  }).not.toBe(before.revision)
  await expect(page.getByText('88.8')).toHaveCount(0)
  const announcementViewButton = page.getByRole('button', { name: '数据视图：公告观察' })
  await announcementViewButton.click()
  await expect(page.getByText('UAT 实时推送公告').first()).toBeVisible({ timeout: 8_000 })

  await updateSource(request, { score: 91.2, announcementTitle: 'UAT 恢复公告', mode: 'ready' })
  await expect(page.getByText('UAT 恢复公告').first()).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('91.2')).toHaveCount(0)
  await expect(page.locator('.trading-panel').first()).toHaveAttribute('data-fact-state', 'CURRENT')
  expect(pageErrors).toEqual([])
})
