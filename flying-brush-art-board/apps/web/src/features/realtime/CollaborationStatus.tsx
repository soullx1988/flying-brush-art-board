export type CollaborationConnectionStatus = 'connecting' | 'online' | 'error'

const LABELS: Record<CollaborationConnectionStatus, string> = {
  connecting: '正在连接协作房间',
  online: '协作已连接',
  error: '协作连接失败',
}

export function CollaborationStatus({
  status,
  onlineCount,
}: {
  status: CollaborationConnectionStatus
  onlineCount?: number
}) {
  const suffix = status === 'online' && onlineCount !== undefined
    ? ` · ${onlineCount} 人在线`
    : ''
  return (
    <span className={`collaboration-status collaboration-status--${status}`} role="status">
      {LABELS[status]}{suffix}
    </span>
  )
}
