import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TemporaryImportTab } from '../import-export/TemporaryImportTab'
import {
  BoardTabStrip,
  WORKSPACE_TEMPORARY_TAB_TARGET_ID,
  type BoardTabView,
} from './BoardTabStrip'

afterEach(cleanup)

const tabs: BoardTabView[] = [
  { tabId: 'tab-a', boardId: 'board-a', title: 'Overview', status: 'dirty', readOnly: false },
  { tabId: 'tab-b', boardId: 'board-b', title: 'Research', status: 'saving', readOnly: false },
  { tabId: 'tab-c', boardId: 'board-c', title: 'Archive', status: 'error', readOnly: true },
]

function renderStrip(overrides: Partial<Parameters<typeof BoardTabStrip>[0]> = {}) {
  const props = {
    tabs,
    activeTabId: 'tab-a',
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  }
  render(<BoardTabStrip {...props} />)
  return props
}

describe('BoardTabStrip', () => {
  it('renders only supplied open sessions with active, save, error, and read-only state', () => {
    renderStrip()

    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveTextContent('未保存')
    expect(screen.getByRole('tab', { name: /Research/ })).toHaveTextContent('保存中')
    expect(screen.getByRole('tab', { name: /Archive/ })).toHaveTextContent('错误')
    expect(screen.getByRole('tab', { name: /Archive/ })).toHaveTextContent('只读')
    expect(screen.getByRole('tab', { name: /Overview/ }).parentElement).toHaveClass('board-tab-shell--active')
  })

  it('cycles tabs and closes the active tab with browser keyboard shortcuts', () => {
    const props = renderStrip()
    const tablist = screen.getByRole('tablist', { name: '已打开画板' })

    fireEvent.keyDown(tablist, { key: 'Tab', ctrlKey: true })
    fireEvent.keyDown(tablist, { key: 'Tab', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(tablist, { key: 'w', ctrlKey: true })

    expect(props.onActivate).toHaveBeenNthCalledWith(1, 'tab-b')
    expect(props.onActivate).toHaveBeenNthCalledWith(2, 'tab-c')
    expect(props.onClose).toHaveBeenCalledWith('tab-a')
  })

  it('closes on middle click and reports drag reorder by tab id', () => {
    const props = renderStrip()
    const overview = screen.getByRole('tab', { name: /Overview/ })
    const archive = screen.getByRole('tab', { name: /Archive/ })

    fireEvent.mouseDown(overview, { button: 1 })
    fireEvent.dragStart(overview)
    fireEvent.dragOver(archive)
    fireEvent.drop(archive)

    expect(props.onClose).toHaveBeenCalledWith('tab-a')
    expect(props.onReorder).toHaveBeenCalledWith('tab-a', 'tab-c')
  })

  it('moves hidden tabs into an accessible overflow menu', () => {
    const props = renderStrip({ maxVisibleTabs: 2 })

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '更多已打开画板' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Archive/ }))

    expect(props.onActivate).toHaveBeenCalledWith('tab-c')
  })

  it('dispatches picked import files through the new-tab import path', () => {
    const onPickFiles = vi.fn()
    renderStrip({ onPickFiles })

    const file = new File(['svg'], 'fixture.svg', { type: 'image/svg+xml' })
    fireEvent.change(screen.getByRole('button', { name: '导入文件' }).parentElement!.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    })

    expect(onPickFiles).toHaveBeenCalledWith([file])
  })

  it('hides board-only creation and import actions on the project page', () => {
    renderStrip({ tabs: [], activeTabId: undefined, showWorkspaceActions: false, onPickFiles: vi.fn() })

    expect(screen.queryByRole('button', { name: '添加画板标签' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入文件' })).not.toBeInTheDocument()
  })

  it('keeps one selected tab and places temporary-tab close controls outside role=tab', () => {
    renderStrip()
    render(
      <TemporaryImportTab
        fileName="fixture.iboard"
        status="ready"
        portalTargetId={WORKSPACE_TEMPORARY_TAB_TARGET_ID}
        onClose={vi.fn()}
      />,
    )

    const tablist = screen.getByRole('tablist')
    const temporaryTab = within(tablist).getByRole('tab', { name: /fixture\.iboard/ })
    expect(within(tablist).getAllByRole('tab').filter((tab) =>
      tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(temporaryTab).toHaveAttribute('aria-selected', 'false')
    expect(within(temporaryTab).queryByRole('button')).not.toBeInTheDocument()
    expect(tablist.querySelector('.temporary-import-tab__close')).toBeInTheDocument()
  })
})
