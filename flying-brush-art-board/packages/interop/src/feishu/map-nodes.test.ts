import { describe, expect, it } from 'vitest'

import { mapFeishuNodes } from './map-nodes.js'

describe('mapFeishuNodes', () => {
  it('maps validated Feishu nodes and reports fidelity categories', () => {
    const result = mapFeishuNodes({ nodes: [
      { id: 'shape', type: 'shape', x: 10, y: 20, width: 100, height: 50, shape: 'rectangle', text: 'Box', style: { fill: '#ff0000' } },
      { id: 'text', type: 'text', x: 1, y: 2, width: 80, height: 20, text: 'Hello' },
      { id: 'sticky', type: 'sticky_note', x: 3, y: 4, width: 120, height: 100, text: 'Note' },
      { id: 'image', type: 'image', x: 5, y: 6, width: 320, height: 180, mediaToken: 'media_one', mimeType: 'image/png' },
      { id: 'connector', type: 'connector', x: 0, y: 0, width: 110, height: 70, start: { elementId: 'shape' }, end: { x: 110, y: 70 } },
      { id: 'section', type: 'section', x: 0, y: 0, width: 500, height: 300, title: 'Area' },
      { id: 'table', type: 'table', x: 20, y: 30, width: 240, height: 120, cells: [['A', 'B'], ['C', 'D']] },
      { id: 'pen', type: 'freehand', x: 0, y: 0, width: 20, height: 20, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 20, y: 20 }] },
      { id: 'svg', type: 'svg', x: 40, y: 50, width: 90, height: 90, svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#123456"/></svg>' },
      {
        id: 'mind', type: 'mind_map', x: 60, y: 70, width: 160, height: 80, text: 'Root',
        layout: 'bilateral', theme: 'colorful',
        style: { fill_color: '#4e6ef2', text_color: '#8f959e', font_size: 18, shape: 'pill' },
        children: [{
          text: 'Child', collapsed: true,
          style: { fill_color: '#d46bfa', text_color: '#1f2329', font_size: 24, edge_color: '#0f9f75', edge_dash: 'dashed', edge_width: 3, shape: 'underline' },
          children: [{ text: 'Grandchild' }],
        }],
      },
      { id: 'future', type: 'kanban', x: 0, y: 0, width: 200, height: 100, payload: { secret: 'preserved' } },
      { id: '', type: 'text', text: 'invalid' },
    ] })

    expect(result.value.elements.map((element) => element.type)).toEqual([
      'shape', 'text', 'sticky', 'image', 'connector', 'section', 'table', 'paint', 'svg', 'mind-map', 'unsupported', 'unsupported',
    ])
    expect(result.value.elements.find((element) => element.id === 'future')).toMatchObject({
      type: 'unsupported', sourceType: 'kanban', sourcePayload: expect.objectContaining({ payload: { secret: 'preserved' } }),
    })
    expect(result.report.unsupportedElementCount).toBe(2)
    expect(result.report.downgradedElementCount).toBe(0)
    expect(result.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEISHU_NODE_UNSUPPORTED', elementId: 'future' }),
      expect.objectContaining({ code: 'FEISHU_NODE_INVALID' }),
    ]))
    expect(result.value.elements.find((element) => element.id === 'mind')).toMatchObject({
      type: 'mind-map',
      text: 'Root',
      layout: 'bilateral',
      theme: 'colorful',
      rootShape: 'pill',
      rootStyle: expect.objectContaining({ fillColor: 'indigo', textColor: 'gray', fontSize: 'l' }),
      children: [{
        id: 'mind:node:0', text: 'Child', collapsed: true, shape: 'underline',
        style: expect.objectContaining({ fillColor: 'purple', textColor: 'black', fontSize: 'xl', edgeColor: 'teal', edgeDash: 'dashed', edgeWidth: 3 }),
        children: [{ id: 'mind:node:0.0', text: 'Grandchild', children: [] }],
      }],
    })
    expect(result.value.elements.find((element) => element.id === 'table')).toMatchObject({
      type: 'table', cells: [['A', 'B'], ['C', 'D']],
    })
    expect(result.value.elements.find((element) => element.id === 'mind')?.sourcePayload).toMatchObject({ type: 'mind_map' })
  })

  it('accepts an array response and uses stable anonymous preview geometry and colors', () => {
    const result = mapFeishuNodes([{ id: 'n1', type: 'shape', x: -12, y: 8, width: 44, height: 55, shape: 'ellipse', style: { fill: '#abcdef' } }])
    expect(result.value.elements[0]).toMatchObject({ geometry: { x: -12, y: 8, width: 44, height: 55 }, style: { fill: '#abcdef' } })
  })

  it('normalizes documented Board API composite, text, image, and connector envelopes', () => {
    const result = mapFeishuNodes({ nodes: [
      {
        id: 'composite', type: 'composite_shape', x: 10, y: 20, width: 100, height: 50, angle: 12, z_index: 3,
        composite_shape: { type: 'rectangle' }, text: { text: 'Box', font_size: 18, text_color: '#111111' },
        style: { fill_color: '#ffeeaa', border_color: '#123456', border_width: '2' },
      },
      { id: 'image', type: 'image', x: 5, y: 6, width: 320, height: 180, image: { token: 'media_one' } },
      {
        id: 'connector', type: 'connector', x: 0, y: 0, width: 110, height: 70,
        connector: { start_object: { id: 'composite', position: { x: 10, y: 20 } }, end_object: { id: 'text', position: { x: 110, y: 70 } } },
      },
      { id: 'text', type: 'text_shape', x: 1, y: 2, width: 80, height: 20, text: { text: 'Hello', font_size: 16, text_color: '#222222' } },
    ] })

    expect(result.value.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'composite', type: 'shape', shape: 'rectangle', text: 'Box', geometry: expect.objectContaining({ rotation: 12 }), style: expect.objectContaining({ fill: '#ffeeaa', stroke: '#123456', strokeWidth: 2, fontSize: 18 }) }),
      expect.objectContaining({ id: 'image', type: 'image', src: 'feishu-media://media_one' }),
      expect.objectContaining({ id: 'connector', type: 'connector', start: expect.objectContaining({ elementId: 'composite' }), end: expect.objectContaining({ elementId: 'text' }) }),
      expect.objectContaining({ id: 'text', type: 'text', text: 'Hello', style: expect.objectContaining({ color: '#222222', fontSize: 16 }) }),
    ]))
    expect(result.report.issues).toHaveLength(1)
    expect(result.report.issues[0]).toMatchObject({ code: 'FEISHU_IMAGE_RASTERIZED', severity: 'warning' })
    expect(result.value.elements.find((element) => element.id === 'composite')?.sourcePayload).toMatchObject({ type: 'composite_shape' })
  })

  it('retains valid nodes when a connector has an incomplete point endpoint', () => {
    const malformedConnector = {
      id: 'broken-connector', type: 'connector', x: 0, y: 0, width: 100, height: 50,
      start: { x: 12 }, end: { x: 100, y: 50 }, metadata: { original: true },
    }

    const result = mapFeishuNodes([
      { id: 'valid-shape', type: 'shape', x: 10, y: 20, width: 80, height: 40, shape: 'rectangle' },
      malformedConnector,
    ])

    expect(result.value.elements[0]).toMatchObject({ id: 'valid-shape', type: 'shape' })
    expect(result.value.elements[1]).toMatchObject({
      id: 'broken-connector',
      type: 'unsupported',
      sourceType: 'connector',
      sourcePayload: malformedConnector,
    })
    expect(result.report.issues).toContainEqual(expect.objectContaining({
      code: 'FEISHU_NODE_INVALID', elementId: 'broken-connector', sourceType: 'connector',
    }))
  })
})
