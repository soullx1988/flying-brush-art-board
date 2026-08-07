import { useEffect, useState } from 'react'
import type { BoardClipboardPayload } from '@infinite-board/board-core'
import { importDrawio, type DrawioImportBoard } from '@infinite-board/interop/drawio/import-drawio'
import { interopSceneToSnapshot } from '@infinite-board/tldraw-adapter'
import { FileArrowUp } from '@phosphor-icons/react'
import { Alert, Button, Modal, Steps, Upload, toast, type UploadFile } from '@ttqtt/liquid-glass-react'
import { chineseErrorMessage } from '../../ui-text'

export interface PrepareDrawioBoardImportOptions {
  projectId: string
  boardId: string
  boards: readonly DrawioImportBoard[]
  copiedAt?: string
}

export interface PreparedDrawioBoardImport {
  initialSnapshot: ReturnType<typeof interopSceneToSnapshot>
  referencePayload?: BoardClipboardPayload
  warningCount: number
}

interface SnapshotRecord {
  id?: unknown
  typeName?: unknown
  type?: unknown
  fromId?: unknown
  toId?: unknown
  props?: Record<string, unknown>
  meta?: Record<string, unknown>
}

function normalizeInteropMarkers(store: Record<string, SnapshotRecord>): Record<string, SnapshotRecord> {
  const logicalToRecordId = new Map<string, string>()
  for (const record of Object.values(store)) {
    const marker = record.meta?.interopElement as { id?: unknown } | undefined
    if (typeof marker?.id === 'string' && typeof record.id === 'string') {
      logicalToRecordId.set(marker.id, record.id)
    }
  }
  return Object.fromEntries(Object.entries(store).map(([recordId, source]) => {
    const record = structuredClone(source)
    const marker = record.meta?.interopElement as Record<string, any> | undefined
    if (marker) {
      marker.id = recordId
      if (typeof marker.parentElementId === 'string') {
        marker.parentElementId = logicalToRecordId.get(marker.parentElementId) ?? marker.parentElementId
      }
      if (marker.type === 'connector') {
        for (const terminal of ['start', 'end'] as const) {
          const endpoint = marker[terminal] as { elementId?: unknown } | undefined
          if (typeof endpoint?.elementId === 'string') {
            endpoint.elementId = logicalToRecordId.get(endpoint.elementId) ?? endpoint.elementId
          }
        }
      }
    }
    return [recordId, record]
  }))
}

export function prepareDrawioBoardImport(
  xml: string,
  options: PrepareDrawioBoardImportOptions,
): PreparedDrawioBoardImport {
  const imported = importDrawio(xml, { projectId: options.projectId, boards: options.boards })
  const snapshot = interopSceneToSnapshot(imported.value, { referencePolicy: 'preserve' })
  const sourceStore = normalizeInteropMarkers(
    snapshot.document.store as unknown as Record<string, SnapshotRecord>,
  )
  const referenceShapeIds = new Set(
    Object.values(sourceStore)
      .filter((record) => record.typeName === 'shape' && record.type === 'board-reference')
      .map((record) => String(record.id)),
  )
  if (referenceShapeIds.size === 0) {
    return {
      initialSnapshot: snapshot,
      warningCount: imported.report.issues.length,
    }
  }

  const referenceBindings = Object.values(sourceStore)
    .filter((record) => record.typeName === 'binding'
      && (referenceShapeIds.has(String(record.fromId)) || referenceShapeIds.has(String(record.toId))))
  const transactionShapeIds = new Set(referenceShapeIds)
  for (const binding of referenceBindings) {
    const fromId = String(binding.fromId)
    const fromRecord = sourceStore[fromId]
    if (fromRecord?.typeName === 'shape' && (fromRecord.type === 'arrow' || fromRecord.type === 'line')) {
      transactionShapeIds.add(fromId)
    }
  }
  const transactionShapes = Object.values(sourceStore)
    .filter((record) => record.typeName === 'shape' && transactionShapeIds.has(String(record.id)))
    .map((record) => structuredClone(record))
  const transactionBindings = Object.values(sourceStore)
    .filter((record) => record.typeName === 'binding'
      && (transactionShapeIds.has(String(record.fromId)) || transactionShapeIds.has(String(record.toId))))
    .map((record) => structuredClone(record))
  const removedIds = new Set([
    ...transactionShapeIds,
    ...transactionBindings.map((record) => String(record.id)),
  ])
  const initialStore = Object.fromEntries(
    Object.entries(sourceStore)
      .filter(([recordId]) => !removedIds.has(recordId))
      .map(([recordId, record]) => [recordId, structuredClone(record)]),
  )
  const references = transactionShapes
    .filter((record) => record.type === 'board-reference')
    .map((record) => ({
      shapeId: String(record.id),
      referenceId: String(record.props?.referenceId),
      targetBoardId: String(record.props?.targetBoardId),
      kind: record.props?.kind === 'link' ? 'link' as const : 'embed' as const,
    }))

  return {
    initialSnapshot: {
      ...snapshot,
      document: { ...snapshot.document, store: initialStore as typeof snapshot.document.store },
    },
    referencePayload: {
      version: 1,
      sourceProjectId: options.projectId,
      sourceBoardId: options.boardId,
      shapes: transactionShapes,
      bindings: transactionBindings,
      references,
      assets: [],
      copiedAt: options.copiedAt ?? new Date().toISOString(),
    },
    warningCount: imported.report.issues.length,
  }
}

