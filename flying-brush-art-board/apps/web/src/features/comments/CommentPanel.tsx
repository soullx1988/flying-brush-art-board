import { useEffect, useMemo, useRef, useState } from 'react'
import { ChatCircleDots, CheckCircle, CrosshairSimple, DotsThree, PaperPlaneTilt, Trash } from '@phosphor-icons/react'
import {
  Avatar,
  Button,
  Empty,
  Input,
  Menu,
  Modal,
  Segmented,
  Skeleton,
  Tag,
  Textarea,
  toast,
  type MenuItem,
} from '@ttqtt/liquid-glass-react'

import type { CommentClient, CommentMessageView, CommentThreadView } from './comment-client'

type CommentFilter = 'open' | 'resolved' | 'all'

function timeLabel(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function personLabel(openId: string): string {
  return openId.length > 18 ? `${openId.slice(0, 7)}…${openId.slice(-4)}` : openId
}

export function CommentPanel({ boardId, client, hasShape, pendingAnchor, threads: controlledThreads, messagesByThread: controlledMessages, onRefresh, onThreadsChange, onPendingAnchorSaved, focusedThreadId, onLocateThread, onClose, embedded = false }: {
  boardId: string
  client: CommentClient
  hasShape(shapeId: string): boolean
  pendingAnchor?: { shapeId?: string; x: number; y: number }
  threads?: CommentThreadView[]
  messagesByThread?: Readonly<Record<string, CommentMessageView[]>>
  onRefresh?(): Promise<void>
  onThreadsChange?(threads: CommentThreadView[]): void
  onPendingAnchorSaved?(): void
  focusedThreadId?: string
  onLocateThread?(thread: CommentThreadView): void
  onClose(): void
  embedded?: boolean
}) {
  const [localThreads, setLocalThreads] = useState<CommentThreadView[]>([])
  const [localMessages, setLocalMessages] = useState<Record<string, CommentMessageView[]>>({})
  const [draft, setDraft] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<CommentFilter>('open')
  const [loading, setLoading] = useState(controlledThreads === undefined)
  const [sending, setSending] = useState<string>()
  const reloadGeneration = useRef(0)

  const reload = async (silent = false) => {
    const generation = ++reloadGeneration.current
    if (!silent) setLoading(true)
    try {
      if (onRefresh) {
        await onRefresh()
        return
      }
      const next = await client.listThreads(boardId)
      if (generation !== reloadGeneration.current) return
      setLocalThreads(next)
      onThreadsChange?.(next)
      const nextMessages = await Promise.all(next.map(async (thread) => [thread.id, await client.listMessages(thread.id)] as const))
      if (generation !== reloadGeneration.current) return
      setLocalMessages(Object.fromEntries(nextMessages))
    } catch {
      if (!silent && generation === reloadGeneration.current) toast.error('无法加载评论，请稍后重试。')
    } finally {
      if (!silent && generation === reloadGeneration.current) setLoading(false)
    }
  }

  const threads = controlledThreads ?? localThreads
  const messages = controlledMessages ?? localMessages

  useEffect(() => {
    if (controlledThreads !== undefined) {
      setLoading(false)
      return
    }
    void reload()
  }, [boardId, controlledThreads])
  useEffect(() => {
    if (onRefresh) return
    return client.subscribeToChanges?.(boardId, () => { void reload(true) })
  }, [boardId, client, onRefresh])
  useEffect(() => {
    if (!focusedThreadId) return
    if (!controlledMessages) {
      void client.listMessages(focusedThreadId)
        .then((next) => setLocalMessages((current) => ({ ...current, [focusedThreadId]: next })))
        .catch(() => toast.error('无法加载评论回复，请稍后重试。'))
    }
    window.requestAnimationFrame(() => {
      const thread = document.querySelector(`[data-comment-thread="${focusedThreadId}"]`)
      if (thread && typeof thread.scrollIntoView === 'function') thread.scrollIntoView({ block: 'nearest' })
    })
  }, [client, controlledMessages, focusedThreadId, threads])

  const visibleThreads = useMemo(() => {
    if (focusedThreadId) {
      const focusedThread = threads.find((thread) => thread.id === focusedThreadId)
      return focusedThread ? [focusedThread] : []
    }
    return threads.filter((thread) => filter === 'all' || thread.status === filter)
  }, [filter, focusedThreadId, threads])
  const openCount = threads.filter((thread) => thread.status === 'open').length

  const create = async () => {
    if (!draft.trim()) return
    setSending('new')
    try {
      await client.createThread(boardId, { body: draft.trim(), ...(pendingAnchor ?? {}) })
      setDraft('')
      onPendingAnchorSaved?.()
      await reload(true)
      toast.success('评论已发送')
    } catch {
      toast.error('无法发送评论，请稍后重试。')
    } finally {
      setSending(undefined)
    }
  }

  const updateStatus = async (thread: CommentThreadView) => {
    try {
      await client.setThreadStatus(thread.id, thread.status === 'open' ? 'resolved' : 'open')
      await reload(true)
    } catch {
      toast.error('无法更新评论状态。')
    }
  }

  const deleteThread = async (thread: CommentThreadView) => {
    const confirmed = await Modal.confirm({
      title: '删除讨论',
      content: '此讨论及其全部回复都会被永久删除。',
      okText: '删除讨论',
      cancelText: '取消',
      danger: true,
      locale: 'zh-CN',
    })
    if (!confirmed) return
    try {
      await client.deleteThread(thread.id)
      await reload(true)
      toast.success('讨论已删除')
    } catch {
      toast.error('无法删除讨论。')
    }
  }

  return <aside className={embedded ? 'comment-panel comment-panel--embedded' : 'comment-panel'} data-comment-panel aria-label="评论">
    {!embedded ? <header className="comment-panel__header"><h2>评论 ({threads.length})</h2><Button variant="ghost" size="sm" onClick={onClose}>关闭</Button></header> : null}
    {!focusedThreadId ? <div className="comment-panel__filters">
      <Segmented
        aria-label="评论状态"
        block
        value={filter}
        onChange={(value) => setFilter(value as CommentFilter)}
        options={[{ value: 'open', label: `未解决 ${openCount}` }, { value: 'resolved', label: '已解决' }, { value: 'all', label: '全部' }]}
      />
    </div> : null}
    {pendingAnchor ? <section className="comment-panel__new">
      <div><strong>添加评论</strong><Tag size="sm">已定位到画布</Tag></div>
      <Textarea autoResize aria-label="新评论" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="描述问题或留下建议…" />
      <Button variant="accent" icon={<PaperPlaneTilt aria-hidden="true" />} loading={sending === 'new'} disabled={!draft.trim() || sending === 'new'} onClick={() => void create()}>发送评论</Button>
    </section> : null}
    {loading ? <div className="comment-panel__loading"><Skeleton lines={4} /><Skeleton lines={3} /></div> : visibleThreads.length === 0 ? (
      <Empty
        image={<ChatCircleDots className="comment-panel__empty-icon" weight="duotone" aria-hidden="true" />}
        title={focusedThreadId ? '这条评论已不存在' : filter === 'resolved' ? '还没有已解决评论' : filter === 'open' ? '没有待处理评论' : '还没有评论'}
        description={focusedThreadId ? '它可能已被其他协作者删除。' : '在画布上放置评论锚点后，讨论会显示在这里。'}
      />
    ) : <ul>{visibleThreads.map((thread) => {
      const threadMessages = messages[thread.id] ?? []
      const menuItems: MenuItem[] = [
        { key: 'status', label: thread.status === 'open' ? '标记为已解决' : '重新打开', icon: <CheckCircle aria-hidden="true" /> },
        { type: 'divider' },
        { key: 'delete', label: '删除讨论', icon: <Trash aria-hidden="true" />, danger: true },
      ]
      return <li key={thread.id} data-comment-thread={thread.id} data-focused={focusedThreadId === thread.id ? 'true' : undefined}>
        <div className="comment-panel__thread-head">
          <div>
            <Avatar size="sm" shape="square" fallback={personLabel(thread.createdBy).slice(0, 1)} />
            <span><strong>{personLabel(thread.createdBy)}</strong><small>{timeLabel(thread.updatedAt)}</small></span>
          </div>
          <div className="comment-panel__thread-actions">
            {onLocateThread && typeof thread.x === 'number' && typeof thread.y === 'number' ? <Button variant="ghost" size="sm" aria-label="定位到画布" icon={<CrosshairSimple aria-hidden="true" />} onClick={() => onLocateThread(thread)} /> : null}
            <Menu items={menuItems} placement="bottom-end" onSelect={(key) => { if (key === 'status') void updateStatus(thread); if (key === 'delete') void deleteThread(thread) }}>
              <Button variant="ghost" size="sm" aria-label="评论操作" icon={<DotsThree weight="bold" aria-hidden="true" />} />
            </Menu>
          </div>
        </div>
        {thread.shapeId && !hasShape(thread.shapeId) ? <p className="comment-panel__anchor-warning" role="status">原画布锚点已不存在，可拖动画布中的评论标记重新定位</p> : null}
        <div className="comment-panel__messages">
          {threadMessages.map((message) => <article key={message.id}>
            <header><strong>{personLabel(message.authorOpenId)}</strong><time>{timeLabel(message.createdAt)}</time></header>
            <p>{message.deletedAt ? '此评论已删除' : message.body}</p>
          </article>)}
        </div>
        <div className="comment-panel__reply">
          <Input aria-label={`回复 ${thread.id}`} value={replyDrafts[thread.id] ?? ''} placeholder="回复讨论" onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.currentTarget.value }))} />
          <Button variant="glass" size="sm" icon={<PaperPlaneTilt aria-hidden="true" />} loading={sending === thread.id} disabled={!replyDrafts[thread.id]?.trim() || Boolean(sending)} onClick={() => {
            const body = replyDrafts[thread.id]?.trim()
            if (!body) return
            setSending(thread.id)
            void client.addMessage(thread.id, body).then(async () => {
              if (onRefresh) await onRefresh()
              else {
                const next = await client.listMessages(thread.id)
                setLocalMessages((current) => ({ ...current, [thread.id]: next }))
              }
              setReplyDrafts((current) => ({ ...current, [thread.id]: '' }))
            }).catch(() => toast.error('无法发送回复。')).finally(() => setSending(undefined))
          }}>回复</Button>
        </div>
      </li>
    })}</ul>}
  </aside>
}
