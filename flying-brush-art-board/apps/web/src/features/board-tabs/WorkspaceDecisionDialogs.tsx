import { Button, Input, Modal } from '@ttqtt/liquid-glass-react'

export function WorkspaceDecisionDialogs({
  pendingCloseOpen,
  onPendingCloseOpenChange,
  onResolvePendingClose,
  pendingCloseBusy,
  pendingCloseError,
  referenceRenameOpen,
  referenceRenameTitle,
  onReferenceRenameTitleChange,
  onReferenceRenameOpenChange,
  onSaveReferenceRename,
}: {
  pendingCloseOpen: boolean
  onPendingCloseOpenChange(open: boolean): void
  onResolvePendingClose(action: 'save' | 'copy-recovery' | 'discard'): void
  pendingCloseBusy?: boolean
  pendingCloseError?: string
  referenceRenameOpen: boolean
  referenceRenameTitle: string
  onReferenceRenameTitleChange(title: string): void
  onReferenceRenameOpenChange(open: boolean): void
  onSaveReferenceRename(): void
}) {
  return (
    <>
      <Modal
        open={pendingCloseOpen}
        onOpenChange={onPendingCloseOpenChange}
        title="关闭未保存的画板"
        size="sm"
        footer={(
          <div className="dialog__actions dialog__actions--three">
            <Button variant="ghost" type="button" disabled={pendingCloseBusy} onClick={() => onPendingCloseOpenChange(false)}>继续编辑</Button>
            <Button variant="danger" type="button" disabled={pendingCloseBusy} onClick={() => onResolvePendingClose('discard')}>放弃更改</Button>
            <Button variant="glass" type="button" loading={Boolean(pendingCloseBusy)} disabled={pendingCloseBusy} onClick={() => onResolvePendingClose('copy-recovery')}>下载恢复副本并关闭</Button>
            <Button variant="accent" type="button" loading={Boolean(pendingCloseBusy)} disabled={pendingCloseBusy} onClick={() => onResolvePendingClose('save')}>保存并关闭</Button>
          </div>
        )}
      >
        <p>这个画板还有未保存的更改。建议先保存；如果保存失败，可下载本地恢复副本后关闭。</p>
        {pendingCloseError ? <p role="alert">{pendingCloseError}</p> : null}
      </Modal>
      <Modal
        open={referenceRenameOpen}
        onOpenChange={onReferenceRenameOpenChange}
        title="重命名目标画板"
        size="sm"
        footer={(
          <div className="dialog__actions">
            <Button variant="ghost" type="button" onClick={() => onReferenceRenameOpenChange(false)}>取消</Button>
            <Button
              variant="accent"
              type="button"
              disabled={!referenceRenameTitle.trim()}
              onClick={onSaveReferenceRename}
            >保存</Button>
          </div>
        )}
      >
        <div className="dialog-form">
          <label htmlFor="reference-rename-title">画板名称</label>
          <Input
            id="reference-rename-title"
            autoFocus
            size="lg"
            value={referenceRenameTitle}
            onChange={(event) => onReferenceRenameTitleChange(event.currentTarget.value)}
          />
        </div>
      </Modal>
    </>
  )
}
