import { describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'

import { createBoardStore, getStoreSnapshot, loadSnapshotIntoStore } from '@infinite-board/tldraw-adapter'
import { TldrawWorkspaceEditor } from './TldrawWorkspaceEditor'

function snapshotWithPageName(name: string) {
  const snapshot = structuredClone(getStoreSnapshot(createBoardStore()))
  const records = snapshot.store as Record<string, { name?: string }>
  records['page:page'] = { ...records['page:page']!, name }
  return snapshot
}

function pageName(snapshot: ReturnType<typeof getStoreSnapshot>): string | undefined {
  return (snapshot.store as Record<string, { name?: string }>)['page:page']?.name
}

describe('TldrawWorkspaceEditor', () => {
  it('serializes the mounted realtime editor store instead of the detached bridge store', () => {
    const liveStore = createBoardStore()
    loadSnapshotIntoStore(liveStore, snapshotWithPageName('Live realtime page'))
    const bridge = new TldrawWorkspaceEditor(snapshotWithPageName('Detached bridge page'))
    const mountedEditor = {
      store: liveStore,
      setCamera: vi.fn(),
      setSelectedShapes: vi.fn(),
      setCurrentTool: vi.fn(),
      updateInstanceState: vi.fn(),
    } as unknown as Editor

    bridge.mountEditor(mountedEditor)

    expect(pageName(bridge.getSnapshot() as ReturnType<typeof getStoreSnapshot>)).toBe('Live realtime page')
  })

  it('does not load the next tab snapshot into a detached realtime editor store', () => {
    const sourceStore = createBoardStore()
    loadSnapshotIntoStore(sourceStore, snapshotWithPageName('Source'))
    const bridge = new TldrawWorkspaceEditor(snapshotWithPageName('Initial'))
    const mountedEditor = {
      store: sourceStore,
      setCamera: vi.fn(),
      setSelectedShapes: vi.fn(),
      setCurrentTool: vi.fn(),
      updateInstanceState: vi.fn(),
    } as unknown as Editor

    bridge.mountEditor(mountedEditor)
    bridge.dispose()
    bridge.prepare(snapshotWithPageName('Target'))

    expect(pageName(getStoreSnapshot(sourceStore))).toBe('Source')
    expect(pageName(bridge.getSnapshot() as ReturnType<typeof getStoreSnapshot>)).toBe('Target')
  })
})
