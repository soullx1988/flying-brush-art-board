import { useEffect, useRef, useState } from 'react'
import type { StoredBoard } from '@infinite-board/board-core'
import { ClockCounterClockwise, FunnelSimple, UserCircle } from '@phosphor-icons/react'
import {
  Button,
  Drawer,
  Empty,
  Input,
  RangePicker,
  Select,
  Skeleton,
  Tag,
  Timeline,
} from '@ttqtt/liquid-glass-react'

import { chineseAuditAction } from '../../ui-text'

export interface AuditEventView {
  id: string
  actorOpenId: string
  projectId?: string
  boardId?: string
  action: string
  summary: Record<string, unknown>
  createdAt: string
}

export interface AuditClient {
  listAuditEvents(query: { projectId?: string; boardId?: string; actorOpenId?: string; action?: string; startAt?: string; endAt?: string; cursor?: string; limit: number }): Promise<{ events: AuditEventView[]; nextCursor?: string }>
}

const ACTION_OPTIONS = [
  { value: '', label: '全部操作' },
  { value: 'project.create', label: '创建项目' },
  { value: 'project.rename', label: '重命名项目' },
  { value: 'project.delete', label: '删除项目' },
  { value: 'project.root-board', label: '更改默认画板' },
  { value: 'board.create', label: '创建画板' },
  { value: 'board.edit', label: '编辑画板' },
  { value: 'board.rename', label: '重命名画板' },
  { value: 'board.delete', label: '删除画板' },
  { value: 'comment.create', label: '发表评论' },
  { value: 'comment.reply', label: '回复评论' },
  { value: 'comment.resolve', label: '解决评论' },
  { value: 'comment.reopen', label: '重新打开评论' },
  { value: 'comment.move', label: '移动评论' },
  { value: 'comment.delete', label: '删除评论' },
  { value: 'reference.create', label: '创建画板引用' },
  { value: 'reference.update', label: '更新画板引用' },
  { value: 'reference.delete', label: '删除画板引用' },
  { value: 'import.commit', label: '完成导入' },
  { value: 'export.complete', label: '完成导出' },
  { value: 'auth.login', label: '登录' },
  { value: 'auth.logout', label: '退出登录' },
]

function timeLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function actorLabel(openId: string, labels?: Readonly<Record<string, string>>): string {
  return labels?.[openId] ?? (openId.length > 18 ? `${openId.slice(0, 8)}…${openId.slice(-5)}` : openId)
}

const SUMMARY_LABELS: Record<string, string> = {
  title: '名称',
  previousTitle: '原名称',
  boardId: '画板 ID',
  projectId: '项目 ID',
  threadId: '讨论 ID',
  messageId: '消息 ID',
  status: '状态',
  previousStatus: '原状态',
  revision: '版本',
  count: '数量',
  fileName: '文件',
}

function summaryValue(value: unknown): string {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(summaryValue).join('、')
  return JSON.stringify(value)
}

function summaryEntries(summary: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(summary).map(([key, value]) => [SUMMARY_LABELS[key] ?? key, summaryValue(value)])
}

