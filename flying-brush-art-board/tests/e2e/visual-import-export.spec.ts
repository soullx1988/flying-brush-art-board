import { expect, test, type APIRequestContext, type Page } from './test.js'

import type { ProjectRecord, StoredBoard } from '../../packages/board-core/src/index.js'
import { renderProjectToPdf } from '../../packages/interop/src/pdf/project-pdf.js'

const API_BASE = 'http://localhost:8787'
const now = '2026-07-23T00:00:00.000Z'

interface ProjectState {
  project: ProjectRecord
  boards: StoredBoard[]
}

interface Upload {
  name: string
  mimeType: string
  bytes: Uint8Array
}

async function readProject(request: APIRequestContext, projectId: string): Promise<ProjectState> {
  const response = await request.get(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ProjectState>
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(bytes.buffer).setUint32(4, 22, true)
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8)
  new DataView(bytes.buffer).setUint32(16, 10, true)
  const encodedWidth = width - 1
  const encodedHeight = height - 1
  bytes.set([encodedWidth & 0xff, (encodedWidth >>> 8) & 0xff, (encodedWidth >>> 16) & 0xff], 24)
  bytes.set([encodedHeight & 0xff, (encodedHeight >>> 8) & 0xff, (encodedHeight >>> 16) & 0xff], 27)
  return bytes
}

async function pdf(pageCount: number): Promise<Uint8Array> {
  const project: ProjectRecord = {
    id: `pdf-fixture-${pageCount}`,
    title: `${pageCount} page fixture`,
    rootBoardId: 'pdf-board-1',
    formatVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
  const boards: StoredBoard[] = Array.from({ length: pageCount }, (_, index) => ({
    id: `pdf-board-${index + 1}`,
    projectId: project.id,
    title: `PDF page ${index + 1}`,
    tldrawSnapshot: { store: {} },
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }))
  return renderProjectToPdf({ project, boards, references: [] })
}

function snapshotStore(board: StoredBoard): Record<string, any> {
  const snapshot = board.tldrawSnapshot as {
    store?: Record<string, any>
    document?: { store?: Record<string, any> }
  }
  return snapshot.document?.store ?? snapshot.store ?? {}
}

function projectContent(state: ProjectState) {
  return {
    project: state.project,
    boards: state.boards.map((board) => ({
      id: board.id,
      projectId: board.projectId,
      title: board.title,
      tldrawSnapshot: board.tldrawSnapshot,
      createdAt: board.createdAt,
    })),
  }
}

async function dropFiles(
  page: Page,
  target: 'new-tab' | 'tab-strip' | 'canvas' | 'global',
  uploads: readonly Upload[],
): Promise<void> {
  if (target === 'tab-strip' || target === 'canvas' || target === 'global') {
    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['probe'], 'probe.png', { type: 'image/png' }))
      window.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }))
    })
    await page.locator('.app-drop-overlay').waitFor({ state: 'visible' })
  }
  await page.evaluate(({ target, uploads }) => {
    const transfer = new DataTransfer()
    for (const upload of uploads) {
      const bytes = Uint8Array.from(atob(upload.base64), (character) => character.charCodeAt(0))
      transfer.items.add(new File([bytes], upload.name, { type: upload.mimeType }))
    }
    const dropTarget = target === 'global'
      ? window
      : document.querySelector(`[data-drop-target="${target}"]`)
    if (!dropTarget) throw new Error(`Missing drop target: ${target}`)
    dropTarget.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 420,
      clientY: 320,
      dataTransfer: transfer,
    }))
  }, {
    target,
    uploads: uploads.map((upload) => ({
      name: upload.name,
      mimeType: upload.mimeType,
      base64: Buffer.from(upload.bytes).toString('base64'),
    })),
  })
}

async function expectAssetMaterialized(request: APIRequestContext, record: any): Promise<void> {
  expect(record.typeName).toBe('asset')
  expect(record.props.src).toMatch(/^\/api\/assets\/[a-f0-9]{64}$/)
  const response = await request.get(`${API_BASE}${record.props.src}`)
  expect(response.ok()).toBe(true)
  expect(Number(response.headers()['content-length'] ?? (await response.body()).byteLength)).toBeGreaterThan(0)
}

