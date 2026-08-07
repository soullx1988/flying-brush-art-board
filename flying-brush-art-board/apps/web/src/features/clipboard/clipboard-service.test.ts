import { describe, expect, it, vi } from 'vitest'

import type { BoardClipboardPayload } from '@infinite-board/board-core'

import { BrowserClipboardService } from './clipboard-service'

const payload: BoardClipboardPayload = {
  version: 1,
  sourceProjectId: 'project-1',
  sourceBoardId: 'board-a',
  shapes: [{ id: 'shape:one', typeName: 'shape' }],
  bindings: [],
  references: [],
  assets: [],
  copiedAt: '2026-07-23T00:00:00.000Z',
}

describe('BrowserClipboardService', () => {
  it('keeps a structured board payload in memory across board switches and mirrors it when permitted', async () => {
    let systemText = ''
    const service = new BrowserClipboardService({
      writeText: vi.fn(async (text) => {
        systemText = text
      }),
      readText: vi.fn(async () => systemText),
    })

    await service.copy(payload)
    service.onBoardActivated('board-b')

    expect(service.peek()).toEqual(payload)
    expect(await service.read()).toEqual(payload)
    expect(systemText).toContain('application/x-infinite-board-clipboard+json')
  })

  it('falls back to the in-memory payload when browser clipboard permission is denied', async () => {
    const service = new BrowserClipboardService({
      writeText: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
      readText: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
    })

    await expect(service.copy(payload)).resolves.toBeUndefined()
    expect(await service.read()).toEqual(payload)
  })

  it('imports a valid application clipboard envelope when memory is empty', async () => {
    const systemText = JSON.stringify({
      type: 'application/x-infinite-board-clipboard+json',
      payload,
    })
    const service = new BrowserClipboardService({
      writeText: vi.fn(),
      readText: vi.fn(async () => systemText),
    })

    expect(await service.read()).toEqual(payload)
    expect(service.peek()).toEqual(payload)
  })
})
