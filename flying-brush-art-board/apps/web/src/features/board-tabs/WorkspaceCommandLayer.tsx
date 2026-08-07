import { useRef } from 'react'

import type { StoredBoard } from '@infinite-board/board-core'

import { WorkspaceCommandPalette } from './WorkspaceCommandPalette'

export function WorkspaceCommandLayer({
  open,
  onOpenChange,
  boards,
  onProjectCenter,
  onProjectHome,
  onOpenBoard,
  onCreateBoard,
  onImportFiles,
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
  onImportFiles(files: readonly File[]): void
  onShowAllBoards(): void
  onShowActivity(): void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".iboard,.tldr,.drawio,.png,.jpg,.jpeg,.webp,.svg,.pdf"
        aria-label="从命令面板选择导入文件"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]
          event.currentTarget.value = ''
          if (files.length > 0) onImportFiles(files)
        }}
      />
      <WorkspaceCommandPalette
        open={open}
        onOpenChange={onOpenChange}
        boards={boards}
        onProjectCenter={onProjectCenter}
        onProjectHome={onProjectHome}
        onOpenBoard={onOpenBoard}
        onCreateBoard={onCreateBoard}
        onImport={() => fileInputRef.current?.click()}
        onShowAllBoards={onShowAllBoards}
        onShowActivity={onShowActivity}
      />
    </>
  )
}
