import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@ttqtt/liquid-glass-react'

import type {
  BoardClipboardPayload,
  BoardReferenceKind,
  BoardReferenceRecord,
  ProjectRecord,
  StoredBoard,
} from '@infinite-board/board-core'
import type { CommentBoardState, CommentClient, CommentMessageView, CommentThreadView } from '../features/comments/comment-client'
import type { AuditClient, AuditEventView } from '../features/audit/AuditPanel'

import { BoardSessionConflictError } from '../features/boards/board-session'
import type {
  CreateBoardInput,
  ProjectHomeData,
} from '../features/boards/ProjectHomePage'
import type {
  ClipboardCommandReceipt,
  WorkspaceClient,
} from '../features/board-tabs/WorkspaceShell'
import type { BoardNavigationOptions } from '../features/board-references/use-board-navigation'
import { useCurrentUser } from '../features/auth/current-user-context'
import type {
  IboardImportCommitRequest,
  IboardImportCommitResult,
  IboardInspectSession,
} from '../features/import-export/IboardImportWizard'
import { ProjectCenterPage, type CreateProjectInput, type ProjectSummary } from '../features/projects/ProjectCenterPage'
import { requestWorkspaceExit } from './workspace-exit-guard'
import { createBrowserUuid } from './browser-uuid'

const WorkspaceShell = lazy(async () => {
  const module = await import('../features/board-tabs/WorkspaceShell')
  return { default: module.WorkspaceShell }
})

async function responseJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => ({}))) as {
    code?: string
    currentRevision?: number
  }
  if (response.status === 409 && body.code === 'REVISION_CONFLICT') {
    throw new BoardSessionConflictError(body.currentRevision ?? 0)
  }
  throw Object.assign(new Error(body.code ?? `HTTP_${response.status}`), body)
}

async function retryRevisionMutation<T>(
  expectedRevision: number,
  mutation: (revision: number) => Promise<T>,
): Promise<T> {
  try {
    return await mutation(expectedRevision)
  } catch (error) {
    if (!(error instanceof BoardSessionConflictError) || error.currentRevision === expectedRevision) throw error
    return mutation(error.currentRevision)
  }
}

export class LocalApiClient implements WorkspaceClient, CommentClient, AuditClient {
  private readonly clipboardSessionId = createBrowserUuid()

  async getProject(projectId: string): Promise<ProjectHomeData> {
    return responseJson(await fetch(`/api/projects/${encodeURIComponent(projectId)}`))
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return responseJson(await fetch('/api/projects'))
  }

  async listThreads(boardId: string): Promise<CommentThreadView[]> {
    return responseJson(await fetch(`/api/boards/${encodeURIComponent(boardId)}/comments`))
  }

  async listMessages(threadId: string): Promise<CommentMessageView[]> {
    return responseJson(await fetch(`/api/comment-threads/${encodeURIComponent(threadId)}/messages`))
  }

  async loadBoardComments(boardId: string): Promise<CommentBoardState> {
    return responseJson(await fetch(`/api/boards/${encodeURIComponent(boardId)}/comment-state`))
  }

