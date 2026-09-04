import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BoardSession,
  BoardSessionConflictError,
  type BoardEditor,
  type BoardSessionApi,
} from '../boards/board-session'
import type { BoardReferenceRecord } from '@infinite-board/board-core'

import { releaseEditingLease } from './editing-lease'
import {
  WorkspaceNavigationBlockedError,
  WorkspaceTabs,
  type WorkspaceEditor,
  type WorkspaceViewState,
} from './workspace-tabs'
import { useWorkspaceTabs } from './use-workspace-tabs'

class FakeWorkspaceEditor implements WorkspaceEditor {
  private readonly listeners = new Set<() => void>()
  private snapshot: unknown
  readOnly = false
  private viewState: WorkspaceViewState = {
    camera: { x: 0, y: 0, z: 1 },
    selectedShapeIds: [],
    currentToolId: 'select',
  }

  constructor(
    snapshot: unknown,
    private readonly onDispose: () => void,
  ) {
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

  getViewState(): WorkspaceViewState {
    return this.viewState
  }

  setViewState(viewState: WorkspaceViewState): void {
    this.viewState = viewState
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
  }

  dispose(): void {
    this.onDispose()
  }
}

function createHarness(onCopyRecovery?: () => void | Promise<void>) {
  const server = new Map<string, { snapshot: unknown; revision: number }>([
    ['board-a', { snapshot: { board: 'a-v1' }, revision: 1 }],
    ['board-b', { snapshot: { board: 'b-v1' }, revision: 5 }],
  ])
  const saves: Array<{ boardId: string; expectedRevision: number; snapshot: unknown }> = []
  const api: BoardSessionApi = {
    loadBoard: vi.fn(async (boardId) => structuredClone(server.get(boardId)!)),
    saveSnapshot: vi.fn(async (boardId, expectedRevision, snapshot) => {
      saves.push({ boardId, expectedRevision, snapshot })
      const current = server.get(boardId)!
      if (current.revision !== expectedRevision) {
        throw new BoardSessionConflictError(current.revision)
      }
      const commit = { snapshot, revision: current.revision + 1 }
      server.set(boardId, commit)
      return structuredClone(commit)
    }),
  }
  let activeEditors = 0
  let peakEditors = 0
  const copiedRecoveries: unknown[] = []
  let nextTab = 0
  const workspace = new WorkspaceTabs({
    projectId: 'project-a',
    api,
    createTabId: () => `tab-${++nextTab}`,
    createEditor: (snapshot) => {
      activeEditors += 1
      peakEditors = Math.max(peakEditors, activeEditors)
      return new FakeWorkspaceEditor(snapshot, () => {
        activeEditors -= 1
      })
    },
    copyRecovery: async (snapshot) => {
      copiedRecoveries.push(snapshot)
      await onCopyRecovery?.()
    },
  })

  return {
    api,
    copiedRecoveries,
    get activeEditors() {
      return activeEditors
    },
    get peakEditors() {
      return peakEditors
    },
    saves,
    server,
    workspace,
  }
}

function reference(
  id: string,
  sourceBoardId: string,
  targetBoardId: string,
): BoardReferenceRecord {
  return {
    id,
    projectId: 'project-a',
    sourceBoardId,
    targetBoardId,
    shapeId: `shape:${id}`,
    kind: 'link',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

afterEach(() => {
  releaseEditingLease('project-a', 'board-a', 'tab-1')
  releaseEditingLease('project-a', 'board-a', 'tab-2')
  releaseEditingLease('project-a', 'board-b', 'tab-1')
  releaseEditingLease('project-a', 'board-b', 'tab-2')
})

describe('WorkspaceTabs', () => {
  it('keeps a projected REST snapshot read-only even when realtime is enabled', async () => {
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async () => ({
        snapshot: { store: { public: true } },
        revision: 4,
        snapshotAccess: 'projected' as const,
      })),
      saveSnapshot: vi.fn(),
    }
    let editor: FakeWorkspaceEditor | undefined
    const workspace = new WorkspaceTabs({
      projectId: 'project-a',
      api,
      realtime: true,
      createEditor: (snapshot) => {
        editor = new FakeWorkspaceEditor(snapshot, () => undefined)
        return editor
      },
    })

    const tab = await workspace.openBoardInNewTab('board-projected')

    expect(tab.session.snapshotAccess).toBe('projected')
    expect(tab.readOnly).toBe(true)
    expect(editor?.readOnly).toBe(true)
    expect(workspace.acquireEditingLease(tab.tabId)).toEqual({
      applied: false,
      reason: 'projected-read-only',
    })
    expect(api.saveSnapshot).not.toHaveBeenCalled()
    workspace.dispose()
  })

  it('keeps an ordinary full Board editable in realtime mode', async () => {
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async () => ({
        snapshot: { store: { public: true } },
        revision: 2,
        snapshotAccess: 'full' as const,
      })),
      saveSnapshot: vi.fn(),
    }
    let editor: FakeWorkspaceEditor | undefined
    const workspace = new WorkspaceTabs({
      projectId: 'project-a',
      api,
      realtime: true,
      createEditor: (snapshot) => {
        editor = new FakeWorkspaceEditor(snapshot, () => undefined)
        return editor
      },
    })

    const tab = await workspace.openBoardInNewTab('board-public')

    expect(tab.session.snapshotAccess).toBe('full')
    expect(tab.readOnly).toBe(false)
    expect(editor?.readOnly).toBe(false)
    expect(workspace.acquireEditingLease(tab.tabId)).toEqual({ applied: true })
    workspace.dispose()
  })

