import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InteropScene } from '@infinite-board/interop/scene/schema'

import { DrawioExportButton } from './DrawioExportButton'

afterEach(() => vi.restoreAllMocks())

describe('DrawioExportButton', () => {
  it('exports the current board scene with project reference metadata', async () => {
    const scene: InteropScene = {
      formatVersion: 1,
      elements: [{
        id: 'reference-card', type: 'board-reference', referenceId: 'reference-one',
        targetBoardId: 'board-target', kind: 'link', titleFallback: 'Target',
        geometry: { x: 0, y: 0, width: 280, height: 140 }, zIndex: 'a1', style: {},
      }],
    }
    let downloadedBlob: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error('Expected a Blob download')
      downloadedBlob = blob
      return 'blob:drawio'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(
      <DrawioExportButton
        projectId="project-one"
        boardTitle="Architecture / 2026"
        getScene={() => scene}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '导出 .drawio' }))

    expect(click).toHaveBeenCalledOnce()
    expect(downloadedBlob).toBeInstanceOf(Blob)
    const xml = await downloadedBlob!.text()
    expect(xml).toContain('iboardProjectId="project-one"')
    expect(xml).toContain('iboardReferenceKind="link"')
    expect(xml).toContain('/projects/project-one/boards/board-target')
    expect(document.querySelector<HTMLAnchorElement>('a[download="Architecture - 2026.drawio"]')).toBeNull()
  })
})
