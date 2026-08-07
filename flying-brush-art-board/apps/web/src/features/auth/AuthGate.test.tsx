import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from './AuthGate'
import type { AuthClient } from './auth-client'
import { registerWorkspaceExitGuard } from '../../app/workspace-exit-guard'

function renderGate(auth: AuthClient) {
  return render(<AuthGate auth={auth}><p>private canvas</p></AuthGate>)
}

afterEach(cleanup)

describe('AuthGate', () => {
  it('does not render workspace data until current user is authenticated', async () => {
    let resolveUser!: (value: { openId: string; name: string } | undefined) => void
    const auth: AuthClient = { getMe: () => new Promise((resolve) => { resolveUser = resolve }), logout: async () => {}, loginUrl: () => '/auth/feishu/start?returnTo=%2F' }
    renderGate(auth)
    expect(screen.getByText('正在验证身份…')).toBeInTheDocument()
    expect(screen.queryByText('private canvas')).not.toBeInTheDocument()
    resolveUser({ openId: 'ou_1', name: 'Ada' })
    expect(await screen.findByText('private canvas')).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
  })

  it('shows only login for an anonymous user and preserves the return path', async () => {
    const auth: AuthClient = { getMe: async () => undefined, logout: async () => {}, loginUrl: (returnTo) => `/auth/feishu/start?returnTo=${encodeURIComponent(returnTo)}` }
    window.history.replaceState(null, '', '/projects/p1?path=ref-1')
    renderGate(auth)
    const login = await screen.findByRole('link', { name: '使用飞书登录' })
    expect(login).toHaveAttribute('href', '/auth/feishu/start?returnTo=%2Fprojects%2Fp1%3Fpath%3Dref-1')
    expect(screen.queryByText('private canvas')).not.toBeInTheDocument()
  })

  it('limits the compact account name to four characters while preserving the full name', async () => {
    const auth: AuthClient = {
      getMe: async () => ({ openId: 'ou_1', name: '王者冲突测试' }),
      logout: async () => {},
      loginUrl: () => '/',
    }
    renderGate(auth)
    expect(await screen.findByText('王者冲突')).toHaveAttribute('title', '王者冲突测试')
    expect(screen.queryByText('王者冲突测试')).not.toBeInTheDocument()
  })

  it('explains allowlist errors and logs out an authenticated user', async () => {
    const denied: AuthClient = { getMe: async () => { throw Object.assign(new Error('USER_NOT_ALLOWED'), { code: 'USER_NOT_ALLOWED' }) }, logout: async () => {}, loginUrl: () => '/' }
    const deniedView = renderGate(denied)
    expect(await screen.findByRole('alert')).toHaveTextContent('不在允许名单')
    deniedView.unmount()

    const logout = vi.fn(async () => {})
    const auth: AuthClient = { getMe: async () => ({ openId: 'ou_1', name: 'Ada', department: 'Engineering', position: 'Designer' }), logout, loginUrl: () => '/' }
    const view = renderGate(auth)
    fireEvent.click(await screen.findByRole('button', { name: '退出' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(await screen.findByRole('link', { name: '使用飞书登录' })).toBeInTheDocument()
    view.unmount()
  })

  it('waits for the workspace exit guard before revoking the session', async () => {
    let finishExit: (() => void) | undefined
    const unregister = registerWorkspaceExitGuard(
      () => new Promise<void>((resolve) => { finishExit = resolve }),
    )
    const logout = vi.fn(async () => {})
    const auth: AuthClient = {
      getMe: async () => ({ openId: 'ou_1', name: 'Ada' }),
      logout,
      loginUrl: () => '/',
    }
    renderGate(auth)

    fireEvent.click(await screen.findByRole('button', { name: '退出' }))
    await waitFor(() => expect(finishExit).toBeDefined())
    expect(logout).not.toHaveBeenCalled()
    finishExit?.()
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
    unregister()
  })
})
