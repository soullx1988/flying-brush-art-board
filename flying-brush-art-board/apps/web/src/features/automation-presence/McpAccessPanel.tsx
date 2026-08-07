import { useEffect, useState } from 'react'
import { DownloadSimple, Key, Trash } from '@phosphor-icons/react'
import { Button, Card, Modal, Switch, Tag, toast } from '@ttqtt/liquid-glass-react'

interface McpClientGrant {
  id: string
  oauthClientId: string
  clientName: string
  scopes: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

const clientSupport = [
  { name: 'Codex', detail: '脚本写入 MCP URL、安装操作 Skill，并提示完成 OAuth 登录。', supported: true },
  { name: 'Cursor', detail: '合并到 .cursor/mcp.json，保留其他 MCP。', supported: true },
  { name: 'Windsurf', detail: '合并到 Windsurf MCP 配置，保留其他 MCP。', supported: true },
  { name: 'Trae', detail: '当前客户端未确认支持 MCP OAuth。', supported: false },
]

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  return response.json() as Promise<T>
}

function formatLastUsed(value?: string): string {
  if (!value) return '尚未调用'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function McpAccessPanel() {
  const [clients, setClients] = useState<McpClientGrant[]>()
  const [available, setAvailable] = useState(true)
  const [togglingId, setTogglingId] = useState<string>()
  const mcpUrl = `${window.location.origin}/mcp`

  const reload = () => {
    void fetch('/api/mcp/clients').then(async (response) => {
      if (response.status === 404) {
        setAvailable(false)
        setClients([])
        return
      }
      const value = await responseJson<unknown>(response)
      setClients(Array.isArray(value) ? value as McpClientGrant[] : [])
    }).catch(() => {
      setAvailable(false)
      setClients([])
    })
  }

  useEffect(reload, [])

  const downloadSetup = () => {
    const link = document.createElement('a')
    link.href = '/api/mcp/setup/windows.zip'
    link.download = 'InfiniteBoard-MCP-Setup.zip'
    document.body.append(link)
    link.click()
    link.remove()
  }

  const setEnabled = async (client: McpClientGrant, enabled: boolean) => {
    setTogglingId(client.id)
    try {
      const response = await fetch(`/api/mcp/clients/${encodeURIComponent(client.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      setClients((current) => current?.map((item) => item.id === client.id ? { ...item, enabled } : item))
      toast.success(enabled ? 'MCP 客户端已恢复' : 'MCP 客户端已暂停')
    } catch {
      toast.error('无法更新 MCP 客户端状态。')
    } finally {
      setTogglingId(undefined)
    }
  }

  const revoke = async (client: McpClientGrant) => {
    const confirmed = await Modal.confirm({
      title: '断开 MCP 客户端',
      content: `断开“${client.clientName}”后，该客户端的整个令牌族会立即失效，需要重新授权才能连接。`,
      okText: '断开',
      cancelText: '取消',
      danger: true,
      locale: 'zh-CN',
    })
    if (!confirmed) return
    try {
      const response = await fetch(`/api/mcp/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      setClients((current) => current?.filter((item) => item.id !== client.id))
      toast.success('MCP 客户端已断开')
    } catch {
      toast.error('无法断开 MCP 客户端。')
    }
  }

  return (
    <Card as="section" className="mcp-access-panel" padding="lg" radius="24px">
      <div className="mcp-access-panel__heading">
        <div><p className="eyebrow">远程自动化</p><h2><Key aria-hidden="true" />MCP v2 接入</h2></div>
        {available ? <Tag color="success">OAuth 已启用</Tag> : <Tag color="default">未启用</Tag>}
      </div>
      <p>不再创建或复制个人令牌。同事运行一次配置脚本，在客户端完成飞书 OAuth 授权后即可使用。</p>
      {available ? <>
        <div className="mcp-setup-callout">
          <strong>Windows 一键配置</strong>
          <small>MCP URL：<code>{mcpUrl}</code></small>
          <Button className="mcp-setup-download" variant="accent" icon={<DownloadSimple aria-hidden="true" />} onClick={downloadSetup}>下载 Windows 配置包</Button>
        </div>
        <div className="mcp-client-support" aria-label="支持的 MCP 客户端">
          {clientSupport.map((client) => <article key={client.name} className={client.supported ? '' : 'is-disabled'}>
            <div><strong>{client.name}</strong><Tag color={client.supported ? 'success' : 'default'}>{client.supported ? '支持' : '待确认'}</Tag></div>
            <p>{client.detail}</p>
          </article>)}
        </div>
        <div className="mcp-authorized-clients">
          <h3>已授权客户端</h3>
          <div className="mcp-client-list">
            {(clients ?? []).map((client) => <article key={client.id}>
              <div className="mcp-client-list__primary">
                <strong title={client.clientName}>{client.clientName}</strong>
                <Switch className="mcp-client-switch" size="sm" aria-label={`${client.clientName}启用状态`} checked={client.enabled} disabled={togglingId === client.id} onCheckedChange={(checked) => void setEnabled(client, checked)} />
                <Button className="mcp-client-revoke" variant="ghost" size="sm" aria-label={`断开${client.clientName}`} icon={<Trash size={20} weight="bold" aria-hidden="true" />} onClick={() => void revoke(client)} />
              </div>
              <small>最后使用：{formatLastUsed(client.lastUsedAt)}</small>
            </article>)}
            {clients?.length === 0 ? <p className="mcp-client-list__empty">尚无已授权客户端。运行配置脚本并完成飞书授权后会显示在这里。</p> : null}
          </div>
        </div>
      </> : <p>服务器管理员尚未开启 <code>MCP_ENABLED=true</code>。</p>}
    </Card>
  )
}
