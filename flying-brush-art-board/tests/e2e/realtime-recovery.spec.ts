import { expect, test, type APIRequestContext } from './test.js'

interface RealtimeProbe {
  mountRealtimeWriter(boardId: string, shapeId: string, onWritten: (written: boolean) => void): { remove(): void }
  mountRealtimeReader(boardId: string, shapeId: string, onRestored: (restored: boolean) => void): { remove(): void }
}

async function seedBoard(request: APIRequestContext, suffix: string): Promise<string> {
  const projectId = `project-realtime-recovery-${suffix}`
  const boardId = `board-realtime-recovery-${suffix}`
  const response = await request.post('http://localhost:8787/api/projects', {
    data: { id: projectId, title: 'Realtime recovery', rootBoard: { id: boardId, title: 'Recovery board' } },
  })
  expect(response.ok()).toBe(true)
  return boardId
}

test('realtime recovery @collaboration', async ({ page, request }) => {
  const boardId = await seedBoard(request, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const shapeId = `shape:realtime-recovery-${crypto.randomUUID()}`
  await page.goto('/')
  await page.evaluate(async ({ boardId: board, shapeId: shape }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    const mounted = probe.mountRealtimeWriter(board, shape, (written) => {
      ;(window as Window & { __REALTIME_RECOVERY_WRITTEN__?: boolean }).__REALTIME_RECOVERY_WRITTEN__ = written
    })
    ;(window as Window & { __REALTIME_RECOVERY_REMOVE__?: () => void }).__REALTIME_RECOVERY_REMOVE__ = mounted.remove
  }, { boardId, shapeId })
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as Window & { __REALTIME_RECOVERY_WRITTEN__?: boolean }).__REALTIME_RECOVERY_WRITTEN__,
  ))).toBe(true)
  // sync-core batches document updates; wait for the durable room projection.
  await page.waitForTimeout(1_200)
  await page.reload()
  await page.evaluate(async ({ boardId: board, shapeId: shape }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    probe.mountRealtimeReader(board, shape, (restored) => {
      ;(window as Window & { __REALTIME_RECOVERY_RESTORED__?: boolean }).__REALTIME_RECOVERY_RESTORED__ = restored
    })
  }, { boardId, shapeId })
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as Window & { __REALTIME_RECOVERY_RESTORED__?: boolean }).__REALTIME_RECOVERY_RESTORED__,
  ))).toBe(true)
})
