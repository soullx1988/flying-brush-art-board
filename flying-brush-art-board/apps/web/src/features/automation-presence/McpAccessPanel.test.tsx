import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { McpAccessPanel } from './McpAccessPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('McpAccessPanel', () => {
  it('shows script-first OAuth setup and manages authorized clients without PAT controls', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/mcp/clients' && !init?.method) return new Response(JSON.stringify([{
        id: '2ed60cf7-c43f-42a0-ad08-a86106277c95',
        oauthClientId: 'codex-client',
        clientName: 'Codex 张三电脑',
        scopes: ['project:read', 'project:write', 'board:read', 'board:write', 'import', 'export', 'audit:read'],
        enabled: true,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:00.000Z',
        lastUsedAt: '2026-07-30T08:00:00.000Z',
      }]), { status: 200 })
      if (url.includes('/api/mcp/clients/') && init?.method === 'PATCH') return new Response(null, { status: 204 })
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<McpAccessPanel />)
    expect(await screen.findByText('Windows 一键配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /下载 Windows 配置包/ })).toBeInTheDocument()
    expect(screen.getByText('Trae')).toBeInTheDocument()
    expect(screen.getByText('当前客户端未确认支持 MCP OAuth。')).toBeInTheDocument()
    expect(screen.queryByText(/创建 30 天令牌/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /复制.*令牌/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    const clientSwitch = await screen.findByRole('switch', { name: 'Codex 张三电脑启用状态' })
    expect(clientSwitch).toBeChecked()
    fireEvent.click(clientSwitch)
    await waitFor(() => expect(clientSwitch).not.toBeChecked())
    expect(fetchMock).toHaveBeenCalledWith('/api/mcp/clients/2ed60cf7-c43f-42a0-ad08-a86106277c95', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ enabled: false }),
    }))
    expect(screen.getByRole('button', { name: '断开Codex 张三电脑' })).toBeInTheDocument()
  })
})
