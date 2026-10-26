import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowSquareOut,
  FilePdf,
  FileArrowUp,
  FolderOpen,
  GearSix,
  Plus,
  ShieldCheck,
  UploadSimple,
} from '@phosphor-icons/react'
import { Button, Card, Dropdown, Empty, Input, Modal, Select, Tabs, toast, type MenuItem } from '@ttqtt/liquid-glass-react'

import type {
  BoardReferenceRecord,
  ProjectRecord,
  ProjectNavigation,
  StoredBoard,
} from '@infinite-board/board-core'

import { AllBoardsPanel } from './AllBoardsPanel'
import { ProjectTopicMap } from './ProjectTopicMap'
import { CreateBoardDialog } from './CreateBoardDialog'
import { IboardExportButton } from '../import-export/IboardExportButton'
import { AuditPanel, type AuditClient } from '../audit/AuditPanel'
import { FeishuConnectionPanel } from '../feishu/FeishuConnectionPanel'
import { createFeishuImportClient, FeishuImportWizard, type FeishuImportCommitResult } from '../feishu/FeishuImportWizard'
import { createBrowserUuid } from '../../app/browser-uuid'
import { subscribeApplicationEvents } from '../automation-presence/application-events'
import { McpAccessPanel } from '../automation-presence/McpAccessPanel'

export interface ProjectHomeData {
  project: ProjectRecord
  boards: StoredBoard[]
  references: BoardReferenceRecord[]
}

export interface CreateBoardInput {
  id: string
  title: string
  tldrawSnapshot: unknown
}

export interface ProjectHomeClient {
  getProject(projectId: string): Promise<ProjectHomeData>
  saveProjectNavigation?(projectId: string, navigation: ProjectNavigation): Promise<ProjectRecord>
  createBoard(projectId: string, input: CreateBoardInput): Promise<StoredBoard>
  duplicateBoard(boardId: string, input: { id: string; title: string }): Promise<StoredBoard>
  setDefaultBoard(projectId: string, boardId: string): Promise<ProjectRecord>
  renameProject?(projectId: string, title: string): Promise<ProjectRecord>
  deleteProject?(projectId: string): Promise<void>
  renameBoard(boardId: string, title: string): Promise<StoredBoard>
  deleteBoard(boardId: string): Promise<void>
}

export interface ProjectHomePageProps {
  projectId: string
  client: ProjectHomeClient
  onOpenBoard(boardId: string, mode: 'current' | 'new'): void
  onImport?: () => void
  onImportDrawio?: () => void
  auditClient?: AuditClient
  onFeishuImported?(result: FeishuImportCommitResult): void | Promise<void>
  onProjectDeleted?(): void
}

type ProjectSection = 'map' | 'boards' | 'activity' | 'integrations' | 'settings'

function createBoardId(): string {
  return `board-${createBrowserUuid()}`
}

