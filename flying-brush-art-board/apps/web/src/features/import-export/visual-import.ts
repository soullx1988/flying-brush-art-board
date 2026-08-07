import type { BoardClipboardPayload, ClipboardAsset } from '@infinite-board/board-core'
import { sanitizeSvg } from '@infinite-board/interop/visual/sanitize-svg'
import { createBoardStore, getStoreSnapshot } from '@infinite-board/tldraw-adapter'
import type { Editor, TLShapeId } from 'tldraw'
import { createBrowserUuid } from '../../app/browser-uuid'

export const MAX_VISUAL_FILE_BYTES = 25 * 1024 * 1024
export const MAX_VISUAL_DIMENSION = 16_384
export const MAX_VISUAL_TOTAL_PIXELS = 100_000_000
export const MAX_VISUAL_PDF_PAGES = 50
export const PDF_PAGE_GAP = 32

export type VisualImportInput = {
  file: File
  target:
    | { kind: 'new-board'; projectId: string }
    | { kind: 'current-board'; boardId: string; dropPoint: { x: number; y: number }; pageId?: string }
}

export interface PreparedVisualPage {
  bytes: Uint8Array
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
}

export interface UploadedVisualAsset {
  sha256: string
  mime: PreparedVisualPage['mime']
  size: number
  created?: boolean
}

export interface VisualImportCommit {
  boardId: string
  revision: number
  snapshot: unknown
}

export interface VisualImportDependencies {
  uploadAsset(input: {
    bytes: Uint8Array
    mime: PreparedVisualPage['mime']
  }): Promise<UploadedVisualAsset>
  discardAsset?(sha256: string): Promise<void>
  createBoardWithVisuals(input: {
    projectId: string
    board: { id: string; title: string; initialSnapshot: unknown }
    payload: BoardClipboardPayload
  }): Promise<VisualImportCommit>
  pasteVisuals(input: {
    boardId: string
    payload: BoardClipboardPayload
    placement: { x: number; y: number }
  }): Promise<VisualImportCommit>
  renderPdfPages?(bytes: Uint8Array): Promise<PreparedVisualPage[]>
}

export interface VisualImportOptions {
  beforePersist?(): void | Promise<void>
}

export interface VisualImportResult extends VisualImportCommit {
  fileName: string
  createdBoard: boolean
  shapeCount: number
  rasterized: boolean
}

export class VisualImportError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'VisualImportError'
  }
}

type VisualMime = PreparedVisualPage['mime'] | 'application/pdf'

const EXTENSION_MIME = new Map<string, VisualMime>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.pdf', 'application/pdf'],
])

function randomId(prefix: string): string {
  return `${prefix}-${createBrowserUuid()}`
}

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.[^.]+$/)
  return match?.[0] ?? ''
}

function assertFileType(file: File): VisualMime {
  const expectedMime = EXTENSION_MIME.get(extensionOf(file.name))
  if (!expectedMime || file.type.toLowerCase() !== expectedMime) {
    throw new VisualImportError('VISUAL_FILE_TYPE_MISMATCH')
  }
  if (file.size > MAX_VISUAL_FILE_BYTES) {
    throw new VisualImportError('VISUAL_FILE_SIZE_LIMIT_EXCEEDED')
  }
  return expectedMime
}

async function fileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FILE_READ_FAILED'))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(file)
  })
}

function assertPixelLimits(width: number, height: number, currentPixels = 0): number {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_VISUAL_DIMENSION
    || height > MAX_VISUAL_DIMENSION
  ) {
    throw new VisualImportError('VISUAL_DIMENSION_LIMIT_EXCEEDED')
  }
  const nextPixels = currentPixels + width * height
  if (!Number.isSafeInteger(nextPixels) || nextPixels > MAX_VISUAL_TOTAL_PIXELS) {
    throw new VisualImportError('VISUAL_PIXEL_LIMIT_EXCEEDED')
  }
  return nextPixels
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.byteLength < 24 || !signature.every((value, index) => bytes[index] === value)) {
    throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
  }
  let offset = 2
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.byteLength) break
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      }
    }
    offset += length
  }
  throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length))
  if (bytes.byteLength < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') {
    throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
  }
  const chunk = ascii(12, 4)
  if (chunk === 'VP8X') {
    return {
      width: uint24LittleEndian(bytes, 24) + 1,
      height: uint24LittleEndian(bytes, 27) + 1,
    }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
    const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    }
  }
  throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
}

