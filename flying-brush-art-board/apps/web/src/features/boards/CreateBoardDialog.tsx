import { useId, useState, type FormEvent } from 'react'
import { Plus } from '@phosphor-icons/react'
import { Button, Checkbox, Input, Modal } from '@ttqtt/liquid-glass-react'

export interface CreateBoardDialogProps {
  open: boolean
  submitting?: boolean
  fixedOpenMode?: 'current' | 'new'
  onCancel(): void
  onCreate(title: string, openInNewTab: boolean): void | Promise<void>
}

export function CreateBoardDialog({
  open,
  submitting = false,
  fixedOpenMode,
  onCancel,
  onCreate,
}: CreateBoardDialogProps) {
  const titleId = useId()
  const [title, setTitle] = useState('')
  const [openInNewTab, setOpenInNewTab] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    void onCreate(trimmedTitle, fixedOpenMode ? fixedOpenMode === 'new' : openInNewTab)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen && !submitting) onCancel() }}
      title={<span id={`${titleId}-heading`}>新建画板</span>}
      size="sm"
      closeOnOverlayClick={!submitting}
      footer={(
        <div className="dialog__actions">
          <Button variant="ghost" type="button" disabled={submitting} onClick={onCancel}>取消</Button>
          <Button variant="accent" icon={<Plus aria-hidden="true" />} type="submit" form={`${titleId}-form`} loading={submitting} disabled={submitting || !title.trim()}>
            创建
          </Button>
        </div>
      )}
    >
      <form id={`${titleId}-form`} className="dialog-form" onSubmit={submit}>
        <label htmlFor={titleId}>画板名称</label>
        <Input
          id={titleId}
          size="lg"
          autoFocus
          value={title}
          placeholder="例如：用户旅程"
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        {!fixedOpenMode ? (
          <Checkbox checked={openInNewTab} onCheckedChange={setOpenInNewTab}>
            创建后在新标签打开
          </Checkbox>
        ) : null}
      </form>
    </Modal>
  )
}
