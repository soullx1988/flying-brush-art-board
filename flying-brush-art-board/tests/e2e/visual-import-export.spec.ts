import { readFile } from 'node:fs/promises'

import { expect, test, type APIRequestContext, type Page } from './test.js'

import type { ProjectRecord, StoredBoard } from '../../packages/board-core/src/index.js'
import { renderProjectToPdf } from '../../packages/interop/src/pdf/project-pdf.js'
import { createPngFixture } from '../../packages/test-fixtures/src/media.js'

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
  return createPngFixture(width, height)
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(bytes)
  expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

async function browserRaster(page: Page, width: number, height: number, mime: 'image/jpeg' | 'image/webp'): Promise<Uint8Array> {
  const base64 = await page.evaluate(({ width, height, mime }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#3370ff'
    context.fillRect(0, 0, width, height)
    return canvas.toDataURL(mime, 0.85).split(',')[1]!
  }, { width, height, mime })
  return new Uint8Array(Buffer.from(base64, 'base64'))
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

async function waitForBoardRevisionToSettle(
  request: APIRequestContext,
  projectId: string,
  page: Page,
  boardId: string,
): Promise<void> {
  await expect.poll(async () => {
    const first = (await readProject(request, projectId)).boards.find((board) => board.id === boardId)?.revision
    await page.waitForTimeout(1_200)
    const second = (await readProject(request, projectId)).boards.find((board) => board.id === boardId)?.revision
    return first === second ? first : -1
  }).not.toBe(-1)
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
  const [jpegBytes, webpBytes] = await Promise.all([
    browserRaster(page, 80, 60, 'image/jpeg'),
    browserRaster(page, 90, 70, 'image/webp'),
  ])
  await dropFiles(page, 'new-tab', [
    { name: 'One.png', mimeType: 'image/png', bytes: png(64, 48) },
    { name: 'Two.jpg', mimeType: 'image/jpeg', bytes: jpegBytes },
    { name: 'Three.webp', mimeType: 'image/webp', bytes: webpBytes },
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
  await waitForBoardRevisionToSettle(request, projectId, page, rootBoardId)
  await expect(page.getByRole('img', { name: 'single.pdf' })).toBeVisible()
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

  const failureBoardId = `visual-pdf-failure-${suffix}`
  expect((await request.post(`${API_BASE}/api/projects/${projectId}/boards`, {
    data: { id: failureBoardId, title: 'Failure target' },
  })).ok()).toBe(true)
  await page.goto(`/projects/${projectId}/boards/${failureBoardId}`)
  await expect(page.getByRole('heading', { name: 'Failure target' })).toBeVisible()
  await waitForBoardRevisionToSettle(request, projectId, page, failureBoardId)

  const readFailureBoard = async () => {
    const state = await readProject(request, projectId)
    return state.boards.find((board) => board.id === failureBoardId)!
  }

  const beforeFailure = await readFailureBoard()
  await dropFiles(page, 'canvas', [
    { name: 'broken.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-broken') },
  ])
  await expect(page.getByRole('status').filter({
    hasText: /PDF_DOCUMENT_INVALID|PDF_PAGE_RENDER_FAILED/,
  })).toBeVisible()
  const afterBrokenPdf = await readFailureBoard()
  expect(afterBrokenPdf).toEqual(beforeFailure)

  await dropFiles(page, 'tab-strip', [
    { name: 'mismatch.png', mimeType: 'image/jpeg', bytes: png(10, 10) },
  ])
  await expect(page.getByRole('status').filter({
    hasText: 'VISUAL_FILE_TYPE_MISMATCH',
  })).toBeVisible()
  const afterTypeMismatch = await readFailureBoard()
  expect(afterTypeMismatch).toEqual(beforeFailure)
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

  const importedVisual = page.waitForResponse((response) =>
    response.url().endsWith(`/api/boards/${rootBoardId}/clipboard/paste`)
    && response.request().method() === 'POST')
  await dropFiles(page, 'canvas', [
    {
      name: 'export.svg',
      mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#2563eb"/></svg>'),
    },
  ])
  expect((await importedVisual).status()).toBe(201)
  await expect.poll(async () => (await readProject(request, projectId)).boards.find((board) => board.id === rootBoardId)!.revision).toBeGreaterThan(0)
  await expect(page.getByRole('img', { name: 'export.svg' })).toBeVisible()

  for (const label of ['导出 PNG', '导出 SVG'] as const) {
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: label }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`Export target.${label.endsWith('PNG') ? 'png' : 'svg'}`)
    if (label.endsWith('PNG')) {
      const downloadPath = await download.path()
      expect(downloadPath).not.toBeNull()
      const bytes = await readFile(downloadPath!)
      const dimensions = pngDimensions(bytes)
      expect(dimensions.width).toBeGreaterThanOrEqual(120)
      expect(dimensions.height).toBeGreaterThanOrEqual(80)
      expect(dimensions.width).toBeLessThanOrEqual(4_096)
      expect(dimensions.height).toBeLessThanOrEqual(4_096)
    }
  }

  const boardPdfResponse = await request.post(`${API_BASE}/api/boards/${rootBoardId}/export.pdf`)
  const projectPdfResponse = await request.post(`${API_BASE}/api/projects/${projectId}/export.pdf`)
  expect(boardPdfResponse.ok()).toBe(true)
  expect(projectPdfResponse.ok()).toBe(true)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  expect((await pdfjs.getDocument({ data: new Uint8Array(await boardPdfResponse.body()) }).promise).numPages).toBe(1)
  expect((await pdfjs.getDocument({ data: new Uint8Array(await projectPdfResponse.body()) }).promise).numPages).toBe(2)
})
