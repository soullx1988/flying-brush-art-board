import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { BoardClipboardPayload } from '@infinite-board/board-core'

import {
  MAX_VISUAL_PDF_PAGES,
  VisualImportError,
  exportBoardAsPng,
  exportBoardAsSvg,
  importVisualFile,
  type VisualImportDependencies,
} from './visual-import'

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

function dependencies(overrides: Partial<VisualImportDependencies> = {}): VisualImportDependencies {
  return {
    uploadAsset: vi.fn(async ({ bytes, mime }) => ({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mime,
      size: bytes.byteLength,
    })),
    createBoardWithVisuals: vi.fn(async ({ board, payload }) => ({
      boardId: board.id,
      revision: 1,
      snapshot: { payload },
    })),
    pasteVisuals: vi.fn(async ({ boardId, payload }) => ({
      boardId,
      revision: 2,
      snapshot: { payload },
    })),
    ...overrides,
  }
}

function payloadFrom(mock: ReturnType<typeof vi.fn>): BoardClipboardPayload {
  return mock.mock.calls[0]![0].payload as BoardClipboardPayload
}

describe('visual import', () => {
  it('validates and creates one asset-backed Board for a raster image at the new-Board origin', async () => {
    const deps = dependencies()
    const file = new File([png(640, 360).buffer as ArrayBuffer], 'hero.png', { type: 'image/png' })

    const result = await importVisualFile({
      file,
      target: { kind: 'new-board', projectId: 'project-1' },
    }, deps)

    expect(result).toMatchObject({ createdBoard: true, shapeCount: 1, rasterized: false })
    expect(deps.uploadAsset).toHaveBeenCalledOnce()
    expect(deps.createBoardWithVisuals).toHaveBeenCalledOnce()
    const payload = payloadFrom(deps.createBoardWithVisuals as ReturnType<typeof vi.fn>)
    expect(payload.shapes).toEqual([
      expect.objectContaining({
        type: 'image',
        x: 0,
        y: 0,
        props: expect.objectContaining({ w: 640, h: 360 }),
      }),
    ])
    expect(payload.assets).toEqual([
      expect.objectContaining({ mime: 'image/png', size: file.size }),
    ])
  })

  it('rasterizes all PDF pages before uploading and lays one insertion batch top-to-bottom at the drop point', async () => {
    const renderPdfPages = vi.fn(async () => [
      { bytes: png(600, 800), width: 600, height: 800, mime: 'image/png' as const },
      { bytes: png(600, 900), width: 600, height: 900, mime: 'image/png' as const },
    ])
    const deps = dependencies({ renderPdfPages })

    const result = await importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'two-pages.pdf', { type: 'application/pdf' }),
      target: {
        kind: 'current-board',
        boardId: 'board-current',
        dropPoint: { x: 125, y: 250 },
        pageId: 'page:non-default',
      },
    }, deps)

    expect(result).toMatchObject({ createdBoard: false, shapeCount: 2, rasterized: true })
    expect(renderPdfPages).toHaveBeenCalledOnce()
    expect(deps.uploadAsset).toHaveBeenCalledTimes(2)
    expect(deps.pasteVisuals).toHaveBeenCalledOnce()
    const call = (deps.pasteVisuals as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.placement).toEqual({ x: 125, y: 250 })
    expect(call.payload.shapes).toEqual([
      expect.objectContaining({ parentId: 'page:non-default', y: 0, meta: expect.objectContaining({ rasterized: true, pageNumber: 1 }) }),
      expect.objectContaining({ parentId: 'page:non-default', y: 832, meta: expect.objectContaining({ rasterized: true, pageNumber: 2 }) }),
    ])
  })

  it('accepts 50 PDF pages and rejects page 51 before uploading any asset', async () => {
    const page = { bytes: png(10, 10), width: 10, height: 10, mime: 'image/png' as const }
    const atLimit = dependencies({
      renderPdfPages: vi.fn(async () => Array.from({ length: MAX_VISUAL_PDF_PAGES }, () => page)),
    })
    const accepted = await importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'fifty-pages.pdf', { type: 'application/pdf' }),
      target: { kind: 'current-board', boardId: 'board-current', dropPoint: { x: 0, y: 0 } },
    }, atLimit)

    expect(accepted.shapeCount).toBe(50)
    expect(atLimit.uploadAsset).toHaveBeenCalledTimes(50)
    expect(atLimit.pasteVisuals).toHaveBeenCalledOnce()

    const overLimit = dependencies({
      renderPdfPages: vi.fn(async () => Array.from({ length: MAX_VISUAL_PDF_PAGES + 1 }, () => page)),
    })
    await expect(importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'fifty-one-pages.pdf', { type: 'application/pdf' }),
      target: { kind: 'current-board', boardId: 'board-current', dropPoint: { x: 0, y: 0 } },
    }, overLimit)).rejects.toThrow('PDF_PAGE_LIMIT_EXCEEDED')
    expect(overLimit.uploadAsset).not.toHaveBeenCalled()
    expect(overLimit.pasteVisuals).not.toHaveBeenCalled()
  })

  it('finishes preparing every PDF page before the caller flushes and persistence begins', async () => {
    const order: string[] = []
    const deps = dependencies({
      renderPdfPages: vi.fn(async () => {
        order.push('render-all-pages')
        return [
          { bytes: png(600, 800), width: 600, height: 800, mime: 'image/png' as const },
          { bytes: png(600, 900), width: 600, height: 900, mime: 'image/png' as const },
        ]
      }),
      uploadAsset: vi.fn(async ({ bytes, mime }) => {
        order.push('upload')
        return {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          mime,
          size: bytes.byteLength,
        }
      }),
      pasteVisuals: vi.fn(async ({ boardId, payload }) => {
        order.push('paste')
        return { boardId, revision: 2, snapshot: { payload } }
      }),
    })

    await importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'two-pages.pdf', { type: 'application/pdf' }),
      target: {
        kind: 'current-board',
        boardId: 'board-current',
        dropPoint: { x: 125, y: 250 },
      },
    }, deps, {
      beforePersist: async () => {
        order.push('before-persist')
      },
    })

    expect(order).toEqual([
      'render-all-pages',
      'upload',
      'upload',
      'before-persist',
      'paste',
    ])
  })

  it('does not upload or mutate a Board when any PDF page fails to render', async () => {
    const beforePersist = vi.fn()
    const deps = dependencies({
      renderPdfPages: vi.fn(async () => {
        throw new VisualImportError('PDF_PAGE_RENDER_FAILED')
      }),
    })

    await expect(importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'broken.pdf', { type: 'application/pdf' }),
      target: { kind: 'new-board', projectId: 'project-1' },
    }, deps, { beforePersist })).rejects.toThrow('PDF_PAGE_RENDER_FAILED')

    expect(beforePersist).not.toHaveBeenCalled()
    expect(deps.uploadAsset).not.toHaveBeenCalled()
    expect(deps.createBoardWithVisuals).not.toHaveBeenCalled()
    expect(deps.pasteVisuals).not.toHaveBeenCalled()
  })

  it('discards newly created uploads when a later PDF page upload fails', async () => {
    const firstUpload = { sha256: 'a'.repeat(64), mime: 'image/png' as const, size: 33, created: true }
    const discardAsset = vi.fn(async () => undefined)
    const deps = dependencies({
      renderPdfPages: vi.fn(async () => [
        { bytes: png(600, 800), width: 600, height: 800, mime: 'image/png' as const },
        { bytes: png(600, 900), width: 600, height: 900, mime: 'image/png' as const },
      ]),
      uploadAsset: vi.fn()
        .mockResolvedValueOnce(firstUpload)
        .mockRejectedValueOnce(new VisualImportError('ASSET_UPLOAD_FAILED')),
      discardAsset,
    })

    await expect(importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'two-pages.pdf', { type: 'application/pdf' }),
      target: { kind: 'current-board', boardId: 'board-current', dropPoint: { x: 0, y: 0 } },
    }, deps)).rejects.toThrow('ASSET_UPLOAD_FAILED')

    expect(discardAsset).toHaveBeenCalledExactlyOnceWith(firstUpload.sha256)
    expect(deps.pasteVisuals).not.toHaveBeenCalled()
  })

  it('discards all newly created uploads when the final clipboard command conflicts', async () => {
    const firstUpload = { sha256: 'a'.repeat(64), mime: 'image/png' as const, size: 33, created: true }
    const deduplicatedUpload = { sha256: 'b'.repeat(64), mime: 'image/png' as const, size: 33, created: false }
    const discardAsset = vi.fn(async () => undefined)
    const deps = dependencies({
      renderPdfPages: vi.fn(async () => [
        { bytes: png(600, 800), width: 600, height: 800, mime: 'image/png' as const },
        { bytes: png(600, 900), width: 600, height: 900, mime: 'image/png' as const },
      ]),
      uploadAsset: vi.fn()
        .mockResolvedValueOnce(firstUpload)
        .mockResolvedValueOnce(deduplicatedUpload),
      pasteVisuals: vi.fn(async () => {
        throw new VisualImportError('REVISION_CONFLICT')
      }),
      discardAsset,
    })

    await expect(importVisualFile({
      file: new File(['%PDF-1.7 fixture'], 'two-pages.pdf', { type: 'application/pdf' }),
      target: { kind: 'current-board', boardId: 'board-current', dropPoint: { x: 0, y: 0 } },
    }, deps)).rejects.toThrow('REVISION_CONFLICT')

    expect(discardAsset).toHaveBeenCalledExactlyOnceWith(firstUpload.sha256)
  })

  it('rejects MIME/extension mismatches and pixel-limit violations before persistence', async () => {
    const deps = dependencies()
    await expect(importVisualFile({
      file: new File([png(10, 10).buffer as ArrayBuffer], 'fake.jpg', { type: 'image/png' }),
      target: { kind: 'new-board', projectId: 'project-1' },
    }, deps)).rejects.toThrow('VISUAL_FILE_TYPE_MISMATCH')
    await expect(importVisualFile({
      file: new File([png(11_000, 10_000).buffer as ArrayBuffer], 'huge.png', { type: 'image/png' }),
      target: { kind: 'new-board', projectId: 'project-1' },
    }, deps)).rejects.toThrow('VISUAL_PIXEL_LIMIT_EXCEEDED')
    expect(deps.uploadAsset).not.toHaveBeenCalled()
  })
})

describe('visual export', () => {
  it('exports all shapes or only the current selection through tldraw image export', async () => {
    const toImage = vi.fn(async (_ids, options) => ({
      blob: new Blob([options.format], { type: options.format === 'svg' ? 'image/svg+xml' : 'image/png' }),
      width: 100,
      height: 100,
    }))
    const editor = {
      getCurrentPageShapesSorted: () => [{ id: 'shape:one' }, { id: 'shape:two' }],
      getSelectedShapeIds: () => ['shape:two'],
      toImage,
    }

    await exportBoardAsPng(editor as never, false)
    await exportBoardAsSvg(editor as never, true)

    expect(toImage).toHaveBeenNthCalledWith(1, ['shape:one', 'shape:two'], expect.objectContaining({ format: 'png' }))
    expect(toImage).toHaveBeenNthCalledWith(2, ['shape:two'], expect.objectContaining({ format: 'svg' }))
  })
})
