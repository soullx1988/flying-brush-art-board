import { useEffect, useRef, useState } from 'react'
import { CheckCircle, CloudArrowDown, WarningCircle } from '@phosphor-icons/react'
import { Alert, Button, Input, Radio, RadioGroup, Select, Tag } from '@ttqtt/liquid-glass-react'
import type { InteropElement, InteropScene } from '@infinite-board/interop'
import { chineseErrorMessage } from '../../ui-text'
import { createBrowserUuid } from '../../app/browser-uuid'

interface ProjectOption { id: string; title: string }
interface CompatibilityIssue { code: string; message: string; severity: string }
interface InspectResult {
  sessionId: string
  preview: {
    report: { issues: CompatibilityIssue[] }
    fidelity: { editable: string[]; downgraded: string[]; rasterized: string[]; unsupported: string[] }
    baseline: { previewByteLength: number }
    scene: Pick<InteropScene, 'elements'>
    theme?: { background?: string; primary?: string; text?: string }
  }
}
export interface FeishuImportCommitResult { boardId: string; projectId: string }

const styleString = (element: InteropElement, key: string, fallback: string) => typeof element.style?.[key] === 'string' ? element.style[key] as string : fallback
const styleNumber = (element: InteropElement, key: string, fallback: number) => typeof element.style?.[key] === 'number' && Number.isFinite(element.style[key]) ? element.style[key] as number : fallback

function WhiteboardPreview({ scene, background }: { scene: Pick<InteropScene, 'elements'>; background: string }) {
  const elements = scene.elements.slice(0, 200)
  if (!elements.length) return <div aria-label="白板预览" className="feishu-whiteboard-preview feishu-whiteboard-preview-empty" style={{ background }}><p>白板为空。</p></div>
  const byId = new Map(elements.map((element) => [element.id, element]))
  const endpoint = (value: { elementId?: string; x?: number; y?: number }) => {
    if (value.x !== undefined && value.y !== undefined) return { x: value.x, y: value.y }
    const target = value.elementId ? byId.get(value.elementId) : undefined
    return target ? { x: target.geometry.x + target.geometry.width / 2, y: target.geometry.y + target.geometry.height / 2 } : { x: 0, y: 0 }
  }
  const points = elements.flatMap((element) => {
    if (element.type === 'connector') return [endpoint(element.start), endpoint(element.end)]
    return [{ x: element.geometry.x, y: element.geometry.y }, { x: element.geometry.x + element.geometry.width, y: element.geometry.y + element.geometry.height }]
  })
  const minX = Math.min(...points.map((point) => point.x)); const minY = Math.min(...points.map((point) => point.y))
  const maxX = Math.max(...points.map((point) => point.x)); const maxY = Math.max(...points.map((point) => point.y))
  const pad = 20; const viewBox = `${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}`

  const rendered = (element: InteropElement) => {
    const { x, y, width, height, rotation = 0 } = element.geometry
    const fill = styleString(element, 'fill', element.type === 'sticky' ? '#fff2a8' : '#ffffff')
    const stroke = styleString(element, 'stroke', '#334155')
    const color = styleString(element, 'color', styleString(element, 'textColor', '#172033'))
    const strokeWidth = styleNumber(element, 'strokeWidth', 2)
    const transform = rotation ? `rotate(${rotation} ${x + width / 2} ${y + height / 2})` : undefined
    const label = (text: string) => <text x={x + 10} y={y + Math.min(height / 2 + 5, 24)} fill={color} fontSize={styleNumber(element, 'fontSize', 16)}>{text.slice(0, 80)}</text>
    if (element.type === 'connector') {
      const start = endpoint(element.start); const end = endpoint(element.end)
      return <g key={element.id}><line data-preview-element-id={element.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />{element.text ? <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6} fill={color} fontSize="14">{element.text}</text> : null}</g>
    }
    if (element.type === 'paint') return <polyline key={element.id} data-preview-element-id={element.id} points={element.points.map((point) => `${x + point.x},${y + point.y}`).join(' ')} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    if (element.type === 'image' || element.type === 'svg') {
      const name = element.type === 'image' ? element.name ?? '图片' : 'SVG 图形'
      return <g key={element.id} transform={transform}><rect data-preview-element-id={element.id} x={x} y={y} width={width} height={height} rx="6" fill={fill === '#ffffff' ? '#e8eef7' : fill} stroke={stroke} strokeWidth={strokeWidth} /><path d={`M ${x + width * .15} ${y + height * .75} L ${x + width * .4} ${y + height * .45} L ${x + width * .58} ${y + height * .62} L ${x + width * .75} ${y + height * .35} L ${x + width * .9} ${y + height * .75}`} fill="none" stroke={stroke} strokeWidth={strokeWidth} /><text x={x + 8} y={y + height - 8} fill={color} fontSize="12">{name.slice(0, 60)}</text></g>
    }
    if (element.type === 'text') return <text key={element.id} data-preview-element-id={element.id} x={x} y={y + Math.max(16, height * .65)} fill={color} fontSize={styleNumber(element, 'fontSize', Math.max(12, Math.min(28, height * .7)))} transform={transform}>{element.text.slice(0, 100)}</text>
    const text = element.type === 'shape' ? element.text : element.type === 'sticky' || element.type === 'mind-map' ? element.text : element.type === 'section' ? element.title : element.type === 'table' ? element.cells.flat().join(' · ') : element.type === 'board-reference' ? element.titleFallback : element.type === 'unsupported' ? element.sourceType : ''
    const ellipse = element.type === 'shape' && ['ellipse', 'circle', 'oval'].includes(element.shape.toLowerCase())
    return <g key={element.id} transform={transform}>{ellipse
      ? <ellipse data-preview-element-id={element.id} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      : <rect data-preview-element-id={element.id} x={x} y={y} width={width} height={height} rx={element.type === 'sticky' ? 4 : 8} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />}{text ? label(text) : null}</g>
  }
  return <div aria-label="白板预览" className="feishu-whiteboard-preview" style={{ background }}><svg viewBox={viewBox} role="img" aria-label="缩放后的导入白板布局" preserveAspectRatio="xMidYMid meet">{[...elements].sort((a, b) => (a.zIndex ?? '').localeCompare(b.zIndex ?? '')).map(rendered)}</svg></div>
}

