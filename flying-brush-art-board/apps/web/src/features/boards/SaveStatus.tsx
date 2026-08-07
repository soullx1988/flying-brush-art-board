import type { BoardSessionStatus } from './board-session'
import { Button } from '@ttqtt/liquid-glass-react'

export interface SaveStatusProps {
  status: BoardSessionStatus
  leaseHolderTabId?: string
  onRetry?: () => void
  onReload?: () => void
  onCopyRecovery?: () => void
}

const STATUS_LABELS: Record<BoardSessionStatus, string> = {
  loading: '正在加载画板',
  clean: '已保存',
  dirty: '有未保存的更改',
  saving: '正在保存',
  conflict: '保存冲突',
  offline: '离线更改已保留',
  error: '保存失败',
}

export function SaveStatus({
  status,
  leaseHolderTabId,
  onRetry,
  onReload,
  onCopyRecovery,
}: SaveStatusProps) {
  return (
    <div role="status" aria-live="polite" data-save-status={status}>
      <span>{STATUS_LABELS[status]}</span>
      {leaseHolderTabId ? <span> 此画板正在另一个标签页编辑</span> : null}
      {status === 'conflict' ? (
        <>
          {onReload ? (
            <Button variant="glass" size="sm" type="button" onClick={onReload}>重新加载服务器版本</Button>
          ) : null}
          {onCopyRecovery ? (
            <Button variant="glass" size="sm" type="button" onClick={onCopyRecovery}>下载恢复副本</Button>
          ) : null}
        </>
      ) : null}
      {status === 'offline' || status === 'error' ? (
        <>
          {onRetry ? <Button variant="glass" size="sm" type="button" onClick={onRetry}>重试保存</Button> : null}
          {onCopyRecovery ? <Button variant="glass" size="sm" type="button" onClick={onCopyRecovery}>下载恢复副本</Button> : null}
        </>
      ) : null}
    </div>
  )
}
