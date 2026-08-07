import { useMemo, useState, type FormEvent } from 'react'
import type {
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { Button, Card, Input, Modal, Segmented, Select, toast } from '@ttqtt/liquid-glass-react'

import { BoardList } from './BoardList'
import {
  readBoardPreferences,
  removeBoardPreference,
  setBoardArchived,
  toggleBoardFavorite,
  type BoardPreferences,
} from './board-preferences'

type BoardView = 'active' | 'archived'
type BoardSort = 'recent' | 'name' | 'references'

export interface AllBoardsPanelProps {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  onOpenBoard(boardId: string, mode: 'current' | 'new'): void
  onSetDefault(boardId: string): void
  onCreateBoard?(): void
  onRenameBoard?(boardId: string, title: string): void | Promise<void>
  onDuplicateBoard?(board: StoredBoard): void | Promise<void>
  onDeleteBoard?(board: StoredBoard): void | Promise<void>
  onDragBoardStart?(boardId: string): void
  compact?: boolean
}

export function AllBoardsPanel({
  project,
  boards,
  references,
  onOpenBoard,
  onSetDefault,
  onCreateBoard,
  onRenameBoard,
  onDuplicateBoard,
  onDeleteBoard,
  onDragBoardStart,
  compact = false,
}: AllBoardsPanelProps) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<BoardView>('active')
  const [sort, setSort] = useState<BoardSort>('recent')
  const [preferences, setPreferences] = useState<BoardPreferences>(() => readBoardPreferences(project.id))
  const [renameBoard, setRenameBoard] = useState<StoredBoard>()
  const [renameTitle, setRenameTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const visibleBoards = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    const archived = new Set(preferences.archivedIds)
    const favorites = new Set(preferences.favoriteIds)
    const referenceCount = (boardId: string) => references.filter((reference) => reference.sourceBoardId === boardId || reference.targetBoardId === boardId).length
    return [...boards]
      .filter((board) => (view === 'archived') === archived.has(board.id))
      .filter((board) => !normalizedQuery || board.title.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
      .sort((left, right) => {
        const favoriteDifference = Number(favorites.has(right.id)) - Number(favorites.has(left.id))
        if (favoriteDifference !== 0) return favoriteDifference
        if (sort === 'name') return left.title.localeCompare(right.title, 'zh-CN')
        if (sort === 'references') return referenceCount(right.id) - referenceCount(left.id)
        return right.updatedAt.localeCompare(left.updatedAt)
      })
  }, [boards, preferences, query, references, sort, view])

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    const title = renameTitle.trim()
    if (!renameBoard || !title || !onRenameBoard) return
    setBusy(true)
    try {
      await onRenameBoard(renameBoard.id, title)
      toast.success('画板名称已更新')
      setRenameBoard(undefined)
    } catch {
      toast.error('无法重命名画板，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const duplicateBoard = async (board: StoredBoard) => {
    if (!onDuplicateBoard) return
    try {
      await onDuplicateBoard(board)
      toast.success('画板副本已创建')
    } catch {
      toast.error('无法创建画板副本，请稍后重试。')
    }
  }

  const deleteBoard = async (board: StoredBoard) => {
    if (!onDeleteBoard) return
    const confirmed = await Modal.confirm({
      title: '删除画板',
      content: `“${board.title}”将被永久删除。`,
      okText: '删除画板',
      cancelText: '取消',
      danger: true,
      locale: 'zh-CN',
    })
    if (!confirmed) return
    try {
      await onDeleteBoard(board)
      setPreferences(removeBoardPreference(project.id, board.id))
      toast.success('画板已删除')
    } catch {
      toast.error('无法删除画板。请确认它不是默认入口，且没有被其他画板引用。')
    }
  }

  return (
    <Card as="section" className={compact ? 'all-boards-panel all-boards-panel--compact' : 'all-boards-panel'} padding="lg" radius="24px" aria-labelledby="all-boards-heading">
      <div className="all-boards-panel__heading">
        <div>
          <p className="eyebrow">画板库</p>
          <h2 id="all-boards-heading">{view === 'active' ? '全部画板' : '个人归档'} <span>{visibleBoards.length}</span></h2>
        </div>
        {onCreateBoard ? <Button variant="accent" size="sm" icon={<Plus aria-hidden="true" />} onClick={onCreateBoard}>新建画板</Button> : null}
      </div>
      <div className="all-boards-panel__toolbar">
        <Input aria-label="搜索画板" prefix={<MagnifyingGlass aria-hidden="true" />} placeholder="搜索画板" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <Select
          aria-label="画板排序"
          value={sort}
          onChange={(value) => setSort(value as BoardSort)}
          options={[
            { value: 'recent', label: '最近更新' },
            { value: 'name', label: '名称' },
            { value: 'references', label: '引用数量' },
          ]}
        />
        <Segmented
          aria-label="画板状态"
          value={view}
          onChange={(value) => setView(value as BoardView)}
          options={[{ value: 'active', label: '使用中' }, { value: 'archived', label: '个人归档' }]}
        />
      </div>
      <BoardList
        project={project}
        boards={visibleBoards}
        references={references}
        preferences={preferences}
        onOpenBoard={onOpenBoard}
        onSetDefault={onSetDefault}
        onToggleFavorite={(boardId) => setPreferences(toggleBoardFavorite(project.id, boardId))}
        onArchive={(boardId, archived) => {
          setPreferences(setBoardArchived(project.id, boardId, archived))
          toast.success(archived ? '已移至个人归档（仅当前浏览器）' : '已移出个人归档')
        }}
        {...(onRenameBoard ? { onRename: (board) => { setRenameBoard(board); setRenameTitle(board.title) } } : {})}
        {...(onDuplicateBoard ? { onDuplicate: (board) => void duplicateBoard(board) } : {})}
        {...(onDeleteBoard ? { onDelete: (board) => void deleteBoard(board) } : {})}
        {...(onDragBoardStart ? { onDragBoardStart } : {})}
      />
      <Modal
        open={Boolean(renameBoard)}
        onOpenChange={(open) => { if (!open && !busy) setRenameBoard(undefined) }}
        title="重命名画板"
        size="sm"
        footer={(
          <div className="dialog__actions">
            <Button variant="ghost" disabled={busy} onClick={() => setRenameBoard(undefined)}>取消</Button>
            <Button variant="accent" loading={busy} disabled={busy || !renameTitle.trim()} type="submit" form="rename-board-form">保存</Button>
          </div>
        )}
      >
        <form id="rename-board-form" className="dialog-form" onSubmit={submitRename}>
          <label htmlFor="rename-board-title">画板名称</label>
          <Input id="rename-board-title" autoFocus size="lg" value={renameTitle} onChange={(event) => setRenameTitle(event.currentTarget.value)} />
        </form>
      </Modal>
    </Card>
  )
}