export interface FeishuImportWizardClient {
  status(): Promise<{ connected: boolean }>
  projects(): Promise<ProjectOption[]>
  inspect(url: string): Promise<InspectResult>
  commit(input: { sessionId: string; target: { kind: 'existing'; projectId: string } | { kind: 'new'; projectId: string; title: string }; confirmed: true }): Promise<FeishuImportCommitResult>
  cancel(sessionId: string): Promise<void>
}

export interface FeishuImportWizardProps {
  client: FeishuImportWizardClient
  defaultProjectId?: string
  onCommitted(result: FeishuImportCommitResult): void | Promise<void>
}

export function FeishuImportWizard({ client, defaultProjectId, onCommitted }: FeishuImportWizardProps) {
  const [connected, setConnected] = useState<boolean>()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [url, setUrl] = useState('')
  const [projectId, setProjectId] = useState('')
  const [targetKind, setTargetKind] = useState<'existing' | 'new'>('existing')
  const [newProjectId] = useState(() => `project-${createBrowserUuid()}`)
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [inspection, setInspection] = useState<InspectResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const sessionRef = useRef<string | undefined>(undefined)
  const inspectionGeneration = useRef(0)

  useEffect(() => {
    void Promise.all([client.status(), client.projects()]).then(([status, loadedProjects]) => {
      const options = Array.isArray(loadedProjects) ? loadedProjects : []
      setConnected(status.connected)
      setProjects(options)
      setProjectId(options.some((project) => project.id === defaultProjectId) ? defaultProjectId! : options[0]?.id ?? '')
      setTargetKind(options.length ? 'existing' : 'new')
    }, () => setError('无法加载飞书导入配置，请稍后重试。'))
  }, [client, defaultProjectId])

  useEffect(() => () => {
    if (sessionRef.current) void client.cancel(sessionRef.current).catch(() => undefined)
  }, [client])

  const inspect = async () => {
    const generation = ++inspectionGeneration.current
    setBusy(true); setError(undefined)
    if (sessionRef.current) await client.cancel(sessionRef.current).catch(() => undefined)
    try {
      const result = await client.inspect(url)
      if (generation !== inspectionGeneration.current) {
        await client.cancel(result.sessionId).catch(() => undefined)
        return
      }
      sessionRef.current = result.sessionId
      setInspection(result)
    } catch (cause) {
      setError(chineseErrorMessage(cause, '飞书白板预检失败。'))
      setInspection(undefined)
    } finally { setBusy(false) }
  }

  const commit = async () => {
    if (!inspection) return
    const target = targetKind === 'existing'
      ? { kind: 'existing' as const, projectId }
      : { kind: 'new' as const, projectId: newProjectId.trim(), title: newProjectTitle.trim() }
    if (!target.projectId || (target.kind === 'new' && !target.title)) return
    setBusy(true); setError(undefined)
    try {
      const result = await client.commit({ sessionId: inspection.sessionId, target, confirmed: true })
      sessionRef.current = undefined
      await onCommitted(result)
    } catch (cause) { setError(chineseErrorMessage(cause, '飞书白板导入失败。')) }
    finally { setBusy(false) }
  }

  return (
    <section aria-label="飞书白板导入" className="feishu-import-wizard">
      <header className="feishu-import-wizard__heading">
        <div><h2>导入飞书白板</h2><p>预检兼容性后，再选择导入目标。</p></div>
        <Tag color={connected ? 'success' : connected === undefined ? 'warning' : 'danger'} size="sm">
          {connected === undefined ? '检查连接中' : connected ? '已连接' : '未连接'}
        </Tag>
      </header>
      {connected === false ? <Alert kind="warning" title="需要先连接飞书">请先在上方的“飞书导入”连接卡片中完成授权。</Alert> : null}
      <div className="feishu-import-wizard__inspect-row">
        <label className="feishu-form-field" htmlFor="feishu-board-url"><span>飞书白板链接</span><Input id="feishu-board-url" size="lg" value={url} onChange={(event) => {
          const nextUrl = event.currentTarget.value
          setUrl(nextUrl)
          inspectionGeneration.current += 1
          setInspection(undefined)
          setError(undefined)
          const previousSessionId = sessionRef.current
          sessionRef.current = undefined
          if (previousSessionId) void client.cancel(previousSessionId).catch(() => undefined)
        }} placeholder="粘贴飞书白板或知识库链接" /></label>
        <Button variant="glass" size="lg" icon={<CloudArrowDown aria-hidden="true" />} loading={busy && !inspection} disabled={!connected || !url.trim() || busy} onClick={() => void inspect()}>仅预检，不导入</Button>
      </div>
      {inspection ? (
        <div className="feishu-inspection" aria-label="兼容性报告">
          <div className="feishu-inspection__heading"><div><h3>兼容性报告</h3><p>确认内容质量和目标项目后再提交导入。</p></div><CheckCircle weight="duotone" aria-hidden="true" /></div>
          <WhiteboardPreview scene={inspection.preview.scene} background={inspection.preview.theme?.background ?? '#f6f7f9'} />
          <dl className="feishu-fidelity-summary">
            <div><dt>可编辑</dt><dd>{inspection.preview.fidelity.editable.length}</dd></div>
            <div><dt>已降级</dt><dd>{inspection.preview.fidelity.downgraded.length}</dd></div>
            <div><dt>已栅格化</dt><dd>{inspection.preview.fidelity.rasterized.length}</dd></div>
            <div><dt>不支持</dt><dd>{inspection.preview.fidelity.unsupported.length}</dd></div>
          </dl>
          {inspection.preview.report.issues.length ? <ul className="feishu-issue-list">{inspection.preview.report.issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity={issue.severity}><WarningCircle aria-hidden="true" /><span><strong>{issue.code}</strong>{issue.message}</span></li>)}</ul> : <Alert kind="success" title="兼容性检查通过">未发现需要确认的问题。</Alert>}
          <div className="feishu-target-picker">
            <span className="feishu-target-picker__label">导入目标</span>
            <RadioGroup aria-label="导入目标" name="feishu-target" value={targetKind} onChange={(value) => setTargetKind(value as 'existing' | 'new')} orientation="horizontal">
              {projects.length ? <Radio value="existing">已有项目</Radio> : null}
              <Radio value="new">新建项目</Radio>
            </RadioGroup>
            {!projects.length ? <p>暂无已有项目，将创建一个新项目。</p> : null}
          </div>
          {targetKind === 'existing'
            ? <label className="feishu-form-field"><span>目标项目</span><Select aria-label="目标项目" size="lg" value={projectId} onChange={setProjectId} options={projects.map((project) => ({ value: project.id, label: project.title }))} /></label>
            : <label className="feishu-form-field" htmlFor="feishu-new-project-title"><span>新项目名称</span><Input id="feishu-new-project-title" size="lg" value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.currentTarget.value)} /></label>}
          <Button className="feishu-import-wizard__commit" variant="accent" size="lg" loading={busy && Boolean(inspection)} disabled={busy || (targetKind === 'existing' ? !projectId : !newProjectId.trim() || !newProjectTitle.trim()) || inspection.preview.report.issues.some((issue) => issue.severity === 'error')} onClick={() => void commit()}>确认导入</Button>
        </div>
      ) : null}
      {error ? <Alert kind="danger" title="飞书导入未完成">{error}</Alert> : null}
    </section>
  )
}

export function createFeishuImportClient(): FeishuImportWizardClient {
  const json = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({})) as T & { code?: string }
    if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`)
    return body
  }
  return {
    status: async () => json(await fetch('/api/integrations/feishu/status')),
    projects: async () => {
      const response = await json<ProjectOption[] | { projects: ProjectOption[] }>(await fetch('/api/projects'))
      return Array.isArray(response) ? response : response.projects
    },
    inspect: async (url) => json(await fetch('/api/import/feishu/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })),
    commit: async (input) => json(await fetch('/api/import/feishu/commit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })),
    cancel: async (sessionId) => { const response = await fetch(`/api/import/feishu/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }); if (!response.ok) throw new Error(`HTTP_${response.status}`) },
  }
}
