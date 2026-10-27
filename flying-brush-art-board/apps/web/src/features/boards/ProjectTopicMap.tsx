import { useEffect, useMemo, useRef, useState } from 'react'
import { Breadcrumb, Button, Card, Empty, Input, Modal, Select, toast } from '@ttqtt/liquid-glass-react'
import { ArrowRight, ArrowUpRight, Compass, MagnifyingGlass, PencilSimple, Plus } from '@phosphor-icons/react'
import { emptyProjectNavigation, navigationPath, type BoardReferenceRecord, type ProjectNavigation, type ProjectRecord, type StoredBoard } from '@infinite-board/board-core'
import { createBrowserUuid } from '../../app/browser-uuid'
import { hasCommerceOverview } from '../commerce/commerce-browse'
import './project-topic-map.css'

export interface ProjectTopicMapProps {
  project: ProjectRecord
  boards: readonly StoredBoard[]
  references: readonly BoardReferenceRecord[]
  initialFocus?: string
  onOpenBoard(boardId: string, mode: 'current' | 'new'): void
  onSaveNavigation?(navigation: ProjectNavigation): Promise<void>
  onFocusChange?(id: string): void
}

const UNCLASSIFIED = 'unclassified'
const compareTitles = (a: StoredBoard, b: StoredBoard) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true })

