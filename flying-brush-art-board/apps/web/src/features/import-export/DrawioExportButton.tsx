import { exportDrawio } from '@infinite-board/interop/drawio/export-drawio'
import type { InteropScene } from '@infinite-board/interop/scene/schema'
import { DownloadSimple } from '@phosphor-icons/react'
import { Button } from '@ttqtt/liquid-glass-react'

export interface DrawioExportButtonProps {
  projectId: string
  boardTitle: string
  getScene(): InteropScene
}

function safeDownloadName(title: string): string {
  const safe = title
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safe || 'board'}.drawio`
}

export function exportDrawioBoard({
  projectId,
  boardTitle,
  getScene,
}: DrawioExportButtonProps): void {
  const xml = exportDrawio(getScene(), { projectId })
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeDownloadName(boardTitle)
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function DrawioExportButton({
  projectId,
  boardTitle,
  getScene,
}: DrawioExportButtonProps) {
  return <Button variant="glass" icon={<DownloadSimple aria-hidden="true" />} type="button" onClick={() => exportDrawioBoard({ projectId, boardTitle, getScene })}>导出 .drawio</Button>
}
