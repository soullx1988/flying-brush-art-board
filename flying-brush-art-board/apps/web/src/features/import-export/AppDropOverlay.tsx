import { useEffect, useState, type DragEvent } from 'react'

import type { FileDropTarget } from './DropImportController'

export type AppDropTarget = FileDropTarget

export interface AppDropOverlayProps {
  onDispatch(files: readonly File[], target: AppDropTarget): void
}

export function AppDropOverlay({ onDispatch }: AppDropOverlayProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const show = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setVisible(true)
    }
    const hide = () => setVisible(false)
    const dropGlobal = (event: globalThis.DragEvent) => {
      if (event.defaultPrevented) return
      const files = event.dataTransfer ? [...event.dataTransfer.files] : []
      setVisible(false)
      if (files.length === 0) return
      event.preventDefault()
      onDispatch(files, { kind: 'global' })
    }
    window.addEventListener('dragenter', show)
    window.addEventListener('dragover', show)
    window.addEventListener('dragleave', hide)
    window.addEventListener('drop', dropGlobal)
    return () => {
      window.removeEventListener('dragenter', show)
      window.removeEventListener('dragover', show)
      window.removeEventListener('dragleave', hide)
      window.removeEventListener('drop', dropGlobal)
    }
  }, [onDispatch])

  if (!visible) return null

  const drop = (event: DragEvent, target: 'tab-strip' | 'canvas') => {
    event.preventDefault()
    event.stopPropagation()
    const files = [...event.dataTransfer.files]
    setVisible(false)
    if (files.length > 0) {
      onDispatch(files, target === 'canvas'
        ? { kind: 'canvas', dropPoint: { x: event.clientX, y: event.clientY } }
        : { kind: 'tab-strip' })
    }
  }

  return (
    <div className="app-drop-overlay" role="region" aria-label="文件投放区域">
      <button data-drop-target="tab-strip" type="button" onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, 'tab-strip')}>
        拖到标签栏：新建临时导入标签
      </button>
      <button data-drop-target="canvas" type="button" onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, 'canvas')}>
        拖到当前画布
      </button>
    </div>
  )
}
