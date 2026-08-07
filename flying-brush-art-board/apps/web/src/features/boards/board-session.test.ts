import { createElement } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BoardSession,
  BoardSessionConflictError,
  type BoardEditor,
  type BoardSessionApi,
} from './board-session'
import { SaveStatus } from './SaveStatus'
import { useBoardSession } from './use-board-session'

class FakeEditor implements BoardEditor {
  private snapshot: unknown
  private readonly listeners = new Set<() => void>()

  constructor(snapshot: unknown) {
    this.snapshot = snapshot
  }

  getSnapshot(): unknown {
    return this.snapshot
  }

  loadSnapshot(snapshot: unknown): void {
    this.snapshot = snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  edit(snapshot: unknown): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

function createApi(snapshot: unknown = { shapes: [] }, revision = 3) {
  const saves: Array<{ boardId: string; expectedRevision: number; snapshot: unknown }> = []
  const api: BoardSessionApi = {
    loadBoard: vi.fn(async () => ({ snapshot, revision })),
    saveSnapshot: vi.fn(async (boardId, expectedRevision, nextSnapshot) => {
      saves.push({ boardId, expectedRevision, snapshot: nextSnapshot })
      revision += 1
      snapshot = nextSnapshot
      return { snapshot, revision }
    }),
  }
  return { api, saves }
}

describe('BoardSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces editor changes for 800ms before saving with CAS', async () => {
    const { api, saves } = createApi()
    const editor = new FakeEditor({ shapes: [] })
    const session = new BoardSession({ api })
    await session.mount('tab-a', 'board-a', editor)

    editor.edit({ shapes: [{ id: 'one' }] })
    await vi.advanceTimersByTimeAsync(799)
    expect(saves).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(saves).toEqual([
      {
        boardId: 'board-a',
        expectedRevision: 3,
        snapshot: { shapes: [{ id: 'one' }] },
      },
    ])
    expect(session.status).toBe('clean')
    expect(session.currentRevision).toBe(4)
  })

  it('flushes immediately before navigation, page close, and reference entry', async () => {
    const { api, saves } = createApi()
    const editor = new FakeEditor({ shapes: [] })
    const session = new BoardSession({ api })
    await session.mount('tab-a', 'board-a', editor)

    editor.edit({ route: 1 })
    await session.flushBeforeNavigation()
    editor.edit({ close: 2 })
    await session.flushBeforeClose()
    editor.edit({ reference: 3 })
    await session.flushBeforeReferenceEntry()

    expect(saves.map((save) => save.snapshot)).toEqual([
      { route: 1 },
      { close: 2 },
      { reference: 3 },
    ])
  })

  it('waits for the realtime projection before allowing a structural command', async () => {
    const initial = { store: { 'shape:one': { id: 'shape:one', typeName: 'shape', x: 10 } } }
    const latest = { store: { 'shape:one': { id: 'shape:one', typeName: 'shape', x: 90 } } }
    const api: BoardSessionApi = {
      loadBoard: vi.fn()
        .mockResolvedValueOnce({ snapshot: initial, revision: 3 })
        .mockResolvedValueOnce({ snapshot: initial, revision: 3 })
        .mockResolvedValueOnce({ snapshot: latest, revision: 3 }),
      saveSnapshot: vi.fn(),
    }
    const editor = new FakeEditor(initial)
    const session = new BoardSession({
      api,
      mode: 'realtime',
      waitForRealtimeSync: async () => undefined,
    })
    await session.mount('tab-a', 'board-a', editor)
    editor.edit(latest)

    await expect(session.flushBeforeClose()).resolves.toEqual({
      ok: true,
      snapshot: latest,
      revision: 3,
    })
    expect(api.loadBoard).toHaveBeenCalledTimes(3)
    expect(api.saveSnapshot).not.toHaveBeenCalled()
    expect(editor.getSnapshot()).toEqual(latest)
  })

  it('closes a clean realtime tab without waiting for a WebSocket projection', async () => {
    const api: BoardSessionApi = {
      loadBoard: vi.fn().mockResolvedValue({ snapshot: { store: {} }, revision: 2 }),
      saveSnapshot: vi.fn(),
    }
    const session = new BoardSession({ api, mode: 'realtime', realtimeSyncMaxAttempts: 80 })
    await session.mount('tab-a', 'board-a', new FakeEditor({ store: {} }))

    await expect(session.flushBeforeClose()).resolves.toEqual({
      ok: true,
      snapshot: { store: {} },
      revision: 2,
    })
    expect(api.loadBoard).toHaveBeenCalledTimes(1)
  })

  it('blocks a structural command when the realtime projection never catches up', async () => {
    const initial = { store: { 'shape:one': { id: 'shape:one', typeName: 'shape', x: 10 } } }
    const latest = { store: { 'shape:one': { id: 'shape:one', typeName: 'shape', x: 90 } } }
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async () => ({ snapshot: initial, revision: 3 })),
      saveSnapshot: vi.fn(),
    }
    const editor = new FakeEditor(initial)
    const session = new BoardSession({
      api,
      mode: 'realtime',
      realtimeSyncMaxAttempts: 2,
      waitForRealtimeSync: async () => undefined,
    })
    await session.mount('tab-a', 'board-a', editor)
    editor.edit(latest)

    await expect(session.flushBeforeClose()).resolves.toMatchObject({
      ok: false,
      reason: 'error',
      recoverySnapshot: latest,
      error: expect.objectContaining({ message: 'REALTIME_SYNC_TIMEOUT' }),
    })
    expect(editor.getSnapshot()).toEqual(latest)
    expect(api.saveSnapshot).not.toHaveBeenCalled()
  })

  it('keeps the dirty snapshot on a revision conflict and exposes reload and copy recovery', async () => {
    const serverSnapshot = { shapes: [{ id: 'server' }] }
    const api: BoardSessionApi = {
      loadBoard: vi
        .fn()
        .mockResolvedValueOnce({ snapshot: { shapes: [] }, revision: 4 })
        .mockResolvedValueOnce({ snapshot: serverSnapshot, revision: 8 }),
      saveSnapshot: vi.fn(async () => {
        throw new BoardSessionConflictError(8)
      }),
    }
    const editor = new FakeEditor({ shapes: [] })
    const session = new BoardSession({ api })
    await session.mount('tab-a', 'board-a', editor)
    const localSnapshot = { shapes: [{ id: 'local' }] }
    editor.edit(localSnapshot)

    const result = await session.flush()

    expect(result).toMatchObject({ ok: false, reason: 'conflict', currentRevision: 8 })
    expect(session.status).toBe('conflict')
    expect(session.pendingSnapshot).toEqual(localSnapshot)
    expect(session.copyRecoverySnapshot()).toEqual(localSnapshot)

    await session.reloadFromServer()
    expect(editor.getSnapshot()).toEqual(serverSnapshot)
    expect(session.pendingSnapshot).toBeUndefined()
    expect(session.status).toBe('clean')
    expect(session.currentRevision).toBe(8)
  })

  it('keeps an offline snapshot in memory and retries it', async () => {
    const { api } = createApi()
    vi.mocked(api.saveSnapshot)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ snapshot: { shapes: [{ id: 'local' }] }, revision: 4 })
    const editor = new FakeEditor({ shapes: [] })
    const session = new BoardSession({ api })
    await session.mount('tab-a', 'board-a', editor)
    const localSnapshot = { shapes: [{ id: 'local' }] }
    editor.edit(localSnapshot)

    expect(await session.flush()).toMatchObject({ ok: false, reason: 'offline' })
    expect(session.pendingSnapshot).toEqual(localSnapshot)
    expect(session.status).toBe('offline')

    expect(await session.retry()).toMatchObject({ ok: true, revision: 4 })
    expect(session.pendingSnapshot).toBeUndefined()
    expect(session.status).toBe('clean')
  })

  it('serializes overlapping flush requests instead of issuing duplicate CAS writes', async () => {
    let finishSave: ((commit: { snapshot: unknown; revision: number }) => void) | undefined
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async () => ({ snapshot: { shapes: [] }, revision: 2 })),
      saveSnapshot: vi.fn(
        async () =>
          new Promise<{ snapshot: unknown; revision: number }>((resolve) => {
            finishSave = resolve
          }),
      ),
    }
    const editor = new FakeEditor({ shapes: [] })
    const session = new BoardSession({ api })
    await session.mount('tab-a', 'board-a', editor)
    const localSnapshot = { shapes: [{ id: 'local' }] }
    editor.edit(localSnapshot)

    const autosaveFlush = session.flush()
    const navigationFlush = session.flushBeforeNavigation()

    await Promise.resolve()
    expect(api.saveSnapshot).toHaveBeenCalledOnce()
    finishSave?.({ snapshot: localSnapshot, revision: 3 })
    await expect(autosaveFlush).resolves.toMatchObject({ ok: true, revision: 3 })
    await expect(navigationFlush).resolves.toMatchObject({ ok: true, revision: 3 })
    expect(api.saveSnapshot).toHaveBeenCalledOnce()
  })

  it('ignores a stale board load after the session has mounted a different board', async () => {
    let finishBoardA: ((commit: { snapshot: unknown; revision: number }) => void) | undefined
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async (boardId) => {
        if (boardId === 'board-a') {
          return new Promise<{ snapshot: unknown; revision: number }>((resolve) => {
            finishBoardA = resolve
          })
        }
        return { snapshot: { board: 'b' }, revision: 9 }
      }),
      saveSnapshot: vi.fn(),
    }
    const editorA = new FakeEditor({ board: 'empty-a' })
    const editorB = new FakeEditor({ board: 'empty-b' })
    const session = new BoardSession({ api })

    const staleMount = session.mount('tab-a', 'board-a', editorA)
    await session.mount('tab-b', 'board-b', editorB)
    finishBoardA?.({ snapshot: { board: 'stale-a' }, revision: 2 })
    await staleMount
    editorA.edit({ board: 'detached-a-edit' })

    expect(editorB.getSnapshot()).toEqual({ board: 'b' })
    expect(session.mountedBoardId).toBe('board-b')
    expect(session.currentRevision).toBe(9)
    expect(session.pendingSnapshot).toBeUndefined()
  })

  it('autosaves reference-only geometry and visual changes', async () => {
    const { api, saves } = createApi()
    const editor = new FakeEditor({ shapes: [] })
    const session = new BoardSession({ api })
    await session.mount('tab-a', 'board-a', editor)
    const referenceRestyle = {
      shapes: [
        {
          id: 'shape:reference',
          type: 'board-reference',
          x: 20,
          y: 30,
          props: { width: 320, height: 180, opacity: 0.7 },
        },
      ],
    }

    editor.edit(referenceRestyle)
    await vi.advanceTimersByTimeAsync(800)

    expect(saves.at(-1)?.snapshot).toEqual(referenceRestyle)
  })

  it('exposes one session through the React hook and flushes through its navigation guard', async () => {
    const { api, saves } = createApi()
    const editor = new FakeEditor({ shapes: [] })
    const { result } = renderHook(() =>
      useBoardSession({ api, tabId: 'tab-a', boardId: 'board-a', editor }),
    )
    await act(async () => undefined)
    editor.edit({ shapes: [{ id: 'hook-change' }] })

    await act(async () => {
      await result.current.flushBeforeNavigation()
    })

    expect(result.current.status).toBe('clean')
    expect(saves.at(-1)?.snapshot).toEqual({ shapes: [{ id: 'hook-change' }] })
  })

  it('renders recovery actions for a conflicted save status', () => {
    const onReload = vi.fn()
    const onCopyRecovery = vi.fn()
    render(
      createElement(SaveStatus, {
        status: 'conflict',
        onReload,
        onCopyRecovery,
      }),
    )

    screen.getByRole('button', { name: '重新加载服务器版本' }).click()
    screen.getByRole('button', { name: '下载恢复副本' }).click()

    expect(onReload).toHaveBeenCalledOnce()
    expect(onCopyRecovery).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('保存冲突')
  })
})