export function ProjectHomePage({
  projectId,
  client,
  onOpenBoard,
  onImport,
  onImportDrawio,
  auditClient,
  onFeishuImported,
  onProjectDeleted,
}: ProjectHomePageProps) {
  const [data, setData] = useState<ProjectHomeData>()
  const [error, setError] = useState<string>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [section, setSection] = useState<ProjectSection>('map')
  const [projectTitle, setProjectTitle] = useState('')
  const [defaultBoardId, setDefaultBoardId] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [exportingProjectPdf, setExportingProjectPdf] = useState(false)
  const latestRefresh = useRef(0)
  const feishuImportClient = useMemo(() => createFeishuImportClient(), [])

  const refresh = () => {
    const refreshId = ++latestRefresh.current
    setError(undefined)
    void client.getProject(projectId).then((next) => {
      if (refreshId !== latestRefresh.current || next.project.id !== projectId) return
      setData(next)
      setProjectTitle(next.project.title)
      setDefaultBoardId(next.project.rootBoardId)
    }, () => {
      if (refreshId === latestRefresh.current) setError('无法加载项目，请稍后重试。')
    })
  }

  useEffect(() => {
    setData(undefined)
    setError(undefined)
    setDialogOpen(false)
    setCreating(false)
    setSection('map')
    setProjectTitle('')
    setDefaultBoardId('')
    setSavingSettings(false)
    refresh()
    return () => {
      latestRefresh.current += 1
    }
  }, [client, projectId])

  useEffect(() => subscribeApplicationEvents((event) => {
    if (event.projectId !== projectId) return
    if (event.type.startsWith('project.') || event.type.startsWith('board.') || event.type.startsWith('comment.')) refresh()
  }), [client, projectId])

  if (error) {
    return <main className="project-home project-home--state" id="main-content"><Empty title="无法加载项目" description={error}><Button variant="accent" onClick={refresh}>重试</Button></Empty></main>
  }
  if (!data || data.project.id !== projectId) {
    return <main className="project-home project-home--state" id="main-content"><div className="project-home-skeleton" role="status" aria-label="正在加载项目"><span /><span /><span /></div></main>
  }

  const setDefault = async (boardId: string) => {
    try {
      const project = await client.setDefaultBoard(projectId, boardId)
      setData((current) => (current ? { ...current, project } : current))
      setDefaultBoardId(boardId)
      toast.success('默认入口已更新')
    } catch {
      toast.error('无法更新默认入口，请稍后重试。')
    }
  }

  const createBoard = async (title: string, openInNewTab: boolean) => {
    setCreating(true)
    try {
      const board = await client.createBoard(projectId, {
        id: createBoardId(),
        title,
        tldrawSnapshot: { store: {} },
      })
      setData((current) => current ? { ...current, boards: [...current.boards, board] } : current)
      setDialogOpen(false)
      toast.success('画板已创建')
      if (openInNewTab) onOpenBoard(board.id, 'new')
    } catch {
      toast.error('无法创建画板，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }

  const renameBoard = async (boardId: string, title: string) => {
    const updated = await client.renameBoard(boardId, title)
    setData((current) => current ? { ...current, boards: current.boards.map((board) => board.id === boardId ? updated : board) } : current)
  }

  const duplicateBoard = async (board: StoredBoard) => {
    const duplicated = await client.duplicateBoard(board.id, {
      id: createBoardId(),
      title: `${board.title} 副本`,
    })
    setData((current) => current ? { ...current, boards: [...current.boards, duplicated] } : current)
  }

  const deleteBoard = async (board: StoredBoard) => {
    await client.deleteBoard(board.id)
    setData((current) => current ? {
      ...current,
      boards: current.boards.filter((candidate) => candidate.id !== board.id),
      references: current.references.filter((reference) => reference.sourceBoardId !== board.id && reference.targetBoardId !== board.id),
    } : current)
    refresh()
  }

  const saveProjectName = async () => {
    const title = projectTitle.trim()
    if (!title || title === data.project.title || !client.renameProject) return
    setSavingSettings(true)
    try {
      const project = await client.renameProject(projectId, title)
      setData((current) => current ? { ...current, project } : current)
      toast.success('项目名称已更新')
    } catch {
      toast.error('无法更新项目名称，请稍后重试。')
    } finally {
      setSavingSettings(false)
    }
  }

  const saveDefaultBoard = async () => {
    if (!defaultBoardId || defaultBoardId === data.project.rootBoardId) return
    setSavingSettings(true)
    try {
      await setDefault(defaultBoardId)
    } finally {
      setSavingSettings(false)
    }
  }

  const deleteProject = async () => {
    if (!client.deleteProject) return
    const confirmed = await Modal.confirm({
      title: '删除项目',
      content: `“${data.project.title}”中的画板、引用、评论和资源都会被永久删除。`,
      okText: '删除项目',
      cancelText: '取消',
      danger: true,
      locale: 'zh-CN',
    })
    if (!confirmed) return
    setSavingSettings(true)
    try {
      await client.deleteProject(projectId)
      toast.success('项目已删除')
      onProjectDeleted?.()
    } catch {
      toast.error('无法删除项目，请稍后重试。')
      setSavingSettings(false)
    }
  }

  const exportProjectPdf = async () => {
    setExportingProjectPdf(true)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export.pdf`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${data.project.title.replace(/[\\/:*?"<>|]/g, '-').trim() || '项目'}.pdf`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      toast.error('无法导出项目 PDF，请稍后重试。')
    } finally {
      setExportingProjectPdf(false)
    }
  }

  const importItems: MenuItem[] = [
    { key: 'iboard', label: '导入 .iboard 项目包', icon: <FileArrowUp aria-hidden="true" />, disabled: !onImport },
    { key: 'drawio', label: '导入 .drawio 画板', icon: <ArrowSquareOut aria-hidden="true" />, disabled: !onImportDrawio },
    { key: 'feishu', label: '从飞书白板导入', icon: <UploadSimple aria-hidden="true" /> },
  ]

  const boardContent = (
    <AllBoardsPanel
      project={data.project}
      boards={data.boards}
      references={data.references}
      onOpenBoard={onOpenBoard}
      onSetDefault={(boardId) => void setDefault(boardId)}
      onCreateBoard={() => setDialogOpen(true)}
      onRenameBoard={renameBoard}
      onDuplicateBoard={duplicateBoard}
      onDeleteBoard={deleteBoard}
    />
  )

  const activityContent = auditClient ? (
    <AuditPanel projectId={projectId} client={auditClient} boards={data.boards} onOpenBoard={(boardId) => onOpenBoard(boardId, 'current')} />
  ) : (
    <Empty title="活动记录不可用" description="当前运行环境没有启用操作审计。" />
  )

  const integrationsContent = (
    <div className="project-home__integrations">
      <McpAccessPanel />
      <FeishuConnectionPanel />
      <FeishuImportWizard
        client={feishuImportClient}
        defaultProjectId={projectId}
        onCommitted={async (result) => {
          if (onFeishuImported) await onFeishuImported(result)
          else onOpenBoard(result.boardId, 'new')
        }}
      />
    </div>
  )

  const settingsContent = (
    <div className="project-settings-grid">
      <Card as="section" className="project-settings-card project-settings-card--primary" padding="lg" radius="24px">
        <div className="project-settings-card__heading"><div><p className="eyebrow">项目信息</p><h2>名称与默认入口</h2></div><span>{data.boards.length} 个画板 · {data.references.length} 条引用</span></div>
        <div className="project-settings-form">
          <label htmlFor="project-settings-title">项目名称</label>
          <div><Input id="project-settings-title" value={projectTitle} onChange={(event) => setProjectTitle(event.currentTarget.value)} /><Button variant="glass" disabled={savingSettings || !projectTitle.trim() || projectTitle.trim() === data.project.title || !client.renameProject} onClick={() => void saveProjectName()}>保存名称</Button></div>
          <span className="project-settings-form__label">默认画板</span>
          <div><Select aria-label="默认画板" value={defaultBoardId} onChange={setDefaultBoardId} options={data.boards.map((board) => ({ value: board.id, label: board.title }))} /><Button variant="glass" disabled={savingSettings || defaultBoardId === data.project.rootBoardId} onClick={() => void saveDefaultBoard()}>更新入口</Button></div>
        </div>
      </Card>
      <Card as="section" className="project-settings-card" padding="lg" radius="24px">
        <p className="eyebrow">备份与迁移</p>
        <h2>导出项目</h2>
        <p>导出完整项目包，包含画板、引用和已物化资源。</p>
        <div className="project-settings-card__actions">
          <IboardExportButton projectId={data.project.id} projectTitle={data.project.title} />
          <Button variant="glass" icon={<FilePdf aria-hidden="true" />} loading={exportingProjectPdf} disabled={exportingProjectPdf} onClick={() => void exportProjectPdf()}>导出项目 PDF</Button>
        </div>
      </Card>
      <Card as="section" className="project-settings-card project-settings-card--danger" padding="lg" radius="24px">
        <div><p className="eyebrow">危险操作</p><h2>删除项目</h2><p>删除后无法恢复，请先导出项目备份。</p></div>
        <Button variant="danger" disabled={savingSettings || !client.deleteProject} onClick={() => void deleteProject()}>删除项目</Button>
      </Card>
    </div>
  )

  return (
    <main className="project-home" id="main-content">
      <header className="project-home__header">
        <div className="project-home__title">
          <p className="eyebrow">项目工作区</p>
          <h1>{data.project.title}</h1>
          <p>{data.boards.length} 个画板 · {data.references.length} 条引用</p>
        </div>
        <div className="project-home__actions">
          <Button variant="accent" icon={<FolderOpen aria-hidden="true" />} type="button" onClick={() => onOpenBoard(data.project.rootBoardId, 'current')}>
            进入默认画板
          </Button>
          <Button variant="glass" icon={<Plus aria-hidden="true" />} type="button" onClick={() => setDialogOpen(true)}>新建画板</Button>
          <Dropdown
            label="导入"
            variant="glass"
            items={importItems}
            onSelect={(key) => {
              if (key === 'iboard') onImport?.()
              if (key === 'drawio') onImportDrawio?.()
              if (key === 'feishu') setSection('integrations')
            }}
          />
        </div>
      </header>

      <div className="project-home__tabs">
        <Tabs
          aria-label="项目内容"
          value={section === 'map' && !data.project.navigation && !client.saveProjectNavigation ? 'boards' : section}
          onChange={(value) => setSection(value as ProjectSection)}
          items={[
            ...(data.project.navigation || client.saveProjectNavigation ? [{ key: 'map', label: '主题地图', content: <ProjectTopicMap project={data.project} boards={data.boards} references={data.references} onOpenBoard={onOpenBoard} initialFocus={new URLSearchParams(window.location.search).get('map') ?? ''} onFocusChange={(id) => { const url = new URL(window.location.href); if (id) url.searchParams.set('map', id); else url.searchParams.delete('map'); window.history.replaceState(window.history.state, '', url) }} {...(client.saveProjectNavigation ? { onSaveNavigation: async (navigation: ProjectNavigation) => { const project = await client.saveProjectNavigation!(projectId, navigation); setData((current) => current ? { ...current, project } : current) } } : {})} /> }] : []),
            { key: 'boards', label: '画板', content: boardContent },
            { key: 'activity', label: <span className="project-tab-label"><ShieldCheck aria-hidden="true" />活动</span>, content: activityContent },
            { key: 'integrations', label: <span className="project-tab-label"><UploadSimple aria-hidden="true" />集成</span>, content: integrationsContent },
            { key: 'settings', label: <span className="project-tab-label"><GearSix aria-hidden="true" />设置</span>, content: settingsContent },
          ]}
        />
      </div>

      <CreateBoardDialog
        open={dialogOpen}
        submitting={creating}
        onCancel={() => setDialogOpen(false)}
        onCreate={createBoard}
      />
    </main>
  )
}