export function AuditPanel({ projectId, client, boards = [], actorLabels, onOpenBoard }: {
  projectId: string
  client: AuditClient
  boards?: readonly StoredBoard[]
  actorLabels?: Readonly<Record<string, string>>
  onOpenBoard?(boardId: string): void
}) {
  const [boardId, setBoardId] = useState('')
  const [actorOpenId, setActorOpenId] = useState('')
  const [action, setAction] = useState('')
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null])
  const [events, setEvents] = useState<AuditEventView[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AuditEventView>()
  const loadGeneration = useRef(0)

  const load = async (
    cursor?: string,
    append = false,
    filters = { boardId, actorOpenId, action, range },
  ) => {
    const generation = ++loadGeneration.current
    setError(undefined)
    setLoading(!append)
    try {
      const page = await client.listAuditEvents({
        projectId,
        ...(filters.boardId ? { boardId: filters.boardId } : {}),
        ...(filters.actorOpenId.trim() ? { actorOpenId: filters.actorOpenId.trim() } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.range[0] ? { startAt: new Date(filters.range[0].getFullYear(), filters.range[0].getMonth(), filters.range[0].getDate()).toISOString() } : {}),
        ...(filters.range[1] ? { endAt: new Date(filters.range[1].getFullYear(), filters.range[1].getMonth(), filters.range[1].getDate(), 23, 59, 59, 999).toISOString() } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 50,
      })
      if (generation !== loadGeneration.current) return
      setEvents((current) => append ? [...current, ...page.events] : page.events)
      setNextCursor(page.nextCursor)
    } catch {
      if (generation === loadGeneration.current) setError('无法加载活动记录，请稍后重试。')
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => { loadGeneration.current += 1 }
  }, [projectId])

  const boardName = (id: string | undefined) => boards.find((board) => board.id === id)?.title ?? id
  const filtersActive = Boolean(boardId || actorOpenId.trim() || action || range[0] || range[1])

  return <section className="audit-panel" aria-label="活动与审计">
    <div className="audit-panel__heading">
      <div><p className="eyebrow">活动与审计</p><h2>项目动态</h2></div>
      <ClockCounterClockwise aria-hidden="true" />
    </div>
    <form className="audit-panel__filters" onSubmit={(event) => { event.preventDefault(); void load() }}>
      <Select
        aria-label="筛选画板"
        value={boardId}
        onChange={setBoardId}
        searchable
        options={[{ value: '', label: '全部画板' }, ...boards.map((board) => ({ value: board.id, label: board.title }))]}
      />
      <Select aria-label="筛选操作" value={action} onChange={setAction} options={ACTION_OPTIONS} />
      <Input aria-label="筛选协作者标识" prefix={<UserCircle aria-hidden="true" />} value={actorOpenId} onChange={(event) => setActorOpenId(event.currentTarget.value)} placeholder="协作者标识（高级筛选）" />
      <RangePicker aria-label="筛选日期" value={range} onChange={setRange} locale="zh-CN" placeholder={['开始日期', '结束日期']} />
      <Button variant="accent" icon={<FunnelSimple aria-hidden="true" />} type="submit">应用筛选</Button>
      {filtersActive ? <Button variant="ghost" type="button" onClick={() => {
        setBoardId('')
        setActorOpenId('')
        setAction('')
        setRange([null, null])
        void load(undefined, false, { boardId: '', actorOpenId: '', action: '', range: [null, null] })
      }}>清空</Button> : null}
    </form>
    {error ? <div className="audit-panel__error" role="alert"><span>{error}</span><Button variant="glass" size="sm" onClick={() => void load()}>重试</Button></div> : null}
    {loading ? <div className="audit-panel__loading"><Skeleton lines={4} /><Skeleton lines={3} /></div> : events.length === 0 ? (
      <Empty title="没有活动记录" description={filtersActive ? '当前筛选条件下没有匹配记录。' : '项目操作记录会显示在这里。'} />
    ) : (
      <Timeline items={events.map((event) => ({
        key: event.id,
        time: timeLabel(event.createdAt),
        color: event.action.includes('delete') ? 'danger' : event.action.includes('create') ? 'success' : 'accent',
        content: (
          <button type="button" className="audit-event" onClick={() => setSelected(event)}>
            <span><strong>{chineseAuditAction(event.action)}</strong>{event.boardId ? <Tag size="sm">{boardName(event.boardId)}</Tag> : null}</span>
            <small>{actorLabel(event.actorOpenId, actorLabels)}</small>
          </button>
        ),
      }))} />
    )}
    {nextCursor ? <Button variant="glass" type="button" onClick={() => void load(nextCursor, true)}>加载更多</Button> : null}
    <Drawer open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(undefined) }} placement="right" size={420} title="活动详情">
      {selected ? <div className="audit-detail">
        <dl>
          <div><dt>操作</dt><dd>{chineseAuditAction(selected.action)}</dd></div>
          <div><dt>时间</dt><dd>{timeLabel(selected.createdAt)}</dd></div>
          <div><dt>操作者</dt><dd>{actorLabel(selected.actorOpenId, actorLabels)}</dd></div>
          {selected.boardId ? <div><dt>画板</dt><dd>{boardName(selected.boardId)}{onOpenBoard ? <Button variant="ghost" size="sm" onClick={() => onOpenBoard(selected.boardId!)}>打开画板</Button> : null}</dd></div> : null}
        </dl>
        <h3>记录内容</h3>
        {summaryEntries(selected.summary).length > 0 ? <dl className="audit-detail__summary">{summaryEntries(selected.summary).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className="empty-state">此记录没有附加内容。</p>}
        <details><summary>查看原始记录</summary><pre>{JSON.stringify(selected.summary, null, 2)}</pre></details>
      </div> : null}
    </Drawer>
  </section>
}
