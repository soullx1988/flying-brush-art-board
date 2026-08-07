import { describe, expect, it } from 'vitest'
import { deflateSync, strToU8 } from 'fflate'

import type { InteropScene } from '../scene/schema.js'

import { exportDrawio } from './export-drawio.js'
import { DrawioImportError, importDrawio } from './import-drawio.js'

const graph = (cells: string) => `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="page-1" name="Page-1">
    <mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      ${cells}
    </root></mxGraphModel>
  </diagram>
</mxfile>`

const compressedDiagram = (model: string) => Buffer.from(deflateSync(strToU8(encodeURIComponent(model)))).toString('base64')

describe('draw.io import and export', () => {
  it('maps vertices, groups, sections, images, text, edges, geometry, styles, and connection points', () => {
    const result = importDrawio(graph(`
      <mxCell id="group" value="Cluster" style="group;" vertex="1" parent="1">
        <mxGeometry x="10" y="20" width="500" height="300" as="geometry"/>
      </mxCell>
      <mxCell id="section" value="Lane A" style="swimlane;horizontal=0;fillColor=#dae8fc;" vertex="1" parent="group">
        <mxGeometry x="30" y="40" width="400" height="220" as="geometry"/>
      </mxCell>
      <mxCell id="shape" value="&lt;b&gt;Hello&lt;/b&gt;" style="rounded=1;whiteSpace=wrap;fillColor=#fff2cc;" vertex="1" parent="section">
        <mxGeometry x="60" y="70" width="120" height="80" as="geometry"/>
      </mxCell>
      <mxCell id="text" value="Caption" style="text;html=1;align=left;" vertex="1" parent="section">
        <mxGeometry x="200" y="70" width="100" height="30" as="geometry"/>
      </mxCell>
      <mxCell id="image" value="Logo" style="shape=image;image=data:image/png;base64,AA==;" vertex="1" parent="section">
        <mxGeometry x="320" y="70" width="64" height="64" as="geometry"/>
      </mxCell>
      <mxCell id="edge" value="go" style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="section" source="shape" target="image">
        <mxGeometry relative="1" as="geometry">
          <Array as="points"><mxPoint x="240" y="110"/></Array>
        </mxGeometry>
      </mxCell>
    `))

    expect(result.report).toMatchObject({
      unsupportedElementCount: 0,
      downgradedElementCount: 0,
      issues: [],
    })
    expect(result.value.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'group', type: 'section', title: 'Cluster' }),
      expect.objectContaining({
        id: 'section', type: 'section', title: 'Lane A', parentElementId: 'group',
        geometry: { x: 30, y: 40, width: 400, height: 220 },
      }),
      expect.objectContaining({
        id: 'shape', type: 'shape', shape: 'rectangle', text: 'Hello', parentElementId: 'section',
        geometry: { x: 60, y: 70, width: 120, height: 80 },
        style: expect.objectContaining({ rounded: '1', fillColor: '#fff2cc' }),
      }),
      expect.objectContaining({ id: 'text', type: 'text', text: 'Caption' }),
      expect.objectContaining({ id: 'image', type: 'image', src: 'data:image/png;base64,AA==', mimeType: 'image/png' }),
      expect.objectContaining({
        id: 'edge', type: 'connector', start: { elementId: 'shape' }, end: { elementId: 'image' },
        style: expect.objectContaining({ exitX: '1', exitY: '0.5', entryX: '0', entryY: '0.5' }),
      }),
    ]))
  })

  it('rejects external entities, XInclude, excessive nodes, and oversized cell strings', () => {
    expect(() => importDrawio('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxGraphModel/>')).toThrow(
      expect.objectContaining({ code: 'DRAWIO_UNSAFE_XML' }) satisfies Partial<DrawioImportError>,
    )
    expect(() => importDrawio('<mxGraphModel xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///etc/passwd"/></mxGraphModel>')).toThrow(
      expect.objectContaining({ code: 'DRAWIO_UNSAFE_XML' }) satisfies Partial<DrawioImportError>,
    )

    const atLimitCells = Array.from(
      { length: 9_994 },
      (_, index) => `<mxCell id="n${index}" vertex="1" parent="1"/>`,
    ).join('')
    expect(importDrawio(graph(atLimitCells)).value.elements).toHaveLength(9_994)

    const tooManyCells = `${atLimitCells}<mxCell id="n9994" vertex="1" parent="1"/>`
    expect(() => importDrawio(graph(tooManyCells))).toThrow(
      expect.objectContaining({ code: 'DRAWIO_LIMIT_EXCEEDED' }) satisfies Partial<DrawioImportError>,
    )

    expect(() => importDrawio(graph(`<mxCell id="huge" value="${'x'.repeat(1_000_001)}" vertex="1"/>`))).toThrow(
      expect.objectContaining({ code: 'DRAWIO_LIMIT_EXCEEDED' }) satisfies Partial<DrawioImportError>,
    )
  })

  it('validates decompressed diagrams and rejects compressed input beyond the inflate budget', () => {
    const compressed = (model: string) => `<mxfile><diagram>${compressedDiagram(model)}</diagram></mxfile>`

    expect(importDrawio(compressed('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>')).value.elements).toEqual([])
    expect(() => importDrawio(compressed('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxGraphModel/>'))).toThrow(
      expect.objectContaining({ code: 'DRAWIO_UNSAFE_XML' }) satisfies Partial<DrawioImportError>,
    )
    expect(() => importDrawio(compressed('<mxGraphModel xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///etc/passwd"/></mxGraphModel>'))).toThrow(
      expect.objectContaining({ code: 'DRAWIO_UNSAFE_XML' }) satisfies Partial<DrawioImportError>,
    )
    expect(() => importDrawio(compressed(`<mxGraphModel>${'x'.repeat(8 * 1024 * 1024 + 1)}</mxGraphModel>`))).toThrow(
      expect.objectContaining({ code: 'DRAWIO_LIMIT_EXCEEDED' }) satisfies Partial<DrawioImportError>,
    )
    expect(() => importDrawio(compressed(`<mxGraphModel>${'<x/>'.repeat(10_001)}</mxGraphModel>`))).toThrow(
      expect.objectContaining({ code: 'DRAWIO_LIMIT_EXCEEDED' }) satisfies Partial<DrawioImportError>,
    )
    expect(() => importDrawio(`<mxfile><diagram>${'A'.repeat(3 * 1024 * 1024)}</diagram></mxfile>`)).toThrow(
      expect.objectContaining({ code: 'DRAWIO_LIMIT_EXCEEDED' }) satisfies Partial<DrawioImportError>,
    )
  })

  it('reads standalone and one-sided mxPoint endpoints and preserves them through export', () => {
    const first = importDrawio(graph(`
      <mxCell id="standalone" edge="1" parent="1"><mxGeometry relative="1"><mxPoint x="10" y="20" as="sourcePoint"/><mxPoint x="110" y="120" as="targetPoint"/></mxGeometry></mxCell>
      <mxCell id="one-sided" edge="1" parent="1"><mxGeometry relative="1"><mxPoint x="220" y="230" as="sourcePoint"/></mxGeometry></mxCell>
      <mxCell id="target-only" edge="1" parent="1"><mxGeometry relative="1"><mxPoint x="320" y="330" as="targetPoint"/></mxGeometry></mxCell>
    `))

    expect(first.value.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'standalone', type: 'connector', start: { x: 10, y: 20 }, end: { x: 110, y: 120 },
        geometry: { x: 10, y: 20, width: 100, height: 100 },
      }),
      expect.objectContaining({ id: 'one-sided', type: 'connector', start: { x: 220, y: 230 } }),
      expect.objectContaining({ id: 'target-only', type: 'connector', end: { x: 320, y: 330 } }),
    ]))

    const second = importDrawio(exportDrawio(first.value))
    expect(second.value.elements.find((element) => element.id === 'standalone')).toMatchObject({
      start: { x: 10, y: 20 }, end: { x: 110, y: 120 },
      geometry: { x: 10, y: 20, width: 100, height: 100 },
    })
    expect(second.value.elements.find((element) => element.id === 'one-sided')).toMatchObject({
      start: { x: 220, y: 230 }, end: { x: 0, y: 0 },
    })
    expect(second.value.elements.find((element) => element.id === 'target-only')).toMatchObject({
      start: { x: 0, y: 0 }, end: { x: 320, y: 330 },
    })
  })

  it('exports embed and link references with an internal URL and all custom attributes, then restores them in the same project', () => {
    const scene: InteropScene = {
      formatVersion: 1,
      elements: [
        {
          id: 'embed-card', type: 'board-reference', referenceId: 'reference-embed',
          targetBoardId: 'board-b', kind: 'embed', titleFallback: 'Board B',
          geometry: { x: 20, y: 30, width: 280, height: 140 }, zIndex: 'a1',
          style: { rounded: '1', fillColor: '#dae8fc' },
        },
        {
          id: 'link-card', type: 'board-reference', referenceId: 'reference-link',
          targetBoardId: 'board-c', kind: 'link', titleFallback: 'Board C',
          geometry: { x: 340, y: 30, width: 280, height: 140 }, zIndex: 'a2', style: {},
        },
      ],
    }

    const xml = exportDrawio(scene, { projectId: 'project-one' })

    expect(xml).toContain('iboardReferenceId="reference-embed"')
    expect(xml).toContain('iboardTargetBoardId="board-b"')
    expect(xml).toContain('iboardReferenceKind="embed"')
    expect(xml).toContain('iboardProjectId="project-one"')
    expect(xml).toContain('link="/projects/project-one/boards/board-b"')
    expect(xml).toContain('iboardReferenceKind="link"')

    const imported = importDrawio(xml, {
      projectId: 'project-one',
      boards: [
        { id: 'board-b', projectId: 'project-one' },
        { id: 'board-c', projectId: 'project-one' },
      ],
    })
    expect(imported.value.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'embed-card', type: 'board-reference', referenceId: 'reference-embed',
        targetBoardId: 'board-b', kind: 'embed', titleFallback: 'Board B',
      }),
      expect.objectContaining({
        id: 'link-card', type: 'board-reference', referenceId: 'reference-link',
        targetBoardId: 'board-c', kind: 'link', titleFallback: 'Board C',
      }),
    ]))
    expect(imported.report.downgradedElementCount).toBe(0)
  })

  it('keeps reference cards visual and reports downgrade for incomplete, cross-project, or missing targets', () => {
    const result = importDrawio(graph(`
      <mxCell id="cross-project" value="Other" vertex="1" parent="1" link="/projects/other/boards/board-b"
        iboardReferenceId="reference-cross" iboardTargetBoardId="board-b" iboardReferenceKind="embed" iboardProjectId="other">
        <mxGeometry x="0" y="0" width="280" height="140" as="geometry"/>
      </mxCell>
      <mxCell id="missing-target" value="Missing" vertex="1" parent="1" link="/projects/project-one/boards/missing"
        iboardReferenceId="reference-missing" iboardTargetBoardId="missing" iboardReferenceKind="link" iboardProjectId="project-one">
        <mxGeometry x="300" y="0" width="280" height="140" as="geometry"/>
      </mxCell>
      <mxCell id="incomplete" value="Incomplete" vertex="1" parent="1" link="/projects/project-one/boards/board-b"
        iboardTargetBoardId="board-b" iboardReferenceKind="embed" iboardProjectId="project-one">
        <mxGeometry x="600" y="0" width="280" height="140" as="geometry"/>
      </mxCell>
    `), {
      projectId: 'project-one',
      boards: [{ id: 'board-b', projectId: 'project-one' }],
    })

    expect(result.value.elements).toHaveLength(3)
    expect(result.value.elements.every((element) => element.type === 'shape')).toBe(true)
    expect(JSON.stringify(result.value.elements)).not.toMatch(/referenceId|targetBoardId|"kind"/)
    expect(result.report).toMatchObject({
      downgradedElementCount: 3,
      issues: [
        expect.objectContaining({ code: 'BOARD_REFERENCE_DOWNGRADED', elementId: 'cross-project' }),
        expect.objectContaining({ code: 'BOARD_REFERENCE_DOWNGRADED', elementId: 'missing-target' }),
        expect.objectContaining({ code: 'BOARD_REFERENCE_DOWNGRADED', elementId: 'incomplete' }),
      ],
    })
  })

  it('preserves unknown stencils as unsupported payloads and keeps visual geometry through export/import', () => {
    const first = importDrawio(graph(`
      <mxCell id="vendor" value="Router" style="shape=mxgraph.vendor.router;fillColor=#f5f5f5;" vertex="1" parent="1">
        <mxGeometry x="15" y="25" width="90" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="diamond" value="Decision" style="rhombus;fillColor=#fff2cc;" vertex="1" parent="1">
        <mxGeometry x="150" y="25" width="100" height="80" as="geometry"/>
      </mxCell>
    `))

    expect(first.value.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vendor', type: 'unsupported', sourceType: 'mxgraph.vendor.router' }),
      expect.objectContaining({
        id: 'diamond', type: 'shape', shape: 'diamond',
        geometry: { x: 150, y: 25, width: 100, height: 80 },
      }),
    ]))
    expect(first.report).toMatchObject({
      unsupportedElementCount: 1,
      issues: [expect.objectContaining({ code: 'UNSUPPORTED_ELEMENT', elementId: 'vendor' })],
    })

    const second = importDrawio(exportDrawio(first.value))
    expect(second.value.elements.find((element) => element.id === 'diamond')).toMatchObject({
      type: 'shape', shape: 'diamond', text: 'Decision',
      geometry: { x: 150, y: 25, width: 100, height: 80 },
      style: expect.objectContaining({ fillColor: '#fff2cc' }),
    })
  })
})