function svgDimensions(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? ''
  const numeric = (name: string) => {
    const value = root.match(new RegExp(`\\b${name}=["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`, 'i'))?.[1]
    return value ? Math.ceil(Number(value)) : undefined
  }
  let width = numeric('width')
  let height = numeric('height')
  const viewBox = root.match(/\bviewBox=["']\s*[-+0-9.e]+[ ,]+[-+0-9.e]+[ ,]+([-+0-9.e]+)[ ,]+([-+0-9.e]+)\s*["']/i)
  width ??= viewBox?.[1] ? Math.ceil(Number(viewBox[1])) : 300
  height ??= viewBox?.[2] ? Math.ceil(Number(viewBox[2])) : 150
  return { width, height }
}

function assertPdfSignature(bytes: Uint8Array): void {
  if (new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new VisualImportError('VISUAL_FILE_CONTENT_INVALID')
  }
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('CANVAS_PNG_FAILED')), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

async function renderPdfPages(bytes: Uint8Array): Promise<PreparedVisualPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
  try {
    loadingTask = pdfjs.getDocument({ data: bytes })
    document = await loadingTask.promise
  } catch {
    throw new VisualImportError('PDF_DOCUMENT_INVALID')
  }
  if (document.numPages < 1 || document.numPages > MAX_VISUAL_PDF_PAGES) {
    throw new VisualImportError('PDF_PAGE_LIMIT_EXCEEDED')
  }

  const pageDescriptors: Array<{ page: Awaited<ReturnType<typeof document.getPage>>; width: number; height: number }> = []
  let totalPixels = 0
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    totalPixels = assertPixelLimits(width, height, totalPixels)
    pageDescriptors.push({ page, width, height })
  }

  const pages: PreparedVisualPage[] = []
  try {
    for (const descriptor of pageDescriptors) {
      const canvas = documentOwner().createElement('canvas')
      canvas.width = descriptor.width
      canvas.height = descriptor.height
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE')
      await descriptor.page.render({
        canvas,
        canvasContext: context,
        viewport: descriptor.page.getViewport({ scale: 2 }),
      }).promise
      pages.push({
        bytes: await canvasPng(canvas),
        width: descriptor.width,
        height: descriptor.height,
        mime: 'image/png',
      })
      descriptor.page.cleanup()
    }
  } catch {
    throw new VisualImportError('PDF_PAGE_RENDER_FAILED')
  } finally {
    await loadingTask?.destroy()
  }
  return pages
}

function documentOwner(): Document {
  if (typeof document === 'undefined') throw new VisualImportError('PDF_RENDERING_UNAVAILABLE')
  return document
}

async function preparePages(
  file: File,
  mime: VisualMime,
  dependencies: VisualImportDependencies,
): Promise<PreparedVisualPage[]> {
  const bytes = await fileBytes(file)
  if (mime === 'application/pdf') {
    assertPdfSignature(bytes)
    const pages = await (dependencies.renderPdfPages ?? renderPdfPages)(bytes)
    if (pages.length < 1 || pages.length > MAX_VISUAL_PDF_PAGES) {
      throw new VisualImportError('PDF_PAGE_LIMIT_EXCEEDED')
    }
    let pixels = 0
    for (const page of pages) pixels = assertPixelLimits(page.width, page.height, pixels)
    return pages
  }
  if (mime === 'image/svg+xml') {
    const sanitized = sanitizeSvg(new TextDecoder().decode(bytes))
    const sanitizedBytes = new TextEncoder().encode(sanitized.svg)
    const dimensions = svgDimensions(sanitized.svg)
    assertPixelLimits(dimensions.width, dimensions.height)
    return [{ bytes: sanitizedBytes, ...dimensions, mime }]
  }
  const dimensions = mime === 'image/png'
    ? pngDimensions(bytes)
    : mime === 'image/jpeg'
      ? jpegDimensions(bytes)
      : webpDimensions(bytes)
  assertPixelLimits(dimensions.width, dimensions.height)
  return [{ bytes, ...dimensions, mime }]
}

