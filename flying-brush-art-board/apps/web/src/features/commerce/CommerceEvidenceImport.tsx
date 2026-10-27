import { useState } from 'react'
import { Alert, Button, Modal, Upload, type UploadFile } from '@ttqtt/liquid-glass-react'
import { commerceEvidenceBundleSchema, type CommerceEvidenceBundle } from './commerce-evidence'

export function CommerceEvidenceImport({ disabled, onImport }: { disabled: boolean; onImport(bundle: CommerceEvidenceBundle): Promise<void> }) {
  const [open, setOpen] = useState(false), [file, setFile] = useState<File>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  const files: UploadFile[] = file ? [{ key: 'evidence', name: file.name, status: busy ? 'uploading' : error ? 'error' : 'ready' }] : []
  const submit = async () => {
    if (!file || busy) return
    setBusy(true); setError(undefined)
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('资料包超过 30 MB，请分批整理。')
      const parsed = commerceEvidenceBundleSchema.safeParse(JSON.parse(await file.text()))
      if (!parsed.success) throw new Error('资料包格式或汇总校验失败，请核查生成结果。')
      await onImport(parsed.data)
      setOpen(false); setFile(undefined)
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败') }
    finally { setBusy(false) }
  }
  return <><Button variant="glass" size="sm" disabled={disabled} onClick={() => setOpen(true)}>更新配图与历史</Button>
    <Modal open={open} onOpenChange={v => { if (!busy) setOpen(v) }} title="更新配图与历史资料" size="md" closeOnOverlayClick={!busy} footer={<><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button variant="accent" loading={busy} disabled={!file || busy} onClick={() => void submit()}>更新当前画板</Button></>}>
      <p>选择经过核对的资料包。可更新商品配置、配图和历史；商品编号、设计关联与已有历史会校验保留。配置日期与实得流水分别显示，不把源表当作线上发布证明。</p>
      <Upload aria-label="选择配图与历史资料包" accept=".json,application/json" maxCount={1} disabled={busy} fileList={files} onChange={(_list, meta) => { setFile(meta.type === 'add' ? meta.file ?? undefined : undefined); setError(undefined) }}>选择资料包</Upload>
      {error ? <Alert kind="danger" title="未更新">{error}</Alert> : null}
    </Modal></>
}
