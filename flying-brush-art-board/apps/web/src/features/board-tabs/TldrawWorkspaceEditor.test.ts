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
      getCurrentPageBounds: vi.fn(() => undefined),
      getViewportScreenBounds: vi.fn(() => ({ w: 1280, h: 800 })),
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
      getCurrentPageBounds: vi.fn(() => undefined),
      getViewportScreenBounds: vi.fn(() => ({ w: 1280, h: 800 })),
    } as unknown as Editor

    bridge.mountEditor(mountedEditor)
    bridge.dispose()
    bridge.prepare(snapshotWithPageName('Target'))

    expect(pageName(getStoreSnapshot(sourceStore))).toBe('Source')
    expect(pageName(bridge.getSnapshot() as ReturnType<typeof getStoreSnapshot>)).toBe('Target')
  })

  it('opens a long board at a readable top view without clipping its title under the toolbar', () => {
    const bridge = new TldrawWorkspaceEditor(snapshotWithPageName('Long board'))
    const setCamera = vi.fn()
    const mountedEditor = {
      store: createBoardStore(), setCamera, setSelectedShapes: vi.fn(), setCurrentTool: vi.fn(),
      updateInstanceState: vi.fn(),
      getCurrentPageBounds: () => ({ x: -100, y: -200, w: 1480, h: 8000 }),
      getViewportScreenBounds: () => ({ w: 1280, h: 800 }),
    } as unknown as Editor
    bridge.mountEditor(mountedEditor)
    const camera = setCamera.mock.calls.at(-1)![0]
    expect(camera.z).toBeCloseTo(0.8)
    expect((-100 + camera.x) * camera.z).toBeCloseTo(48)
    expect((-200 + camera.y) * camera.z).toBeCloseTo(80)
  })

  it('restores explicitly saved cameras including a deliberate origin at 100 percent', () => {
    const bridge = new TldrawWorkspaceEditor(snapshotWithPageName('Saved view'))
    const getCurrentPageBounds = vi.fn()
    const setCamera = vi.fn()
    bridge.setViewState({ camera: { x: 0, y: 0, z: 1 }, selectedShapeIds: [], currentToolId: 'select', hasBeenViewed: true })
    bridge.mountEditor({
      store: createBoardStore(), setCamera, setSelectedShapes: vi.fn(), setCurrentTool: vi.fn(),
      updateInstanceState: vi.fn(), getCurrentPageBounds,
    } as unknown as Editor)
    expect(setCamera).toHaveBeenLastCalledWith({ x: 0, y: 0, z: 1 })
    expect(getCurrentPageBounds).not.toHaveBeenCalled()
  })

  it('fits both design chains on first view while leaving room for the canvas controls', () => {
    const store = createBoardStore()
    loadSnapshotIntoStore(store, getStoreSnapshot(store))
    const doc = store.allRecords().find(r => r.typeName === 'document')!
    store.put([{ ...doc, meta: { commerceDesignMap: { version: 1, template: 'pay-rhythm', sourceBoardId: 'source' } } }])
    const bridge = new TldrawWorkspaceEditor(getStoreSnapshot(store)), setCamera = vi.fn()
    bridge.mountEditor({
      store, setCamera, setSelectedShapes: vi.fn(), setCurrentTool: vi.fn(), updateInstanceState: vi.fn(),
      getCurrentPageBounds: () => ({ x: 22, y: 0, w: 1120, h: 544 }),
      getViewportScreenBounds: () => ({ w: 1280, h: 606 }),
    } as unknown as Editor)
    const camera = setCamera.mock.calls.at(-1)![0]
    expect(camera.z).toBeLessThan(1)
    expect((544 + camera.y) * camera.z).toBeLessThanOrEqual(606 - 60)
    expect((1120 + 22 + camera.x) * camera.z).toBeLessThan(1280)
  })
})
