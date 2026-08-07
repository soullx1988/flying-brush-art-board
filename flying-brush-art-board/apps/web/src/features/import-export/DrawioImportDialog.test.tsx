import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DrawioImportDialog, prepareDrawioBoardImport } from './DrawioImportDialog'

const xml = `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="normal" value="Normal" vertex="1" parent="1">
    <mxGeometry x="10" y="20" width="100" height="60" as="geometry"/>
  </mxCell>
  <mxCell id="reference-card" value="Target" vertex="1" parent="1"
    iboardReferenceId="reference-source" iboardTargetBoardId="board-target"
    iboardReferenceKind="embed" iboardProjectId="project-one">
    <mxGeometry x="150" y="20" width="280" height="140" as="geometry"/>
  </mxCell>
  <mxCell id="connector" edge="1" parent="1" source="normal" target="reference-card">
    <mxGeometry relative="1" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`

describe('DrawioImportDialog', () => {
  it('prepares normal records in the new board snapshot and recoverable references for one Task 11 paste transaction', () => {
    const prepared = prepareDrawioBoardImport(xml, {
      projectId: 'project-one',
      boardId: 'board-imported',
      boards: [{ id: 'board-target', projectId: 'project-one' }],
      copiedAt: '2026-07-23T00:00:00.000Z',
    })
    const initialStore = prepared.initialSnapshot.document.store as Record<string, any>

    expect(Object.values(initialStore)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        typeName: 'shape',
        type: 'geo',
        meta: expect.objectContaining({ interopElement: expect.objectContaining({ id: 'shape:interop-normal' }) }),
      }),
    ]))
    expect(Object.values(initialStore).some((record) => record.type === 'board-reference')).toBe(false)
    expect(Object.values(initialStore).some((record) => record.type === 'arrow')).toBe(false)
    expect(prepared.referencePayload).toMatchObject({
      version: 1,
      sourceProjectId: 'project-one',
      sourceBoardId: 'board-imported',
      references: [{ referenceId: 'reference-source', targetBoardId: 'board-target', kind: 'embed' }],
      shapes: expect.arrayContaining([
        expect.objectContaining({ type: 'board-reference' }),
        expect.objectContaining({ type: 'arrow' }),
      ]),
      bindings: [
        expect.objectContaining({ type: 'arrow' }),
        expect.objectContaining({ type: 'arrow' }),
      ],
      assets: [],
      copiedAt: '2026-07-23T00:00:00.000Z',
    })
    const referenceShape = prepared.referencePayload!.shapes.find(
      (shape: any) => shape.type === 'board-reference',
    ) as any
    expect(referenceShape.meta.interopElement.id).toBe(referenceShape.id)
  })

  it('selects a .drawio file and delegates one confirmed new-board import', async () => {
    const onImport = vi.fn(async () => ({ boardId: 'board-imported', warningCount: 1 }))
    const onClose = vi.fn()
    render(<DrawioImportDialog open onImport={onImport} onClose={onClose} />)

    const file = new File([xml], 'Architecture.drawio', { type: 'application/xml' })
    fireEvent.change(screen.getByTestId('lg-upload-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '导入为新画板' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})
