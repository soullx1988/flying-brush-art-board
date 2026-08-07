import { useEffect, useMemo, useSyncExternalStore } from 'react'

import {
  BoardSession,
  type BoardEditor,
  type BoardSessionApi,
  type BoardSessionFlushResult,
  type BoardSessionStatus,
} from './board-session'

export interface UseBoardSessionOptions {
  api: BoardSessionApi
  tabId: string
  boardId: string
  editor: BoardEditor | undefined
  session?: BoardSession
}

export interface UseBoardSessionResult {
  session: BoardSession
  status: BoardSessionStatus
  flush(): Promise<BoardSessionFlushResult>
  flushBeforeNavigation(): Promise<BoardSessionFlushResult>
  flushBeforeClose(): Promise<BoardSessionFlushResult>
  flushBeforeReferenceEntry(): Promise<BoardSessionFlushResult>
  retry(): Promise<BoardSessionFlushResult>
  reloadFromServer(): ReturnType<BoardSession['reloadFromServer']>
  copyRecoverySnapshot(): unknown | undefined
}

export function useBoardSession(options: UseBoardSessionOptions): UseBoardSessionResult {
  const ownedSession = useMemo(
    () => new BoardSession({ api: options.api }),
    [options.api, options.boardId, options.tabId],
  )
  const session = options.session ?? ownedSession
  const status = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.status,
    () => session.status,
  )

  useEffect(() => {
    const editor = options.editor
    if (!editor) return
    void session.mount(options.tabId, options.boardId, editor).catch(() => undefined)
    return () => {
      void session.flushBeforeNavigation()
      session.detachEditor()
    }
  }, [options.boardId, options.editor, options.tabId, session])

  useEffect(() => {
    const flushBeforePageExit = (event: BeforeUnloadEvent) => {
      if (!session.hasPendingChanges) return
      event.preventDefault()
      event.returnValue = ''
      void session.flushBeforeClose()
    }
    const flushOnPageHide = () => {
      if (session.hasPendingChanges) void session.flushBeforeClose()
    }
    window.addEventListener('beforeunload', flushBeforePageExit)
    window.addEventListener('pagehide', flushOnPageHide)
    return () => {
      window.removeEventListener('beforeunload', flushBeforePageExit)
      window.removeEventListener('pagehide', flushOnPageHide)
    }
  }, [session])

  return {
    session,
    status,
    flush: () => session.flush(),
    flushBeforeNavigation: () => session.flushBeforeNavigation(),
    flushBeforeClose: () => session.flushBeforeClose(),
    flushBeforeReferenceEntry: () => session.flushBeforeReferenceEntry(),
    retry: () => session.retry(),
    reloadFromServer: () => session.reloadFromServer(),
    copyRecoverySnapshot: () => session.copyRecoverySnapshot(),
  }
}