test('imports PNG, JPEG, WebP, and sanitized SVG as ordered independent new Boards', async ({ page, request }) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID()
  const projectId = `visual-raster-${suffix}`
  const rootBoardId = `visual-root-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Visual formats',
      rootBoard: { id: rootBoardId, title: 'Root' },
    },
  })).ok()).toBe(true)
  await page.goto(`/projects/${projectId}/boards/${rootBoardId}`)
  await expect(page.getByRole('heading', { name: 'Root' })).toBeVisible()

  const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="alert(1)">
    <script>alert(1)</script><image href="https://evil.invalid/pixel.png"/>
    <rect width="120" height="80" fill="#22c55e"/>
  </svg>`
  await dropFiles(page, 'new-tab', [
    { name: 'One.png', mimeType: 'image/png', bytes: png(64, 48) },
    { name: 'Two.jpg', mimeType: 'image/jpeg', bytes: jpeg(80, 60) },
    { name: 'Three.webp', mimeType: 'image/webp', bytes: webp(90, 70) },
    { name: 'Four.svg', mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(maliciousSvg) },
  ])

  await expect.poll(async () => (await readProject(request, projectId)).boards.length).toBe(5)
  const state = await readProject(request, projectId)
  const imported = ['One', 'Two', 'Three', 'Four'].map((title) =>
    state.boards.find((board) => board.title === title)!)
  expect(imported.every(Boolean)).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/boards/${encodeURIComponent(imported[3]!.id)}$`))

  for (const board of imported) {
    const records = Object.values(snapshotStore(board))
    const shapes = records.filter((record) => record.typeName === 'shape' && record.type === 'image')
    const assets = records.filter((record) => record.typeName === 'asset' && record.type === 'image')
    expect(shapes).toHaveLength(1)
    expect(assets).toHaveLength(1)
    await expectAssetMaterialized(request, assets[0])
  }

  const svgAsset = Object.values(snapshotStore(imported[3]!)).find((record: any) => record.typeName === 'asset') as any
  const sanitized = await (await request.get(`${API_BASE}${svgAsset.props.src}`)).text()
  expect(sanitized).toContain('<rect')
  expect(sanitized).not.toMatch(/script|onload|evil\.invalid/i)
})

test('imports single and multi-page PDFs as rasterized atomic canvas batches and rolls back failures', async ({ page, request }) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID()
  const projectId = `visual-pdf-${suffix}`
  const rootBoardId = `visual-pdf-root-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Visual PDF',
      rootBoard: { id: rootBoardId, title: 'PDF target' },
    },
  })).ok()).toBe(true)
  await page.goto(`/projects/${projectId}/boards/${rootBoardId}`)
  await expect(page.getByRole('heading', { name: 'PDF target' })).toBeVisible()

  await dropFiles(page, 'canvas', [
    { name: 'single.pdf', mimeType: 'application/pdf', bytes: await pdf(1) },
  ])
  await expect.poll(async () => {
    const board = (await readProject(request, projectId)).boards[0]!
    return Object.values(snapshotStore(board))
      .filter((record) => record.typeName === 'asset' && record.type === 'image').length
  }).toBe(1)
  await dropFiles(page, 'canvas', [
    { name: 'multi.pdf', mimeType: 'application/pdf', bytes: await pdf(2) },
  ])
  await expect.poll(async () => {
    const board = (await readProject(request, projectId)).boards[0]!
    return Object.values(snapshotStore(board))
      .filter((record) => record.typeName === 'asset' && record.type === 'image').length
  }).toBe(3)

  const committed = (await readProject(request, projectId)).boards[0]!
  expect((await readProject(request, projectId)).boards).toHaveLength(1)
  expect(committed.revision).toBeGreaterThanOrEqual(2)
  const records = Object.values(snapshotStore(committed))
  const assets = records.filter((record) => record.typeName === 'asset' && record.type === 'image')
  const shapes = records.filter((record) => record.typeName === 'shape' && record.type === 'image')
  expect(assets).toHaveLength(3)
  expect(shapes).toHaveLength(3)
  expect(shapes.every((shape) => shape.meta?.rasterized === true)).toBe(true)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const multiShapes = shapes
    .filter((shape) => String(assetById.get(shape.props.assetId)?.props.name).startsWith('multi.pdf'))
    .sort((left, right) => left.meta.pageNumber - right.meta.pageNumber)
  expect(multiShapes).toHaveLength(2)
  expect(multiShapes[1]!.y - multiShapes[0]!.y).toBe(multiShapes[0]!.props.h + 32)
  for (const asset of assets) await expectAssetMaterialized(request, asset)

  const beforeFailure = await readProject(request, projectId)
  await dropFiles(page, 'canvas', [
    { name: 'broken.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-broken') },
  ])
  await expect(page.getByRole('status').filter({
    hasText: /PDF_DOCUMENT_INVALID|PDF_PAGE_RENDER_FAILED/,
  })).toBeVisible()
  expect(projectContent(await readProject(request, projectId))).toEqual(projectContent(beforeFailure))

  await dropFiles(page, 'tab-strip', [
    { name: 'mismatch.png', mimeType: 'image/jpeg', bytes: png(10, 10) },
  ])
  await expect(page.getByRole('status').filter({
    hasText: 'VISUAL_FILE_TYPE_MISMATCH',
  })).toBeVisible()
  expect(projectContent(await readProject(request, projectId))).toEqual(projectContent(beforeFailure))
})

test('exports current Board as PNG, SVG, and one-page PDF and project PDF without directory pages', async ({ page, request }) => {
  test.setTimeout(120_000)
  const suffix = crypto.randomUUID()
  const projectId = `visual-export-${suffix}`
  const rootBoardId = `visual-export-root-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects`, {
    data: {
      id: projectId,
      title: 'Visual export',
      rootBoard: { id: rootBoardId, title: 'Export target' },
    },
  })).ok()).toBe(true)
  expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
    data: { id: `visual-export-child-${suffix}`, title: 'Second board' },
  })).ok()).toBe(true)
  await page.goto(`/projects/${projectId}/boards/${rootBoardId}`)
  await expect(page.getByRole('heading', { name: 'Export target' })).toBeVisible()

  await dropFiles(page, 'canvas', [
    {
      name: 'export.svg',
      mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#2563eb"/></svg>'),
    },
  ])
  await expect.poll(async () => (await readProject(request, projectId)).boards.find((board) => board.id === rootBoardId)!.revision).toBe(1)

  for (const label of ['导出 PNG', '导出 SVG'] as const) {
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: label }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`Export target.${label.endsWith('PNG') ? 'png' : 'svg'}`)
  }

  const boardPdfResponse = await request.post(`${API_BASE}/api/boards/${rootBoardId}/export.pdf`)
  const projectPdfResponse = await request.post(`${API_BASE}/api/projects/${projectId}/export.pdf`)
  expect(boardPdfResponse.ok()).toBe(true)
  expect(projectPdfResponse.ok()).toBe(true)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  expect((await pdfjs.getDocument({ data: new Uint8Array(await boardPdfResponse.body()) }).promise).numPages).toBe(1)
  expect((await pdfjs.getDocument({ data: new Uint8Array(await projectPdfResponse.body()) }).promise).numPages).toBe(2)
})
