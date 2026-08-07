import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Input, Modal, Radio, RadioGroup, Select } from '@ttqtt/liquid-glass-react'

import type { BoardReferenceKind } from '@infinite-board/board-core'

export type CreateBoardReferenceInput =
  | { mode: 'existing'; targetBoardId: string; kind: BoardReferenceKind }
  | { mode: 'new'; title: string }

export interface CreateBoardReferenceDialogProps {
  open: boolean
  boards: ReadonlyArray<{ id: string; title: string }>
  currentBoardId?: string
  onCreate(input: CreateBoardReferenceInput): void | Promise<void>
  onCancel(): void
}

export function CreateBoardReferenceDialog({
  open,
  boards,
  currentBoardId,
  onCreate,
  onCancel,
}: CreateBoardReferenceDialogProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [targetBoardId, setTargetBoardId] = useState('')
  const [kind, setKind] = useState<BoardReferenceKind>('embed')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const availableBoards = useMemo(
    () => boards.filter((board) => board.id !== currentBoardId),
    [boards, currentBoardId],
  )

  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setMode(availableBoards.length ? 'existing' : 'new')
    setTargetBoardId(availableBoards[0]?.id ?? '')
  }, [availableBoards, open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const input = mode === 'new'
      ? title.trim() ? { mode: 'new' as const, title: title.trim() } : undefined
      : targetBoardId ? { mode: 'existing' as const, targetBoardId, kind } : undefined
    if (!input) return
    setSubmitting(true)
    try {
      await onCreate(input)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}
      title="创建画板引用"
      size="sm"
      footer={(
        <div className="dialog__actions">
          <Button variant="ghost" type="button" disabled={submitting} onClick={onCancel}>取消</Button>
          <Button
            variant="accent"
            type="submit"
            form="board-reference-form"
            loading={submitting}
            disabled={submitting || (mode === 'new' ? !title.trim() : !targetBoardId)}
          >
            创建引用
          </Button>
        </div>
      )}
    >
      <form id="board-reference-form" className="board-reference-dialog" aria-label="创建画板引用" onSubmit={submit}>
        <div className="board-reference-dialog__mode">
          <span>引用目标</span>
          <RadioGroup
            aria-label="引用目标"
            name="reference-target-mode"
            value={mode}
            onChange={(value) => setMode(value as 'existing' | 'new')}
            orientation="horizontal"
          >
            <Radio value="existing" disabled={!availableBoards.length}>引用已有画板</Radio>
            <Radio value="new">新建目标画板</Radio>
          </RadioGroup>
        </div>
        {mode === 'existing' ? (
          <div className="board-reference-dialog__fields">
            <label>
              <span>目标画板</span>
              <Select
              aria-label="目标画板"
              size="lg"
              value={targetBoardId}
              onChange={setTargetBoardId}
              options={availableBoards.map((board) => ({ value: board.id, label: board.title }))}
            />
            </label>
            <label>
              <span>引用类型</span>
              <Select
              aria-label="引用类型"
              size="lg"
              value={kind}
              onChange={(value) => setKind(value as BoardReferenceKind)}
              options={[
                { value: 'embed', label: '嵌入画板' },
                { value: 'link', label: '普通链接' },
              ]}
            />
            </label>
            <p className="board-reference-dialog__hint">嵌入画板用于建立层级，不能形成循环；普通链接仅用于跳转，可以互相引用。</p>
          </div>
        ) : (
          <label className="board-reference-dialog__field" htmlFor="board-reference-title">
            <span>新画板名称</span>
            <Input
              id="board-reference-title"
              size="lg"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="例如：研究笔记"
            />
          </label>
        )}
      </form>
    </Modal>
  )
}
