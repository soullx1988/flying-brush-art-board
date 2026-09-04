import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectCenterPage, type ProjectCenterClient, type ProjectSummary } from './ProjectCenterPage'

const projects: ProjectSummary[] = [
  {
    id: 'project-1',
    title: 'Desktop UI Review',
    rootBoardId: 'board-1',
    rootBoardTitle: 'Overview',
    boardCount: 2,
    boardTitles: ['Overview', 'Research Notes'],
    formatVersion: 1,
    createdAt: '2026-07-25T08:00:00.000Z',
    updatedAt: '2026-07-25T09:00:00.000Z',
  },
  {
    id: 'project-2',
    title: 'Launch Plan',
    rootBoardId: 'board-2',
    rootBoardTitle: 'Timeline',
    boardCount: 1,
    boardTitles: ['Timeline'],
    formatVersion: 1,
    createdAt: '2026-07-24T08:00:00.000Z',
    updatedAt: '2026-07-24T09:00:00.000Z',
  },
]

function createClient(): ProjectCenterClient {
  return {
    listProjects: vi.fn(async () => structuredClone(projects)),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('ProjectCenterPage', () => {
  it('creates and opens the default trading workspace when the library is empty', async () => {
    const rootBoard = {
      id: 'trading-root', projectId: 'trading-project', title: '总览', tldrawSnapshot: { store: {} },
      revision: 0, createdAt: '2026-08-08T08:00:00.000Z', updatedAt: '2026-08-08T08:00:00.000Z',
    }
    const project = {
      id: 'trading-project', title: '短线主线交易工作台', rootBoardId: rootBoard.id, formatVersion: 1,
      createdAt: rootBoard.createdAt, updatedAt: rootBoard.updatedAt,
    }
    const boards = [rootBoard, ...['数据', '逻辑', '经验', '心态'].map((title, index) => ({
      ...rootBoard, id: `trading-${index}`, title,
    }))]
    const client: ProjectCenterClient = {
      ...createClient(),
      listProjects: vi.fn(async () => []),
      ensureTradingWorkspace: vi.fn(async () => ({ status: 'created' as const, project, rootBoard, boards })),
    }
    const onOpenProject = vi.fn()

    render(<ProjectCenterPage client={client} onOpenProject={onOpenProject} />)

    await waitFor(() => expect(client.ensureTradingWorkspace).toHaveBeenCalledTimes(1))
    expect(onOpenProject).toHaveBeenCalledWith('trading-project', 'trading-root')
  })

  it('ensures the personal trading workspace even when ordinary projects already exist', async () => {
    const rootBoard = {
      id: 'trading-root', projectId: 'trading-project', title: '总览', tldrawSnapshot: { store: {} },
      revision: 0, createdAt: '2026-08-08T08:00:00.000Z', updatedAt: '2026-08-08T08:00:00.000Z',
    }
    const project = {
      id: 'trading-project', title: '短线主线交易工作台', rootBoardId: rootBoard.id, formatVersion: 1,
      createdAt: rootBoard.createdAt, updatedAt: rootBoard.updatedAt,
    }
    const client: ProjectCenterClient = {
      ...createClient(),
      ensureTradingWorkspace: vi.fn(async () => ({
        status: 'created' as const,
        project,
        rootBoard,
        boards: [rootBoard],
      })),
    }
    const onOpenProject = vi.fn()

    render(<ProjectCenterPage client={client} onOpenProject={onOpenProject} />)

    await screen.findByText('短线主线交易工作台')
    expect(screen.getByText('Desktop UI Review')).toBeInTheDocument()
    expect(client.ensureTradingWorkspace).toHaveBeenCalledTimes(1)
    expect(onOpenProject).not.toHaveBeenCalled()
  })

  it('shows a first-screen Yishui entry and opens the data board with panel focus', async () => {
    const rootBoard = {
      id: 'trading-root', projectId: 'trading-project', title: '总览', tldrawSnapshot: { store: {} },
      revision: 0, createdAt: '2026-08-08T08:00:00.000Z', updatedAt: '2026-08-08T08:00:00.000Z',
    }
    const dataBoard = {
      ...rootBoard,
      id: 'trading-data',
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
    }
    const project = {
      id: 'trading-project', title: '短线主线交易工作台', rootBoardId: rootBoard.id, formatVersion: 1,
      createdAt: rootBoard.createdAt, updatedAt: rootBoard.updatedAt,
    }
    const client: ProjectCenterClient = {
      ...createClient(),
      ensureTradingWorkspace: vi.fn(async () => ({
        status: 'existing' as const,
        project,
        rootBoard,
        boards: [rootBoard, dataBoard],
      })),
    }
    const onOpenProject = vi.fn()

    render(<ProjectCenterPage client={client} onOpenProject={onOpenProject} />)
    const entry = await screen.findByRole('button', { name: '打开义水推演' })
    fireEvent.click(entry)

    expect(onOpenProject).toHaveBeenCalledWith(
      'trading-project',
      'trading-data',
      { focusPanelKind: 'yishui-inference' },
    )
  })

  it('shows one project library ordered by most recently updated first', async () => {
    const client = createClient()
    vi.mocked(client.listProjects).mockResolvedValueOnce(structuredClone(projects).reverse())

    render(<ProjectCenterPage client={client} onOpenProject={vi.fn()} />)
    await screen.findByText('Desktop UI Review')

    expect(screen.queryByRole('heading', { name: '最近项目' })).not.toBeInTheDocument()
    const titles = Array.from(document.querySelectorAll('.project-card__title strong'), (element) => element.textContent)
    expect(titles).toEqual(['Desktop UI Review', 'Launch Plan'])
  })

  it('searches project titles and every board title, then opens the matching project', async () => {
    const onOpenProject = vi.fn()
    render(<ProjectCenterPage client={createClient()} onOpenProject={onOpenProject} />)
    expect(await screen.findByText('Desktop UI Review')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目' }), { target: { value: 'Research Notes' } })
    expect(screen.getByText('Desktop UI Review')).toBeInTheDocument()
    expect(screen.queryByText('Launch Plan')).not.toBeInTheDocument()
    expect(screen.getByText(/2 个画板/)).toBeInTheDocument()
    expect(screen.getByText('默认入口：Overview')).toBeInTheDocument()

    fireEvent.click(document.querySelector('.project-card__open') as HTMLButtonElement)
    expect(onOpenProject).toHaveBeenCalledWith('project-1')
  })

  it('offers an inline undo after archiving a project', async () => {
    render(<ProjectCenterPage client={createClient()} onOpenProject={vi.fn()} />)
    await screen.findByText('Desktop UI Review')

    fireEvent.click(screen.getByRole('button', { name: 'Desktop UI Review 更多操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '移至个人归档' }))
    expect(screen.queryByText('Desktop UI Review')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已移至个人归档')

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(screen.getByText('Desktop UI Review')).toBeInTheDocument())
  })

  it('exposes global integrations and homepage settings without a decorative history control', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/mcp/clients') return new Response(JSON.stringify([]), { status: 200 })
      if (url === '/api/integrations/feishu/status') return new Response(JSON.stringify({ connected: false }), { status: 200 })
      return new Response(null, { status: 404 })
    }))
    render(<ProjectCenterPage client={createClient()} onOpenProject={vi.fn()} />)
    await screen.findByText('Desktop UI Review')

    expect(document.querySelector('.section-heading > svg')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '集成' }))
    expect(await screen.findByRole('heading', { name: 'MCP v2 接入' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '飞书导入' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '首页偏好' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除首页偏好' })).toBeInTheDocument()
  })
})
