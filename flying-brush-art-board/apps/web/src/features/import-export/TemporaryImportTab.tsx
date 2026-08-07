import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

export type TemporaryImportStatus =
  | 'selecting'
  | 'inspecting'
  | 'ready'
  | 'committing'
  | 'error'

export interface TemporaryImportTabProps {
  fileName: string
  status: TemporaryImportStatus
  closeDisabled?: boolean
  portalTargetId?: string
  onClose(): void
}

const STATUS_LABELS: Record<TemporaryImportStatus, string> = {
  selecting: '等待选择文件',
  inspecting: '正在预检',
  ready: '等待确认',
  committing: '正在合并',
  error: '需要处理',
}

export function TemporaryImportTab({
  fileName,
  status,
  closeDisabled = false,
  portalTargetId,
  onClose,
}: TemporaryImportTabProps) {
  const tab = (
    <div className="temporary-import-tab-shell">
      <div
        className="temporary-import-tab"
        role="tab"
        aria-selected="false"
        aria-label={`导入 ${fileName}`}
      >
        <span>导入 {fileName}</span>
        <span className="tab-status">{STATUS_LABELS[status]}</span>
      </div>
      <button
        type="button"
        className="temporary-import-tab__close"
        aria-label="关闭导入标签"
        disabled={closeDisabled}
        onClick={onClose}
      >
        <X weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
  if (!portalTargetId) return tab
  const target = document.getElementById(portalTargetId)
  return target ? createPortal(tab, target) : null
}
