import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, useValue, type Editor, type TLShapeId, type TLStore } from 'tldraw'
import { ChatCircleDots, ClockCounterClockwise, SquaresFour } from '@phosphor-icons/react'
import { Badge, Button, Drawer, Modal, Tag, toast } from '@ttqtt/liquid-glass-react'
import type { BoardReferenceShape } from '@infinite-board/tldraw-adapter'
import { getStoreSnapshot, snapshotToInteropScene } from '@infinite-board/tldraw-adapter'
import type { TldrawUserIdentity } from '../auth/tldraw-user'

import type { BoardSessionStatus } from './board-session'
import { SaveStatus } from './SaveStatus'
import { CanvasEditor, type BoardReferenceActions, type CanvasEditorProps } from '../canvas/CanvasEditor'
import { exportDrawioBoard } from '../import-export/DrawioExportButton'
import { BoardExportMenu } from '../import-export/BoardExportMenu'
import { exportBoardAsPng, exportBoardAsSvg } from '../import-export/visual-import'
import { CommentPanel } from '../comments/CommentPanel'
import type { CommentClient, CommentMessageView, CommentThreadView } from '../comments/comment-client'
import { resolveCommentAnchorPagePoint } from '../comments/CommentPins'
import { chineseErrorMessage } from '../../ui-text'
import { subscribeApplicationEvents, type ApplicationEvent } from '../automation-presence/application-events'
import { CommerceBoardView } from '../commerce/CommerceBoardView'
import { readCommerceDataset, type CommerceDataset } from '../commerce/commerce-data'
import { readDesignMap } from '../commerce/commerce-design-map'
import { CommerceDesignCanvas, type CommerceSourceLoader } from '../commerce/CommerceDesignCanvas'
import { CommerceEvidenceImport } from '../commerce/CommerceEvidenceImport'
import { importCommerceEvidence } from '../commerce/import-commerce-evidence'

async function loadCommentState(client: CommentClient, boardId: string): Promise<{
  threads: CommentThreadView[]
  messagesByThread: Record<string, CommentMessageView[]>
}> {
  if (client.loadBoardComments) {
    const state = await client.loadBoardComments(boardId)
    const messagesByThread: Record<string, CommentMessageView[]> = {}
    for (const message of state.messages) (messagesByThread[message.threadId] ??= []).push(message)
    return { threads: state.threads, messagesByThread }
  }
  const threads = await client.listThreads(boardId)
  const messages = await Promise.all(threads.map(async (thread) => [thread.id, await client.listMessages(thread.id)] as const))
  return { threads, messagesByThread: Object.fromEntries(messages) }
}

function sanitizeDownloadName(title: string): string {
  const sanitized = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[ .]+$/g, '')
    .trim()
  return sanitized || 'board'
}

export interface BoardPageProps {
  title: string
  navigation?: ReactNode
  projectId?: string
  boardId?: string
  status: BoardSessionStatus
  readOnly: boolean
  leaseHolderTabId?: string
  onRetrySave?: () => void
  onReloadFromServer?: () => void
  onDownloadRecovery?: () => void
  store: TLStore
  inputSessionKey: string
  onEditorMount(editor: Editor): void
  onBeforePdfExport?(): Promise<void>
  onEditIntent(): boolean
  onClipboardPaste?: CanvasEditorProps['onClipboardPaste']
  onShowAllBoards(): void
  onShowActivity?(): void
  onCreateReference?: (placement: { x: number; y: number }) => void
  onBoardReferenceOpen?(shape: BoardReferenceShape): void
  onLinkedBoardOpen?(boardId: string): void
  commerceResources?: readonly { id: string; title: string }[]
  onPayRhythmOpen?(sourceBoardId: string, data: CommerceDataset): Promise<void>
  loadCommerceSource?: CommerceSourceLoader
  boardReferenceActions?: BoardReferenceActions
  onBoardReferenceDrop?(event: { boardId: string; x: number; y: number }): void
  tldrawUser?: TldrawUserIdentity
  commentClient?: CommentClient
  collaborationStatus?: ReactNode
}

