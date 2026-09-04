import { expect, test } from '@playwright/test'

const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8787'

test('authorized Feishu whiteboard import @feishu-real', async ({ page }, testInfo) => {
  test.skip(process.env.FEISHU_REAL_SMOKE !== '1', 'SKIPPED: awaiting user authorization')
  test.skip(!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET, 'SKIPPED: awaiting user authorization')
  test.skip(!process.env.FEISHU_REAL_WHITEBOARD_URL, 'SKIPPED: awaiting user authorization')

  await page.goto('/')
  const status = await page.request.get(`${API_BASE}/api/integrations/feishu/status`)
  expect(status.ok()).toBeTruthy()
  expect(await status.json()).toMatchObject({ connected: true })

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const projectId = `feishu-real-acceptance-${suffix}`
  let created = false
  try {
    const createProject = await page.request.post(`${API_BASE}/api/projects`, {
      data: { id: projectId, title: `Feishu real acceptance ${suffix}`, rootBoard: { id: `feishu-real-board-${suffix}`, title: '概览' } },
    })
    expect(createProject.ok()).toBe(true)
    created = true

    await page.goto(`/projects/${projectId}`)
    await page.getByRole('tab', { name: '集成' }).click()
    await expect(page.getByRole('heading', { name: '导入飞书白板' })).toBeVisible()
    await page.getByLabel('飞书白板链接').fill(process.env.FEISHU_REAL_WHITEBOARD_URL!)
    await page.getByRole('button', { name: '仅预检，不导入' }).click()
    const report = page.getByLabel('兼容性报告')
    await expect(report).toBeVisible()
    const preview = page.getByLabel('白板预览')
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-preview-element-id]').first()).toBeVisible()
    // This artifact stays in Playwright output only. It is intentionally not a Git baseline.
    await preview.screenshot({ path: testInfo.outputPath('feishu-local-import-preview.png') })

    await expect(page.getByRole('radio', { name: '已有项目' })).toBeChecked()
    const confirm = page.getByRole('button', { name: '确认导入' })
    await expect(confirm).toBeEnabled()
    const commitResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/import/feishu/commit')
      && response.request().method() === 'POST',
    )
    await confirm.click()
    const commitResponse = await commitResponsePromise
    expect(commitResponse.ok()).toBe(true)
    const committed = await commitResponse.json() as { boardId: string; projectId: string }
    expect(committed.projectId).toBe(projectId)
    expect(committed.boardId).toBeTruthy()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/boards/${committed.boardId}`))

    const persistedResponse = await page.request.get(`${API_BASE}/api/projects/${projectId}`)
    expect(persistedResponse.ok()).toBe(true)
    const persisted = await persistedResponse.json() as {
      boards: Array<{ id: string; tldrawSnapshot: { store?: Record<string, { typeName?: string }> } }>
    }
    const importedBoard = persisted.boards.find((board) => board.id === committed.boardId)
    expect(importedBoard).toBeDefined()
    expect(Object.values(importedBoard?.tldrawSnapshot.store ?? {})
      .some((record) => record.typeName === 'shape')).toBe(true)
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    if (created) {
      await page.goto('/').catch(() => undefined)
      const cleanup = await page.request.delete(`${API_BASE}/api/projects/${projectId}`)
      expect(cleanup.ok()).toBe(true)
    }
  }
})
