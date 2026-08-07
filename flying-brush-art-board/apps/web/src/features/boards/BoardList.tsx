import type {
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'
import {
  Archive,
  ArrowCounterClockwise,
  ArrowSquareOut,
  Copy,
  DotsThree,
  FolderOpen,
  HouseLine,
  PencilSimple,
  Star,
  Trash,
} from '@phosphor-icons/react'
import { Button, Empty, GlassSurface, Menu, Tag, type MenuItem } from '@ttqtt/liquid-glass-react'
import { useRef } from 'react'

import type { BoardPreferences } from './board-preferences'

export const BOARD_DRAG_TYPE = 'application/x-infinite-board-board-id'

export interface BoardListProps {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  preferences?: BoardPreferences
  onOpenBoard(boardId: string, mode: 'current' | 'new'): void
  onSetDefault(boardId: string): void
  onToggleFavorite?(boardId: string): void
  onArchive?(boardId: string, archived: boolean): void
  onRename?(board: StoredBoard): void
  onDuplicate?(board: StoredBoard): void
  onDelete?(board: StoredBoard): void
  onDragBoardStart?(boardId: string): void
}

function updatedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function BoardList({
  project,
  boards,
  references,
  preferences = { favoriteIds: [], archivedIds: [] },
  onOpenBoard,
  onSetDefault,
  onToggleFavorite,
  onArchive,
  onRename,
  onDuplicate,
  onDelete,
  onDragBoardStart,
}: BoardListProps) {
  const openButtons = useRef<Array<HTMLButtonElement | null>>([])
  const defaultBoardIndex = boards.findIndex((board) => board.id === project.rootBoardId)
  const orderedBoards = defaultBoardIndex > 0
    ? [
        boards[defaultBoardIndex]!,
        ...boards.slice(0, defaultBoardIndex),
        ...boards.slice(defaultBoardIndex + 1),
      ]
    : boards

  if (boards.length === 0) {
    return <Empty title="没有符合条件的画板" description="调整搜索或筛选条件，或者新建一个画板。" />
  }

  return (
    <ul className="board-list" aria-label="画板列表">
      {orderedBoards.map((board, index) => {
        const inbound = references.filter((reference) => reference.targetBoardId === board.id).length
        const outbound = references.filter((reference) => reference.sourceBoardId === board.id).length
        const isDefault = project.rootBoardId === board.id
        const favorite = preferences.favoriteIds.includes(board.id)
        const archived = preferences.archivedIds.includes(board.id)
        const menuItems: MenuItem[] = [
          { key: 'new-tab', label: '在新标签打开', icon: <ArrowSquareOut aria-hidden="true" /> },
          ...(!isDefault ? [{ key: 'default', label: '设为默认入口', icon: <HouseLine aria-hidden="true" /> } satisfies MenuItem] : []),
          { key: 'rename', label: '重命名', icon: <PencilSimple aria-hidden="true" />, disabled: !onRename },
          { key: 'duplicate', label: '创建副本', icon: <Copy aria-hidden="true" />, disabled: !onDuplicate },
          { key: 'favorite', label: favorite ? '取消个人收藏' : '加入个人收藏', icon: <Star weight={favorite ? 'fill' : 'regular'} aria-hidden="true" />, disabled: !onToggleFavorite },
          { key: 'archive', label: archived ? '移出个人归档' : '移至个人归档', icon: archived ? <ArrowCounterClockwise aria-hidden="true" /> : <Archive aria-hidden="true" />, disabled: isDefault || !onArchive },
          { type: 'divider' },
          {
            key: 'delete',
            label: isDefault ? '默认画板不可删除' : inbound > 0 ? `仍被 ${inbound} 处引用` : '删除画板',
            icon: <Trash aria-hidden="true" />,
            danger: true,
            disabled: isDefault || inbound > 0 || !onDelete,
          },
        ]

        const onMenuSelect = (key: string) => {
          if (key === 'new-tab') onOpenBoard(board.id, 'new')
          if (key === 'default') onSetDefault(board.id)
          if (key === 'rename') onRename?.(board)
          if (key === 'duplicate') onDuplicate?.(board)
          if (key === 'favorite') onToggleFavorite?.(board.id)
          if (key === 'archive') onArchive?.(board.id, !archived)
          if (key === 'delete') onDelete?.(board)
        }

        return (
          <GlassSurface
            as="li"
            className={isDefault ? 'board-list__item board-list__item--default' : 'board-list__item'}
            key={board.id}
            aria-label={board.title}
            radius="18px"
            material="clear"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'copy'
              event.dataTransfer.setData(BOARD_DRAG_TYPE, board.id)
              onDragBoardStart?.(board.id)
            }}
          >
            <button
              ref={(element) => { openButtons.current[index] = element }}
              type="button"
              className="board-list__open"
              aria-keyshortcuts="Enter Control+Enter Meta+Enter ArrowUp ArrowDown"
              onClick={() => onOpenBoard(board.id, 'current')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  onOpenBoard(board.id, 'new')
                  return
                }
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                event.preventDefault()
                const direction = event.key === 'ArrowDown' ? 1 : -1
                const nextIndex = Math.min(orderedBoards.length - 1, Math.max(0, index + direction))
                openButtons.current[nextIndex]?.focus()
              }}
            >
              <span className="board-list__icon"><FolderOpen weight="duotone" aria-hidden="true" /></span>
              <span className="board-list__copy">
                <span className="board-list__title">
                  <strong>{board.title}</strong>
                  {isDefault ? <Tag className="board-badge" color="accent" size="sm">默认入口</Tag> : null}
                  {favorite ? <Star weight="fill" aria-label="已收藏" /> : null}
                </span>
                <span className="board-list__meta">
                  <span>被引用 {inbound}</span>
                  <span>引用 {outbound}</span>
                  <span>更新于 {updatedLabel(board.updatedAt)}</span>
                </span>
              </span>
            </button>
            <div className="board-list__actions">
              <Menu items={menuItems} onSelect={onMenuSelect} placement="bottom-end">
                <Button variant="ghost" size="sm" type="button" aria-label={`${board.title} 更多操作`} icon={<DotsThree weight="bold" aria-hidden="true" />} />
              </Menu>
            </div>
          </GlassSurface>
        )
      })}
    </ul>
  )
}
