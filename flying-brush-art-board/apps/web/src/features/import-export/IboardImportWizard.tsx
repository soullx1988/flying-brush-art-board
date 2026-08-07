import { useEffect, useRef, useState } from 'react'
import { FileArrowUp, ShieldCheck, WarningCircle } from '@phosphor-icons/react'
import {
  Alert,
  Button,
  Modal,
  Skeleton,
  Steps,
  Upload,
  type UploadFile,
} from '@ttqtt/liquid-glass-react'

import { TemporaryImportTab, type TemporaryImportStatus } from './TemporaryImportTab'
import { chineseErrorMessage } from '../../ui-text'

export interface IboardImportIssue {
  code: string
  message: string
  action: string
}

export interface IboardImportInspection {
  compatible: boolean
  formatVersion?: number
  sourceProject?: { id: string; title: string; rootBoardId: string }
  boardCount?: number
  referenceCount?: number
  maxEmbedDepth?: number
  assetCount?: number
  assetBytes?: number
  issues: IboardImportIssue[]
}

export interface IboardInspectSession {
  sessionId: string
  fileName: string
  inspection: IboardImportInspection
}

export interface IboardImportCommitRequest {
  sessionId: string
  targetProjectId: string
  mode: 'merge'
  openImportedRootInNewTab: true
}

export interface IboardImportCommitResult {
  targetProjectId: string
  importedRootBoardId: string
  importedBoardIds: string[]
  importedReferenceIds: string[]
  importedBoardCount: number
  importedReferenceCount: number
}

export interface IboardImportClient {
  inspectIboard(file: File): Promise<IboardInspectSession>
  commitIboardImport(request: IboardImportCommitRequest): Promise<IboardImportCommitResult>
  cancelIboardImport(sessionId: string): Promise<void>
}

export interface IboardImportWizardProps {
  open: boolean
  targetProject: { id: string; title: string }
  initialFile?: File
  client: IboardImportClient
  onClose(): void
  onCommitted(result: IboardImportCommitResult): void | Promise<void>
  temporaryTabTargetId?: string
}