  it('adopts realtime command metadata without loading the receipt snapshot into the live editor', async () => {
    const initial = { store: { 'shape:initial': { id: 'shape:initial' } } }
    const live = { store: { 'shape:live': { id: 'shape:live' } } }
    const receipt = { store: { 'shape:receipt': { id: 'shape:receipt' } } }
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async () => ({ snapshot: initial, revision: 2 })),
      saveSnapshot: vi.fn(),
    }
    let editor: FakeWorkspaceEditor | undefined
    const workspace = new WorkspaceTabs({
      projectId: 'project-a',
      api,
      realtime: true,
      createEditor: (snapshot) => {
        editor = new FakeWorkspaceEditor(snapshot, () => undefined)
        return editor
      },
    })
    const tab = await workspace.openBoardInNewTab('board-a')
    editor!.edit(live)
    const loadSnapshot = vi.spyOn(editor!, 'loadSnapshot')

    workspace.adoptCommandCommit(tab.tabId, receipt, 8)

    expect(loadSnapshot).not.toHaveBeenCalled()
    expect(editor!.getSnapshot()).toEqual(live)
    expect(tab.session).toMatchObject({ lastKnownRevision: 8, status: 'clean' })
    workspace.dispose()
  })

  it('hydrates the editor from a command receipt in snapshot mode', async () => {
    const initial = { store: { 'shape:initial': { id: 'shape:initial' } } }
    const receipt = { store: { 'shape:receipt': { id: 'shape:receipt' } } }
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async () => ({ snapshot: initial, revision: 2 })),
      saveSnapshot: vi.fn(),
    }
    let editor: FakeWorkspaceEditor | undefined
    const workspace = new WorkspaceTabs({
      projectId: 'project-a',
      api,
      createEditor: (snapshot) => {
        editor = new FakeWorkspaceEditor(snapshot, () => undefined)
        return editor
      },
    })
    const tab = await workspace.openBoardInNewTab('board-a')
    const loadSnapshot = vi.spyOn(editor!, 'loadSnapshot')

    workspace.adoptCommandCommit(tab.tabId, receipt, 3)

    expect(loadSnapshot).toHaveBeenCalledOnce()
    expect(loadSnapshot).toHaveBeenCalledWith(receipt)
    expect(editor!.getSnapshot()).toEqual(receipt)
    workspace.dispose()
  })

  it('synchronizes only the requested tab before a structural command', async () => {
    const server = new Map<string, { snapshot: unknown; revision: number }>([
      ['board-a', { snapshot: { store: { board: 'a' } }, revision: 1 }],
      ['board-b', { snapshot: { store: { board: 'b' } }, revision: 5 }],
    ])
    const api: BoardSessionApi = {
      loadBoard: vi.fn(async (boardId) => structuredClone(server.get(boardId)!)),
      saveSnapshot: vi.fn(),
    }
    const workspace = new WorkspaceTabs({
      projectId: 'project-a',
      api,
      realtime: true,
      createEditor: (snapshot) => new FakeWorkspaceEditor(snapshot, () => undefined),
    })
    const first = await workspace.openBoardInNewTab('board-a')
    const second = await workspace.openBoardInNewTab('board-b')
    server.set('board-a', { snapshot: { store: { board: 'a' } }, revision: 7 })
    vi.mocked(api.loadBoard).mockClear()

    await expect(workspace.syncBeforeStructuralCommand(first.tabId)).resolves.toMatchObject({
      ok: true,
      revision: 7,
    })

    expect(api.loadBoard).toHaveBeenCalledOnce()
    expect(api.loadBoard).toHaveBeenCalledWith('board-a')
    expect(first.session.lastKnownRevision).toBe(7)
    expect(second.session.lastKnownRevision).toBe(5)
    workspace.dispose()
  })

  it('mounts a board read-only until its first edit intent acquires the lease', async () => {
    const harness = createHarness()
    const tab = await harness.workspace.openBoardInNewTab('board-a')

    expect(harness.workspace.getTab(tab.tabId)?.readOnly).toBe(true)
    expect((harness.workspace.getActiveEditor() as FakeWorkspaceEditor).readOnly).toBe(true)
    expect(harness.workspace.acquireEditingLease(tab.tabId)).toEqual({ applied: true })
    expect((harness.workspace.getActiveEditor() as FakeWorkspaceEditor).readOnly).toBe(false)
  })

  it('captures view and draft, flushes, and disposes the old editor before mounting one active editor', async () => {
    const harness = createHarness()
    const { workspace } = harness
    const firstTab = await workspace.openBoardInNewTab('board-a')
    const firstEditor = workspace.getActiveEditor() as FakeWorkspaceEditor
    firstEditor.setViewState({
      camera: { x: 80, y: 40, z: 2 },
      selectedShapeIds: ['shape:one'],
      currentToolId: 'draw',
    })
    workspace.applyEditableInput(firstTab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'a-local' })
    })

    await workspace.openBoardInNewTab('board-b')

    const inactive = workspace.getTab(firstTab.tabId)!
    expect(inactive.session.history[0]?.viewState).toEqual({
      camera: { x: 80, y: 40, z: 2 },
      selectedShapeIds: ['shape:one'],
      currentToolId: 'draw',
    })
    expect(inactive.serializedSnapshot).toEqual({ board: 'a-local' })
    expect(inactive.session.status).toBe('clean')
    expect('editor' in inactive).toBe(false)
    expect(harness.saves[0]).toEqual({
      boardId: 'board-a',
      expectedRevision: 1,
      snapshot: { board: 'a-local' },
    })
    expect(harness.activeEditors).toBe(1)
    expect(harness.peakEditors).toBe(1)
  })

  it('acquires the lease before applying input and makes the losing duplicate tab read-only', async () => {
    const harness = createHarness()
    const firstTab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(firstTab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'a-local' })
    })
    harness.server.set('board-a', { snapshot: { board: 'a-remote' }, revision: 2 })
    const duplicate = await harness.workspace.openBoardInNewTab('board-a')
    const apply = vi.fn((editor: BoardEditor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'must-not-land' })
    })

    const result = harness.workspace.applyEditableInput(duplicate.tabId, apply)

    expect(result).toEqual({ applied: false, holderTabId: firstTab.tabId })
    expect(apply).not.toHaveBeenCalled()
    expect(harness.workspace.getTab(duplicate.tabId)).toMatchObject({
      readOnly: true,
      leaseHolderTabId: firstTab.tabId,
    })
    expect((harness.workspace.getActiveEditor() as FakeWorkspaceEditor).readOnly).toBe(true)
    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({ board: 'a-remote' })
  })

  it('rejects a duplicate tab edit-intent before it can create a pending snapshot or autosave', async () => {
    const harness = createHarness()
    const firstTab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(firstTab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'owner-draft' })
    })
    harness.server.set('board-a', { snapshot: { board: 'newer-server-copy' }, revision: 2 })
    const duplicate = await harness.workspace.openBoardInNewTab('board-a')
    const savesBeforeRejectedIntent = harness.saves.length

    const result = harness.workspace.acquireEditingLease(duplicate.tabId)

    expect(result).toEqual({ applied: false, holderTabId: firstTab.tabId })
    expect(harness.workspace.getTab(duplicate.tabId)?.session.status).toBe('clean')
    expect(harness.workspace.getTab(duplicate.tabId)?.session.pendingSnapshot).toBeUndefined()
    expect(harness.saves).toHaveLength(savesBeforeRejectedIntent)
  })

  it('refreshes a clean duplicate from the server and restores that tab view', async () => {
    const harness = createHarness()
    const firstTab = await harness.workspace.openBoardInNewTab('board-a')
    const firstView: WorkspaceViewState = {
      camera: { x: 15, y: 25, z: 1.5 },
      selectedShapeIds: ['shape:kept'],
      currentToolId: 'select',
    }
    ;(harness.workspace.getActiveEditor() as FakeWorkspaceEditor).setViewState(firstView)
    await harness.workspace.openBoardInNewTab('board-a')
    harness.server.set('board-a', { snapshot: { board: 'a-v2' }, revision: 2 })

    await harness.workspace.activateTab(firstTab.tabId)

    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({ board: 'a-v2' })
    expect(harness.workspace.getActiveEditor()?.getViewState()).toEqual(firstView)
    expect(harness.workspace.getTab(firstTab.tabId)?.session).toMatchObject({
      lastKnownRevision: 2,
      status: 'clean',
    })
    expect(harness.workspace.getTab(firstTab.tabId)?.session.pendingSnapshot).toBeUndefined()
  })

  it('uses the dirty owner expected revision on duplicate activation and preserves recovery on CAS failure', async () => {
    const harness = createHarness()
    const firstTab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(firstTab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'a-local' })
    })
    harness.server.set('board-a', { snapshot: { board: 'a-remote' }, revision: 2 })
    await harness.workspace.openBoardInNewTab('board-a')

    await harness.workspace.activateTab(firstTab.tabId)

    expect(harness.saves.filter((save) => save.boardId === 'board-a')).toEqual([
      { boardId: 'board-a', expectedRevision: 1, snapshot: { board: 'a-local' } },
      { boardId: 'board-a', expectedRevision: 1, snapshot: { board: 'a-local' } },
    ])
    expect(harness.workspace.getTab(firstTab.tabId)?.session).toMatchObject({
      lastKnownRevision: 1,
      pendingSnapshot: { board: 'a-local' },
      status: 'conflict',
    })
    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({ board: 'a-local' })
  })

  it('requires an explicit save, recovery copy, or discard before closing a dirty tab', async () => {
    const harness = createHarness()
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'recovery' })
    })

    expect(await harness.workspace.closeTab(tab.tabId)).toEqual({
      closed: false,
      requiresDecision: true,
      recoverySnapshot: { board: 'recovery' },
      choices: ['save', 'copy-recovery', 'discard'],
    })
    expect(harness.workspace.getTab(tab.tabId)).toBeDefined()

    expect(await harness.workspace.closeTab(tab.tabId, 'copy-recovery')).toEqual({ closed: true })
    expect(harness.copiedRecoveries).toEqual([{ board: 'recovery' }])
    expect(harness.workspace.getTab(tab.tabId)).toBeUndefined()
  })

  it('blocks current-tab navigation when offline instead of discarding the dirty snapshot', async () => {
    const harness = createHarness()
    vi.mocked(harness.api.saveSnapshot).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'offline-recovery' })
    })

    await expect(harness.workspace.openBoardInCurrentTab('board-b')).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceNavigationBlockedError>>({
        name: 'WorkspaceNavigationBlockedError',
        reason: 'offline',
        recoverySnapshot: { board: 'offline-recovery' },
      }),
    )

    expect(harness.workspace.activeTabId).toBe(tab.tabId)
    expect(harness.workspace.getTab(tab.tabId)).toMatchObject({
      boardId: 'board-a',
      session: {
        status: 'offline',
        pendingSnapshot: { board: 'offline-recovery' },
      },
    })
    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({
      board: 'offline-recovery',
    })
  })

  it('blocks reference entry on CAS conflict and keeps the recovery snapshot editable', async () => {
    const harness = createHarness()
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'conflict-recovery' })
    })
    harness.server.set('board-a', { snapshot: { board: 'remote' }, revision: 2 })

    await expect(
      harness.workspace.enterReferenceTarget('board-b', {
        referenceId: 'reference-a-b',
        sourceBoardId: 'board-a',
        targetBoardId: 'board-b',
        shapeId: 'shape:reference',
        kind: 'link',
      }),
    ).rejects.toMatchObject({
      name: 'WorkspaceNavigationBlockedError',
      reason: 'conflict',
      recoverySnapshot: { board: 'conflict-recovery' },
    })
    expect(harness.workspace.getTab(tab.tabId)?.boardId).toBe('board-a')
    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({
      board: 'conflict-recovery',
    })
  })

  it('flushes a dirty active board before leaving for project home and disposes its editor', async () => {
    const harness = createHarness()
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'project-home-save' })
    })

    await harness.workspace.leaveWorkspace()

    expect(harness.saves).toContainEqual({
      boardId: 'board-a',
      expectedRevision: 1,
      snapshot: { board: 'project-home-save' },
    })
    expect(harness.workspace.getTab(tab.tabId)?.session.status).toBe('clean')
    expect(harness.workspace.getTab(tab.tabId)?.session).not.toHaveProperty('pendingSnapshot')
    expect(harness.workspace.getActiveEditor()).toBeUndefined()
    expect(harness.activeEditors).toBe(0)
  })

  it('blocks project-home navigation when the active dirty board is offline and keeps its recovery snapshot', async () => {
    const harness = createHarness()
    vi.mocked(harness.api.saveSnapshot).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'project-home-recovery' })
    })

    await expect(harness.workspace.leaveWorkspace()).rejects.toMatchObject({
      name: 'WorkspaceNavigationBlockedError',
      reason: 'offline',
      recoverySnapshot: { board: 'project-home-recovery' },
    })
    expect(harness.workspace.activeTabId).toBe(tab.tabId)
    expect(harness.workspace.getTab(tab.tabId)?.session).toMatchObject({
      status: 'offline',
      pendingSnapshot: { board: 'project-home-recovery' },
    })
    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({
      board: 'project-home-recovery',
    })
  })

  it('blocks workspace exit when an inactive tab still has an offline recovery snapshot', async () => {
    const harness = createHarness()
    vi.mocked(harness.api.saveSnapshot).mockRejectedValue(new TypeError('Failed to fetch'))
    const first = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(first.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'inactive-recovery' })
    })

    const second = await harness.workspace.openBoardInNewTab('board-b')
    expect(harness.workspace.getTab(first.tabId)?.session).toMatchObject({
      status: 'offline',
      pendingSnapshot: { board: 'inactive-recovery' },
    })

    await expect(harness.workspace.leaveWorkspace()).rejects.toMatchObject({
      name: 'WorkspaceNavigationBlockedError',
      reason: 'offline',
      recoverySnapshot: { board: 'inactive-recovery' },
    })
    expect(harness.workspace.activeTabId).toBe(second.tabId)
    expect(harness.workspace.getActiveEditor()).toBeDefined()
  })

  it('records actual reference entries and restores source camera, selection, and tool on back', async () => {
    const harness = createHarness()
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    const sourceView: WorkspaceViewState = {
      camera: { x: 120, y: 45, z: 1.75 },
      selectedShapeIds: ['shape:source-selection'],
      currentToolId: 'draw',
    }
    ;(harness.workspace.getActiveEditor() as FakeWorkspaceEditor).setViewState(sourceView)

    await harness.workspace.enterReference(tab.tabId, reference('a-b', 'board-a', 'board-b'), 'current')
    await harness.workspace.enterReference(tab.tabId, reference('b-a', 'board-b', 'board-a'), 'current')

    expect(harness.workspace.getTab(tab.tabId)?.session.history.map((entry) => entry.boardId)).toEqual([
      'board-a',
      'board-b',
      'board-a',
    ])
    const entryIds = harness.workspace.getTab(tab.tabId)!.session.history.map((entry) => entry.entryId)
    expect(new Set(entryIds).size).toBe(3)

    await harness.workspace.goBackAlongHistoryPath(tab.tabId)
    await harness.workspace.goBackAlongHistoryPath(tab.tabId)

    expect(harness.workspace.getTab(tab.tabId)).toMatchObject({
      boardId: 'board-a',
      session: { historyIndex: 0 },
    })
    expect(harness.workspace.getActiveEditor()?.getViewState()).toEqual(sourceView)
  })

  it('opens a reference in a new tab with a copied source entry and isolated histories', async () => {
    const harness = createHarness()
    const sourceTab = await harness.workspace.openBoardInNewTab('board-a')
    const sourceView: WorkspaceViewState = {
      camera: { x: 30, y: 60, z: 2 },
      selectedShapeIds: ['shape:source'],
      currentToolId: 'select',
    }
    ;(harness.workspace.getActiveEditor() as FakeWorkspaceEditor).setViewState(sourceView)

    const targetTab = await harness.workspace.enterReference(
      sourceTab.tabId,
      reference('a-b', 'board-a', 'board-b'),
      'new-tab',
    )

    expect(targetTab.session.history.map((entry) => entry.boardId)).toEqual(['board-a', 'board-b'])
    expect(targetTab.session.historyIndex).toBe(1)
    expect(targetTab.session.history[0]?.viewState).toEqual(sourceView)
    expect(targetTab.session.history[0]?.entryId).not.toBe(
      harness.workspace.getTab(sourceTab.tabId)?.session.history[0]?.entryId,
    )
    expect(harness.workspace.getTab(sourceTab.tabId)?.session.history.map((entry) => entry.boardId))
      .toEqual(['board-a'])

    await harness.workspace.goBackAlongHistoryPath(targetTab.tabId)

    expect(harness.workspace.getTab(targetTab.tabId)).toMatchObject({
      boardId: 'board-a',
      session: { historyIndex: 0 },
    })
    expect(harness.workspace.getActiveEditor()?.getViewState()).toEqual(sourceView)
  })

  it('jumps to an exact history entry without changing another tab history', async () => {
    const harness = createHarness()
    const first = await harness.workspace.openBoardInNewTab('board-a')
    await harness.workspace.enterReference(first.tabId, reference('a-b', 'board-a', 'board-b'), 'current')
    const second = await harness.workspace.openBoardInNewTab('board-a')

    await harness.workspace.activateTab(first.tabId)
    await harness.workspace.goToHistoryEntry(first.tabId, 0)

    expect(harness.workspace.getTab(first.tabId)).toMatchObject({
      boardId: 'board-a',
      session: { historyIndex: 0 },
    })
    expect(harness.workspace.getTab(second.tabId)).toMatchObject({
      boardId: 'board-a',
      session: { historyIndex: 0 },
    })
    expect(harness.workspace.getTab(second.tabId)?.session.history).toHaveLength(1)
  })

  it('does not close after save when a newer edit arrives while the save is in flight', async () => {
    const harness = createHarness()
    let finishSave:
      | ((commit: { snapshot: unknown; revision: number }) => void)
      | undefined
    vi.mocked(harness.api.saveSnapshot).mockImplementationOnce(
      async (_boardId, _expectedRevision, snapshot) =>
        new Promise((resolve) => {
          finishSave = () => resolve({ snapshot, revision: 2 })
        }),
    )
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'first-edit' })
    })

    const close = harness.workspace.closeTab(tab.tabId, 'save')
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'newer-edit' })
    })
    finishSave?.({ snapshot: { board: 'first-edit' }, revision: 2 })

    await expect(close).resolves.toEqual({
      closed: false,
      requiresDecision: true,
      recoverySnapshot: { board: 'newer-edit' },
      choices: ['save', 'copy-recovery', 'discard'],
    })
    expect(harness.workspace.getTab(tab.tabId)?.session.pendingSnapshot).toEqual({
      board: 'newer-edit',
    })
  })

  it('requires a new close decision when an edit arrives during a clean close flush', async () => {
    const harness = createHarness()
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    const session = (
      harness.workspace as unknown as { sessionsById: Map<string, BoardSession> }
    ).sessionsById.get(tab.tabId)!
    const originalFlushBeforeClose = session.flushBeforeClose.bind(session)
    let finishCleanFlush: (() => void) | undefined
    vi.spyOn(session, 'flushBeforeClose').mockImplementation(async () => {
      const cleanResult = await originalFlushBeforeClose()
      await new Promise<void>((resolve) => {
        finishCleanFlush = resolve
      })
      return cleanResult
    })

    const close = harness.workspace.closeTab(tab.tabId)
    await vi.waitFor(() => expect(finishCleanFlush).toBeTypeOf('function'))
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'edit-during-clean-close' })
    })
    finishCleanFlush?.()

    await expect(close).resolves.toEqual({
      closed: false,
      requiresDecision: true,
      recoverySnapshot: { board: 'edit-during-clean-close' },
      choices: ['save', 'copy-recovery', 'discard'],
    })
    expect(harness.workspace.getTab(tab.tabId)?.session.pendingSnapshot).toEqual({
      board: 'edit-during-clean-close',
    })
  })

  it('does not close after recovery copy when a newer edit arrives during the copy', async () => {
    let finishCopy: (() => void) | undefined
    const harness = createHarness(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve
        }),
    )
    const tab = await harness.workspace.openBoardInNewTab('board-a')
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'copied-edit' })
    })

    const close = harness.workspace.closeTab(tab.tabId, 'copy-recovery')
    await vi.waitFor(() => expect(finishCopy).toBeTypeOf('function'))
    harness.workspace.applyEditableInput(tab.tabId, (editor) => {
      ;(editor as FakeWorkspaceEditor).edit({ board: 'not-yet-copied' })
    })
    finishCopy?.()

    await expect(close).resolves.toEqual({
      closed: false,
      requiresDecision: true,
      recoverySnapshot: { board: 'not-yet-copied' },
      choices: ['save', 'copy-recovery', 'discard'],
    })
    expect(harness.workspace.getTab(tab.tabId)).toBeDefined()
  })

  it('serializes overlapping tab transitions so only one editor is ever mounted', async () => {
    const harness = createHarness()

    const [first, second] = await Promise.all([
      harness.workspace.openBoardInNewTab('board-a'),
      harness.workspace.openBoardInNewTab('board-b'),
    ])

    expect(harness.workspace.tabs.map((tab) => tab.tabId)).toEqual([first.tabId, second.tabId])
    expect(harness.workspace.activeTabId).toBe(second.tabId)
    expect(harness.activeEditors).toBe(1)
    expect(harness.peakEditors).toBe(1)
  })

  it('rolls back a provisional tab when its board cannot attach', async () => {
    const harness = createHarness()
    const first = await harness.workspace.openBoardInNewTab('board-a')
    vi.mocked(harness.api.loadBoard).mockRejectedValueOnce(new Error('load failed'))

    await expect(harness.workspace.openBoardInNewTab('board-b')).rejects.toThrow('load failed')

    expect(harness.workspace.tabs.map((tab) => tab.tabId)).toEqual([first.tabId])
    expect(harness.workspace.activeTabId).toBe(first.tabId)
    expect(harness.workspace.getActiveEditor()?.getSnapshot()).toEqual({ board: 'a-v1' })
    expect(harness.activeEditors).toBe(1)
  })

  it('reorders only the open session list without mounting another editor', async () => {
    const harness = createHarness()
    const first = await harness.workspace.openBoardInNewTab('board-a')
    const second = await harness.workspace.openBoardInNewTab('board-b')

    harness.workspace.reorderTab(first.tabId, second.tabId)

    expect(harness.workspace.tabs.map((tab) => tab.tabId)).toEqual([second.tabId, first.tabId])
    expect(harness.workspace.activeTabId).toBe(second.tabId)
    expect(harness.activeEditors).toBe(1)
  })

  it('exposes task-scoped tab actions and live state through the React hook', async () => {
    const harness = createHarness()
    const syncBeforeStructuralCommand = vi.spyOn(
      harness.workspace,
      'syncBeforeStructuralCommand',
    )
    const { result } = renderHook(() => useWorkspaceTabs(harness.workspace))

    await act(async () => {
      await result.current.openBoardInNewTab('board-a')
    })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.activeTabId).toBe('tab-1')
    expect(result.current.activeEditor).toBe(harness.workspace.getActiveEditor())

    await act(async () => {
      await result.current.syncBeforeStructuralCommand('tab-1')
    })
    expect(syncBeforeStructuralCommand).toHaveBeenCalledWith('tab-1')
  })
})
