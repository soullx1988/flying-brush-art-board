import { expect, test } from './test.js'

test('authorized Feishu whiteboard import @feishu-real', async ({ page, request }, testInfo) => {
  test.skip(process.env.FEISHU_REAL_SMOKE !== '1', 'SKIPPED: awaiting user authorization')
  test.skip(!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET, 'SKIPPED: awaiting user authorization')
  test.skip(!process.env.FEISHU_REAL_WHITEBOARD_URL, 'SKIPPED: awaiting user authorization')

  await page.goto('/')
  const status = await page.request.get('http://127.0.0.1:8787/api/integrations/feishu/status')
  expect(status.ok()).toBeTruthy()
  expect(await status.json()).toMatchObject({ connected: true })

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const projectId = `feishu-real-acceptance-${suffix}`
  expect((await request.post('http://localhost:8787/api/projects', {
    data: { id: projectId, title: `Feishu real acceptance ${suffix}`, rootBoard: { id: `feishu-real-board-${suffix}`, title: '概览' } },
  })).ok()).toBe(true)
  await page.goto(`/projects/${projectId}`)
  await page.getByRole('tab', { name: '集成' }).click()
  await expect(page.getByRole('heading', { name: '导入飞书白板' })).toBeVisible()
  await page.getByLabel('飞书白板链接').fill(process.env.FEISHU_REAL_WHITEBOARD_URL!)
  await page.getByRole('button', { name: '仅预检，不导入' }).click()
  const report = page.getByLabel('兼容性报告')
  await expect(report).toBeVisible()
  const preview = page.getByLabel('白板预览')
  await expect(preview).toBeVisible()
  // This artifact stays in Playwright output only. It is intentionally not a Git baseline.
  await preview.screenshot({ path: testInfo.outputPath('feishu-local-import-preview.png') })

  await page.getByRole('radio', { name: '新建项目' }).check()
  await page.getByLabel('新项目 ID').fill(`feishu-real-import-${suffix}`)
  await page.getByLabel('新项目名称').fill(`Feishu real import ${suffix}`)
  const confirm = page.getByRole('button', { name: '确认导入' })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