function initialSnapshot(): unknown {
  return getStoreSnapshot(createBoardStore())
}

function pageIdFromSnapshot(snapshot: unknown): string {
  const value = snapshot as { store?: Record<string, { typeName?: unknown }> }
  return Object.entries(value.store ?? {}).find(([, record]) => record.typeName === 'page')?.[0]
    ?? 'page:page'
}

function visualPayload(
  file: File,
  pages: readonly PreparedVisualPage[],
  uploads: readonly UploadedVisualAsset[],
  sourceProjectId: string,
  sourceBoardId: string,
  parentId: string,
  rasterized: boolean,
): BoardClipboardPayload {
  let y = 0
  const shapes: Record<string, unknown>[] = []
  const assets: ClipboardAsset[] = []
  for (const [index, page] of pages.entries()) {
    const uploaded = uploads[index]!
    const assetRecordId = `asset:${randomId('visual')}`
    const shapeId = `shape:${randomId('visual')}`
    const pageNumber = index + 1
    const name = pages.length === 1 ? file.name : `${file.name} - page ${pageNumber}`
    shapes.push({
      id: shapeId,
      typeName: 'shape',
      type: 'image',
      parentId,
      index: `a${String(pageNumber).padStart(4, '0')}`,
      x: 0,
      y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      props: {
        w: page.width,
        h: page.height,
        assetId: assetRecordId,
        playing: true,
        url: '',
        crop: null,
        flipX: false,
        flipY: false,
        altText: name,
      },
      meta: {
        visualImport: true,
        sourceMime: file.type,
        rasterized,
        pageNumber,
      },
    })
    const record = {
      id: assetRecordId,
      typeName: 'asset',
      type: 'image',
      props: {
        w: page.width,
        h: page.height,
        name,
        isAnimated: false,
        mimeType: page.mime,
        src: `/api/assets/${uploaded.sha256}`,
      },
      meta: { visualImport: true, rasterized, pageNumber, sha256: uploaded.sha256 },
    }
    assets.push({
      assetRecordId,
      sha256: uploaded.sha256,
      mime: uploaded.mime,
      size: uploaded.size,
      record,
      sourceUrl: `/api/assets/${uploaded.sha256}`,
    })
    y += page.height + PDF_PAGE_GAP
  }
  return {
    version: 1,
    sourceProjectId,
    sourceBoardId,
    shapes,
    bindings: [],
    references: [],
    assets,
    copiedAt: new Date().toISOString(),
  }
}

function boardTitle(fileName: string): string {
  return fileName.replace(/\.(?:png|jpe?g|webp|svg|pdf)$/i, '').trim() || '导入的视觉内容'
}

async function responseJson<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>
  const body = await response.json().catch(() => ({})) as { code?: string }
  throw new VisualImportError(body.code ?? `HTTP_${response.status}`)
}

const defaultSessionId = createBrowserUuid()

