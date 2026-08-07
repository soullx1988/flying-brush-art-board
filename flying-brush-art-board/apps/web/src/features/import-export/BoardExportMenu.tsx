import { useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { Button, Popover, toast } from '@ttqtt/liquid-glass-react'

export interface BoardExportMenuProps {
  onExportDrawio?(): void
  onExportPng(selectionOnly: boolean): void
  onExportSvg(selectionOnly: boolean): void
  onExportPdf?(): void
  busy?: boolean
}

export function BoardExportMenu({
  onExportDrawio,
  onExportPng,
  onExportSvg,
  onExportPdf,
  busy = false,
}: BoardExportMenuProps) {
  const [open, setOpen] = useState(false)

  const runExport = (callback: () => void) => {
    try {
      callback()
      setOpen(false)
    } catch {
      toast.error('导出失败，请稍后重试。')
    }
  }

  return (
    <div className="export-menu">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        showArrow={false}
        content={(
        <div className="export-menu__list" role="menu" aria-label="导出格式">
          {onExportDrawio ? (
            <Button variant="ghost" size="sm" type="button" role="menuitem" disabled={busy} icon={<DownloadSimple aria-hidden="true" />} onClick={() => runExport(onExportDrawio)}>
              导出 .drawio
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" type="button" role="menuitem" disabled={busy} onClick={() => runExport(() => onExportPng(false))}>
            导出 PNG
          </Button>
          <Button variant="ghost" size="sm" type="button" role="menuitem" disabled={busy} onClick={() => runExport(() => onExportPng(true))}>
            导出选中内容为 PNG
          </Button>
          <Button variant="ghost" size="sm" type="button" role="menuitem" disabled={busy} onClick={() => runExport(() => onExportSvg(false))}>
            导出 SVG
          </Button>
          <Button variant="ghost" size="sm" type="button" role="menuitem" disabled={busy} onClick={() => runExport(() => onExportSvg(true))}>
            导出选中内容为 SVG
          </Button>
          {onExportPdf ? (
            <Button variant="ghost" size="sm" type="button" role="menuitem" disabled={busy} onClick={() => runExport(onExportPdf)}>
              导出 PDF
            </Button>
          ) : null}
        </div>
        )}
      >
        <Button
          variant="glass"
          size="sm"
          icon={<DownloadSimple aria-hidden="true" />}
          type="button"
          className="export-menu__trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          loading={busy}
          disabled={busy}
        >
          导出
        </Button>
      </Popover>
    </div>
  )
}
