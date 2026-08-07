import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

async function login(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('link', { name: '使用飞书登录' }).click()
  await expect(page.getByText('E2E Test')).toBeVisible()
  return { context, page }
}

test('comments audit @collaboration', async ({ browser }) => {
  const first = await login(browser)
  const second = await login(browser)
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const projectId = `project-comments-${suffix}`
    const boardId = `board-comments-${suffix}`
    await first.page.evaluate(async ({ projectId: id, boardId: board }) => {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, title: 'Comments audit', rootBoard: { id: board, title: 'Shared board' } }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, { projectId, boardId })

    await Promise.all([
      first.page.goto(`/projects/${projectId}/boards/${boardId}`),
      second.page.goto(`/projects/${projectId}/boards/${boardId}`),
    ])
    await Promise.all([
      expect(first.page.getByLabel('白板画布')).toBeVisible(),
      expect(second.page.getByLabel('白板画布')).toBeVisible(),
    ])

    const threadId = await first.page.evaluate(async (board) => {
      const response = await fetch(`/api/boards/${encodeURIComponent(board)}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Visible to collaborators', x: 120, y: 180 }),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json() as { thread: { id: string } }).thread.id
    }, boardId)

    await second.page.locator('[data-comment-toggle]').click()
    await expect(second.page.locator(`[data-comment-thread="${threadId}"]`)).toBeVisible({ timeout: 5_000 })
    await first.page.evaluate(async (thread) => {
      const response = await fetch(`/api/comment-threads/${encodeURIComponent(thread)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, threadId)

    await second.page.getByRole('radio', { name: '已解决' }).click()
    const resolvedThread = second.page.locator(`[data-comment-thread="${threadId}"]`)
    await expect(resolvedThread).toBeVisible({ timeout: 5_000 })
    await resolvedThread.getByRole('button', { name: '评论操作' }).click()
    await expect(second.page.getByRole('menuitem', { name: '重新打开' })).toBeVisible()
    const auditActions = await second.page.evaluate(async () => {
      const response = await fetch('/api/audit?limit=100')
      if (!response.ok) throw new Error(await response.text())
      return (await response.json() as { events: Array<{ action: string }> }).events.map((event) => event.action)
    })
    expect(auditActions).toContain('comment.create')
    expect(auditActions).toContain('comment.resolve')
  } finally {
    await Promise.all([first.context.close(), second.context.close()])
  }
})
