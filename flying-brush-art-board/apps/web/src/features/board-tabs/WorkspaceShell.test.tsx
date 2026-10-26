import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardReferenceRecord, StoredBoard } from '@infinite-board/board-core'

vi.mock('@infinite-board/interop/tldraw/import-tldr', () => ({
  importTldr: vi.fn(),
}))

vi.mock('../import-export/visual-import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../import-export/visual-import')>()),
  importVisualFile: vi.fn(),
}))

let workspaceStore: {
  snapshot: unknown
  listeners: Set<() => void>
  allRecords(): []
  listen(listener: () => void): () => void
  remove(): void
  put(): void
} | undefined
let boardReferencePreviewResolver: ((boardId: string) => { title: string; snapshot: unknown } | undefined) | undefined

type MockCanvasProps = {
  onMount?: (editor: unknown) => void
  onBoardReferenceDrop?: (event: { boardId: string; x: number; y: number }) => void
  onBoardReferenceOpen?: (shape: { props: { referenceId: string } }) => void
  referenceToolActive?: boolean
  onReferenceToolToggle?: () => void
  onReferencePlace?: (placement: { x: number; y: number }) => void
}

let canvasEditorProps: MockCanvasProps | undefined
let canvasEditorInstance: {
  getShapePageBounds: ReturnType<typeof vi.fn>
  centerOnPoint: ReturnType<typeof vi.fn>
  setSelectedShapes: ReturnType<typeof vi.fn>
} | undefined

vi.mock('@infinite-board/tldraw-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@infinite-board/tldraw-adapter')>()),
  createBoardStore: () => {
    const listeners = new Set<() => void>()
    workspaceStore = {
      snapshot: { store: {} },
      listeners,
      allRecords: () => [],
      listen: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      remove: () => undefined,
      put: () => undefined,
    }
    return workspaceStore
  },
  getStoreSnapshot: (store: typeof workspaceStore) => store?.snapshot,
  setBoardReferencePreviewResolver: (resolver: typeof boardReferencePreviewResolver) => {
    boardReferencePreviewResolver = resolver
    return () => { if (boardReferencePreviewResolver === resolver) boardReferencePreviewResolver = undefined }
  },
}))

vi.mock('../canvas/CanvasEditor', () => {
  const editor = {
    getCamera: vi.fn(() => ({ x: 0, y: 0, z: 1 })),
    getCurrentPageId: vi.fn(() => 'page:page'),
    getCurrentPageBounds: vi.fn(() => undefined),
    getViewportScreenBounds: vi.fn(() => ({ w: 1280, h: 800 })),
    getCurrentToolId: vi.fn(() => 'select'),
    getSelectedShapeIds: vi.fn(() => []),
    getShape: vi.fn(() => undefined),
    getShapePageBounds: vi.fn((shapeId: string) => shapeId ? { center: { x: 320, y: 240 } } : undefined),
    centerOnPoint: vi.fn(),
    screenToPage: vi.fn(({ x, y }: { x: number; y: number }) => ({
      x: x + 10,
      y: y + 20,
      z: 0.5,
    })),
    setCamera: vi.fn(),
    setCurrentTool: vi.fn(),
    setSelectedShapes: vi.fn(),
    updateInstanceState: vi.fn(),
  }

  return {
    CanvasEditor: (props: MockCanvasProps) => {
      canvasEditorProps = props
      canvasEditorInstance = editor
      props.onMount?.(editor)
      return <div data-testid="canvas-editor">
        <button type="button" data-testid="toggle-reference-tool" data-active={props.referenceToolActive ? 'true' : 'false'} onClick={props.onReferenceToolToggle}>toggle reference tool</button>
        <button type="button" data-testid="place-reference" onClick={() => props.onReferencePlace?.({ x: 340, y: 480 })}>place reference</button>
      </div>
    },
  }
})

import { WorkspaceShell, type WorkspaceClient } from './WorkspaceShell'
import { importTldr } from '@infinite-board/interop/tldraw/import-tldr'
import { importVisualFile } from '../import-export/visual-import'

afterEach(() => {
  cleanup()
  workspaceStore = undefined
  boardReferencePreviewResolver = undefined
  canvasEditorProps = undefined
  canvasEditorInstance = undefined
})

const now = '2026-07-23T00:00:00.000Z'
const boardTitles = ['Overview', 'Research', 'Ideas', 'Roadmap', 'Archive', 'Notes', 'Sketches']
const boards: StoredBoard[] = boardTitles.map((title, index) => ({
  id: `board-${index + 1}`,
  projectId: 'project-1',
  title,
  tldrawSnapshot: { store: {} },
  revision: 0,
  createdAt: now,
  updatedAt: now,
}))