export function ProjectTopicMap({ project, boards, references, initialFocus = '', onOpenBoard, onSaveNavigation, onFocusChange }: ProjectTopicMapProps) {
  const navigation = project.navigation ?? emptyProjectNavigation()
  const [focus, setFocus] = useState(initialFocus)
  const [query, setQuery] = useState('')
  const [showAllRelations, setShowAllRelations] = useState(false)
  const [showRelations, setShowRelations] = useState(false)
  const [editing, setEditing] = useState<'board' | 'topic' | 'new-topic'>()
  const [draft, setDraft] = useState(navigation)
  const [parentId, setParentId] = useState('')
  const [topicTitle, setTopicTitle] = useState('')
  const [topicDescription, setTopicDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const locationRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLElement>(null)
  const previousFocus = useRef(initialFocus)
  const byId = useMemo(() => new Map(boards.map((board) => [board.id, board])), [boards])
  const commerceBoards = useMemo(() => boards.filter(board => hasCommerceOverview(board.tldrawSnapshot)), [boards])
  const landingBoard = (topicId: string) => {
    const matches = commerceBoards.filter(board => navigation.parents[board.id] === topicId)
    return matches.length === 1 ? matches[0] : undefined
  }
  const topicById = new Map(navigation.topics.map((topic) => [topic.id, topic]))
  const title = (id: string) => topicById.get(id)?.title ?? byId.get(id)?.title ?? (id === UNCLASSIFIED ? '待归类' : '主题地图')
  const path = (id: string) => navigationPath(navigation, id).filter((node) => topicById.has(node) || byId.has(node))
  // Unknown or deleted owners are always discoverable; never silently hide a board.
  const unclassified = boards.filter((board) => !path(board.id).some((id) => topicById.has(id)))
  const validFocus = focus === UNCLASSIFIED || byId.has(focus) || topicById.has(focus) ? focus : ''
  const focusedBoard = byId.get(validFocus)
  const focusedTopic = topicById.get(validFocus)
  const parent = navigation.parents[validFocus]
  const children = (validFocus === UNCLASSIFIED ? unclassified : boards.filter((board) => navigation.parents[board.id] === validFocus)).sort(compareTitles)
  const childCount = (id: string) => boards.filter((board) => navigation.parents[board.id] === id).length
  const searchResults = query.trim() ? boards.filter((board) => path(board.id).map(title).join(' / ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort(compareTitles) : []
  const localRelations = useMemo(() => {
    const grouped = new Map<string, { id: string; direction: 'out' | 'in'; kinds: Set<string>; count: number }>()
    for (const ref of references) {
      if (ref.sourceBoardId !== validFocus && ref.targetBoardId !== validFocus) continue
      const direction = ref.sourceBoardId === validFocus ? 'out' : 'in'
      const id = direction === 'out' ? ref.targetBoardId : ref.sourceBoardId
      if (!byId.has(id) || id === validFocus) continue
      const key = `${direction}:${id}`
      const entry = grouped.get(key) ?? { id, direction, kinds: new Set<string>(), count: 0 }
      entry.kinds.add(ref.kind)
      entry.count++
      grouped.set(key, entry)
    }
    const structural = (id: string) => Number(navigation.parents[id] === validFocus || navigation.parents[validFocus] === id)
    return [...grouped.values()].sort((a, b) => a.direction.localeCompare(b.direction) || structural(a.id) - structural(b.id) || byId.get(a.id)!.title.localeCompare(byId.get(b.id)!.title, 'zh-CN', { numeric: true }))
  }, [references, validFocus, byId, navigation.parents])

  useEffect(() => { setFocus(initialFocus); setQuery('') }, [project.id, initialFocus])
  useEffect(() => { setShowAllRelations(false); setShowRelations(false) }, [validFocus])
  useEffect(() => {
    if (validFocus || previousFocus.current) mapRef.current?.scrollIntoView?.({ block: 'start', inline: 'nearest' })
    previousFocus.current = validFocus
  }, [validFocus])
  const select = (id: string) => { setFocus(id); setQuery(''); onFocusChange?.(id) }
  const edit = (kind: 'board' | 'topic' | 'new-topic') => {
    setDraft(structuredClone(navigation))
    setParentId(parent ?? '')
    setTopicTitle(kind === 'topic' ? focusedTopic?.title ?? '' : '')
    setTopicDescription(kind === 'topic' ? focusedTopic?.description ?? '' : '')
    setEditing(kind)
  }
  const save = async () => {
    if (!onSaveNavigation) return
    const next = structuredClone(draft)
    let nextFocus = validFocus
    if (editing === 'board') {
      if (parentId) next.parents[validFocus] = parentId
      else delete next.parents[validFocus]
    } else if (editing === 'new-topic') {
      nextFocus = `topic:${createBrowserUuid()}`
      next.topics.push({ id: nextFocus, title: topicTitle.trim(), description: topicDescription.trim() })
    } else {
      next.topics = next.topics.map((topic) => topic.id === validFocus ? { ...topic, title: topicTitle.trim(), description: topicDescription.trim() } : topic)
    }
    setBusy(true)
    try {
      await onSaveNavigation(next)
      setEditing(undefined)
      select(nextFocus)
      toast.success('主题结构已保存，路径和关系图已同步')
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'NAVIGATION_REVISION_CONFLICT' ? '其他人刚更新了结构。请关闭弹窗，刷新后重新调整。' : '无法保存结构，请刷新后重试。')
    } finally { setBusy(false) }
  }
  const boardNode = (board: StoredBoard, compact = false) => (
    <Card className={`topic-map__node${compact ? ' topic-map__node--compact' : ''}`} key={board.id} padding="sm" radius="16px">
      <Button variant="ghost" className="topic-map__node-title" aria-label={`打开 ${board.title}`} onClick={() => onOpenBoard(board.id, 'current')}>{board.title.replace(/^\d+(?:\.\d+)*\s+/, '').split('｜')[0]}</Button>
      <p className="topic-map__node-description">{board.title.split('｜').slice(1).join('｜')}</p>
      <div className="topic-map__node-footer">{childCount(board.id) ? <Button variant="ghost" size="sm" onClick={() => select(board.id)}>查看下级内容 · {childCount(board.id)}</Button> : <span>内容画板</span>}<Button variant="ghost" size="sm" onClick={() => select(board.id)}>资料与归属</Button></div>
    </Card>
  )

  return (
    <section ref={mapRef} className="topic-map" aria-label="主题地图与局部关系图">
      <header className="topic-map__heading"><div><h2>设计内容</h2><p>选择主题开始阅读；来源、归属和引用资料按需展开。</p></div><div className="topic-map__toolbar"><Input aria-label="搜索主题地图" prefix={<MagnifyingGlass aria-hidden="true" />} placeholder="找画板名称或所属主题" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />{onSaveNavigation ? <Button variant="ghost" size="sm" icon={<Plus aria-hidden="true" />} onClick={() => edit('new-topic')}>新建主题</Button> : null}</div></header>
      {query.trim() ? (
        <div className="topic-map__search" aria-label="地图搜索结果"><p>{searchResults.length} 个结果 · 同时搜索画板名称与所属路径</p>{searchResults.map((board) => <Card padding="sm" radius="16px" key={board.id}><div className="topic-map__search-row"><div><Button variant="ghost" onClick={() => onOpenBoard(board.id, 'current')}>{board.title}</Button><p>{path(board.id).map(title).join(' › ')}</p></div><Button variant="ghost" size="sm" onClick={() => select(board.id)}>资料与归属</Button></div></Card>)}{searchResults.length === 0 ? <Empty title="没有找到画板" description="试试商品名称、画板编号或主题名称。" /> : null}</div>
      ) : <>
        <nav className={`topic-map__themes${validFocus ? ' topic-map__themes--compact' : ''}`} aria-label="项目主题">
          {navigation.topics.map(topic => { const landing = landingBoard(topic.id); return <Card className={`topic-map__theme${path(validFocus).includes(topic.id) ? ' topic-map__theme--active' : ''}`} padding="md" radius="20px" key={topic.id}><Button variant="ghost" className="topic-map__theme-title" onClick={() => landing ? onOpenBoard(landing.id, 'current') : select(topic.id)}>{topic.title}<ArrowRight aria-hidden="true" /></Button><p>{landing ? '查看投放入口、具体商品、设计依据与历史表现' : topic.description}</p>{landing ? <Button variant="ghost" size="sm" onClick={() => select(topic.id)}>查看设计资料</Button> : null}</Card> })}
          {unclassified.length > 0 ? <Card className="topic-map__theme topic-map__theme--unclassified" padding="md" radius="20px"><span className="topic-map__theme-index">{unclassified.length} 个画板</span><Button variant="ghost" className="topic-map__theme-title" onClick={() => select(UNCLASSIFIED)}>待归类<ArrowRight aria-hidden="true" /></Button><p>新建或尚未设置主要归属的内容，在这里整理。</p></Card> : null}
        </nav>
        {!validFocus ? <div className="topic-map__intro"><Compass size={28} aria-hidden="true" /><div><strong>从你想了解的设计开始</strong><p>商业模式直接进入商品总览；原设计讨论、资源总表和待核验资料仍在同一个主题中。</p></div></div> : <>
          <div ref={locationRef} className="topic-map__breadcrumbs"><Breadcrumb items={[{ label: '全部主题', onClick: () => select('') }, ...path(validFocus).map((id) => ({ label: title(id), onClick: () => select(id) }))]} /></div>
          <div className={`topic-map__graph${focusedTopic ? ' topic-map__graph--topic' : ''}`} role="region" aria-label="当前层级">
            <Card className="topic-map__focus" padding="lg" radius="22px"><p className="topic-map__label">{focusedTopic ? '当前主题' : '当前画板'}</p><h3>{title(validFocus)}</h3><p>{focusedTopic?.description ?? (focusedBoard ? '打开正文阅读设计，相关内容列在下方。' : '选择画板后，可通过“调整归属”整理到主题或上级画板。')}</p><div className="topic-map__focus-actions">{focusedBoard ? <Button variant="accent" icon={<ArrowUpRight aria-hidden="true" />} onClick={() => onOpenBoard(focusedBoard.id, 'current')}>打开画板</Button> : null}{onSaveNavigation && validFocus !== UNCLASSIFIED ? <Button variant="glass" size="sm" icon={<PencilSimple aria-hidden="true" />} onClick={() => edit(focusedTopic ? 'topic' : 'board')}>{focusedTopic ? '编辑主题' : '调整归属'}</Button> : null}</div></Card>
            <div className="topic-map__downstream"><p className="topic-map__label">{validFocus === UNCLASSIFIED ? '等待整理' : commerceBoards.some(b => b.id === validFocus) ? '设计讨论与资料' : '相关内容'} · {children.length}</p><div className="topic-map__children">{children.map((board) => boardNode(board))}{children.length === 0 ? <div className="topic-map__leaf">已到内容层。打开画板即可查看正文。</div> : null}</div></div>
          </div>
          {focusedBoard ? <Button variant="ghost" aria-expanded={showRelations} onClick={() => setShowRelations(!showRelations)}>{showRelations ? '收起引用资料' : `查看画板引用资料 · ${localRelations.length}`}</Button> : null}
          {focusedBoard && showRelations ? <section className="topic-map__relations" aria-label="局部引用关系">
            <div className="topic-map__relations-heading"><div><h3>画板引用资料</h3><p>这里记录资料之间的链接，不代表设计依赖或已确认的因果关系。</p></div><span>{localRelations.length} 个引用方向 / {localRelations.reduce((sum, relation) => sum + relation.count, 0)} 条引用</span></div>
            <div className="topic-map__relation-flow">
              {(['in', 'center', 'out'] as const).map((direction) => {
                if (direction === 'center') return <Card key="center" padding="md" radius="16px" className="topic-map__relation-center"><p className="topic-map__label">当前画板</p><strong>{focusedBoard.title}</strong></Card>
                const relations = localRelations.filter((relation) => relation.direction === direction)
                return <div className="topic-map__relation-column" key={direction}><p className="topic-map__label">{direction === 'in' ? '哪些画板引用了这里' : '这里引用了哪些画板'} · {relations.length}</p>
                  {(showAllRelations ? relations : relations.slice(0, 4)).map((relation) => <Card padding="sm" radius="16px" className="topic-map__relation" key={relation.id}><span>{relation.kinds.has('embed') ? '含嵌入引用' : '画板链接'}{relation.count > 1 ? ` · ${relation.count} 处` : ''}</span><Button variant="ghost" onClick={() => select(relation.id)}>{title(relation.id)}</Button><p>{path(relation.id).map(title).join(' › ')}</p><Button variant="ghost" size="sm" onClick={() => onOpenBoard(relation.id, 'current')}>打开关联画板 <ArrowUpRight aria-hidden="true" /></Button></Card>)}
                  {!relations.length ? <p className="topic-map__leaf">暂无{direction === 'in' ? '来源' : '对外'}引用</p> : null}
                </div>
              })}
            </div>
            {localRelations.filter((relation) => relation.direction === 'in').length > 4 || localRelations.filter((relation) => relation.direction === 'out').length > 4 ? <Button variant="glass" size="sm" onClick={() => setShowAllRelations(!showAllRelations)}>{showAllRelations ? '收起关联' : `展开全部 ${localRelations.length} 个引用方向`}</Button> : null}
          </section> : null}
        </>}
      </>}
      <Modal open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(undefined) }} title={editing === 'board' ? '调整主要归属' : editing === 'topic' ? '编辑主题' : '新建主题'} size="md" footer={<div className="dialog__actions"><Button variant="ghost" disabled={busy} onClick={() => setEditing(undefined)}>取消</Button><Button variant="accent" loading={busy} disabled={busy || (editing !== 'board' && !topicTitle.trim())} onClick={() => void save()}>保存结构</Button></div>}>
        {editing === 'board' ? <div className="dialog-form"><p>{focusedBoard?.title}</p><p>只调整阅读位置。原画板、内容与跨画板引用保持在同一个对象上。</p><Select aria-label="主要归属" value={parentId} onChange={setParentId} options={[{ value: '', label: '待归类' }, ...navigation.topics.map((topic) => ({ value: topic.id, label: `主题 / ${topic.title}` })), ...[...boards].sort(compareTitles).filter((board) => !navigationPath(navigation, board.id).includes(validFocus)).map((board) => ({ value: board.id, label: path(board.id).map(title).join(' / ') }))]} /></div> : <div className="dialog-form"><label htmlFor="topic-name">主题名称</label><Input id="topic-name" value={topicTitle} maxLength={100} onChange={(event) => setTopicTitle(event.currentTarget.value)} /><label htmlFor="topic-description">这里可以看什么</label><Input id="topic-description" value={topicDescription} maxLength={300} onChange={(event) => setTopicDescription(event.currentTarget.value)} /></div>}
      </Modal>
    </section>
  )
}
