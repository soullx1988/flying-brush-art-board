import { describe, expect, it, vi } from 'vitest'

import { ClipboardCommandClient } from './clipboard-command-client'

describe('ClipboardCommandClient', () => {
  it('calls paste, undo, and redo routes and adopts every authoritative commit', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      commandId: 'command:one',
      boardId: 'board:a',
      revision: 2,
      snapshot: { store: {} },
      idMap: {},
      createdReferenceIds: ['reference:one'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const adoptServerCommit = vi.fn()
    const client = new ClipboardCommandClient({
      fetcher,
      adoptServerCommit,
      sessionId: 'session:web-test',
    })

    await client.paste('board:a', {
      payload: {
        version: 1,
        sourceProjectId: 'project:one',
        sourceBoardId: 'board:source',
        shapes: [],
        bindings: [],
        references: [],
        assets: [],
        copiedAt: '2026-07-23T00:00:00.000Z',
      },
      expectedRevision: 1,
      placement: { viewportCenter: true },
    })
    await client.undo('command:one', 2)
    await client.redo('command:one', 3)

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/boards/board%3Aa/clipboard/paste',
      '/api/clipboard/commands/command%3Aone/undo',
      '/api/clipboard/commands/command%3Aone/redo',
    ])
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toEqual([
      expect.objectContaining({ sessionId: 'session:web-test' }),
      { expectedRevision: 2, sessionId: 'session:web-test' },
      { expectedRevision: 3, sessionId: 'session:web-test' },
    ])
    expect(adoptServerCommit).toHaveBeenCalledTimes(3)
  })
})