export function IboardImportWizard({
  open,
  targetProject,
  initialFile,
  client,
  onClose,
  onCommitted,
  temporaryTabTargetId,
}: IboardImportWizardProps) {
  const [fileName, setFileName] = useState(initialFile?.name ?? '未选择文件')
  const [status, setStatus] = useState<TemporaryImportStatus>('selecting')
  const [session, setSession] = useState<IboardInspectSession>()
  const [error, setError] = useState<string>()
  const [committed, setCommitted] = useState<IboardImportCommitResult>()
  const sessionIdRef = useRef<string | undefined>(undefined)
  const inspectSequence = useRef(0)

  const clearSession = async () => {
    const sessionId = sessionIdRef.current
    sessionIdRef.current = undefined
    if (sessionId) await client.cancelIboardImport(sessionId).catch(() => undefined)
  }

  const cancel = async () => {
    if (status === 'committing') return
    inspectSequence.current += 1
    await clearSession()
    onClose()
  }

  const inspectFile = async (file: File) => {
    const sequence = ++inspectSequence.current
    await clearSession()
    setFileName(file.name)
    setStatus('inspecting')
    setSession(undefined)
    setCommitted(undefined)
    setError(undefined)
    try {
      const next = await client.inspectIboard(file)
      if (sequence !== inspectSequence.current) {
        await client.cancelIboardImport(next.sessionId).catch(() => undefined)
        return
      }
      sessionIdRef.current = next.sessionId
      setSession(next)
      setStatus(next.inspection.compatible ? 'ready' : 'error')
    } catch {
      if (sequence !== inspectSequence.current) return
      setStatus('error')
      setError('无法预检此文件，请确认本地服务可用后重试。')
    }
  }

  useEffect(() => {
    if (open && initialFile) void inspectFile(initialFile)
  }, [initialFile, open])

  useEffect(() => {
    if (open || status === 'committing') return
    inspectSequence.current += 1
    void clearSession()
  }, [open, status])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || status === 'committing') return
      event.preventDefault()
      void cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, status])

  useEffect(() => () => {
    const sessionId = sessionIdRef.current
    sessionIdRef.current = undefined
    if (sessionId) void client.cancelIboardImport(sessionId).catch(() => undefined)
  }, [client])

  if (!open) return null

  const commit = async () => {
    if (!session?.inspection.compatible) return
    setStatus('committing')
    setError(undefined)
    let result: IboardImportCommitResult
    try {
      result = await client.commitIboardImport({
        sessionId: session.sessionId,
        targetProjectId: targetProject.id,
        mode: 'merge',
        openImportedRootInNewTab: true,
      })
      sessionIdRef.current = undefined
      setCommitted(result)
    } catch {
      setStatus('error')
      setError('合并失败，当前项目未发生变化。请处理冲突后重试。')
      return
    }

    try {
      await onCommitted(result)
      onClose()
    } catch (openError) {
      setStatus('error')
      const cause = `（${chineseErrorMessage(openError)}）`
      setError(`数据已导入，但入口标签打开失败。${cause}`)
    }
  }

  const reopen = async () => {
    if (!committed) return
    setError(undefined)
    try {
      await onCommitted(committed)
      onClose()
    } catch (openError) {
      const cause = `（${chineseErrorMessage(openError)}）`
      setError(`数据已导入，但入口标签打开失败。${cause}`)
    }
  }

  const uploadFiles: UploadFile[] = fileName === '未选择文件' ? [] : [{
    key: 'iboard-file',
    name: fileName,
    status: status === 'inspecting' || status === 'committing'
      ? 'uploading'
      : status === 'error'
        ? 'error'
        : status === 'ready'
          ? 'done'
          : 'ready',
  }]
  const currentStep = status === 'selecting' ? 0 : status === 'inspecting' ? 1 : 2

  return (
    <>
      <TemporaryImportTab
        fileName={fileName}
        status={status}
        closeDisabled={status === 'committing'}
        {...(temporaryTabTargetId ? { portalTargetId: temporaryTabTargetId } : {})}
        onClose={() => void cancel()}
      />
      <Modal
        open={open}
        onOpenChange={(nextOpen) => { if (!nextOpen) void cancel() }}
        title="导入 .iboard 项目包"
        size="lg"
        closeOnOverlayClick={status !== 'committing'}
        footer={(
          <div className="dialog__actions iboard-import-wizard__actions">
            <Button variant="ghost" type="button" disabled={status === 'committing'} onClick={() => void cancel()}>取消</Button>
            {committed && error ? (
              <Button variant="accent" type="button" onClick={() => void reopen()}>重新打开导入入口</Button>
            ) : (
              <Button
                variant="accent"
                type="button"
                loading={status === 'committing'}
                disabled={!session?.inspection.compatible || status === 'committing'}
                onClick={() => void commit()}
              >{status === 'committing' ? '正在合并' : '确认合并'}</Button>
            )}
          </div>
        )}
      >
        <div className="iboard-import-wizard" data-committing={status === 'committing' ? 'true' : undefined}>
          <div className="import-dialog__intro">
            <span className="import-dialog__icon"><FileArrowUp weight="duotone" aria-hidden="true" /></span>
            <div><strong>{`合并到 ${targetProject.title}`}</strong><p>先完成本地安全预检，确认兼容后再写入项目。</p></div>
          </div>
          <Steps
            current={currentStep}
            size="sm"
            items={[
              { key: 'select', title: '选择文件' },
              { key: 'inspect', title: '兼容预检' },
              { key: 'merge', title: '确认合并' },
            ]}
          />
          <Upload
            aria-label="选择 .iboard 文件"
            accept=".iboard"
            maxCount={1}
            disabled={status === 'committing'}
            fileList={uploadFiles}
            onChange={(_list, meta) => {
              if (meta.type === 'add' && meta.file) void inspectFile(meta.file)
              if (meta.type === 'remove') {
                inspectSequence.current += 1
                void clearSession()
                setFileName('未选择文件')
                setSession(undefined)
                setCommitted(undefined)
                setError(undefined)
                setStatus('selecting')
              }
            }}
          >
            <span className="import-dialog__upload-trigger"><FileArrowUp aria-hidden="true" />选择 .iboard 文件</span>
          </Upload>

          {status === 'inspecting' ? <div className="import-dialog__loading" role="status"><Skeleton lines={3} /><span>正在安全预检，不会写入当前项目</span></div> : null}
          {session?.inspection.compatible ? (
            <div className="iboard-inspection-report">
              <div className="import-dialog__report-title"><ShieldCheck weight="duotone" aria-hidden="true" /><div><h3>兼容检查通过</h3><p>合并会保留现有项目，并把导入入口作为新标签打开。</p></div></div>
              <dl>
                <div><dt>内容</dt><dd>{`${session.inspection.boardCount} 个画板`}</dd></div>
                <div><dt>关系</dt><dd>{`${session.inspection.referenceCount} 条引用`}</dd></div>
                <div><dt>结构</dt><dd>{`最长嵌套 ${session.inspection.maxEmbedDepth} 层`}</dd></div>
                <div><dt>资源</dt><dd>{`${session.inspection.assetCount} 个资源`}</dd></div>
              </dl>
            </div>
          ) : null}
          {session && !session.inspection.compatible ? (
            <Alert kind="danger" title="文件暂时无法导入" icon={<WarningCircle aria-hidden="true" />}>
              <div className="iboard-conflict-report">
              {session.inspection.issues.map((issue) => (
                <article key={issue.code}>
                  <strong>{issue.code}</strong>
                  <p>{issue.message}</p>
                  <p>{issue.action}</p>
                </article>
              ))}
              </div>
            </Alert>
          ) : null}
          {error ? <Alert kind="danger" title="导入未完成">{error}</Alert> : null}
        </div>
      </Modal>
    </>
  )
}
