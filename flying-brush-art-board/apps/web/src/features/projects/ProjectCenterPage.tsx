import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Archive,
  ArrowCounterClockwise,
  ArrowRight,
  DotsThree,
  FolderSimple,
  GearSix,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SquaresFour,
  Star,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import {
  Button,
  Card,
  Empty,
  Input,
  Menu,
  Modal,
  Segmented,
  Skeleton,
  Tabs,
  toast,
  type MenuItem,
} from '@ttqtt/liquid-glass-react'

import type { ProjectRecord, StoredBoard } from '@infinite-board/board-core'
import { createBrowserUuid } from '../../app/browser-uuid'
import {
  markProjectOpened,
  readProjectPreferences,
  removeProjectPreference,
  setProjectArchived,
  toggleProjectFavorite,
  writeProjectPreferences,
  type ProjectPreferences,
} from './project-preferences'
import { subscribeApplicationEvents } from '../automation-presence/application-events'
import { McpAccessPanel } from '../automation-presence/McpAccessPanel'
import { FeishuConnectionPanel } from '../feishu/FeishuConnectionPanel'

export interface CreateProjectInput {
  id: string
  title: string
  rootBoard: { id: string; title: string }
}

export interface ProjectSummary extends ProjectRecord {
  boardCount?: number
  rootBoardTitle?: string
  boardTitles?: string[]
}

export interface ProjectCenterClient {
  listProjects(): Promise<ProjectSummary[]>
  createProject(input: CreateProjectInput): Promise<{ project: ProjectRecord; rootBoard: StoredBoard }>
  renameProject(projectId: string, title: string): Promise<ProjectRecord>
  deleteProject(projectId: string): Promise<void>
}

