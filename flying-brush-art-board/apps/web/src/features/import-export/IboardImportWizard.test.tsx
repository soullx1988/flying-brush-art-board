import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  IboardImportWizard,
  type IboardImportClient,
  type IboardImportCommitResult,
} from './IboardImportWizard'

afterEach(cleanup)

const inspection = {
  compatible: true,
  formatVersion: 1,
  sourceProject: { id: 'source', title: 'Source project', rootBoardId: 'source-root' },
  boardCount: 4,
  referenceCount: 6,
  maxEmbedDepth: 3,
  assetCount: 1,
  assetBytes: 8,
  issues: [],
}

const commitResult: IboardImportCommitResult = {
  targetProjectId: 'project-1',
  importedRootBoardId: 'board-imported-root',
  importedBoardIds: ['board-imported-root'],
  importedReferenceIds: [],
  importedBoardCount: 4,
  importedReferenceCount: 6,
}

function createClient(): IboardImportClient {
  return {
    inspectIboard: vi.fn(async () => ({
      sessionId: '24ec31bc-f2a8-4baf-aa45-3858116464ca',
      fileName: 'fixture.iboard',
      inspection,
    })),
    commitIboardImport: vi.fn(async () => commitResult),
    cancelIboardImport: vi.fn(async () => undefined),
  }
}

describe('IboardImportWizard', () => {
  it('inspects first, shows the target and report, then commits only after explicit confirmation', async () => {
    const client = createClient()
    const onCommitted = vi.fn(async () => undefined)
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'fixture.iboard')}
        client={client}
        onClose={vi.fn()}
        onCommitted={onCommitted}
      />,
    )

    await screen.findByText('兼容检查通过')
    expect(document.querySelector('[role="tab"][aria-label="导入 fixture.iboard"]')).toBeInTheDocument()
    expect(screen.getByText('合并到 Current project')).toBeInTheDocument()
    expect(screen.getByText('4 个画板')).toBeInTheDocument()
    expect(screen.getByText('6 条引用')).toBeInTheDocument()
    expect(screen.getByText('最长嵌套 3 层')).toBeInTheDocument()
    expect(client.commitIboardImport).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认合并' }))

    await waitFor(() => expect(client.commitIboardImport).toHaveBeenCalledWith({
      sessionId: '24ec31bc-f2a8-4baf-aa45-3858116464ca',
      targetProjectId: 'project-1',
      mode: 'merge',
      openImportedRootInNewTab: true,
    }))
    expect(onCommitted).toHaveBeenCalledWith(commitResult)
  })

  it('cancels an inspected session without committing', async () => {
    const client = createClient()
    const onClose = vi.fn()
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'fixture.iboard')}
        client={client}
        onClose={onClose}
        onCommitted={vi.fn()}
      />,
    )
    await screen.findByText('4 个画板')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => expect(client.cancelIboardImport).toHaveBeenCalledWith(
      '24ec31bc-f2a8-4baf-aa45-3858116464ca',
    ))
    expect(client.commitIboardImport).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('cleans the inspect session when the temporary tab is closed', async () => {
    const client = createClient()
    const onClose = vi.fn()
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'fixture.iboard')}
        client={client}
        onClose={onClose}
        onCommitted={vi.fn()}
      />,
    )
    await screen.findByText('4 个画板')

    const closeTemporaryTab = document.querySelector<HTMLButtonElement>('.temporary-import-tab__close')
    expect(closeTemporaryTab).not.toBeNull()
    fireEvent.click(closeTemporaryTab!)

    await waitFor(() => expect(client.cancelIboardImport).toHaveBeenCalledWith(
      '24ec31bc-f2a8-4baf-aa45-3858116464ca',
    ))
    expect(onClose).toHaveBeenCalled()
  })

  it('cancels the inspect session when Escape closes the wizard', async () => {
    const client = createClient()
    const onClose = vi.fn()
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'fixture.iboard')}
        client={client}
        onClose={onClose}
        onCommitted={vi.fn()}
      />,
    )
    await screen.findByText('4 个画板')

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(client.cancelIboardImport).toHaveBeenCalledWith(
      '24ec31bc-f2a8-4baf-aa45-3858116464ca',
    ))
    expect(client.commitIboardImport).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('cleans an inspected session when a controlled parent hides the wizard', async () => {
    const client = createClient()
    const props = {
      targetProject: { id: 'project-1', title: 'Current project' },
      initialFile: new File([new Uint8Array([1])], 'fixture.iboard'),
      client,
      onClose: vi.fn(),
      onCommitted: vi.fn(),
    }
    const view = render(<IboardImportWizard open {...props} />)
    await screen.findByText('4 个画板')

    view.rerender(<IboardImportWizard open={false} {...props} />)

    await waitFor(() => expect(client.cancelIboardImport).toHaveBeenCalledWith(
      '24ec31bc-f2a8-4baf-aa45-3858116464ca',
    ))
    expect(client.commitIboardImport).not.toHaveBeenCalled()
  })

  it('shows commit progress and prevents close actions after confirmation starts', async () => {
    const client = createClient()
    let resolveCommit!: (result: IboardImportCommitResult) => void
    vi.mocked(client.commitIboardImport).mockImplementation(() => new Promise((resolve) => {
      resolveCommit = resolve
    }))
    const onClose = vi.fn()
    const onCommitted = vi.fn(async () => undefined)
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'fixture.iboard')}
        client={client}
        onClose={onClose}
        onCommitted={onCommitted}
      />,
    )
    await screen.findByText('4 个画板')

    fireEvent.click(screen.getByRole('button', { name: '确认合并' }))

    expect(await screen.findByRole('button', { name: '正在合并' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(document.querySelector<HTMLButtonElement>('.temporary-import-tab__close')).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(client.cancelIboardImport).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => resolveCommit(commitResult))
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(commitResult))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders actionable conflicts and prevents commit', async () => {
    const client = createClient()
    vi.mocked(client.inspectIboard).mockResolvedValueOnce({
      sessionId: '24ec31bc-f2a8-4baf-aa45-3858116464ca',
      fileName: 'broken.iboard',
      inspection: {
        compatible: false,
        issues: [{
          code: 'EMBED_CYCLE',
          message: '嵌套引用形成循环。',
          action: '将其中一条引用改为 link 后重新导出。',
        }],
      },
    })
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'broken.iboard')}
        client={client}
        onClose={vi.fn()}
        onCommitted={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('嵌套引用形成循环')
    expect(screen.getByRole('alert')).toHaveTextContent('将其中一条引用改为 link')
    expect(screen.getByRole('button', { name: '确认合并' })).toBeDisabled()
  })

  it('does not recommit data when opening the imported root fails and supports retrying the tab', async () => {
    const client = createClient()
    const onCommitted = vi.fn()
      .mockRejectedValueOnce(new Error('TAB_OPEN_FAILED'))
      .mockResolvedValueOnce(undefined)
    render(
      <IboardImportWizard
        open
        targetProject={{ id: 'project-1', title: 'Current project' }}
        initialFile={new File([new Uint8Array([1])], 'fixture.iboard')}
        client={client}
        onClose={vi.fn()}
        onCommitted={onCommitted}
      />,
    )
    await screen.findByText('4 个画板')
    fireEvent.click(screen.getByRole('button', { name: '确认合并' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('数据已导入，但入口标签打开失败')
    fireEvent.click(screen.getByRole('button', { name: '重新打开导入入口' }))

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(2))
    expect(client.commitIboardImport).toHaveBeenCalledTimes(1)
  })
})
