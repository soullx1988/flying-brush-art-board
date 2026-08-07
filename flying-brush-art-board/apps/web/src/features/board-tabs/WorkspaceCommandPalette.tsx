import {
  ClockCounterClockwise,
  FolderOpen,
  House,
  MagnifyingGlass,
  Plus,
  SquaresFour,
  UploadSimple,
} from '@phosphor-icons/react'
import { Command, type CommandItem } from '@ttqtt/liquid-glass-react'
import type { ReactNode } from 'react'

import type { StoredBoard } from '@infinite-board/board-core'

function commandLabel(icon: ReactNode, label: string, shortcut?: string) {
  return <span className="command-item-label"><span>{icon}{label}</span>{shortcut ? <kbd>{shortcut}</kbd> : null}</span>
}

export function WorkspaceCommandPalette({
  open,
  onOpenChange,
  boards,
  onProjectCenter,
  onProjectHome,
  onOpenBoard,
  onCreateBoard,
  onImport,
  onShowAllBoards,
  onShowActivity,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  boards: readonly StoredBoard[]
  onProjectCenter(): void
  onProjectHome(): void
  onOpenBoard(boardId: string): void
  onCreateBoard(): void
  onImport(): void
  onShowAllBoards(): void
  onShowActivity(): void
}) {
  const items: CommandItem[] = [
    { key: 'project-center', group: '导航', label: commandLabel(<SquaresFour aria-hidden="true" />, '项目中心'), keywords: ['首页', '全部项目'], onRun: onProjectCenter },
    { key: 'project-home', group: '导航', label: commandLabel(<House aria-hidden="true" />, '当前项目首页'), keywords: ['画板列表'], onRun: onProjectHome },
    ...boards.map((board) => ({
      key: `board:${board.id}`,
      group: '打开画板',
      label: commandLabel(<FolderOpen aria-hidden="true" />, board.title),
      keywords: [board.id, board.title],
      onRun: () => onOpenBoard(board.id),
    })),
    { key: 'create-board', group: '操作', label: commandLabel(<Plus aria-hidden="true" />, '新建画板', 'Ctrl Shift N'), keywords: ['创建'], onRun: onCreateBoard },
    { key: 'import', group: '操作', label: commandLabel(<UploadSimple aria-hidden="true" />, '导入文件'), keywords: ['iboard', 'drawio', '图片', 'pdf'], onRun: onImport },
    { key: 'all-boards', group: '操作', label: commandLabel(<MagnifyingGlass aria-hidden="true" />, '浏览全部画板'), keywords: ['搜索', '切换'], onRun: onShowAllBoards },
    { key: 'activity', group: '操作', label: commandLabel(<ClockCounterClockwise aria-hidden="true" />, '查看项目活动'), keywords: ['审计', '历史'], onRun: onShowActivity },
  ]

  return <Command items={items} open={open} onOpenChange={onOpenChange} placeholder="搜索画板或运行命令…" />
}
