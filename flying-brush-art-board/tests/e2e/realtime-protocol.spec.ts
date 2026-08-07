import { expect, test, type APIRequestContext } from './test.js'

interface RealtimeProbe {
  mountRealtimeWriter(boardId: string, shapeId: string, onWritten: (written: boolean) => void): { remove(): void }
  mountRealtimeReader(boardId: string, shapeId: string, onRestored: (restored: boolean) => void): { remove(): void }
  mountRealtimeCanvasWriter(boardId: string, shapeId: string, onWritten: (written: boolean) => void): { remove(): void }
  mountRealtimeCanvasReader(boardId: string, shapeId: string, onRestored: (restored: boolean) => void): { remove(): void }
}

async function seedBoard(request: APIRequestContext, suffix: string) {
  const projectId = `project-realtime-${suffix}`
  const boardId = `board-realtime-${suffix}`
  const response = await request.post('http://localhost:8787/api/projects', {
    data: { id: projectId, title: 'Realtime protocol', rootBoard: { id: boardId, title: 'Realtime' } },
  })
  expect(response.ok()).toBe(true)
  return boardId
}

test('a tldraw realtime room shares a shape with a newly connected client', async ({ page, request }) => {
  const boardId = await seedBoard(request, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const shapeId = `shape:realtime-${crypto.randomUUID()}`
  const socketFrames: string[] = []
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => socketFrames.push(`sent:${frame.payload}`))
    socket.on('framereceived', (frame) => socketFrames.push(`received:${frame.payload}`))
  })
  await page.goto('/')

  await page.evaluate(async ({ boardId: targetBoardId, shapeId: targetShapeId }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    const mounted = probe.mountRealtimeWriter(targetBoardId, targetShapeId, (written: boolean) => {
      ;(window as Window & { __REALTIME_WRITTEN__?: boolean }).__REALTIME_WRITTEN__ = written
    })
    ;(window as Window & { __REALTIME_REMOVE__?: () => void }).__REALTIME_REMOVE__ = mounted.remove
  }, { boardId, shapeId })

  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __REALTIME_WRITTEN__?: boolean }).__REALTIME_WRITTEN__))).toBe(true)
  // A lone tldraw collaborator intentionally batches network writes at 1 FPS.
  await page.waitForTimeout(1_200)
  expect(socketFrames.some((frame) => frame.includes(shapeId))).toBe(true)
  await page.evaluate(() => {
    ;(window as Window & { __REALTIME_REMOVE__?: () => void }).__REALTIME_REMOVE__?.()
  })

  await page.evaluate(async ({ boardId: targetBoardId, shapeId: targetShapeId }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    probe.mountRealtimeReader(targetBoardId, targetShapeId, (restored: boolean) => {
      ;(window as Window & { __REALTIME_RESTORED__?: boolean }).__REALTIME_RESTORED__ = restored
    })
  }, { boardId, shapeId })

  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __REALTIME_RESTORED__?: boolean }).__REALTIME_RESTORED__))).toBe(true)
})

test('a realtime room reconnects after a full browser reload', async ({ page, request }) => {
  const boardId = await seedBoard(request, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const shapeId = `shape:realtime-reload-${crypto.randomUUID()}`
  await page.goto('/')

  await page.evaluate(async ({ boardId: targetBoardId, shapeId: targetShapeId }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    probe.mountRealtimeWriter(targetBoardId, targetShapeId, (written: boolean) => {
      ;(window as Window & { __REALTIME_WRITTEN__?: boolean }).__REALTIME_WRITTEN__ = written
    })
  }, { boardId, shapeId })
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __REALTIME_WRITTEN__?: boolean }).__REALTIME_WRITTEN__))).toBe(true)
  await page.waitForTimeout(1_200)

  await page.reload()
  await page.evaluate(async ({ boardId: targetBoardId, shapeId: targetShapeId }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    probe.mountRealtimeReader(targetBoardId, targetShapeId, (restored: boolean) => {
      ;(window as Window & { __REALTIME_RESTORED__?: boolean }).__REALTIME_RESTORED__ = restored
    })
  }, { boardId, shapeId })
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __REALTIME_RESTORED__?: boolean }).__REALTIME_RESTORED__))).toBe(true)
})

test('a tldraw editor backed by a realtime store survives a full browser reload', async ({ page, request }) => {
  const boardId = await seedBoard(request, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const shapeId = `shape:realtime-canvas-${crypto.randomUUID()}`
  await page.goto('/')
  await page.evaluate(async ({ boardId: targetBoardId, shapeId: targetShapeId }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    probe.mountRealtimeCanvasWriter(targetBoardId, targetShapeId, (written: boolean) => {
      ;(window as Window & { __REALTIME_WRITTEN__?: boolean }).__REALTIME_WRITTEN__ = written
    })
  }, { boardId, shapeId })
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __REALTIME_WRITTEN__?: boolean }).__REALTIME_WRITTEN__))).toBe(true)
  await page.waitForTimeout(1_200)

  await page.reload()
  await page.evaluate(async ({ boardId: targetBoardId, shapeId: targetShapeId }) => {
    const moduleUrl = '/src/test-support/realtime-probe.tsx'
    const probe = await import(/* @vite-ignore */ moduleUrl) as RealtimeProbe
    probe.mountRealtimeCanvasReader(targetBoardId, targetShapeId, (restored: boolean) => {
      ;(window as Window & { __REALTIME_RESTORED__?: boolean }).__REALTIME_RESTORED__ = restored
    })
  }, { boardId, shapeId })
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __REALTIME_RESTORED__?: boolean }).__REALTIME_RESTORED__))).toBe(true)
})

test('the opt-in realtime workspace reconnects its visible canvas after a full reload', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const projectId = `project-realtime-workspace-${suffix}`
  const boardId = `board-realtime-workspace-${suffix}`
  expect((await request.post('http://localhost:8787/api/projects', {
    data: {
      id: projectId,
      title: 'Realtime workspace',
      rootBoard: { id: boardId, title: 'Realtime canvas' },
    },
  })).ok()).toBe(true)

  await page.goto(`/projects/${projectId}/boards/${boardId}?realtime=1`)
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await page.getByLabel('白板画布').click({ position: { x: 20, y: 20 } })
  const shapeId = await page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Realtime workspace editor was not mounted')
    const id = `shape:realtime-workspace-${crypto.randomUUID()}`
    editor.createShapes([{ id, type: 'geo', x: 120, y: 160 }])
    return id
  })
  await expect.poll(() => page.evaluate((id) => Boolean(
    (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
  ), shapeId)).toBe(true)
  // A single tldraw collaborator batches document writes at 1 FPS.
  await page.waitForTimeout(1_200)

  await page.reload()
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => page.evaluate((id) => Boolean(
    (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
  ), shapeId)).toBe(true)
})