  async createThread(boardId: string, input: { body: string; shapeId?: string; x?: number; y?: number; shapeOffsetX?: number; shapeOffsetY?: number }): Promise<{ thread: CommentThreadView }> {
    return responseJson(await fetch(`/api/boards/${encodeURIComponent(boardId)}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }))
  }

  async addMessage(threadId: string, body: string): Promise<CommentMessageView> {
    return responseJson(await fetch(`/api/comment-threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) }))
  }

  async setThreadStatus(threadId: string, status: 'open' | 'resolved'): Promise<CommentThreadView> {
    return responseJson(await fetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) }))
  }

  async updateThreadAnchor(threadId: string, anchor: { x: number; y: number }): Promise<CommentThreadView> {
    return responseJson(await fetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(anchor),
    }))
  }

  async deleteThread(threadId: string): Promise<void> {
    const response = await fetch(`/api/comment-threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
    if (!response.ok) await responseJson(response)
  }

  subscribeToChanges(boardId: string, onChanged: () => void): () => void {
    const source = new EventSource(`/api/boards/${encodeURIComponent(boardId)}/comment-events`)
    const listener = () => onChanged()
    source.addEventListener('comment.changed', listener)
    return () => {
      source.removeEventListener('comment.changed', listener)
      source.close()
    }
  }

  async listAuditEvents(query: { projectId?: string; boardId?: string; actorOpenId?: string; action?: string; startAt?: string; endAt?: string; cursor?: string; limit: number }): Promise<{ events: AuditEventView[]; nextCursor?: string }> {
    const params = new URLSearchParams({ limit: String(query.limit) })
    for (const [key, value] of Object.entries(query)) {
      if (key === 'limit' || value === undefined) continue
      params.set(key, String(value))
    }
    return responseJson(await fetch(`/api/audit?${params.toString()}`))
  }

  async createProject(input: CreateProjectInput): Promise<{ project: ProjectRecord; rootBoard: StoredBoard }> {
    return responseJson(
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  }

  async renameProject(projectId: string, title: string): Promise<ProjectRecord> {
    return responseJson(await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    }))
  }

  async deleteProject(projectId: string): Promise<void> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
    if (!response.ok) await responseJson(response)
  }

  async createBoard(projectId: string, input: CreateBoardInput): Promise<StoredBoard> {
    return responseJson(
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/boards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  }

  async duplicateBoard(boardId: string, input: { id: string; title: string }): Promise<StoredBoard> {
    return responseJson(await fetch(`/api/boards/${encodeURIComponent(boardId)}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }))
  }

  async createBoardWithClipboard(
    projectId: string,
    input: CreateBoardInput,
    payload: BoardClipboardPayload,
  ): Promise<StoredBoard> {
    const result = await responseJson<{ board: StoredBoard }>(
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/boards/clipboard-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ board: input, payload, sessionId: this.clipboardSessionId }),
      }),
    )
    return result.board
  }

  async setDefaultBoard(projectId: string, boardId: string): Promise<ProjectRecord> {
    return responseJson(
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/root-board`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boardId }),
      }),
    )
  }

  async loadBoard(boardId: string): Promise<{ snapshot: unknown; revision: number }> {
    const board = await responseJson<StoredBoard>(
      await fetch(`/api/boards/${encodeURIComponent(boardId)}`),
    )
    return { snapshot: board.tldrawSnapshot, revision: board.revision }
  }

  async saveSnapshot(
    boardId: string,
    expectedRevision: number,
    snapshot: unknown,
  ): Promise<{ snapshot: unknown; revision: number }> {
    const board = await responseJson<StoredBoard>(
      await fetch(`/api/boards/${encodeURIComponent(boardId)}/snapshot`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision, snapshot }),
      }),
    )
    return { snapshot: board.tldrawSnapshot, revision: board.revision }
  }

  async pasteClipboard(
    boardId: string,
    payload: BoardClipboardPayload,
    expectedRevision: number,
  ): Promise<ClipboardCommandReceipt> {
    return retryRevisionMutation(expectedRevision, async (revision) => responseJson(
      await fetch(`/api/boards/${encodeURIComponent(boardId)}/clipboard/paste`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload,
          expectedRevision: revision,
          sessionId: this.clipboardSessionId,
          placement: { viewportCenter: true },
        }),
      }),
    ))
  }

  async undoClipboard(commandId: string, expectedRevision: number): Promise<ClipboardCommandReceipt> {
    return retryRevisionMutation(expectedRevision, async (revision) => responseJson(await fetch(`/api/clipboard/commands/${encodeURIComponent(commandId)}/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: revision, sessionId: this.clipboardSessionId }),
    })))
  }

  async redoClipboard(commandId: string, expectedRevision: number): Promise<ClipboardCommandReceipt> {
    return retryRevisionMutation(expectedRevision, async (revision) => responseJson(await fetch(`/api/clipboard/commands/${encodeURIComponent(commandId)}/redo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: revision, sessionId: this.clipboardSessionId }),
    })))
  }

  async createBoardReference(
    sourceBoardId: string,
    input:
      | { targetBoardId: string; shapeId: string; kind: BoardReferenceKind; expectedRevision: number; placement?: { x: number; y: number } }
      | { newBoard: { id: string; title: string; tldrawSnapshot: unknown }; shapeId: string; kind: 'embed'; expectedRevision: number; placement?: { x: number; y: number } },
  ): Promise<{ reference: BoardReferenceRecord; revision: number; snapshot: unknown }> {
    return retryRevisionMutation(input.expectedRevision, async (expectedRevision) =>
      responseJson(await fetch(`/api/boards/${encodeURIComponent(sourceBoardId)}/references`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, expectedRevision }),
      })),
    )
  }

  async updateBoardReference(
    referenceId: string,
    input: { targetBoardId?: string; kind?: BoardReferenceKind; expectedRevision: number },
  ): Promise<{ reference: BoardReferenceRecord; revision: number; snapshot: unknown }> {
    return retryRevisionMutation(input.expectedRevision, async (expectedRevision) =>
      responseJson(await fetch(`/api/references/${encodeURIComponent(referenceId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, expectedRevision }),
      })),
    )
  }

  async removeBoardReference(
    referenceId: string,
    expectedRevision: number,
  ): Promise<{ reference: BoardReferenceRecord; revision: number; snapshot: unknown }> {
    return retryRevisionMutation(expectedRevision, async (revision) =>
      responseJson(await fetch(`/api/references/${encodeURIComponent(referenceId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: revision }),
      })),
    )
  }

  async renameBoard(boardId: string, title: string): Promise<StoredBoard> {
    return responseJson(await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    }))
  }

  async deleteBoard(boardId: string): Promise<void> {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, { method: 'DELETE' })
    if (!response.ok) await responseJson(response)
  }

  async inspectIboard(file: File): Promise<IboardInspectSession> {
    return responseJson(await fetch('/api/import/iboard/inspect', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-iboard-file-name': encodeURIComponent(file.name),
      },
      body: file,
    }))
  }

  async commitIboardImport(request: IboardImportCommitRequest): Promise<IboardImportCommitResult> {
    return responseJson(await fetch('/api/import/iboard/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }))
  }

  async cancelIboardImport(sessionId: string): Promise<void> {
    const response = await fetch(`/api/import/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
  }
}

function parseProjectRoute(pathname: string): { projectId: string; boardId?: string } | undefined {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/boards\/([^/]+))?\/?$/)
  if (!match?.[1]) return undefined
  try {
    return {
      projectId: decodeURIComponent(match[1]),
      ...(match[2] ? { boardId: decodeURIComponent(match[2]) } : {}),
    }
  } catch {
    return undefined
  }
}