export function BoardPage({
  title,
  navigation,
  projectId,
  boardId,
  status,
  readOnly,
  leaseHolderTabId,
  onRetrySave,
  onReloadFromServer,
  onDownloadRecovery,
  store,
  inputSessionKey,
  onEditorMount,
  onBeforePdfExport,
  onEditIntent,
  onClipboardPaste,
  onShowAllBoards,
  onShowActivity,
  onCreateReference,
  onBoardReferenceOpen,
  onLinkedBoardOpen,
  commerceResources,
  onPayRhythmOpen,
  loadCommerceSource,
  boardReferenceActions,
  onBoardReferenceDrop,
  tldrawUser,
  commentClient,
  collaborationStatus,
}: BoardPageProps) {
  const editorRef = useRef<Editor | undefined>(undefined)
  const [exportError, setExportError] = useState<string>()
  const [exportBusy, setExportBusy] = useState(false)
  const [commentThreads, setCommentThreads] = useState<CommentThreadView[]>([])
  const [commentMessages, setCommentMessages] = useState<Record<string, CommentMessageView[]>>({})
  const [focusedCommentThreadId, setFocusedCommentThreadId] = useState<string>()
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentToolActive, setCommentToolActive] = useState(false)
  const [referenceToolActive, setReferenceToolActive] = useState(false)
  const [pendingCommentAnchor, setPendingCommentAnchor] = useState<{ shapeId?: string; x: number; y: number; shapeOffsetX?: number; shapeOffsetY?: number }>()
  const commentReloadGeneration = useRef(0)
  const [automationEvent, setAutomationEvent] = useState<ApplicationEvent>()
  const documentMeta = useValue('commerce document metadata', () => store.query.records('document').get()[0]?.meta, [store])
  const commerceData = useMemo(() => readCommerceDataset(documentMeta), [documentMeta])
  const designMap = readDesignMap(documentMeta)
  const [openingDesign, setOpeningDesign] = useState(false)
  const [canvasOnly, setCanvasOnly] = useState(false)
  const showCommerce = Boolean(commerceData && !canvasOnly)
  const commerceSession = useRef(inputSessionKey)
  commerceSession.current = inputSessionKey
  useEffect(() => () => { commerceSession.current = '' }, [])
  useEffect(() => setCanvasOnly(false), [boardId, inputSessionKey])

  const closeComments = () => {
    setCommentsOpen(false)
    setFocusedCommentThreadId(undefined)
    setPendingCommentAnchor(undefined)
  }

  const toggleCommentOverview = () => {
    if (commentsOpen && !focusedCommentThreadId && !pendingCommentAnchor) {
      closeComments()
      return
    }
    setFocusedCommentThreadId(undefined)
    setPendingCommentAnchor(undefined)
    setCommentsOpen(true)
  }

  useEffect(() => {
    setCommentThreads([])
    setCommentMessages({})
    setFocusedCommentThreadId(undefined)
    setCommentsOpen(false)
    setCommentToolActive(false)
    setReferenceToolActive(false)
    setPendingCommentAnchor(undefined)
  }, [boardId, inputSessionKey])

  useEffect(() => subscribeApplicationEvents((event) => {
    if (!boardId || event.boardId !== boardId || !event.type.startsWith('operation.')) return
    setAutomationEvent(event)
    if (event.type === 'operation.failed') toast.error(event.summary || 'AI 操作未完成。')
    if (event.type !== 'operation.committed') return
    toast.success(event.summary || 'AI 操作已完成')
    const editor = editorRef.current
    const ids = (event.affectedIds ?? []).filter((id): id is TLShapeId => id.startsWith('shape:') && Boolean(editor?.getShape(id as TLShapeId)))
    if (!editor || ids.length === 0) return
    editor.setHintingShapes(ids)
    window.setTimeout(() => editor.setHintingShapes([]), 1_800)
    if (!editor.isIn('select.idle') || editor.getEditingShapeId()) return
    const bounds = ids.map((id) => editor.getShapePageBounds(id)).filter((value): value is Box => Boolean(value))
    if (bounds.length > 0) editor.zoomToBounds(Box.Common(bounds), { animation: { duration: 220 }, inset: 80, targetZoom: 1 })
  }), [boardId])

  useEffect(() => {
    if (!automationEvent || automationEvent.type === 'operation.started') return
    const timer = window.setTimeout(() => setAutomationEvent(undefined), 3_000)
    return () => window.clearTimeout(timer)
  }, [automationEvent])

  const refreshComments = useCallback(async () => {
    if (!commentClient || !boardId) return
    const generation = ++commentReloadGeneration.current
    const state = await loadCommentState(commentClient, boardId)
    if (generation !== commentReloadGeneration.current) return
    setCommentThreads(state.threads)
    setCommentMessages(state.messagesByThread)
  }, [boardId, commentClient])

  useEffect(() => {
    if (!commentClient || !boardId) return
    let active = true
    void refreshComments().catch(() => {
      if (active) toast.error('无法加载评论，请稍后重试。')
    })
    const unsubscribe = commentClient.subscribeToChanges?.(boardId, () => {
      void refreshComments().catch(() => {
        if (active) toast.error('无法刷新评论，请稍后重试。')
      })
    })
    return () => {
      active = false
      commentReloadGeneration.current += 1
      unsubscribe?.()
    }
  }, [boardId, commentClient, inputSessionKey, refreshComments])

  const download = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${sanitizeDownloadName(title)}.${extension}`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const exportVisual = async (format: 'png' | 'svg', selectionOnly: boolean) => {
    if (!editorRef.current) return
    setExportError(undefined)
    setExportBusy(true)
    try {
      const blob = format === 'png'
        ? await exportBoardAsPng(editorRef.current, selectionOnly)
        : await exportBoardAsSvg(editorRef.current, selectionOnly)
      download(blob, format)
    } catch (error) {
      setExportError(chineseErrorMessage(error, '导出失败，请稍后重试。'))
    } finally {
      setExportBusy(false)
    }
  }

  const exportPdf = async () => {
    if (!boardId) return
    setExportError(undefined)
    setExportBusy(true)
    try {
      await onBeforePdfExport?.()
      const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/export.pdf`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
      download(await response.blob(), 'pdf')
    } catch (error) {
      setExportError(chineseErrorMessage(error, '导出失败，请稍后重试。'))
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <main
      className="board-page"
      onPointerDownCapture={(event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('.comment-pin, [data-comment-panel], [data-comment-toggle]')) return
        closeComments()
      }}
    >
      <header className="board-page__header">
        <div className="board-page__identity">
          {navigation}
          <div className="board-page__title">
            <p className="board-page__context">当前画板</p>
            <h1>{title}</h1>
          </div>
        </div>
        <div className="board-page__status">
          {commerceData && boardId && onPayRhythmOpen ? <Button variant="glass" size="sm" disabled={openingDesign} onClick={async () => {
            setOpeningDesign(true)
            try { await onPayRhythmOpen(boardId, commerceData) }
            catch (error) { toast.error(chineseErrorMessage(error, '无法打开设计画板')) }
            finally { setOpeningDesign(false) }
          }}>{openingDesign ? '正在打开…' : '商业设计总览 ↗'}</Button> : null}
          {commerceData ? <Button variant="accent" size="sm" onClick={() => setCanvasOnly(!canvasOnly)}>{showCommerce ? '查看原生画布' : '打开付费点总览'}</Button> : null}
          {commerceData ? <CommerceEvidenceImport disabled={readOnly} onImport={async bundle => {
            await importCommerceEvidence(store, bundle, () => commerceSession.current === inputSessionKey && !readOnly && onEditIntent())
            toast.success('配图与历史资料已更新')
          }} /> : null}
          <div className="board-page__state-cluster">
            {readOnly ? <Tag color="warning" size="sm">只读</Tag> : null}
            {collaborationStatus}
            <SaveStatus
              status={status}
              {...(leaseHolderTabId ? { leaseHolderTabId } : {})}
              {...(onRetrySave ? { onRetry: onRetrySave } : {})}
              {...(onReloadFromServer ? { onReload: onReloadFromServer } : {})}
              {...(onDownloadRecovery ? { onCopyRecovery: onDownloadRecovery } : {})}
            />
          </div>
          {commentClient ? (
            <Badge count={commentThreads.filter((thread) => thread.status === 'open').length} showZero>
              <Button data-comment-toggle variant={commentsOpen ? 'accent' : 'glass'} size="sm" icon={<ChatCircleDots aria-hidden="true" />} type="button" onClick={toggleCommentOverview}>评论</Button>
            </Badge>
          ) : null}
          {onShowActivity ? <Button variant="glass" size="sm" icon={<ClockCounterClockwise aria-hidden="true" />} type="button" onClick={onShowActivity}>项目活动</Button> : null}
          {!showCommerce ? <BoardExportMenu
            {...(projectId ? {
              onExportDrawio: () => exportDrawioBoard({
                projectId,
                boardTitle: title,
                getScene: () => snapshotToInteropScene(getStoreSnapshot(store)),
              }),
            } : {})}
            onExportPng={(selectionOnly) => void exportVisual('png', selectionOnly)}
            onExportSvg={(selectionOnly) => void exportVisual('svg', selectionOnly)}
            {...(boardId ? { onExportPdf: () => void exportPdf() } : {})}
            busy={exportBusy}
          /> : null}
          <Button variant="glass" size="sm" icon={<SquaresFour aria-hidden="true" />} type="button" onClick={onShowAllBoards}>全部画板</Button>
        </div>
      </header>
      {automationEvent ? <div className={`automation-operation automation-operation--${automationEvent.type.split('.').at(-1)}`} role="status"><strong>{automationEvent.type === 'operation.started' ? 'AI 正在操作' : automationEvent.type === 'operation.committed' ? 'AI 操作完成' : 'AI 操作失败'}</strong><span>{automationEvent.summary}</span></div> : null}
      <CommerceDesignCanvas sourceBoardId={designMap?.sourceBoardId} loadSource={loadCommerceSource} store={store} editorRef={editorRef} canEdit={() => !readOnly && onEditIntent()} onOpenSource={onLinkedBoardOpen}>
      <div className="commerce-stage">
      <div className="commerce-canvas" inert={showCommerce} aria-hidden={showCommerce || undefined}>
      <CanvasEditor
        store={store}
        {...(tldrawUser ? { tldrawUser } : {})}
        inputSessionKey={inputSessionKey}
        onMount={(editor) => {
          editorRef.current = editor
          onEditorMount(editor)
        }}
        onEditIntent={onEditIntent}
        {...(onClipboardPaste ? { onClipboardPaste } : {})}
        {...(onCreateReference ? {
          referenceToolActive,
          onReferenceToolToggle: () => {
            setReferenceToolActive((active) => !active)
            setCommentToolActive(false)
            setPendingCommentAnchor(undefined)
          },
          onReferenceToolCancel: () => setReferenceToolActive(false),
          onReferencePlace: (placement: { x: number; y: number }) => {
            setReferenceToolActive(false)
            onCreateReference(placement)
          },
        } : {})}
        {...(commentClient ? {
          commentToolActive,
          ...(pendingCommentAnchor ? { pendingCommentAnchor } : {}),
          onCommentToolToggle: () => {
            setReferenceToolActive(false)
            setCommentToolActive((active) => !active)
            setPendingCommentAnchor(undefined)
          },
          onCommentCancel: () => {
            setCommentToolActive(false)
            setPendingCommentAnchor(undefined)
          },
          onCommentPlace: (anchor: { shapeId?: string; x: number; y: number; shapeOffsetX?: number; shapeOffsetY?: number }) => {
            setFocusedCommentThreadId(undefined)
            setPendingCommentAnchor(anchor)
            setCommentToolActive(false)
            setCommentsOpen(true)
          },
          commentThreads,
          onFocusCommentThread: (threadId: string) => {
            setFocusedCommentThreadId(threadId)
            setPendingCommentAnchor(undefined)
            setCommentsOpen(true)
          },
          onMoveCommentThread: (threadId: string, anchor: { x: number; y: number }) => {
            void commentClient.updateThreadAnchor(threadId, anchor).then((updated) => {
              setCommentThreads((current) => current.map((thread) => thread.id === threadId ? updated : thread))
            }).catch(() => toast.error('无法移动评论，请稍后重试。'))
          },
          onDeleteCommentThread: (threadId: string) => {
            void Modal.confirm({
              title: '删除讨论',
              content: '此讨论及其全部回复都会被永久删除。',
              okText: '删除讨论',
              cancelText: '取消',
              danger: true,
              locale: 'zh-CN',
            }).then(async (confirmed) => {
              if (!confirmed) return
              try {
                await commentClient.deleteThread(threadId)
                if (focusedCommentThreadId === threadId) closeComments()
                await refreshComments()
                toast.success('讨论已删除')
              } catch {
                toast.error('无法删除讨论。')
              }
            })
          },
        } : {})}
        {...(onBoardReferenceOpen ? { onBoardReferenceOpen } : {})}
        {...(boardReferenceActions ? { boardReferenceActions } : {})}
        {...(onBoardReferenceDrop ? { onBoardReferenceDrop } : {})}
      />
      </div>
      {showCommerce && commerceData ? <div className="commerce-overlay"><CommerceBoardView key={boardId ?? inputSessionKey} data={commerceData} onOpenBoard={onLinkedBoardOpen} {...(commerceResources ? { resources: commerceResources } : {})} /></div> : null}
      </div>
      </CommerceDesignCanvas>
      <Drawer open={Boolean(commentClient && boardId && commentsOpen)} onOpenChange={(open) => { if (!open) closeComments() }} placement="right" size={430} title={focusedCommentThreadId ? '评论详情' : `评论 (${commentThreads.length})`}>
        {commentClient && boardId ? <CommentPanel
          embedded
          boardId={boardId}
          client={commentClient}
          hasShape={(shapeId) => Boolean(store.get(shapeId as never))}
          threads={commentThreads}
          messagesByThread={commentMessages}
          onRefresh={refreshComments}
          {...(pendingCommentAnchor ? { pendingAnchor: pendingCommentAnchor } : {})}
          onPendingAnchorSaved={() => setPendingCommentAnchor(undefined)}
          {...(focusedCommentThreadId ? { focusedThreadId: focusedCommentThreadId } : {})}
          onLocateThread={(thread) => {
            const editor = editorRef.current
            if (!editor) return
            const point = resolveCommentAnchorPagePoint(editor, thread)
            if (!point) return
            setFocusedCommentThreadId(thread.id)
            editor.centerOnPoint(point, { animation: { duration: 180 } })
          }}
          onClose={closeComments}
        /> : null}
      </Drawer>
      {exportError ? <p role="alert">{exportError}</p> : null}
    </main>
  )
}
