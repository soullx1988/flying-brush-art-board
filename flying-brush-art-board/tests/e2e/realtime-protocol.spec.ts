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

test('the realtime workspace reconnects and persists an edit created while the browser was offline', async ({ context, page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const projectId = `project-realtime-offline-${suffix}`
  const boardId = `board-realtime-offline-${suffix}`
  expect((await request.post('http://localhost:8787/api/projects', {
    data: {
      id: projectId,
      title: 'Realtime offline recovery',
      rootBoard: { id: boardId, title: 'Offline recovery' },
    },
  })).ok()).toBe(true)

  const socketUrls: string[] = []
  page.on('websocket', (socket) => socketUrls.push(socket.url()))
  await page.goto(`/projects/${projectId}/boards/${boardId}?realtime=1`)
  await expect(page.getByLabel('白板画布')).toBeVisible()
  await expect.poll(() => socketUrls.length).toBeGreaterThanOrEqual(1)

  await context.setOffline(true)
  const shapeId = await page.evaluate(() => {
    const editor = (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__
    if (!editor) throw new Error('Realtime workspace editor was not mounted')
    const id = `shape:realtime-offline-${crypto.randomUUID()}`
    editor.createShapes([{ id, type: 'geo', x: 180, y: 210 }])
    return id
  })
  await expect.poll(() => page.evaluate((id) => Boolean(
    (window as Window & { __INFINITE_BOARD_EDITOR__?: any }).__INFINITE_BOARD_EDITOR__?.getShape(id),
  ), shapeId)).toBe(true)

  const offlineBoard = await (await request.get(`http://localhost:8787/api/boards/${encodeURIComponent(boardId)}`)).json() as {
    tldrawSnapshot: { store?: Record<string, unknown> }
  }
  expect(offlineBoard.tldrawSnapshot.store?.[shapeId]).toBeUndefined()

  await context.setOffline(false)
  await expect.poll(() => socketUrls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(async () => {
    const response = await request.get(`http://localhost:8787/api/boards/${encodeURIComponent(boardId)}`)
    const board = await response.json() as { tldrawSnapshot: { store?: Record<string, unknown> } }
    return Boolean(board.tldrawSnapshot.store?.[shapeId])
  }, { timeout: 15_000 }).toBe(true)
})
