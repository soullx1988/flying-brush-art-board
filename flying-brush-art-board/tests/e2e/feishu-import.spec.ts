import { expect, test } from './test.js'

test('mock Feishu inspect preview and explicit commit use the selected new-project target', async ({ page, request }) => {
  let committed = false
  let commitPayload: unknown
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const projectId = `project-feishu-${suffix}`
  expect((await request.post('http://localhost:8787/api/projects', {
    data: { id: projectId, title: 'Mock project', rootBoard: { id: `board-feishu-${suffix}`, title: '概览' } },
  })).ok()).toBe(true)
  await page.route('**/api/integrations/feishu/status', (route) => route.fulfill({ json: { connected: true } }))
  await page.route('**/api/import/feishu/inspect', (route) => route.fulfill({ json: { sessionId: 'mock-session', preview: { scene: { elements: [{ id: 'text', type: 'text', geometry: { x: 0, y: 0, width: 100, height: 20 }, text: 'Quarterly roadmap' }] }, report: { issues: [{ code: 'UNSUPPORTED_NODE', message: 'Unknown node cannot be edited.', severity: 'warning' }] }, fidelity: { editable: ['text'], downgraded: ['legacy'], rasterized: [], unsupported: [] }, baseline: { previewByteLength: 4 } } } }))
  await page.route('**/api/import/feishu/commit', async (route) => { committed = true; commitPayload = route.request().postDataJSON(); await route.fulfill({ json: { boardId: 'board-imported', projectId: 'imported-project' } }) })
  await page.route('**/api/import/feishu/sessions/**', (route) => route.fulfill({ status: 204 }))
  await page.goto(`/projects/${projectId}`)
  await page.getByRole('tab', { name: '集成' }).click()
  await expect(page.getByRole('heading', { name: '导入飞书白板' })).toBeVisible()
  await page.getByLabel('飞书白板链接').fill('https://example.feishu.cn/board/mock_token')
  await page.getByRole('button', { name: '仅预检，不导入' }).click()
  await expect(page.getByText('UNSUPPORTED_NODE')).toBeVisible()
  await expect(page.getByLabel('白板预览')).toContainText('Quarterly roadmap')
  expect(committed).toBe(false)
  await page.getByRole('radio', { name: '新建项目' }).check()
  await page.getByLabel('新项目 ID').fill('imported-project')
  await page.getByLabel('新项目名称').fill('Imported Feishu workspace')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect.poll(() => committed).toBe(true)
  expect(commitPayload).toEqual({ sessionId: 'mock-session', target: { kind: 'new', projectId: 'imported-project', title: 'Imported Feishu workspace' }, confirmed: true })
})