export interface DrawioImportResult {
  boardId: string
  warningCount: number
}

export interface DrawioImportDialogProps {
  open: boolean
  initialFile?: File
  onImport(file: File): Promise<DrawioImportResult>
  onClose(): void
}

export function DrawioImportDialog({
  open,
  initialFile,
  onImport,
  onClose,
}: DrawioImportDialogProps) {
  const [file, setFile] = useState<File | undefined>(initialFile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => setFile(initialFile), [initialFile, open])

  if (!open) return null

  const submit = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await onImport(file)
      toast.success(result.warningCount > 0
        ? `已导入，包含 ${result.warningCount} 个兼容性提示`
        : '已导入为新画板')
      onClose()
    } catch (cause) {
      setError(`导入失败：${chineseErrorMessage(cause, '未知错误。')}`)
      setBusy(false)
    }
  }

  const uploadFiles: UploadFile[] = file ? [{ key: 'drawio-file', name: file.name, size: file.size, status: busy ? 'uploading' : error ? 'error' : 'ready' }] : []

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose() }}
      title="导入 .drawio 画板"
      size="md"
      closeOnOverlayClick={!busy}
      footer={(
        <div className="dialog__actions drawio-import-dialog__actions">
          <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="accent" type="button" loading={busy} disabled={!file || busy} onClick={() => void submit()}>导入为新画板</Button>
        </div>
      )}
    >
      <div className="drawio-import-dialog">
        <div className="import-dialog__intro">
          <span className="import-dialog__icon"><FileArrowUp weight="duotone" aria-hidden="true" /></span>
          <div><strong>创建独立画板</strong><p>文件会转换为新画板，不会覆盖当前画布。</p></div>
        </div>
        <Steps current={file ? 1 : 0} size="sm" items={[{ key: 'select', title: '选择文件' }, { key: 'import', title: '导入画板' }]} />
        <Upload
          aria-label="选择 .drawio 文件"
          accept=".drawio,application/xml,text/xml"
          maxCount={1}
          disabled={busy}
          fileList={uploadFiles}
          onChange={(_list, meta) => {
            setFile(meta.type === 'add' ? meta.file ?? undefined : undefined)
            setError(undefined)
          }}
        >
          <span className="import-dialog__upload-trigger"><FileArrowUp aria-hidden="true" />选择 .drawio 文件</span>
        </Upload>
        {error ? <Alert kind="danger" title="导入失败">{error}</Alert> : null}
      </div>
    </Modal>
  )
}
