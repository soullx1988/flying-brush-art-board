import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentUserContext } from '../features/auth/current-user-context'
import { AppRouter, LocalApiClient } from './router'
import { registerWorkspaceExitGuard } from './workspace-exit-guard'

vi.mock('../features/board-tabs/WorkspaceShell', () => ({
  WorkspaceShell: ({ enableRealtime }: { enableRealtime?: boolean }) => (
    <output data-testid="realtime-mode">{String(enableRealtime)}</output>
  ),
}))

vi.mock('../features/projects/ProjectCenterPage', () => ({
  ProjectCenterPage: () => <output data-testid="project-center" />,
}))

describe('AppRouter', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('retries a structural reference deletion once with the server revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'REVISION_CONFLICT',
        currentRevision: 4,
      }), { status: 409, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        reference: { id: 'reference-1' },
        revision: 5,
        snapshot: { store: {} },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await new LocalApiClient().removeBoardReference('reference-1', 2)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ expectedRevision: 2 })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ expectedRevision: 4 })
  })

  it('retries a clipboard paste once with the latest realtime revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'REVISION_CONFLICT',
        currentRevision: 7,
      }), { status: 409, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        commandId: 'command-1', boardId: 'board-1', revision: 8, snapshot: { store: {} },
        idMap: {}, createdReferenceIds: [],
      }), { status: 201, headers: { 'content-type': 'application/json' } }))

    await new LocalApiClient().pasteClipboard('board-1', {
      version: 1, sourceProjectId: 'project-1', sourceBoardId: 'board-1',
      shapes: [], bindings: [], references: [], assets: [], copiedAt: '2026-08-02T00:00:00.000Z',
    }, 3, { x: 120, y: 240 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      expectedRevision: 3,
      placement: { x: 120, y: 240 },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      expectedRevision: 7,
      placement: { x: 120, y: 240 },
    })
  })

  it('uses the offline editor when the authenticated runtime disables realtime collaboration', async () => {
    window.history.replaceState(null, '', '/projects/project-1/boards/board-1')

    render(
      <CurrentUserContext value={{ openId: 'local-acceptance-user', name: 'Local acceptance user', realtimeEnabled: false }}>
        <AppRouter />
      </CurrentUserContext>,
    )

    expect(await screen.findByTestId('realtime-mode')).toHaveTextContent('false')
  })

  it('waits for the workspace exit guard before applying a popstate outside the project', async () => {
    window.history.replaceState(null, '', '/projects/project-1/boards/board-1')
    let finishExit: (() => void) | undefined
    const unregister = registerWorkspaceExitGuard(
      () => new Promise<void>((resolve) => { finishExit = resolve }),
    )
    render(
      <CurrentUserContext value={{ openId: 'local-acceptance-user', name: 'Local acceptance user', realtimeEnabled: false }}>
        <AppRouter />
      </CurrentUserContext>,
    )
    await screen.findByTestId('realtime-mode')

    window.history.replaceState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(window.location.pathname).toBe('/projects/project-1/boards/board-1')
    expect(screen.queryByTestId('project-center')).not.toBeInTheDocument()

    finishExit?.()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByTestId('project-center')).toBeInTheDocument()
    unregister()
  })
})
