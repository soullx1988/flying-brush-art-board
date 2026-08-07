import { useCallback, useEffect, useState } from 'react'
import { useValue } from 'tldraw'
import { Button } from '@ttqtt/liquid-glass-react'
import type { BoardPageProps } from '../boards/BoardPage'
import { BoardPage } from '../boards/BoardPage'

import { CollaborationStatus } from './CollaborationStatus'
import { useRealtimeBoardStore } from './use-realtime-board-store'

export type RealtimeBoardPageProps = Omit<BoardPageProps, 'store' | 'boardId' | 'collaborationStatus'> & {
  boardId: string
}

/**
 * Keeps the tldraw sync hook inside React while the tab shell continues to own
 * browser history, camera state, and structural command navigation.
 */
export function RealtimeBoardPage(props: RealtimeBoardPageProps) {
  const [attempt, setAttempt] = useState(0)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const reconnect = useCallback((manual = false) => {
    setRetryAttempt((current) => manual ? 0 : current + 1)
    setAttempt((current) => current + 1)
  }, [])
  const connected = useCallback(() => setRetryAttempt(0), [])
  return (
    <RealtimeBoardConnection
      key={`${props.boardId}:${props.inputSessionKey}:${attempt}`}
      {...props}
      retryAttempt={retryAttempt}
      onReconnect={() => reconnect()}
      onManualReconnect={() => reconnect(true)}
      onConnected={connected}
    />
  )
}

const MAX_AUTOMATIC_RETRIES = 6

function RealtimeBoardConnection({
  boardId,
  onReconnect,
  onManualReconnect,
  onConnected,
  retryAttempt,
  ...props
}: RealtimeBoardPageProps & {
  retryAttempt: number
  onReconnect(): void
  onManualReconnect(): void
  onConnected(): void
}) {
  const remote = useRealtimeBoardStore(boardId)
  const remoteStore = remote.status === 'synced-remote' ? remote.store : undefined
  const onlineCount = useValue(
    'online collaborators',
    () => remoteStore?.query.records('instance_presence').get().length ?? 0,
    [remoteStore],
  )

  useEffect(() => {
    if (remote.status === 'synced-remote') {
      onConnected()
      return
    }
    if (retryAttempt >= MAX_AUTOMATIC_RETRIES) return
    const delay = remote.status === 'error'
      ? Math.min(1_000 * 2 ** retryAttempt, 10_000)
      : 1_000
    const timer = window.setTimeout(onReconnect, delay)
    return () => window.clearTimeout(timer)
  }, [onConnected, onReconnect, remote.status, retryAttempt])

  if (remote.status === 'loading') {
    return <p className="loading-state" role="status">正在连接协作房间…</p>
  }
  if (remote.status === 'error') {
    return (
      <div className="loading-state" role="status">
        <p>协作连接中断，正在重新连接…</p>
        {retryAttempt >= MAX_AUTOMATIC_RETRIES ? (
          <Button variant="accent" size="sm" onClick={onManualReconnect}>立即重试</Button>
        ) : null}
      </div>
    )
  }

  return (
    <BoardPage
      {...props}
      boardId={boardId}
      store={remote.store}
      collaborationStatus={<CollaborationStatus status="online" onlineCount={onlineCount} />}
    />
  )
}
