export interface IboardExportButtonProps {
  projectId: string
  projectTitle: string
}

function safeDownloadName(title: string): string {
  const safe = title
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safe || 'project'}.iboard`
}

export function IboardExportButton({ projectId, projectTitle }: IboardExportButtonProps) {
  return (
    <GlassSurface as="span" className="iboard-export-surface" radius="999px" interactive>
      <a
        className="iboard-export-button"
        href={`/api/projects/${encodeURIComponent(projectId)}/export.iboard`}
        download={safeDownloadName(projectTitle)}
      >
        <DownloadSimple aria-hidden="true" />
        <span>导出 .iboard</span>
      </a>
    </GlassSurface>
  )
}
import { DownloadSimple } from '@phosphor-icons/react'
import { GlassSurface } from '@ttqtt/liquid-glass-react'
