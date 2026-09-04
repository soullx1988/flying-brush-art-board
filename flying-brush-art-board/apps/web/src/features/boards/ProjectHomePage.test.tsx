import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '@ttqtt/liquid-glass-react'

import {
  ProjectHomePage,
  type ProjectHomeClient,
  type ProjectHomeData,
} from './ProjectHomePage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const projectData: ProjectHomeData = {
  project: {
    id: 'project-1',
    title: 'Design Project',
    rootBoardId: 'board-a',
    formatVersion: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  },
  boards: [
    {
      id: 'board-a',
      projectId: 'project-1',
      title: 'Overview',
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
    {
      id: 'board-b',
      projectId: 'project-1',
      title: 'Research',
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
  ],
  references: [
    {
      id: 'reference-a-b',
      projectId: 'project-1',
      sourceBoardId: 'board-a',
      targetBoardId: 'board-b',
      shapeId: 'shape:reference',
      kind: 'link',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
  ],
}

function createClient(): ProjectHomeClient {
  return {
    getProject: vi.fn(async () => structuredClone(projectData)),
    createBoard: vi.fn(async (_projectId, input) => ({
      id: input.id,
      projectId: 'project-1',
      title: input.title,
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    })),
    duplicateBoard: vi.fn(async (_boardId, input) => ({
      id: input.id,
      projectId: 'project-1',
      title: input.title,
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    })),
    setDefaultBoard: vi.fn(async (_projectId, boardId) => ({
      ...projectData.project,
      rootBoardId: boardId,
    })),
    renameProject: vi.fn(async (_projectId, title) => ({
      ...projectData.project,
      title,
    })),
    deleteProject: vi.fn(async () => undefined),
    renameBoard: vi.fn(async (boardId, title) => ({
      ...projectData.boards.find((board) => board.id === boardId)!,
      title,
    })),
    deleteBoard: vi.fn(async () => undefined),
  }
}

describe('ProjectHomePage', () => {
  it('lists every board with the default marker and inbound/outbound counts', async () => {
    render(
      <ProjectHomePage
        projectId="project-1"
        client={createClient()}
        onOpenBoard={vi.fn()}
      />,
    )

    expect(screen.getByRole('status', { name: '正在加载项目' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Design Project' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '全部画板 2' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Overview' })).toHaveTextContent('默认入口')
    expect(screen.getByRole('listitem', { name: 'Overview' })).toHaveTextContent('引用 1')
    expect(screen.getByRole('listitem', { name: 'Research' })).toHaveTextContent('被引用 1')
    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(screen.getByRole('link', { name: '导出 .iboard' })).toHaveAttribute(
      'href',
      '/api/projects/project-1/export.iboard',
    )
    expect(screen.getByRole('link', { name: '导出 .iboard' })).toHaveAttribute(
      'download',
      'Design Project.iboard',
    )
  })

  it('hides the previous project immediately while a different project loads', async () => {
    let finishSecond: ((value: ProjectHomeData) => void) | undefined
    const client = createClient()
    vi.mocked(client.getProject).mockImplementation((projectId) => {
      if (projectId === 'project-1') return Promise.resolve(structuredClone(projectData))
      return new Promise((resolve) => { finishSecond = resolve })
    })
    const { rerender } = render(
      <ProjectHomePage projectId="project-1" client={client} onOpenBoard={vi.fn()} />,
    )
    await screen.findByRole('heading', { name: 'Design Project' })

    rerender(<ProjectHomePage projectId="project-2" client={client} onOpenBoard={vi.fn()} />)
    expect(screen.queryByRole('heading', { name: 'Design Project' })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '正在加载项目' })).toBeInTheDocument()

    finishSecond?.({
      ...structuredClone(projectData),
      project: { ...projectData.project, id: 'project-2', title: 'Second Project' },
      boards: projectData.boards.map((board) => ({ ...board, projectId: 'project-2' })),
      references: [],
    })
    expect(await screen.findByRole('heading', { name: 'Second Project' })).toBeInTheDocument()
  })

  it('ignores a stale project response that resolves after the current project', async () => {
    let finishFirst: ((value: ProjectHomeData) => void) | undefined
    let finishSecond: ((value: ProjectHomeData) => void) | undefined
    const client = createClient()
    vi.mocked(client.getProject).mockImplementation((projectId) => new Promise((resolve) => {
      if (projectId === 'project-1') finishFirst = resolve
      else finishSecond = resolve
    }))
    const { rerender } = render(
      <ProjectHomePage projectId="project-1" client={client} onOpenBoard={vi.fn()} />,
    )
    await waitFor(() => expect(client.getProject).toHaveBeenCalledWith('project-1'))
    rerender(<ProjectHomePage projectId="project-2" client={client} onOpenBoard={vi.fn()} />)
    await waitFor(() => expect(client.getProject).toHaveBeenCalledWith('project-2'))

    finishSecond?.({
      ...structuredClone(projectData),
      project: { ...projectData.project, id: 'project-2', title: 'Current Project' },
      boards: projectData.boards.map((board) => ({ ...board, projectId: 'project-2' })),
      references: [],
    })
    expect(await screen.findByRole('heading', { name: 'Current Project' })).toBeInTheDocument()
    finishFirst?.(structuredClone(projectData))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Current Project' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Design Project' })).not.toBeInTheDocument()
  })

  it('enters the current default board and updates the entry after setting another board as default', async () => {
    const client = createClient()
    const onOpenBoard = vi.fn()
    render(
      <ProjectHomePage projectId="project-1" client={client} onOpenBoard={onOpenBoard} />,
    )
    await screen.findByRole('heading', { name: 'Design Project' })

    fireEvent.click(screen.getByRole('button', { name: '进入默认画板' }))
    expect(onOpenBoard).toHaveBeenLastCalledWith('board-a', 'current')

    fireEvent.click(screen.getByRole('button', { name: 'Research 更多操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '设为默认入口' }))
    await waitFor(() => expect(client.setDefaultBoard).toHaveBeenCalledWith('project-1', 'board-b'))
    fireEvent.click(screen.getByRole('button', { name: '进入默认画板' }))
    expect(onOpenBoard).toHaveBeenLastCalledWith('board-b', 'current')

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(screen.getByRole('combobox', { name: '默认画板' })).toHaveTextContent('Research')
  })

  it('opens the Yishui panel directly from the project header when present', async () => {
    const client = createClient()
    vi.mocked(client.getProject).mockResolvedValueOnce({
      ...structuredClone(projectData),
      boards: projectData.boards.map((board) => board.id === 'board-b' ? {
        ...board,
        title: '数据',
        tldrawSnapshot: {
          store: {
            'shape:yishui': {
              id: 'shape:yishui',
              type: 'trading-panel',
              meta: { template: 'shortline-trading-v1' },
              props: { panelKind: 'yishui-inference', title: '义水北路推演画板' },
            },
          },
        },
      } : board),
    })
    const onOpenTradingPanel = vi.fn()

    render(
      <ProjectHomePage
        projectId="project-1"
        client={client}
        onOpenBoard={vi.fn()}
        onOpenTradingPanel={onOpenTradingPanel}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: '打开义水推演' }))

    expect(onOpenTradingPanel).toHaveBeenCalledWith('board-b', 'yishui-inference')
  })

  it('renames the project and removes it after an explicit confirmation', async () => {
    const client = createClient()
    const onProjectDeleted = vi.fn()
    const confirm = vi.spyOn(Modal, 'confirm').mockResolvedValue(true)
    render(
      <ProjectHomePage
        projectId="project-1"
        client={client}
        onOpenBoard={vi.fn()}
        onProjectDeleted={onProjectDeleted}
      />,
    )
    await screen.findByRole('heading', { name: 'Design Project' })

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: 'Product Strategy' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(client.renameProject).toHaveBeenCalledWith('project-1', 'Product Strategy'))
    expect(screen.getByRole('heading', { name: 'Product Strategy' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除项目' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '删除项目', danger: true })))
    await waitFor(() => expect(client.deleteProject).toHaveBeenCalledWith('project-1'))
    expect(onProjectDeleted).toHaveBeenCalledOnce()
  })

  it('creates a board and explicitly opens it in a new tab when requested', async () => {
    const client = createClient()
    const onOpenBoard = vi.fn()
    render(
      <ProjectHomePage projectId="project-1" client={client} onOpenBoard={onOpenBoard} />,
    )
    await screen.findByRole('heading', { name: 'Design Project' })

    fireEvent.click(within(document.querySelector('.project-home__actions') as HTMLElement).getByRole('button', { name: '新建画板' }))
    fireEvent.change(screen.getByRole('textbox', { name: '画板名称' }), {
      target: { value: 'Launch Plan' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: '创建后在新标签打开' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(client.createBoard).toHaveBeenCalledTimes(1))
    const createdId = vi.mocked(client.createBoard).mock.calls[0]?.[1].id
    expect(createdId).toMatch(/^board-/)
    expect(onOpenBoard).toHaveBeenCalledWith(createdId, 'new')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建画板' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '全部画板 3' })).toBeInTheDocument()
  })

  it('exposes a separate draw.io import entry', async () => {
    const onImportDrawio = vi.fn()
    render(
      <ProjectHomePage
        projectId="project-1"
        client={createClient()}
        onOpenBoard={vi.fn()}
        onImportDrawio={onImportDrawio}
      />,
    )
    await screen.findByRole('heading', { name: 'Design Project' })

    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '导入 .drawio 画板' }))
    expect(onImportDrawio).toHaveBeenCalledOnce()
  })

  it('exposes the Feishu import connection panel using isolated import endpoints', async () => {
    let connected = true
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/integrations/feishu/account' && init?.method === 'DELETE') connected = false
      return { ok: true, json: async () => ({ connected }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ProjectHomePage projectId="project-1" client={createClient()} onOpenBoard={vi.fn()} />)

    await screen.findByRole('heading', { name: 'Design Project' })
    fireEvent.click(screen.getByRole('tab', { name: '集成' }))
    expect(await screen.findByRole('heading', { name: '飞书导入' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/feishu/status')
    expect(screen.getByRole('button', { name: '断开连接' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/feishu/account', { method: 'DELETE' }))
    expect(await screen.findByRole('link', { name: '连接飞书' })).toHaveAttribute(
      'href', '/auth/feishu/import/start',
    )
  })
})
