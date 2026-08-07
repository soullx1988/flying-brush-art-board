import { Drawer } from '@ttqtt/liquid-glass-react'

import type { StoredBoard } from '@infinite-board/board-core'

import { AuditPanel, type AuditClient } from '../audit/AuditPanel'
import { AllBoardsPanel } from '../boards/AllBoardsPanel'
import type { ProjectHomeData } from '../boards/ProjectHomePage'

export type WorkspaceLibraryPanel = 'boards' | 'activity'

export function WorkspaceLibraryDrawers({
  panel,
  onPanelChange,
  projectId,
  data,
  auditClient,
  onOpenBoard,
  onSetDefault,
  onCreateBoard,
  onRenameBoard,
  onDuplicateBoard,
  onDeleteBoard,
}: {
  panel: WorkspaceLibraryPanel | undefined
  onPanelChange(panel: WorkspaceLibraryPanel | undefined): void
  projectId: string
  data: ProjectHomeData | undefined
  auditClient?: AuditClient
  onOpenBoard(boardId: string, mode: 'current' | 'new'): void
  onSetDefault(boardId: string): void
  onCreateBoard(): void
  onRenameBoard(boardId: string, title: string): void | Promise<void>
  onDuplicateBoard(board: StoredBoard): void | Promise<void>
  onDeleteBoard(board: StoredBoard): void | Promise<void>
}) {
  return (
    <>
      <Drawer
        open={panel === 'boards'}
        onOpenChange={(open) => { if (!open) onPanelChange(undefined) }}
        placement="right"
        size={560}
        title="全部画板"
      >
        {data ? (
          <AllBoardsPanel
            compact
            project={data.project}
            boards={data.boards}
            references={data.references}
            onOpenBoard={onOpenBoard}
            onSetDefault={onSetDefault}
            onCreateBoard={onCreateBoard}
            onRenameBoard={onRenameBoard}
            onDuplicateBoard={onDuplicateBoard}
            onDeleteBoard={onDeleteBoard}
          />
        ) : null}
      </Drawer>
      <Drawer
        open={panel === 'activity'}
        onOpenChange={(open) => { if (!open) onPanelChange(undefined) }}
        placement="right"
        size={560}
        title="项目活动"
      >
        {data && auditClient ? (
          <AuditPanel
            projectId={projectId}
            client={auditClient}
            boards={data.boards}
            onOpenBoard={(boardId) => onOpenBoard(boardId, 'current')}
          />
        ) : <p className="empty-state">当前环境没有启用操作审计。</p>}
      </Drawer>
    </>
  )
}