interface RouterLocation {
  pathname: string
  search: string
  historyState: unknown
}

function readRouterLocation(): RouterLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    historyState: window.history.state as unknown,
  }
}

function routeProjectId(pathname: string): string | undefined {
  try {
    return parseProjectRoute(pathname)?.projectId
  } catch {
    return undefined
  }
}

export function AppRouter() {
  const client = useMemo(() => new LocalApiClient(), [])
  const currentUser = useCurrentUser()
  const [location, setLocation] = useState<RouterLocation>(readRouterLocation)
  const locationRef = useRef(location)

  const applyLocation = (next: RouterLocation) => {
    locationRef.current = next
    setLocation(next)
  }

  useEffect(() => {
    let exitPending = false
    const update = () => {
      const next = readRouterLocation()
      const previous = locationRef.current
      const previousProjectId = routeProjectId(previous.pathname)
      const nextProjectId = routeProjectId(next.pathname)
      if (!previousProjectId || previousProjectId === nextProjectId) {
        applyLocation(next)
        return
      }

      const previousUrl = `${previous.pathname}${previous.search}`
      window.history.replaceState(previous.historyState ?? null, '', previousUrl)
      if (exitPending) return
      exitPending = true
      void requestWorkspaceExit().then(() => {
        window.history.replaceState(
          next.historyState ?? null,
          '',
          `${next.pathname}${next.search}`,
        )
        applyLocation(next)
      }).catch(() => {
        applyLocation(previous)
      }).finally(() => {
        exitPending = false
      })
    }
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  const navigate = (path: string, options: BoardNavigationOptions = {}) => {
    const currentPath = `${window.location.pathname}${window.location.search}`
    if (options.replace) {
      window.history.replaceState(options.state ?? null, '', path)
    } else if (currentPath !== path || options.state !== undefined) {
      window.history.pushState(options.state ?? null, '', path)
    }
    applyLocation(readRouterLocation())
  }
  const route = parseProjectRoute(location.pathname)
  if (route) {
    const routePathReferenceIds = new URLSearchParams(location.search)
      .get('path')
      ?.split(',')
      .map((referenceId) => referenceId.trim())
      .filter(Boolean) ?? []
    return (
      <Suspense fallback={<main className="workspace-loading" role="status" aria-label="正在加载工作区"><span /><span /><span /></main>}>
        <WorkspaceShell
          key={route.projectId}
          projectId={route.projectId}
          {...(route.boardId ? { routeBoardId: route.boardId } : {})}
          routePathReferenceIds={routePathReferenceIds}
          routeHistoryState={location.historyState}
          client={client}
          navigate={navigate}
          enableRealtime={
            currentUser.realtimeEnabled === true
            && new URLSearchParams(location.search).get('realtime') !== '0'
          }
        />
      </Suspense>
    )
  }
  if (location.pathname === '/') {
    return <ProjectCenterPage client={client} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />
  }
  return (
    <main className="not-found-page">
      <h1>页面不存在</h1>
      <Button variant="accent" type="button" onClick={() => navigate('/')}>返回首页</Button>
    </main>
  )
}