type CenterView = 'active' | 'archived'
type CenterSection = 'projects' | 'integrations' | 'settings'
type ProjectDialog = { kind: 'create' } | { kind: 'rename'; project: ProjectRecord } | undefined

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ProjectCenterPage({ client, onOpenProject }: {
  client: ProjectCenterClient
  onOpenProject(projectId: string): void
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>()
  const [preferences, setPreferences] = useState<ProjectPreferences>(() => readProjectPreferences())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<CenterView>('active')
  const [section, setSection] = useState<CenterSection>('projects')
  const [dialog, setDialog] = useState<ProjectDialog>()
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [recentlyArchived, setRecentlyArchived] = useState<ProjectSummary>()

  const reload = () => {
    setError(undefined)
    void client.listProjects().then(setProjects, () => setError('无法加载项目，请稍后重试。'))
  }

  useEffect(reload, [client])
  useEffect(() => subscribeApplicationEvents((event) => {
    if (event.type.startsWith('project.') || event.type.startsWith('board.')) reload()
  }), [client])

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    const archived = new Set(preferences.archivedIds)
    return (projects ?? [])
      .filter((project) => (view === 'archived') === archived.has(project.id))
      .filter((project) => !normalizedQuery || [project.title, project.rootBoardTitle, ...(project.boardTitles ?? [])]
        .some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalizedQuery)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }, [preferences, projects, query, view])

  const openProject = (projectId: string) => {
    setPreferences(markProjectOpened(projectId))
    onOpenProject(projectId)
  }

  const openDialog = (next: ProjectDialog) => {
    setDialog(next)
    setTitle(next?.kind === 'rename' ? next.project.title : '')
    setError(undefined)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!dialog || !nextTitle) return
    setSubmitting(true)
    setError(undefined)
    try {
      if (dialog.kind === 'create') {
        const suffix = createBrowserUuid()
        const created = await client.createProject({
          id: `project-${suffix}`,
          title: nextTitle,
          rootBoard: { id: `board-${suffix}`, title: '概览' },
        })
        toast.success('项目已创建')
        setDialog(undefined)
        openProject(created.project.id)
      } else {
        const updated = await client.renameProject(dialog.project.id, nextTitle)
        setProjects((current) => current?.map((project) => project.id === updated.id ? updated : project))
        toast.success('项目名称已更新')
        setDialog(undefined)
      }
    } catch {
      setError(dialog.kind === 'create' ? '无法创建项目，请稍后重试。' : '无法重命名项目，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  const archiveProject = (projectId: string, archived: boolean) => {
    setPreferences(setProjectArchived(projectId, archived))
    setRecentlyArchived(archived ? projects?.find((project) => project.id === projectId) : undefined)
    toast.success(archived ? '已移至个人归档（仅当前浏览器）' : '已移出个人归档')
  }

  const deleteProject = async (project: ProjectRecord) => {
    const confirmed = await Modal.confirm({
      title: '删除项目',
      content: `“${project.title}”中的画板、引用和评论都会被永久删除。`,
      okText: '删除项目',
      cancelText: '取消',
      danger: true,
      locale: 'zh-CN',
    })
    if (!confirmed) return
    try {
      await client.deleteProject(project.id)
      setProjects((current) => current?.filter((candidate) => candidate.id !== project.id))
      setPreferences(removeProjectPreference(project.id))
      toast.success('项目已删除')
    } catch {
      toast.error('无法删除项目，请稍后重试。')
    }
  }

  const projectMenu = (project: ProjectRecord): MenuItem[] => {
    const isFavorite = preferences.favoriteIds.includes(project.id)
    const isArchived = preferences.archivedIds.includes(project.id)
    return [
      { key: 'rename', label: '重命名', icon: <PencilSimple aria-hidden="true" /> },
      { key: 'favorite', label: isFavorite ? '取消个人收藏' : '加入个人收藏', icon: <Star weight={isFavorite ? 'fill' : 'regular'} aria-hidden="true" /> },
      { key: 'archive', label: isArchived ? '移出个人归档' : '移至个人归档', icon: isArchived ? <ArrowCounterClockwise aria-hidden="true" /> : <Archive aria-hidden="true" /> },
      { type: 'divider' },
      { key: 'delete', label: '删除项目', icon: <Trash aria-hidden="true" />, danger: true },
    ]
  }

  const handleMenu = (project: ProjectRecord, key: string) => {
    if (key === 'rename') openDialog({ kind: 'rename', project })
    if (key === 'favorite') setPreferences(toggleProjectFavorite(project.id))
    if (key === 'archive') archiveProject(project.id, !preferences.archivedIds.includes(project.id))
    if (key === 'delete') void deleteProject(project)
  }

  const clearHomepagePreferences = async () => {
    const confirmed = await Modal.confirm({
      title: '清除首页偏好',
      content: '这会清除当前浏览器中的最近访问、个人收藏和个人归档状态，不会删除服务器上的项目。',
      okText: '清除偏好',
      cancelText: '取消',
      locale: 'zh-CN',
    })
    if (!confirmed) return
    setPreferences(writeProjectPreferences({ recentIds: [], favoriteIds: [], archivedIds: [] }))
    setView('active')
    setRecentlyArchived(undefined)
    toast.success('首页偏好已清除')
  }

  return (
    <main className="project-center" id="main-content">
      <header className="project-center__hero">
        <div className="project-center__brand" aria-hidden="true"><SquaresFour weight="duotone" /></div>
        <div className="project-center__intro">
          <p className="eyebrow">桌面创作工作区</p>
          <h1>无限画板</h1>
          <p>继续最近的项目，或建立一个新的画板工作区。</p>
        </div>
        <Button variant="accent" size="lg" icon={<Plus aria-hidden="true" />} onClick={() => openDialog({ kind: 'create' })}>
          新建项目
        </Button>
      </header>

      <div className="project-home__tabs project-center__tabs">
        <Tabs
          aria-label="首页内容"
          value={section}
          onChange={(value) => setSection(value as CenterSection)}
          items={[
            { key: 'projects', label: <span className="project-tab-label"><FolderSimple aria-hidden="true" />项目</span>, content: null },
            { key: 'integrations', label: <span className="project-tab-label"><UploadSimple aria-hidden="true" />集成</span>, content: null },
            { key: 'settings', label: <span className="project-tab-label"><GearSix aria-hidden="true" />设置</span>, content: null },
          ]}
        />
      </div>

      {section === 'projects' ? <section className="project-center__library" aria-labelledby="project-library-heading">
        <div className="project-library__toolbar">
          <div>
            <p className="eyebrow">项目库</p>
            <h2 id="project-library-heading">{view === 'active' ? '全部项目' : '个人归档'}</h2>
          </div>
          <div className="project-library__controls">
            <Input
              aria-label="搜索项目"
              prefix={<MagnifyingGlass aria-hidden="true" />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索项目"
            />
            <Segmented
              aria-label="项目视图"
              value={view}
              onChange={(value) => setView(value as CenterView)}
              options={[{ value: 'active', label: '进行中' }, { value: 'archived', label: '个人归档' }]}
            />
          </div>
        </div>

        {recentlyArchived && view === 'active' ? <div className="project-center__undo" role="status"><span>“{recentlyArchived.title}”已移至个人归档，仅当前浏览器可见。</span><Button variant="glass" size="sm" onClick={() => { archiveProject(recentlyArchived.id, false); setRecentlyArchived(undefined) }}>撤销</Button></div> : null}
        {error ? <div className="project-center__error" role="alert"><span>{error}</span><Button variant="glass" size="sm" onClick={reload}>重试</Button></div> : null}
        {!projects ? (
          <div className="project-grid" aria-label="正在加载项目">
            {[0, 1, 2].map((item) => <Skeleton key={item} variant="rect" height={150} />)}
          </div>
        ) : visibleProjects.length === 0 ? (
          <Empty
            title={query ? '没有匹配的项目' : view === 'archived' ? '个人归档为空' : '从第一个项目开始'}
            description={query ? '尝试输入其他关键词。' : view === 'archived' ? '这里的状态仅保存在当前浏览器。' : '项目会集中管理画板、引用、评论和导入记录。'}
          >
            {!query && view === 'active' ? <Button variant="accent" icon={<Plus aria-hidden="true" />} onClick={() => openDialog({ kind: 'create' })}>新建项目</Button> : null}
          </Empty>
        ) : (
          <div className="project-grid">
            {visibleProjects.map((project) => {
              const favorite = preferences.favoriteIds.includes(project.id)
              return (
                <article key={project.id} className="project-card">
                  <button type="button" className="project-card__open" onClick={() => openProject(project.id)}>
                    <span className="project-card__icon"><FolderSimple weight="duotone" aria-hidden="true" /></span>
                    <span className="project-card__copy">
                      <span className="project-card__title"><strong>{project.title}</strong>{favorite ? <Star weight="fill" aria-label="已收藏" /> : null}</span>
                      <small>{project.boardCount ?? 0} 个画板 · 更新于 {formatUpdatedAt(project.updatedAt)}</small>
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </button>
                  <footer>
                    <span className="project-card__root">默认入口：{project.rootBoardTitle ?? '概览'}</span>
                    <Menu items={projectMenu(project)} onSelect={(key) => handleMenu(project, key)} placement="bottom-end">
                      <Button variant="ghost" size="sm" aria-label={`${project.title} 更多操作`} icon={<DotsThree weight="bold" aria-hidden="true" />} />
                    </Menu>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </section> : null}

      {section === 'integrations' ? (
        <div className="project-home__integrations project-center__integrations">
          <McpAccessPanel />
          <FeishuConnectionPanel />
        </div>
      ) : null}

      {section === 'settings' ? (
        <div className="project-settings-grid project-center__settings">
          <Card as="section" className="project-settings-card project-settings-card--primary" padding="lg" radius="24px">
            <div className="project-settings-card__heading">
              <div><p className="eyebrow">当前浏览器</p><h2>首页偏好</h2></div>
              <span>{preferences.favoriteIds.length} 个收藏 · {preferences.archivedIds.length} 个归档</span>
            </div>
            <p>最近访问、个人收藏和个人归档只保存在当前浏览器，不会改变服务器上的项目数据。</p>
            <div className="project-settings-card__actions">
              <Button variant="glass" onClick={() => void clearHomepagePreferences()}>清除首页偏好</Button>
            </div>
          </Card>
          <Card as="section" className="project-settings-card" padding="lg" radius="24px">
            <p className="eyebrow">项目级设置</p>
            <h2>名称、默认画板与导出</h2>
            <p>这些设置属于具体项目。请先打开一个项目，再进入项目内的“设置”。</p>
          </Card>
        </div>
      ) : null}

      <Modal
        open={Boolean(dialog)}
        onOpenChange={(open) => { if (!open && !submitting) setDialog(undefined) }}
        title={dialog?.kind === 'rename' ? '重命名项目' : '新建项目'}
        size="sm"
        footer={(
          <div className="dialog__actions">
            <Button variant="ghost" disabled={submitting} onClick={() => setDialog(undefined)}>取消</Button>
            <Button variant="accent" loading={submitting} disabled={submitting || !title.trim()} type="submit" form="project-dialog-form">
              {dialog?.kind === 'rename' ? '保存' : '创建项目'}
            </Button>
          </div>
        )}
      >
        <form id="project-dialog-form" className="dialog-form" onSubmit={submit}>
          <label htmlFor="project-dialog-title">项目名称</label>
          <Input id="project-dialog-title" autoFocus size="lg" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="例如：产品规划" />
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </Modal>
    </main>
  )
}
