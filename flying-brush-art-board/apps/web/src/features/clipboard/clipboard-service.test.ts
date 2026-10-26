import { describe, expect, it, vi } from 'vitest'

import type { BoardClipboardPayload } from '@infinite-board/board-core'

import {
  BOARD_CLIPBOARD_MIME,
  BrowserClipboardService,
  type ClipboardDataReader,
} from './clipboard-service'

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

const replacementPayload: BoardClipboardPayload = {
  ...payload,
  sourceBoardId: 'board-b',
  shapes: [{ id: 'shape:two', typeName: 'shape' }],
  copiedAt: '2026-08-04T00:00:00.000Z',
}

function clipboardData(
  values: Readonly<Record<string, string>>,
  options: { files?: number; items?: number } = {},
): ClipboardDataReader {
  return {
    types: Object.keys(values),
    files: { length: options.files ?? 0 },
    items: { length: options.items ?? 0 },
    getData: (type) => values[type] ?? '',
  }
}

describe('BrowserClipboardService', () => {
  it('writes structured data synchronously during the native copy event', () => {
    const values: Record<string, string> = {}
    const service = new BrowserClipboardService(undefined)

    expect(service.writeToClipboardData({
      setData: (type, value) => {
        values[type] = value
      },
    }, payload)).toBe(true)

    expect(JSON.parse(values['text/plain'] ?? '{}')).toEqual({
      type: BOARD_CLIPBOARD_MIME,
      payload,
    })
    expect(values[BOARD_CLIPBOARD_MIME]).toBe(values['text/plain'])
    expect(service.peek()).toEqual(payload)
  })

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

  it('parses an application envelope from paste event text and refreshes memory', async () => {
    const service = new BrowserClipboardService(undefined)
    await service.copy(payload)
    const data = clipboardData({
      'text/plain': JSON.stringify({
        type: BOARD_CLIPBOARD_MIME,
        payload: replacementPayload,
      }),
    })

    expect(service.readFromClipboardData(data)).toEqual(replacementPayload)
    expect(service.peek()).toEqual(replacementPayload)
  })

  it('clears stale memory when the paste event contains external text', async () => {
    const service = new BrowserClipboardService(undefined)
    await service.copy(payload)

    expect(service.readFromClipboardData(clipboardData({ 'text/plain': 'external text' }))).toBeUndefined()
    expect(service.peek()).toBeUndefined()
  })

  it('falls back to memory only when the paste event contains no data', async () => {
    const service = new BrowserClipboardService(undefined)
    await service.copy(payload)

    expect(service.readFromClipboardData(clipboardData({}))).toEqual(payload)
    expect(service.peek()).toEqual(payload)
  })

  it('treats invalid JSON as current external clipboard content', async () => {
    const service = new BrowserClipboardService(undefined)
    await service.copy(payload)

    expect(service.readFromClipboardData(clipboardData({ 'text/plain': '{not-json' }))).toBeUndefined()
    expect(service.peek()).toBeUndefined()
  })

  it('treats explicitly copied blank text as current external clipboard content', async () => {
    const service = new BrowserClipboardService(undefined)
    await service.copy(payload)

    expect(service.readFromClipboardData(clipboardData({ 'text/plain': '   ' }))).toBeUndefined()
    expect(service.peek()).toBeUndefined()
  })
})
