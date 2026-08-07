import { describe, expect, it, vi } from 'vitest'

import {
  createDropImportController,
  dispatchDroppedFiles,
} from './DropImportController'

describe('DropImportController', () => {
  it('routes .iboard drops from every app target into the same inspect pipeline', async () => {
    const onIboard = vi.fn()
    const controller = createDropImportController({
      onIboard,
      onTldr: vi.fn(),
      onDrawio: vi.fn(),
      onVisual: vi.fn(),
      onUnsupported: vi.fn(),
    })

    for (const target of ['tab-strip', 'canvas', 'new-tab', 'global'] as const) {
      const file = new File([new Uint8Array([1])], `fixture-${target}.iboard`)
      await controller.dispatch([file], target)
      expect(onIboard).toHaveBeenLastCalledWith(file, target)
    }
    expect(onIboard).toHaveBeenCalledTimes(4)
  })

  it('routes every .tldr file to one new-board import regardless of drop target', async () => {
    const onTldr = vi.fn()
    const controller = createDropImportController({
      onIboard: vi.fn(),
      onTldr,
      onDrawio: vi.fn(),
      onVisual: vi.fn(),
      onUnsupported: vi.fn(),
    })

    for (const target of ['tab-strip', 'canvas', 'new-tab', 'global'] as const) {
      const files = [
        new File(['one'], `one-${target}.tldr`, { type: 'application/json' }),
        new File(['two'], `two-${target}.tldr`, { type: 'application/octet-stream' }),
      ]
      const previousCalls = onTldr.mock.calls.length
      await controller.dispatch(files, target)
      expect(onTldr).toHaveBeenNthCalledWith(previousCalls + 1, files[0], target)
      expect(onTldr).toHaveBeenNthCalledWith(previousCalls + 2, files[1], target)
    }
    expect(onTldr).toHaveBeenCalledTimes(8)
  })

  it('routes every .drawio file to one new-board import regardless of drop target', async () => {
    const onDrawio = vi.fn()
    const controller = createDropImportController({
      onIboard: vi.fn(),
      onTldr: vi.fn(),
      onDrawio,
      onVisual: vi.fn(),
      onUnsupported: vi.fn(),
    })

    for (const target of ['tab-strip', 'canvas', 'new-tab', 'global'] as const) {
      const file = new File(['<mxGraphModel/>'], `fixture-${target}.drawio`, { type: 'application/xml' })
      await controller.dispatch([file], target)
      expect(onDrawio).toHaveBeenLastCalledWith(file, target)
    }
    expect(onDrawio).toHaveBeenCalledTimes(4)
  })

  it('rejects multiple project archives and unsupported formats without opening a session', async () => {
    const onIboard = vi.fn()
    const onUnsupported = vi.fn()
    const controller = createDropImportController({
      onIboard,
      onTldr: vi.fn(),
      onDrawio: vi.fn(),
      onVisual: vi.fn(),
      onUnsupported,
    })

    await controller.dispatch([
      new File(['x'], 'one.iboard'),
      new File(['y'], 'two.iboard'),
    ], 'canvas')
    await controller.dispatch([
      new File(['x'], 'drawing.bmp', { type: 'image/bmp' }),
    ], 'tab-strip')

    expect(onIboard).not.toHaveBeenCalled()
    expect(onUnsupported).toHaveBeenNthCalledWith(1, expect.stringContaining('IBOARD_SINGLE_FILE_REQUIRED'))
    expect(onUnsupported).toHaveBeenNthCalledWith(2, expect.stringContaining('UNSUPPORTED_FILE_TYPE'))
  })

  it('routes visual files by MIME and extension, maps canvas drops to the active Board, and rejects no-active-Board atomically', async () => {
    const onVisual = vi.fn(async () => ({
      fileName: 'image.png',
      status: 'success' as const,
      createdBoard: false,
    }))
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })
    const handlers = {
      onIboard: vi.fn(),
      onTldr: vi.fn(),
      onDrawio: vi.fn(),
      onVisual,
      onUnsupported: vi.fn(),
    }

    const success = await dispatchDroppedFiles(
      [file],
      { kind: 'canvas', dropPoint: { x: 20, y: 30 } },
      { projectId: 'project-1', boardId: 'board-1' },
      handlers,
    )
    const failure = await dispatchDroppedFiles(
      [file],
      { kind: 'canvas', dropPoint: { x: 20, y: 30 } },
      { projectId: 'project-1' },
      handlers,
    )

    expect(onVisual).toHaveBeenCalledWith({
      file,
      target: { kind: 'current-board', boardId: 'board-1', dropPoint: { x: 20, y: 30 } },
    })
    expect(success[0]).toMatchObject({ status: 'success' })
    expect(failure[0]).toEqual({ fileName: 'image.png', status: 'error', code: 'NO_ACTIVE_BOARD' })
    expect(onVisual).toHaveBeenCalledTimes(1)
  })

  it('processes mixed visual files in user order as independent transactions and keeps later successes after a failure', async () => {
    const order: string[] = []
    const onVisual = vi.fn(async ({ file }: { file: File }) => {
      order.push(file.name)
      if (file.name === 'bad.svg') throw new Error('SVG_UNSAFE')
      return { fileName: file.name, status: 'success' as const, createdBoard: true }
    })
    const files = [
      new File(['png'], 'one.png', { type: 'image/png' }),
      new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }),
      new File(['webp'], 'three.webp', { type: 'image/webp' }),
    ]

    const results = await dispatchDroppedFiles(
      files,
      { kind: 'new-tab' },
      { projectId: 'project-1', boardId: 'board-1' },
      {
        onIboard: vi.fn(),
        onTldr: vi.fn(),
        onDrawio: vi.fn(),
        onVisual,
        onUnsupported: vi.fn(),
      },
    )

    expect(order).toEqual(['one.png', 'bad.svg', 'three.webp'])
    expect(results.map((result) => result.status)).toEqual(['success', 'error', 'success'])
  })
})
