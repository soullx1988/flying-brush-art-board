import type { Editor, TLShapeId, TLStore } from 'tldraw'

import {
  createBoardStore,
  getStoreSnapshot,
  loadSnapshotIntoStore,
} from '@infinite-board/tldraw-adapter'

import type { WorkspaceEditor, WorkspaceViewState } from './workspace-tabs'

function hasSnapshotRecords(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  const value = snapshot as { store?: Record<string, unknown>; document?: { store?: Record<string, unknown> } }
  return Object.keys(value.document?.store ?? value.store ?? {}).length > 0
}

export class TldrawWorkspaceEditor implements WorkspaceEditor {
  readonly store: TLStore
  private editor: Editor | undefined
  private pendingViewState: WorkspaceViewState = {
    camera: { x: 0, y: 0, z: 1 },
    selectedShapeIds: [],
    currentToolId: 'select',
    hasBeenViewed: false,
  }
  private readOnly = false
  private leaseHolderTabId: string | undefined

  constructor(snapshot: unknown) {
    this.store = createBoardStore()
    if (hasSnapshotRecords(snapshot)) loadSnapshotIntoStore(this.store, snapshot)
  }

  prepare(snapshot: unknown): this {
    this.loadSnapshot(snapshot)
    return this
  }

  getSnapshot(): unknown {
    return getStoreSnapshot(this.editor?.store ?? this.store)
  }

  loadSnapshot(snapshot: unknown): void {
    if (hasSnapshotRecords(snapshot) && this.editor) {
      loadSnapshotIntoStore(this.editor.store, snapshot)
      return
    }
    if (hasSnapshotRecords(snapshot)) {
      loadSnapshotIntoStore(this.store, snapshot)
      return
    }
    const removableIds = this.store
      .allRecords()
      .filter((record) => ['shape', 'binding', 'asset'].includes(record.typeName))
      .map((record) => record.id)
    if (removableIds.length > 0) this.store.remove(removableIds)
    if (!hasSnapshotRecords(snapshot)) return
    const value = snapshot as {
      store?: Record<string, unknown>
      document?: { store?: Record<string, unknown> }
    }
    const records = Object.values(value.document?.store ?? value.store ?? {}).filter((record) => {
      if (!record || typeof record !== 'object') return false
      return ['shape', 'binding', 'asset'].includes(
        String((record as { typeName?: unknown }).typeName),
      )
    })
    if (records.length > 0) this.store.put(records as never[])
  }

  subscribe(listener: () => void): () => void {
    return this.store.listen(() => listener(), { source: 'user', scope: 'document' })
  }

  getViewState(): WorkspaceViewState {
    if (!this.editor) return this.pendingViewState
    return {
      camera: this.editor.getCamera(),
      selectedShapeIds: [...this.editor.getSelectedShapeIds()],
      currentToolId: this.editor.getCurrentToolId(),
      hasBeenViewed: true,
    }
  }

  setViewState(viewState: WorkspaceViewState): void {
    this.pendingViewState = viewState
    if (!this.editor) return
    this.editor.setCamera(viewState.camera as { x: number; y: number; z?: number })
    this.editor.setSelectedShapes(viewState.selectedShapeIds as TLShapeId[])
    this.editor.setCurrentTool(viewState.currentToolId)
    if (viewState.hasBeenViewed === false) this.frameFirstView()
  }

  private frameFirstView(): void {
    const editor = this.editor
    if (!editor) return
    const bounds = editor.getCurrentPageBounds()
    const viewport = editor.getViewportScreenBounds()
    if (!bounds || bounds.w <= 0 || viewport.w <= 0 || viewport.h <= 0) return
    // Read long boards from their top, rather than fitting their entire height
    // into an unreadably small overview. Leave room for the native top toolbar.
    const inset = 48
    const zoom = Math.min(1, (viewport.w - inset * 2) / bounds.w)
    if (zoom <= 0) return
    editor.setCamera({ x: inset / zoom - bounds.x, y: 80 / zoom - bounds.y, z: zoom })
  }

  setReadOnly(readOnly: boolean, holderTabId?: string): void {
    this.readOnly = readOnly
    this.leaseHolderTabId = holderTabId
    this.editor?.updateInstanceState({ isReadonly: readOnly })
  }

  mountEditor(editor: Editor): void {
    this.editor = editor
    this.setViewState(this.pendingViewState)
    this.setReadOnly(this.readOnly, this.leaseHolderTabId)
  }

  getTldrawEditor(): Editor | undefined {
    return this.editor
  }

  dispose(): void {
    // The bridge is reused between tabs, but a detached realtime editor still
    // points at the previous Board's live store. Clear it before prepare()
    // loads the next tab snapshot so the old Board cannot be overwritten.
    this.editor = undefined
  }
}
