import type { BoardHistoryEntry } from '@infinite-board/board-core'

export interface HistoryBreadcrumbsProps {
  entries: readonly BoardHistoryEntry[]
  getBoardTitle(boardId: string): string
  onBack(): void
  onProjectHome(): void
  onGoToEntry(index: number): void
}

export function HistoryBreadcrumbs({
  entries,
  getBoardTitle,
  onBack,
  onProjectHome,
  onGoToEntry,
}: HistoryBreadcrumbsProps) {
  return (
    <nav className="history-breadcrumbs" aria-label="访问历史">
      <button type="button" className="history-breadcrumbs__back" onClick={onBack}>
        返回
      </button>
      <button type="button" className="history-breadcrumbs__home" onClick={onProjectHome}>
        项目首页
      </button>
      {entries.slice(0, -1).map((entry, index) => {
        return (
          <span className="history-breadcrumbs__entry" key={entry.entryId}>
            <span aria-hidden="true">/</span>
            <button type="button" onClick={() => onGoToEntry(index)}>
              {getBoardTitle(entry.boardId)}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
