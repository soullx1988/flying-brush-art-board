import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeishuImportWizard } from './FeishuImportWizard'

describe('FeishuImportWizard', () => {
  afterEach(cleanup)
  it('requires connection, previews compatibility, selects a project, and explicitly confirms', async () => {
    const commit = vi.fn().mockResolvedValue({ boardId: 'board:new', projectId: 'project' })
    const client = {
      status: vi.fn().mockResolvedValue({ connected: true }),
      projects: vi.fn().mockResolvedValue([{ id: 'project', title: 'Project' }]),
      inspect: vi.fn().mockResolvedValue({ sessionId: 'session', preview: { scene: { elements: [{ id: 'a', type: 'text', geometry: { x: 0, y: 0, width: 100, height: 20 }, text: 'Roadmap' }] }, report: { issues: [{ code: 'UNSUPPORTED_NODE', message: 'Unknown node cannot be edited.', severity: 'warning' }] }, fidelity: { editable: ['a'], downgraded: ['b'], rasterized: [], unsupported: [] }, baseline: { previewByteLength: 3 } } }),
      commit,
      cancel: vi.fn().mockResolvedValue(undefined),
    }
    render(<FeishuImportWizard client={client} onCommitted={() => undefined} />)
    await screen.findByText('已连接')
    fireEvent.change(screen.getByLabelText('飞书白板链接'), { target: { value: 'https://example.feishu.cn/board/token' } })
    fireEvent.click(screen.getByRole('button', { name: '仅预检，不导入' }))
    expect(await screen.findByText('UNSUPPORTED_NODE')).toBeInTheDocument()
    expect(screen.getByLabelText('白板预览')).toHaveTextContent('Roadmap')
    expect(commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(commit).toHaveBeenCalledWith({ sessionId: 'session', target: { kind: 'existing', projectId: 'project' }, confirmed: true }))
  })

  it('offers a new-project target when no project exists and commits the chosen target', async () => {
    const commit = vi.fn().mockResolvedValue({ boardId: 'board:new', projectId: 'project:new' })
    const client = {
      status: vi.fn().mockResolvedValue({ connected: true }), projects: vi.fn().mockResolvedValue([]),
      inspect: vi.fn().mockResolvedValue({ sessionId: 'session', preview: { scene: { elements: [] }, report: { issues: [] }, fidelity: { editable: [], downgraded: [], rasterized: [], unsupported: [] }, baseline: { previewByteLength: 0 } } }),
      commit, cancel: vi.fn().mockResolvedValue(undefined),
    }
    render(<FeishuImportWizard client={client} onCommitted={() => undefined} />)
    await screen.findByText('已连接')
    fireEvent.change(screen.getByLabelText('飞书白板链接'), { target: { value: 'token' } })
    fireEvent.click(screen.getByRole('button', { name: '仅预检，不导入' }))
    await screen.findByText('白板为空。')
    fireEvent.change(screen.getByLabelText('新项目名称'), { target: { value: 'Imported workspace' } })
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(commit).toHaveBeenCalledWith({
      sessionId: 'session',
      target: { kind: 'new', projectId: expect.stringMatching(/^project-/), title: 'Imported workspace' },
      confirmed: true,
    }))
  })

  it('renders scene geometry and visual styles as a scaled whiteboard preview', async () => {
    const client = {
      status: vi.fn().mockResolvedValue({ connected: true }),
      projects: vi.fn().mockResolvedValue([{ id: 'project', title: 'Project' }]),
      inspect: vi.fn().mockResolvedValue({ sessionId: 'session', preview: {
        scene: { elements: [
          { id: 'shape', type: 'shape', shape: 'rectangle', geometry: { x: 100, y: 50, width: 240, height: 120 }, text: 'Launch', zIndex: 'a1', style: { fill: '#ffcc66', stroke: '#673ab7', strokeWidth: 4, color: '#231942' } },
          { id: 'line', type: 'connector', geometry: { x: 0, y: 0, width: 0, height: 0 }, start: { x: 340, y: 110 }, end: { x: 500, y: 210 }, zIndex: 'a2', style: { stroke: '#ef4444', strokeWidth: 6 } },
          { id: 'image', type: 'image', geometry: { x: 500, y: 160, width: 180, height: 120 }, src: 'asset://safe', mimeType: 'image/png', name: 'Architecture', zIndex: 'a3', style: {} },
        ] }, report: { issues: [] }, fidelity: { editable: ['shape', 'line'], downgraded: [], rasterized: ['image'], unsupported: [] }, baseline: { previewByteLength: 10 }, theme: { background: '#faf7ff' },
      } }),
      commit: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
    }
    render(<FeishuImportWizard client={client} onCommitted={() => undefined} />)
    await screen.findByText('已连接')
    fireEvent.change(screen.getByLabelText('飞书白板链接'), { target: { value: 'token' } })
    fireEvent.click(screen.getByRole('button', { name: '仅预检，不导入' }))

    const preview = await screen.findByLabelText('白板预览')
    const scene = preview.querySelector('svg')
    const shape = preview.querySelector('[data-preview-element-id="shape"]')
    const line = preview.querySelector('[data-preview-element-id="line"]')
    const image = preview.querySelector('[data-preview-element-id="image"]')
    expect(scene).toHaveAttribute('viewBox', '80 30 620 270')
    expect(shape).toHaveAttribute('x', '100')
    expect(shape).toHaveAttribute('fill', '#ffcc66')
    expect(shape).toHaveAttribute('stroke', '#673ab7')
    expect(line).toHaveAttribute('x1', '340')
    expect(line).toHaveAttribute('stroke', '#ef4444')
    expect(image).toHaveAttribute('x', '500')
    expect(preview).toHaveTextContent('Launch')
    expect(preview).toHaveTextContent('Architecture')
  })

  it('uses the current project by default and invalidates a stale inspection when the URL changes', async () => {
    let resolveInspection!: (value: any) => void
    const inspect = vi.fn(() => new Promise<any>((resolve) => { resolveInspection = resolve }))
    const cancel = vi.fn().mockResolvedValue(undefined)
    const client = {
      status: vi.fn().mockResolvedValue({ connected: true }),
      projects: vi.fn().mockResolvedValue([{ id: 'project-a', title: 'A' }, { id: 'project-b', title: 'B' }]),
      inspect,
      commit: vi.fn(),
      cancel,
    }
    render(<FeishuImportWizard client={client} defaultProjectId="project-b" onCommitted={() => undefined} />)
    await screen.findByText('已连接')
    fireEvent.change(screen.getByLabelText('飞书白板链接'), { target: { value: 'first-url' } })
    fireEvent.click(screen.getByRole('button', { name: '仅预检，不导入' }))
    fireEvent.change(screen.getByLabelText('飞书白板链接'), { target: { value: 'second-url' } })
    resolveInspection({ sessionId: 'stale-session', preview: { scene: { elements: [] }, report: { issues: [] }, fidelity: { editable: [], downgraded: [], rasterized: [], unsupported: [] }, baseline: { previewByteLength: 0 } } })

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('stale-session'))
    expect(screen.queryByLabelText('兼容性报告')).not.toBeInTheDocument()
  })
})
