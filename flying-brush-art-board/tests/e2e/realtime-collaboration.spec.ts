import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

interface RealtimeProbe {
  mountRealtimeWriter(boardId: string, shapeId: string, onWritten: (written: boolean) => void): { remove(): void }
  mountRealtimeReader(boardId: string, shapeId: string, onRestored: (restored: boolean) => void): { remove(): void }
}

async function login(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('link', { name: '使用飞书登录' }).click()
  await expect(page.getByText('E2E Test')).toBeVisible()
  return { context, page }
}

test('realtime collaboration @collaboration', async ({ browser }) => {
  const writer = await login(browser)
  const reader = await login(browser)
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const projectId = `project-realtime-collaboration-${suffix}`
    const boardId = `board-realtime-collaboration-${suffix}`
    const shapeId = `shape:realtime-collaboration-${crypto.randomUUID()}`
    await writer.page.evaluate(async ({ projectId: id, boardId: board }) => {
      const response = await fetch('/api/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, title: 'Realtime collaboration', rootBoard: { id: board, title: 'Shared board' } }),
      })
      if (!response.ok) throw new Error(await response.text())
    }, { projectId, boardId })
    await Promise.all([writer.page.goto('/'), reader.page.goto('/')])

    await reader.page.evaluate(async ({ boardId: board, shapeId: shape }) => {
      const moduleUrl = '/src/test-support/realtime-probe.tsx'
      const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
      const mounted = probe.mountRealtimeReader(board, shape, (restored) => {
        ;(window as Window & { __REALTIME_COLLABORATION_READ__?: boolean }).__REALTIME_COLLABORATION_READ__ = restored
      })
      ;(window as Window & { __REALTIME_COLLABORATION_REMOVE__?: () => void }).__REALTIME_COLLABORATION_REMOVE__ = mounted.remove
    }, { boardId, shapeId })
    await writer.page.evaluate(async ({ boardId: board, shapeId: shape }) => {
      const moduleUrl = '/src/test-support/realtime-probe.tsx'
      const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
      const mounted = probe.mountRealtimeWriter(board, shape, (written) => {
        ;(window as Window & { __REALTIME_COLLABORATION_WRITTEN__?: boolean }).__REALTIME_COLLABORATION_WRITTEN__ = written
      })
      ;(window as Window & { __REALTIME_COLLABORATION_REMOVE__?: () => void }).__REALTIME_COLLABORATION_REMOVE__ = mounted.remove
    }, { boardId, shapeId })

    await expect.poll(() => writer.page.evaluate(() => Boolean(
      (window as Window & { __REALTIME_COLLABORATION_WRITTEN__?: boolean }).__REALTIME_COLLABORATION_WRITTEN__,
    ))).toBe(true)
    await expect.poll(() => reader.page.evaluate(() => Boolean(
      (window as Window & { __REALTIME_COLLABORATION_READ__?: boolean }).__REALTIME_COLLABORATION_READ__,
    )), { timeout: 5_000 }).toBe(true)
  } finally {
    await Promise.all([
      writer.page.evaluate(() => { (window as Window & { __REALTIME_COLLABORATION_REMOVE__?: () => void }).__REALTIME_COLLABORATION_REMOVE__?.() }).catch(() => undefined),
      reader.page.evaluate(() => { (window as Window & { __REALTIME_COLLABORATION_REMOVE__?: () => void }).__REALTIME_COLLABORATION_REMOVE__?.() }).catch(() => undefined),
    ])
    await Promise.all([writer.context.close(), reader.context.close()])
  }
})
