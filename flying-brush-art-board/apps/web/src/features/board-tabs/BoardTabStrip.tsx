import { useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { MagnifyingGlass, Plus, SquaresFour, UploadSimple, X } from '@phosphor-icons/react'

import type { BoardSessionStatus } from '../boards/board-session'
import { TabOverflowMenu } from './TabOverflowMenu'
import type { BoardTabView } from './board-tab-types'

export type { BoardTabView } from './board-tab-types'

export interface BoardTabStripProps {
  tabs: readonly BoardTabView[]
  activeTabId: string | undefined
  maxVisibleTabs?: number
  projectTitle?: string
  showWorkspaceActions?: boolean
  onProjectCenter?(): void
  onCommandPalette?(): void
  onActivate(tabId: string): void
  onClose(tabId: string): void
  onCreate(): void
  onDropOnNewTab?(files: readonly File[]): void
  onPickFiles?(files: readonly File[]): void
  onReorder(sourceTabId: string, targetTabId: string): void
}

const STATUS_LABELS: Partial<Record<BoardSessionStatus, string>> = {
  loading: '加载中',
  dirty: '未保存',
  saving: '保存中',
  conflict: '冲突',
  offline: '离线',
  error: '错误',
}

/** Keep the application header usable on compact laptop widths. */
export const DEFAULT_MAX_VISIBLE_BOARD_TABS = 6
export const WORKSPACE_TEMPORARY_TAB_TARGET_ID = 'workspace-temporary-import-tabs'

export function BoardTabStrip({
  tabs,
  activeTabId,
  maxVisibleTabs = DEFAULT_MAX_VISIBLE_BOARD_TABS,
  projectTitle,
  showWorkspaceActions = true,
  onProjectCenter,
  onCommandPalette,
  onActivate,
  onClose,
  onCreate,
  onDropOnNewTab,
  onPickFiles,
  onReorder,
}: BoardTabStripProps) {
  const draggingTabId = useRef<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const visibleLimit = Math.max(1, maxVisibleTabs)
  const activeIndex = tabs.findIndex((tab) => tab.tabId === activeTabId)
  const visibleTabs = activeIndex >= visibleLimit
    ? [...tabs.slice(0, visibleLimit - 1), tabs[activeIndex]!]
    : tabs.slice(0, visibleLimit)
  const visibleTabIds = new Set(visibleTabs.map((tab) => tab.tabId))
  const hiddenTabs = tabs.filter((tab) => !visibleTabIds.has(tab.tabId))

  const handleShortcuts = (event: KeyboardEvent<HTMLElement>) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || tabs.length === 0) return
    if (event.key.toLowerCase() === 'w') {
      if (activeTabId) onClose(activeTabId)
      event.preventDefault()
      return
    }
    if (event.key !== 'Tab') return
    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.tabId === activeTabId))
    const delta = event.shiftKey ? -1 : 1
    const nextIndex = (activeIndex + delta + tabs.length) % tabs.length
    const next = tabs[nextIndex]
    if (next) onActivate(next.tabId)
    event.preventDefault()
  }

  const closeOnMiddleClick = (event: MouseEvent, tabId: string) => {
    if (event.button !== 1) return
    event.preventDefault()
    onClose(tabId)
  }

  return (
    <nav className="board-tab-strip" aria-label="工作区画板标签" onKeyDown={handleShortcuts}>
      <div className="board-tab-strip__tabs" role="tablist" aria-label="已打开画板" tabIndex={0}>
        {onProjectCenter ? (
          <button
            type="button"
            className="board-tab-strip__project-center"
            aria-label="返回项目中心"
            title={projectTitle ? `${projectTitle} · 返回项目中心` : '返回项目中心'}
            onClick={onProjectCenter}
          >
            <SquaresFour weight="duotone" aria-hidden="true" />
          </button>
        ) : null}
        {onCommandPalette ? (
          <button type="button" className="board-tab-strip__command" aria-label="搜索画板和命令" title="搜索画板和命令 · Ctrl+K" onClick={onCommandPalette}>
            <MagnifyingGlass aria-hidden="true" />
            <span>搜索</span>
            <kbd>Ctrl K</kbd>
          </button>
        ) : null}
        {visibleTabs.map((tab) => {
          const statusLabel = STATUS_LABELS[tab.status]
          const active = tab.tabId === activeTabId
          return (
            <div className={active ? 'board-tab-shell board-tab-shell--active' : 'board-tab-shell'} key={tab.tabId}>
              <button
                type="button"
                role="tab"
                draggable
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={active ? 'board-tab board-tab--active' : 'board-tab'}
                onClick={() => onActivate(tab.tabId)}
                onMouseDown={(event) => closeOnMiddleClick(event, tab.tabId)}
                onDragStart={() => {
                  draggingTabId.current = tab.tabId
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceTabId = draggingTabId.current
                  draggingTabId.current = undefined
                  if (sourceTabId && sourceTabId !== tab.tabId) onReorder(sourceTabId, tab.tabId)
                }}
              >
                <span>{tab.title}</span>
                {statusLabel ? <span className={`tab-status tab-status--${tab.status}`}>{statusLabel}</span> : null}
                {tab.readOnly ? <span className="tab-status">只读</span> : null}
              </button>
              <button
                type="button"
                className="board-tab__close"
                aria-label={`关闭 ${tab.title}`}
                onClick={() => onClose(tab.tabId)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )
        })}
        <div id={WORKSPACE_TEMPORARY_TAB_TARGET_ID} className="board-tab-strip__temporary-tabs" />
        <TabOverflowMenu tabs={hiddenTabs} onActivate={onActivate} />
        {showWorkspaceActions ? <button
            data-drop-target="new-tab"
            type="button"
            className="board-tab board-tab--add"
            aria-label="添加画板标签"
            onClick={onCreate}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const files = [...event.dataTransfer.files]
              if (files.length > 0) onDropOnNewTab?.(files)
            }}
          >
            <Plus aria-hidden="true" />
          </button> : null}
        {showWorkspaceActions && onPickFiles ? <>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".iboard,.tldr,.drawio,.png,.jpg,.jpeg,.webp,.svg,.pdf"
            aria-label="选择导入文件"
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])]
              event.currentTarget.value = ''
              if (files.length > 0) onPickFiles(files)
            }}
          />
          <button type="button" className="board-tab-strip__import" aria-label="导入文件" title="导入文件" onClick={() => fileInputRef.current?.click()}>
            <UploadSimple aria-hidden="true" />
            <span>导入文件</span>
          </button>
        </> : null}
      </div>
    </nav>
  )
}