const browserDependencies: VisualImportDependencies = {
  async uploadAsset({ bytes, mime }) {
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.readAsDataURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }))
    })
    return responseJson(await fetch('/api/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime, base64 }),
    }))
  },
  async discardAsset(sha256) {
    const response = await fetch(`/api/assets/${encodeURIComponent(sha256)}`, { method: 'DELETE' })
    if (!response.ok) await responseJson(response)
  },
  async createBoardWithVisuals({ projectId, board, payload }) {
    const result = await responseJson<{ board: { id: string; revision: number; tldrawSnapshot: unknown } }>(
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/boards/clipboard-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          board: { id: board.id, title: board.title, tldrawSnapshot: board.initialSnapshot },
          payload,
          sessionId: defaultSessionId,
        }),
      }),
    )
    return {
      boardId: result.board.id,
      revision: result.board.revision,
      snapshot: result.board.tldrawSnapshot,
    }
  },
  async pasteVisuals({ boardId, payload, placement }) {
    const board = await responseJson<{ revision: number }>(
      await fetch(`/api/boards/${encodeURIComponent(boardId)}`),
    )
    return responseJson(await fetch(`/api/boards/${encodeURIComponent(boardId)}/clipboard/paste`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payload,
        expectedRevision: board.revision,
        sessionId: defaultSessionId,
        placement,
      }),
    }))
  },
}

export async function importVisualFile(
  input: VisualImportInput,
  dependencies: VisualImportDependencies = browserDependencies,
  options: VisualImportOptions = {},
): Promise<VisualImportResult> {
  const mime = assertFileType(input.file)
  const pages = await preparePages(input.file, mime, dependencies)
  await options.beforePersist?.()
  const uploads: UploadedVisualAsset[] = []
  try {
    for (const page of pages) {
      uploads.push(await dependencies.uploadAsset({ bytes: page.bytes, mime: page.mime }))
    }
    const rasterized = mime === 'application/pdf'

    if (input.target.kind === 'new-board') {
      const snapshot = initialSnapshot()
      const boardId = randomId('board')
      const payload = visualPayload(
        input.file,
        pages,
        uploads,
        input.target.projectId,
        boardId,
        pageIdFromSnapshot(snapshot),
        rasterized,
      )
      const commit = await dependencies.createBoardWithVisuals({
        projectId: input.target.projectId,
        board: { id: boardId, title: boardTitle(input.file.name), initialSnapshot: snapshot },
        payload,
      })
      return {
        ...commit,
        fileName: input.file.name,
        createdBoard: true,
        shapeCount: pages.length,
        rasterized,
      }
    }

    const payload = visualPayload(
      input.file,
      pages,
      uploads,
      'visual-import',
      input.target.boardId,
      input.target.pageId ?? 'page:page',
      rasterized,
    )
    const commit = await dependencies.pasteVisuals({
      boardId: input.target.boardId,
      payload,
      placement: input.target.dropPoint,
    })
    return {
      ...commit,
      fileName: input.file.name,
      createdBoard: false,
      shapeCount: pages.length,
      rasterized,
    }
  } catch (error) {
    const createdHashes = [...new Set(uploads.filter((asset) => asset.created).map((asset) => asset.sha256))]
    await Promise.allSettled(createdHashes.map((sha256) => dependencies.discardAsset?.(sha256)))
    throw error
  }
}

function exportShapeIds(editor: Editor, selectionOnly: boolean): TLShapeId[] {
  const ids = selectionOnly
    ? [...editor.getSelectedShapeIds()]
    : editor.getCurrentPageShapesSorted().map((shape) => shape.id)
  if (ids.length === 0) throw new VisualImportError('NO_SHAPES_TO_EXPORT')
  return ids
}

export async function exportBoardAsPng(editor: Editor, selectionOnly: boolean): Promise<Blob> {
  return (await editor.toImage(exportShapeIds(editor, selectionOnly), {
    format: 'png',
    background: true,
    pixelRatio: 2,
  })).blob
}

export async function exportBoardAsSvg(editor: Editor, selectionOnly: boolean): Promise<Blob> {
  return (await editor.toImage(exportShapeIds(editor, selectionOnly), {
    format: 'svg',
    background: true,
  })).blob
}
