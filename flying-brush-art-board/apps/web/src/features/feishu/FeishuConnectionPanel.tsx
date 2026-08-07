import { useEffect, useState } from 'react'
import { ArrowSquareOut, PlugsConnected, SignOut } from '@phosphor-icons/react'
import { Alert, Button, Tag } from '@ttqtt/liquid-glass-react'

interface FeishuConnectionStatus {
  connected: boolean
  scopes?: readonly string[]
}

export function FeishuConnectionPanel() {
  const [status, setStatus] = useState<FeishuConnectionStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const refreshStatus = async () => {
    const response = await fetch('/api/integrations/feishu/status')
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
    setStatus(await response.json() as FeishuConnectionStatus)
    setError(undefined)
  }

  useEffect(() => {
    void refreshStatus().catch(() => setError('无法检查飞书连接状态，请稍后重试。'))
  }, [])

  const revoke = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch('/api/integrations/feishu/account', { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      await refreshStatus()
    } catch {
      setError('无法断开飞书连接，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="飞书导入连接">
      <div className="feishu-connection-panel__heading"><PlugsConnected weight="duotone" aria-hidden="true" /><div><h2>飞书导入</h2><p>管理白板导入所使用的飞书授权。</p></div></div>
      <Tag color={status?.connected ? 'success' : 'warning'} size="sm">{status ? status.connected ? '已连接' : '未连接' : '检查连接中'}</Tag>
      {status?.connected ? (
        <Button variant="glass" icon={<SignOut aria-hidden="true" />} loading={busy} disabled={busy} onClick={() => void revoke()}>断开连接</Button>
      ) : status ? <a className="feishu-connection-link" href="/auth/feishu/import/start"><ArrowSquareOut aria-hidden="true" />连接飞书</a> : null}
      {error ? <Alert kind="danger" title="飞书连接不可用">{error}</Alert> : null}
    </section>
  )
}