function createClient(references: BoardReferenceRecord[] = []): WorkspaceClient {
  return {
    getProject: vi.fn(async () => ({
      project: {
        id: 'project-1',
        title: 'Workspace',
        rootBoardId: 'board-1',
        formatVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      boards: structuredClone(boards),
      references: structuredClone(references),
    })),
    createBoard: vi.fn(),
    duplicateBoard: vi.fn(),
    createBoardWithClipboard: vi.fn(),
    setDefaultBoard: vi.fn(),
    loadBoard: vi.fn(async (boardId) => {
      const board = boards.find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    }),
    saveSnapshot: vi.fn(async (_boardId, expectedRevision, snapshot) => ({
      snapshot,
      revision: expectedRevision + 1,
    })),
    pasteClipboard: vi.fn(),
    undoClipboard: vi.fn(),
    redoClipboard: vi.fn(),
    createBoardReference: vi.fn(),
    updateBoardReference: vi.fn(),
    removeBoardReference: vi.fn(),
    renameBoard: vi.fn(),
    deleteBoard: vi.fn(),
    inspectIboard: vi.fn(),
    commitIboardImport: vi.fn(),
    cancelIboardImport: vi.fn(async () => undefined),
  }
}

function showAllBoards() {
  const header = document.querySelector<HTMLElement>('.board-page__header')!
  fireEvent.click(within(header).getByRole('button', { name: '全部画板' }))
}

async function openIboardImport() {
  fireEvent.click(screen.getByRole('button', { name: '导入' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '导入 .iboard 项目包' }))
}

function editActiveWorkspace(snapshot: unknown) {
  if (!workspaceStore) throw new Error('Workspace store is not mounted')
  workspaceStore.snapshot = snapshot
  for (const listener of workspaceStore.listeners) listener()
}

describe('WorkspaceShell', () => {
  it('resolves reference previews from the live open-tab snapshot instead of stale project data', async () => {
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={createClient()}
        navigate={vi.fn()}
      />,
    )
    await screen.findByRole('tab', { name: /Overview/ })
    editActiveWorkspace({ store: { live: true } })

    await waitFor(() => expect(boardReferencePreviewResolver?.('board-1')).toEqual({
      title: 'Overview',
      snapshot: { store: { live: true } },
    }))
  })

  it('flushes a dirty board before the Project Home breadcrumb navigates', async () => {
    const client = createClient()
    const navigate = vi.fn()
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={navigate}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    navigate.mockClear()
    editActiveWorkspace({ store: { local: 'breadcrumb-save' } })
    fireEvent.click(screen.getByRole('button', { name: '项目首页' }))

    await waitFor(() => expect(client.saveSnapshot).toHaveBeenCalledWith(
      'board-1',
      0,
      { store: { local: 'breadcrumb-save' } },
    ))
    expect(navigate).toHaveBeenCalledWith('/projects/project-1')
  })

  it('flushes a dirty board before the Project Center button navigates', async () => {
    const client = createClient()
    let finishSave: (() => void) | undefined
    vi.mocked(client.saveSnapshot).mockImplementationOnce(
      (boardId, expectedRevision, snapshot) => new Promise((resolve) => {
        void boardId
        finishSave = () => resolve({ snapshot, revision: expectedRevision + 1 })
      }),
    )
    const navigate = vi.fn()
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={navigate}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    navigate.mockClear()
    editActiveWorkspace({ store: { local: 'project-center-save' } })
    fireEvent.click(screen.getByRole('button', { name: '返回项目中心' }))

    await waitFor(() => expect(client.saveSnapshot).toHaveBeenCalledWith(
      'board-1',
      0,
      { store: { local: 'project-center-save' } },
    ))
    expect(navigate).not.toHaveBeenCalled()
    finishSave?.()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
  })

  it('blocks browser unload while a board still has pending changes', async () => {
    const client = createClient()
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={vi.fn()}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    editActiveWorkspace({ store: { local: 'before-unload-recovery' } })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(client.saveSnapshot).toHaveBeenCalledWith(
      'board-1',
      0,
      { store: { local: 'before-unload-recovery' } },
    ))
  })

  it('blocks the Project Home breadcrumb when saving its dirty board is offline', async () => {
    const client = createClient()
    vi.mocked(client.saveSnapshot).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const navigate = vi.fn()
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={navigate}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    navigate.mockClear()
    editActiveWorkspace({ store: { local: 'breadcrumb-recovery' } })
    fireEvent.click(screen.getByRole('button', { name: '项目首页' }))

    await waitFor(() => expect(client.saveSnapshot).toHaveBeenCalledOnce())
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('canvas-editor')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('恢复快照')
  })

  it('flushes a dirty board before rendering project home', async () => {
    const client = createClient()
    const { rerender } = render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={vi.fn()}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    editActiveWorkspace({ store: { local: 'project-home-save' } })

    rerender(
      <WorkspaceShell enableRealtime={false} projectId="project-1" client={client} navigate={vi.fn()} />,
    )

    await waitFor(() => expect(client.saveSnapshot).toHaveBeenCalledWith(
      'board-1',
      0,
      { store: { local: 'project-home-save' } },
    ))
    await waitFor(() => expect(screen.queryByTestId('canvas-editor')).not.toBeInTheDocument())
  })

  it('keeps the board mounted and restores its route when project-home navigation cannot save', async () => {
    const client = createClient()
    vi.mocked(client.saveSnapshot).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const navigate = vi.fn()
    const { rerender } = render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={navigate}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    editActiveWorkspace({ store: { local: 'project-home-recovery' } })

    rerender(
      <WorkspaceShell enableRealtime={false} projectId="project-1" client={client} navigate={navigate} />,
    )

    await waitFor(() => expect(client.saveSnapshot).toHaveBeenCalledOnce())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-1',
      expect.objectContaining({ replace: true }),
    ))
    expect(screen.getByTestId('canvas-editor')).toBeInTheDocument()
  })

  it('makes extra normal-app tabs reachable through the overflow menu', async () => {
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={createClient()}
        navigate={vi.fn()}
      />,
    )

    await screen.findByRole('tab', { name: /Overview/ })
    for (const title of boardTitles.slice(1)) {
      showAllBoards()
      const boardItem = await screen.findByRole('listitem', { name: title })
      fireEvent.click(within(boardItem).getByRole('button', { name: `${title} 更多操作` }))
      fireEvent.click(await screen.findByRole('menuitem', { name: '在新标签打开' }))
      await waitFor(() =>
        expect(screen.getAllByRole('tab')).toHaveLength(
          Math.min(boardTitles.indexOf(title) + 1, 6),
        ),
      )
    }

    expect(screen.getAllByRole('tab')).toHaveLength(6)
    const overflowTrigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
    expect(overflowTrigger).not.toBeNull()
    fireEvent.click(overflowTrigger!)
    expect(screen.getByRole('tab', { name: /Sketches/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Notes/ })).toBeInTheDocument()
  }, 15_000)

  it('creates from the tab-strip add button without replacing the current board tab', async () => {
    const client = createClient()
    const createdBoard: StoredBoard = {
      id: 'board-created',
      projectId: 'project-1',
      title: 'Launch Plan',
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }
    vi.mocked(client.createBoard).mockResolvedValue(createdBoard)
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: structuredClone(boards), references: [],
      })
      .mockResolvedValue({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: [...structuredClone(boards), createdBoard], references: [],
      })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, createdBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={navigate}
      />,
    )
    await screen.findByRole('tab', { name: /Overview/ })

    fireEvent.click(screen.getByRole('button', { name: '添加画板标签' }))
    expect(screen.queryByRole('checkbox', { name: '创建后在新标签打开' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '画板名称' }), {
      target: { value: 'Launch Plan' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(client.createBoard).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Launch Plan/ })).toHaveAttribute('aria-selected', 'true')
    expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-created',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    )
  })

  it('opens a committed imported root as a new tab without replacing the project root', async () => {
    const client = createClient()
    const importedBoard: StoredBoard = {
      id: 'board-imported-root',
      projectId: 'project-1',
      title: 'Imported root',
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }
    vi.mocked(client.inspectIboard).mockResolvedValue({
      sessionId: '24ec31bc-f2a8-4baf-aa45-3858116464ca',
      fileName: 'fixture.iboard',
      inspection: {
        compatible: true,
        formatVersion: 1,
        sourceProject: { id: 'source', title: 'Source', rootBoardId: 'source-root' },
        boardCount: 1,
        referenceCount: 0,
        maxEmbedDepth: 1,
        assetCount: 0,
        assetBytes: 0,
        issues: [],
      },
    })
    vi.mocked(client.commitIboardImport).mockResolvedValue({
      targetProjectId: 'project-1',
      importedRootBoardId: importedBoard.id,
      importedBoardIds: [importedBoard.id],
      importedReferenceIds: [],
      importedBoardCount: 1,
      importedReferenceCount: 0,
    })
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({
        project: {
          id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now,
        },
        boards: structuredClone(boards),
        references: [],
      })
      .mockResolvedValue({
        project: {
          id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now,
        },
        boards: [...structuredClone(boards), importedBoard],
        references: [],
      })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, importedBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" client={client} navigate={navigate} />)

    await screen.findByRole('heading', { name: 'Workspace' })
    await openIboardImport()
    const picker = document.querySelector<HTMLInputElement>('input[accept=".iboard"]')!
    fireEvent.change(picker, {
      target: { files: [new File([new Uint8Array([1])], 'fixture.iboard')] },
    })
    await screen.findByText((_content, element) => element?.tagName === 'DD' && element.textContent === '1 个画板')
    fireEvent.click(screen.getByRole('button', { name: '确认合并' }))

    await waitFor(() => expect(client.loadBoard).toHaveBeenCalledWith('board-imported-root'))
    expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-imported-root',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    )
    expect(client.setDefaultBoard).not.toHaveBeenCalled()
  })

  it('imports every dropped .tldr file as exactly one new board even when dropped on the canvas', async () => {
    const client = createClient()
    const importedSnapshot = { document: { store: {} }, session: {} }
    const importedBoard: StoredBoard = {
      id: 'board-tldr', projectId: 'project-1', title: 'Imported sketch',
      tldrawSnapshot: importedSnapshot, revision: 0, createdAt: now, updatedAt: now,
    }
    vi.mocked(importTldr).mockReturnValue({
      value: importedSnapshot as never,
      report: { issues: [], unsupportedElementCount: 0, downgradedElementCount: 0, migrations: [] },
    })
    vi.mocked(client.createBoard).mockResolvedValue(importedBoard)
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: structuredClone(boards), references: [],
      })
      .mockResolvedValue({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: [...structuredClone(boards), importedBoard], references: [],
      })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, importedBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" routeBoardId="board-1" client={client} navigate={navigate} />)
    await screen.findByRole('tab', { name: /Overview/ })

    const file = new File(['tldr'], 'Imported sketch.tldr', { type: 'application/json' })
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'], files: [file] } })
    const canvasTarget = document.querySelector<HTMLElement>('[data-drop-target="canvas"]')!
    fireEvent.drop(canvasTarget, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(client.createBoard).toHaveBeenCalledTimes(1))
    expect(client.createBoard).toHaveBeenCalledWith('project-1', expect.objectContaining({
      title: 'Imported sketch',
      tldrawSnapshot: importedSnapshot,
    }))
    await waitFor(() => expect(client.loadBoard).toHaveBeenCalledWith('board-tldr'))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-tldr',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    ))
  })

  it('waits for each structural drop before importing the next and leaves the last success active', async () => {
    const client = createClient()
    const importedSnapshot = { document: { store: {} }, session: {} }
    const firstBoard: StoredBoard = {
      id: 'board-first', projectId: 'project-1', title: 'First',
      tldrawSnapshot: importedSnapshot, revision: 0, createdAt: now, updatedAt: now,
    }
    const secondBoard: StoredBoard = {
      id: 'board-second', projectId: 'project-1', title: 'Second',
      tldrawSnapshot: importedSnapshot, revision: 0, createdAt: now, updatedAt: now,
    }
    let releaseFirst: (() => void) | undefined
    const firstCreate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    vi.mocked(importTldr).mockReturnValue({
      value: importedSnapshot as never,
      report: { issues: [], unsupportedElementCount: 0, downgradedElementCount: 0, migrations: [] },
    })
    vi.mocked(client.createBoard).mockImplementation(async (_projectId, input) => {
      if (input.title === 'First') {
        await firstCreate
        return firstBoard
      }
      return secondBoard
    })
    vi.mocked(client.getProject).mockImplementation(async () => ({
      project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
      boards: [...structuredClone(boards), firstBoard, secondBoard], references: [],
    }))
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, firstBoard, secondBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" routeBoardId="board-1" client={client} navigate={navigate} />)
    await screen.findByRole('tab', { name: /Overview/ })

    const first = new File(['first'], 'First.tldr', { type: 'application/json' })
    const second = new File(['second'], 'Second.tldr', { type: 'application/json' })
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'], files: [first, second] } })
    const canvasTarget = document.querySelector<HTMLElement>('[data-drop-target="canvas"]')!
    fireEvent.drop(canvasTarget, { dataTransfer: { files: [first, second] } })

    await waitFor(() => expect(client.createBoard).toHaveBeenCalledTimes(1))
    expect(client.createBoard).toHaveBeenCalledWith('project-1', expect.objectContaining({ title: 'First' }))
    releaseFirst?.()

    await waitFor(() => expect(client.createBoard).toHaveBeenCalledTimes(2))
    expect(client.createBoard).toHaveBeenNthCalledWith(2, 'project-1', expect.objectContaining({ title: 'Second' }))
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(
      '/projects/project-1/boards/board-second',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    ))
  })

  it('imports a .tldr dropped on the actual add-tab control as exactly one new board tab', async () => {
    const client = createClient()
    const importedSnapshot = { document: { store: {} }, session: {} }
    const importedBoard: StoredBoard = {
      id: 'board-tldr-add-tab', projectId: 'project-1', title: 'Imported sketch',
      tldrawSnapshot: importedSnapshot, revision: 0, createdAt: now, updatedAt: now,
    }
    vi.mocked(importTldr).mockReturnValue({
      value: importedSnapshot as never,
      report: { issues: [], unsupportedElementCount: 0, downgradedElementCount: 0, migrations: [] },
    })
    vi.mocked(client.createBoard).mockResolvedValue(importedBoard)
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: structuredClone(boards), references: [],
      })
      .mockResolvedValue({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: [...structuredClone(boards), importedBoard], references: [],
      })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, importedBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" routeBoardId="board-1" client={client} navigate={navigate} />)
    await screen.findByRole('tab', { name: /Overview/ })

    const file = new File(['tldr'], 'Imported sketch.tldr', { type: 'application/json' })
    const addTab = screen.getByRole('button', { name: /添加画板标签/ })
    expect(addTab).toHaveAttribute('data-drop-target', 'new-tab')
    fireEvent.dragOver(addTab, { dataTransfer: { types: ['Files'], files: [file] } })
    fireEvent.drop(addTab, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(client.createBoard).toHaveBeenCalledTimes(1))
    expect(client.createBoard).toHaveBeenCalledWith('project-1', expect.objectContaining({
      title: 'Imported sketch',
      tldrawSnapshot: importedSnapshot,
    }))
    await waitFor(() => expect(client.loadBoard).toHaveBeenCalledWith('board-tldr-add-tab'))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-tldr-add-tab',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    ))
  })

  it('imports a visual dropped on the add-tab control as one new Board and activates its tab', async () => {
    const client = createClient()
    const visualBoard: StoredBoard = {
      id: 'board-visual', projectId: 'project-1', title: 'Hero',
      tldrawSnapshot: { store: {} }, revision: 1, createdAt: now, updatedAt: now,
    }
    vi.mocked(importVisualFile).mockResolvedValue({
      fileName: 'Hero.png',
      boardId: visualBoard.id,
      revision: 1,
      snapshot: visualBoard.tldrawSnapshot,
      createdBoard: true,
      shapeCount: 1,
      rasterized: false,
    })
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: structuredClone(boards), references: [],
      })
      .mockResolvedValue({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: [...structuredClone(boards), visualBoard], references: [],
      })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, visualBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" routeBoardId="board-1" client={client} navigate={navigate} />)
    await screen.findByRole('tab', { name: /Overview/ })

    const file = new File(['png'], 'Hero.png', { type: 'image/png' })
    const addTab = screen.getByRole('button', { name: /添加画板标签/ })
    fireEvent.drop(addTab, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(importVisualFile).toHaveBeenCalledWith({
      file,
      target: { kind: 'new-board', projectId: 'project-1' },
    }))
    await waitFor(() => expect(client.loadBoard).toHaveBeenCalledWith('board-visual'))
    expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-visual',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    )
  })

  it('normalizes a Vec-like canvas drop point to the strict x/y placement contract', async () => {
    const client = createClient()
    vi.mocked(importVisualFile).mockResolvedValue({
      fileName: 'Placed.svg',
      boardId: 'board-1',
      revision: 1,
      snapshot: { store: {} },
      createdBoard: false,
      shapeCount: 1,
      rasterized: false,
    })
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-1"
        client={client}
        navigate={vi.fn()}
      />,
    )
    await screen.findByRole('tab', { name: /Overview/ })

    const file = new File(['<svg/>'], 'Placed.svg', { type: 'image/svg+xml' })
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'], files: [file] } })
    const canvasTarget = document.querySelector<HTMLElement>('[data-drop-target="canvas"]')!
    const drop = createEvent.drop(canvasTarget, {
      dataTransfer: { files: [file] },
    })
    Object.defineProperties(drop, {
      clientX: { value: 140 },
      clientY: { value: 260 },
    })
    fireEvent(canvasTarget, drop)

    await waitFor(() => expect(importVisualFile).toHaveBeenCalledWith(
      {
        file,
        target: {
          kind: 'current-board',
          boardId: 'board-1',
          dropPoint: { x: 150, y: 280 },
          pageId: 'page:page',
        },
      },
      undefined,
      { beforePersist: expect.any(Function) },
    ))
  })

  it('imports a .drawio drop with recoverable references through one atomic board command', async () => {
    const client = createClient()
    const importedBoard: StoredBoard = {
      id: 'board-drawio', projectId: 'project-1', title: 'Architecture',
      tldrawSnapshot: { document: { store: {} }, session: {} }, revision: 0, createdAt: now, updatedAt: now,
    }
    vi.mocked(client.createBoard).mockResolvedValue(importedBoard)
    vi.mocked(client.pasteClipboard).mockResolvedValue({
      commandId: 'command-drawio', boardId: importedBoard.id, revision: 1,
      snapshot: importedBoard.tldrawSnapshot, idMap: {}, createdReferenceIds: ['reference-imported'],
    })
    const createBoardWithClipboard = vi.mocked(client.createBoardWithClipboard)
    createBoardWithClipboard.mockResolvedValue(importedBoard)
    vi.mocked(client.getProject)
      .mockResolvedValueOnce({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: structuredClone(boards), references: [],
      })
      .mockResolvedValue({
        project: { id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now },
        boards: [...structuredClone(boards), importedBoard], references: [],
      })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      const board = [...boards, importedBoard].find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    const navigate = vi.fn()
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" routeBoardId="board-1" client={client} navigate={navigate} />)
    await screen.findByRole('tab', { name: /Overview/ })

    const drawio = `<?xml version="1.0"?><mxfile><diagram><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="normal" value="Normal" vertex="1" parent="1"><mxGeometry width="100" height="60" as="geometry"/></mxCell>
      <mxCell id="reference-card" value="Research" vertex="1" parent="1"
        iboardReferenceId="reference-source" iboardTargetBoardId="board-2"
        iboardReferenceKind="link" iboardProjectId="project-1">
        <mxGeometry x="150" width="280" height="140" as="geometry"/>
      </mxCell>
    </root></mxGraphModel></diagram></mxfile>`
    const file = new File([drawio], 'Architecture.drawio', { type: 'application/xml' })
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'], files: [file] } })
    fireEvent.drop(document.querySelector<HTMLElement>('[data-drop-target="canvas"]')!, {
      dataTransfer: { files: [file] },
    })

    await waitFor(() => expect(createBoardWithClipboard).toHaveBeenCalledOnce())
    expect(createBoardWithClipboard).toHaveBeenCalledWith('project-1', expect.objectContaining({
      id: expect.stringMatching(/^board-/), title: 'Architecture',
    }), expect.objectContaining({
      sourceProjectId: 'project-1',
      references: [expect.objectContaining({ targetBoardId: 'board-2', kind: 'link' })],
    }))
    const initialSnapshot = createBoardWithClipboard.mock.calls[0]![1].tldrawSnapshot as {
      document: { store: Record<string, { type?: string }> }
    }
    expect(Object.values(initialSnapshot.document.store).some((record) => record.type === 'board-reference')).toBe(false)
    expect(client.createBoard).not.toHaveBeenCalled()
    expect(client.pasteClipboard).not.toHaveBeenCalled()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-drawio',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    ))
  })

  it('keeps import failures inside the real workspace tablist without creating board tabs', async () => {
    const client = createClient()
    vi.mocked(client.inspectIboard).mockResolvedValue({
      sessionId: '24ec31bc-f2a8-4baf-aa45-3858116464ca', fileName: 'fixture.iboard',
      inspection: {
        compatible: true, formatVersion: 1,
        sourceProject: { id: 'source', title: 'Source', rootBoardId: 'source-root' },
        boardCount: 1, referenceCount: 0, maxEmbedDepth: 1, assetCount: 0, assetBytes: 0, issues: [],
      },
    })
    vi.mocked(client.commitIboardImport).mockRejectedValue(new Error('commit failed'))
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" client={client} navigate={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Workspace' })

    await openIboardImport()
    fireEvent.change(document.querySelector<HTMLInputElement>('input[accept=".iboard"]')!, {
      target: { files: [new File([new Uint8Array([1])], 'fixture.iboard')] },
    })
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!
    await waitFor(() => expect(tablist.querySelector('[role="tab"][aria-label="导入 fixture.iboard"]')).toBeInTheDocument())

    fireEvent.click(document.querySelector<HTMLButtonElement>('.iboard-import-wizard__actions button:last-child')!)
    await screen.findByRole('alert')
    expect(client.loadBoard).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.board-tab-shell')).toHaveLength(0)
    expect(tablist.querySelectorAll('[role="tab"]')).toHaveLength(1)
  })

  it('does not accumulate provisional workspace tabs after repeated attach failures', async () => {
    const client = createClient()
    const importedBoard: StoredBoard = {
      id: 'board-imported-broken', projectId: 'project-1', title: 'Broken imported root',
      tldrawSnapshot: { store: {} }, revision: 0, createdAt: now, updatedAt: now,
    }
    vi.mocked(client.inspectIboard).mockResolvedValue({
      sessionId: '24ec31bc-f2a8-4baf-aa45-3858116464ca', fileName: 'fixture.iboard',
      inspection: {
        compatible: true, formatVersion: 1,
        sourceProject: { id: 'source', title: 'Source', rootBoardId: 'source-root' },
        boardCount: 1, referenceCount: 0, maxEmbedDepth: 1, assetCount: 0, assetBytes: 0, issues: [],
      },
    })
    vi.mocked(client.commitIboardImport).mockResolvedValue({
      targetProjectId: 'project-1', importedRootBoardId: importedBoard.id,
      importedBoardIds: [importedBoard.id], importedReferenceIds: [], importedBoardCount: 1, importedReferenceCount: 0,
    })
    vi.mocked(client.getProject).mockResolvedValue({
      project: {
        id: 'project-1', title: 'Workspace', rootBoardId: 'board-1', formatVersion: 1, createdAt: now, updatedAt: now,
      },
      boards: [...structuredClone(boards), importedBoard], references: [],
    })
    vi.mocked(client.loadBoard).mockImplementation(async (boardId) => {
      if (boardId === importedBoard.id) throw new Error('attach failed')
      const board = boards.find((candidate) => candidate.id === boardId)!
      return { snapshot: board.tldrawSnapshot, revision: board.revision }
    })
    render(<WorkspaceShell enableRealtime={false} projectId="project-1" client={client} navigate={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Workspace' })
    await openIboardImport()
    fireEvent.change(document.querySelector<HTMLInputElement>('input[accept=".iboard"]')!, {
      target: { files: [new File([new Uint8Array([1])], 'fixture.iboard')] },
    })
    await waitFor(() => expect(client.inspectIboard).toHaveBeenCalledOnce())

    fireEvent.click(document.querySelector<HTMLButtonElement>('.iboard-import-wizard__actions button:last-child')!)
    await waitFor(() => expect(client.loadBoard).toHaveBeenCalledTimes(1))
    expect(document.querySelectorAll('.board-tab-shell')).toHaveLength(0)
    fireEvent.click(document.querySelector<HTMLButtonElement>('.iboard-import-wizard__actions button:last-child')!)
    await waitFor(() => expect(client.loadBoard).toHaveBeenCalledTimes(2))
    expect(document.querySelectorAll('.board-tab-shell')).toHaveLength(0)
    expect(document.querySelector('[role="tablist"]')!.querySelectorAll('[role="tab"]')).toHaveLength(1)
  })

  it('opens the child-board dialog after canvas placement and centers the card on that point', async () => {
    const reference: BoardReferenceRecord = {
      id: 'reference-placement',
      projectId: 'project-1',
      sourceBoardId: 'board-1',
      targetBoardId: 'board-2',
      shapeId: 'shape:placed-reference',
      kind: 'embed',
      createdAt: now,
      updatedAt: now,
    }
    const client = createClient([reference])
    vi.mocked(client.createBoardReference).mockResolvedValue({
      reference,
      revision: 1,
      snapshot: { store: {} },
    })

    render(<WorkspaceShell
      enableRealtime={false}
      projectId="project-1"
      routeBoardId="board-1"
      client={client}
      navigate={vi.fn()}
    />)

    await screen.findByRole('tab', { name: /Overview/ })
    expect(document.querySelector('#board-reference-form')).toBeNull()
    fireEvent.click(screen.getByTestId('toggle-reference-tool'))
    expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'true')
    expect(document.querySelector('#board-reference-form')).toBeNull()

    fireEvent.click(screen.getByTestId('place-reference'))
    await waitFor(() => expect(document.querySelector('#board-reference-form')).not.toBeNull())
    expect(screen.getByTestId('toggle-reference-tool')).toHaveAttribute('data-active', 'false')
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[form="board-reference-form"]')!)

    await waitFor(() => expect(client.createBoardReference).toHaveBeenCalledWith('board-1', {
      targetBoardId: 'board-2',
      shapeId: expect.stringMatching(/^shape:/),
      kind: 'embed',
      expectedRevision: 0,
      placement: { x: 190, y: 396 },
    }))
  })

  it('creates an embedded child-board reference at a dropped card location and opens it through reference navigation', async () => {
    const reference: BoardReferenceRecord = {
      id: 'reference-1-2',
      projectId: 'project-1',
      sourceBoardId: 'board-1',
      targetBoardId: 'board-2',
      shapeId: 'shape:overview-to-research',
      kind: 'embed',
      createdAt: now,
      updatedAt: now,
    }
    const client = createClient([reference])
    vi.mocked(client.createBoardReference).mockResolvedValue({
      reference,
      revision: 1,
      snapshot: { store: {} },
    })
    const navigate = vi.fn()

    render(<WorkspaceShell
      enableRealtime={false}
      projectId="project-1"
      routeBoardId="board-1"
      client={client}
      navigate={navigate}
    />)

    await screen.findByRole('tab', { name: /Overview/ })
    expect(canvasEditorProps?.onBoardReferenceDrop).toBeTypeOf('function')
    canvasEditorProps?.onBoardReferenceDrop?.({ boardId: 'board-2', x: 340, y: 480 })

    await waitFor(() => expect(client.createBoardReference).toHaveBeenCalledWith('board-1', {
      targetBoardId: 'board-2',
      shapeId: expect.stringMatching(/^shape:/),
      kind: 'embed',
      expectedRevision: 0,
      placement: { x: 340, y: 480 },
    }))

    expect(canvasEditorProps?.onBoardReferenceOpen).toBeTypeOf('function')
    canvasEditorProps?.onBoardReferenceOpen?.({ props: { referenceId: reference.id } })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      '/projects/project-1/boards/board-2?path=reference-1-2',
      expect.objectContaining({ state: expect.objectContaining({ tabId: expect.any(String) }) }),
    ))
  })

  it('shows every inbound source location for a bare deep link', async () => {
    const references: BoardReferenceRecord[] = [
      {
        id: 'reference-1-3',
        projectId: 'project-1',
        sourceBoardId: 'board-1',
        targetBoardId: 'board-3',
        shapeId: 'shape:overview-to-ideas',
        kind: 'link',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'reference-2-3',
        projectId: 'project-1',
        sourceBoardId: 'board-2',
        targetBoardId: 'board-3',
        shapeId: 'shape:research-to-ideas',
        kind: 'embed',
        createdAt: now,
        updatedAt: now,
      },
    ]

    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-3"
        client={createClient(references)}
        navigate={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: '引用此画板的位置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Overview/ })).toHaveTextContent('链接')
    expect(screen.getByRole('button', { name: /Research/ })).toHaveTextContent('嵌入')

    fireEvent.click(screen.getByRole('button', { name: /Overview/ }))
    await waitFor(() => expect(canvasEditorInstance?.setSelectedShapes).toHaveBeenCalledWith(['shape:overview-to-ideas']))
    expect(canvasEditorInstance?.centerOnPoint).toHaveBeenCalledWith(
      { x: 320, y: 240 },
      { animation: { duration: 180 } },
    )
  })

  it('bootstraps valid shared reference edges as breadcrumbs and rejects a forged edge chain', async () => {
    const references: BoardReferenceRecord[] = [
      {
        id: 'reference-1-2',
        projectId: 'project-1',
        sourceBoardId: 'board-1',
        targetBoardId: 'board-2',
        shapeId: 'shape:1-2',
        kind: 'link',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'reference-2-3',
        projectId: 'project-1',
        sourceBoardId: 'board-2',
        targetBoardId: 'board-3',
        shapeId: 'shape:2-3',
        kind: 'link',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const { unmount } = render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-3"
        routePathReferenceIds={['reference-1-2', 'reference-2-3']}
        client={createClient(references)}
        navigate={vi.fn()}
      />,
    )

    const breadcrumbs = await screen.findByRole('navigation', { name: '访问历史' })
    expect(within(breadcrumbs).getByText('Overview')).toBeInTheDocument()
    expect(within(breadcrumbs).getByText('Research')).toBeInTheDocument()
    expect(within(breadcrumbs).queryByText('Ideas')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '引用此画板的位置' })).not.toBeInTheDocument()

    unmount()
    render(
      <WorkspaceShell
        enableRealtime={false}
        projectId="project-1"
        routeBoardId="board-3"
        routePathReferenceIds={['reference-2-3', 'reference-1-2']}
        client={createClient(references)}
        navigate={vi.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: '引用此画板的位置' })).toBeInTheDocument()
  })
})
