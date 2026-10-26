import { describe, expect, it } from 'vitest'

import {
  collectClipboardPayload,
  materializeClipboardPayload,
  type ClipboardEditor,
} from './clipboard.js'
import { createHash } from 'node:crypto'

const shape = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  typeName: 'shape',
  type: 'geo',
  parentId: 'page:page',
  index: 'a1',
  x: 0,
  y: 0,
  rotation: 0,
  isLocked: false,
  opacity: 1,
  props: { w: 100, h: 100, geo: 'rectangle', color: 'black', fill: 'none', dash: 'draw', size: 'm', font: 'draw', align: 'middle', verticalAlign: 'middle', labelColor: 'black', richText: { type: 'doc', content: [] } },
  ...overrides,
})

describe('board clipboard adapter', () => {
  it('collects every selected shape type without an allowlist', () => {
    const shapeTypes = [
      'text',
      'note',
      'geo',
      'draw',
      'line',
      'highlight',
      'arrow',
      'frame',
      'group',
      'table',
      'mind-map',
      'board-reference',
    ]
    const records = shapeTypes.map((type, index) => shape(`shape:${type}`, {
      type,
      index: `a${index + 1}`,
    }))
    const selectedIds = records.map((record) => record.id)
    const editor: ClipboardEditor = {
      getShapeAndDescendantIds: (shapeId) => new Set([shapeId]),
      store: { allRecords: () => records },
    }

    const payload = collectClipboardPayload(editor, selectedIds, {
      sourceProjectId: 'project:source',
      sourceBoardId: 'board:source',
    })

    expect(payload.shapes.map((record) => (record as { type: string }).type)).toEqual(shapeTypes)
  })

  it('keeps bindings fully inside the copied closure and reports external bindings as broken', () => {
    const records = [
      shape('shape:one'),
      shape('shape:two'),
      { id: 'binding:inside', typeName: 'binding', type: 'arrow', fromId: 'shape:one', toId: 'shape:two', props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
      { id: 'binding:outside', typeName: 'binding', type: 'arrow', fromId: 'shape:one', toId: 'shape:outside', props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
    ]
    const editor: ClipboardEditor = {
      getShapeAndDescendantIds: () => new Set(['shape:one', 'shape:two']),
      store: { allRecords: () => records },
    }

    const payload = collectClipboardPayload(editor, ['shape:one'], {
      sourceProjectId: 'project:source',
      sourceBoardId: 'board:source',
      copiedAt: '2026-07-23T00:00:00.000Z',
    })

    expect(payload.bindings).toHaveLength(1)
    expect(payload.brokenBindingIds).toEqual(['binding:outside'])
  })

  it('uses tldraw isolated content so selected children are lifted to page coordinates', () => {
    const editor: ClipboardEditor = {
      getShapeAndDescendantIds: () => new Set(['shape:child']),
      getContentFromCurrentPage: () => ({
        shapes: [shape('shape:child', { parentId: 'page:page', x: 120, y: 160, rotation: Math.PI / 2 })],
        bindings: [],
        assets: [],
      }),
      store: { allRecords: () => [shape('shape:child', { parentId: 'group:source', x: 10, y: 20 })] },
    }

    const payload = collectClipboardPayload(editor, ['shape:child'], {
      sourceProjectId: 'project:source',
      sourceBoardId: 'board:source',
    })

    expect(payload.shapes).toEqual([
      expect.objectContaining({ id: 'shape:child', parentId: 'page:page', x: 120, y: 160, rotation: Math.PI / 2 }),
    ])
  })

  it('materializes a Task 6 clipboard patch with remapped records and reference candidates', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const payload = collectClipboardPayload(
      {
        getShapeAndDescendantIds: () => new Set(['shape:one', 'shape:two']),
        store: {
          allRecords: () => [
            shape('shape:one', { props: { assetId: 'asset:image' } }),
            shape('shape:two'),
            { id: 'binding:inside', typeName: 'binding', type: 'arrow', fromId: 'shape:one', toId: 'shape:two', props: {} },
            { id: 'asset:image', typeName: 'asset', type: 'image', props: { src: 'asset://image' }, meta: {} },
          ],
        },
      },
      ['shape:one'],
      {
        sourceProjectId: 'project:source',
        sourceBoardId: 'board:source',
        copiedAt: '2026-07-23T00:00:00.000Z',
        assets: [{ assetRecordId: 'asset:image', sha256, mime: 'image/png', size: bytes.byteLength }],
        references: [{ shapeId: 'shape:one', referenceId: 'reference:source', targetBoardId: 'board:linked', kind: 'link' }],
      },
    )

    const patch = materializeClipboardPayload(payload, {
      createId: (() => {
        let index = 0
        return () => `new:${++index}`
      })(),
      targetSnapshot: { store: { 'page:page': { id: 'page:page', typeName: 'page' } } },
      assetBlobs: [{ sha256, mime: 'image/png', size: bytes.byteLength, bytes }],
    })
    const binding = (patch.nextSnapshot as { store: Record<string, unknown> }).store[patch.idMap['binding:inside']!] as { fromId: string; toId: string }

    expect(patch.idMap['shape:one']).not.toBe('shape:one')
    expect(binding).toMatchObject({
      fromId: patch.idMap['shape:one'],
      toId: patch.idMap['shape:two'],
    })
    expect(patch.assetUsages).toEqual([{ shapeId: patch.idMap['shape:one'], assetRecordId: patch.idMap['asset:image'], sha256 }])
    expect(patch.referenceCandidates).toEqual([{ shapeId: patch.idMap['shape:one'], referenceId: 'reference:source', targetBoardId: 'board:linked', kind: 'link' }])
    expect(Object.keys(patch).sort()).toEqual([
      'assetBlobs',
      'assetUsages',
      'idMap',
      'nextSnapshot',
      'referenceCandidates',
    ])
    expect(patch.assetBlobs[0]).toMatchObject({ sha256, mime: 'image/png', size: bytes.byteLength })
    expect(patch.assetBlobs[0]?.bytes).toBeInstanceOf(Uint8Array)
  })

  it('materializes serialized clipboard assets with their declared tldraw record', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const payload = JSON.parse(JSON.stringify({
      version: 1,
      sourceProjectId: 'project:source',
      sourceBoardId: 'board:source',
      shapes: [shape('shape:image', { props: { assetId: 'asset:image' } })],
      bindings: [],
      references: [],
      assets: [{
        assetRecordId: 'asset:image',
        sha256,
        mime: 'image/png',
        size: bytes.byteLength,
        record: { id: 'asset:image', typeName: 'asset', type: 'image', props: { src: 'asset://image' }, meta: {} },
      }],
      copiedAt: '2026-07-23T00:00:00.000Z',
    }))

    const patch = materializeClipboardPayload(payload, {
      createId: (() => {
        let index = 0
        return () => `new:${++index}`
      })(),
      targetSnapshot: { store: {} },
      assetBlobs: [{ sha256, mime: 'image/png', size: bytes.byteLength, bytes }],
    })

    expect((patch.nextSnapshot as { store: Record<string, unknown> }).store[patch.idMap['asset:image']!]).toMatchObject({
      id: patch.idMap['asset:image'],
      typeName: 'asset',
    })
    expect(patch.assetUsages).toEqual([{ shapeId: patch.idMap['shape:image'], assetRecordId: patch.idMap['asset:image'], sha256 }])
  })

  it('rejects a serialized payload whose declared asset record is missing or invalid', () => {
    const basePayload = {
      version: 1,
      sourceProjectId: 'project:source',
      sourceBoardId: 'board:source',
      shapes: [shape('shape:image', { props: { assetId: 'asset:image' } })],
      bindings: [],
      references: [],
      assets: [{ assetRecordId: 'asset:image', sha256: 'a'.repeat(64), mime: 'image/png', size: 1 }],
      copiedAt: '2026-07-23T00:00:00.000Z',
    }
    const targetContext = {
      createId: () => 'new:id',
      targetSnapshot: { store: {} },
      assetBlobs: [{ sha256: 'a'.repeat(64), mime: 'image/png', size: 1, bytes: new Uint8Array([1]) }],
    }

    expect(() => materializeClipboardPayload(basePayload as never, targetContext)).toThrow(
      'Clipboard asset is missing a declared tldraw asset record',
    )
    expect(() => materializeClipboardPayload({
      ...basePayload,
      assets: [{ ...basePayload.assets[0], record: { id: 'asset:other', typeName: 'asset' } }],
    } as never, targetContext)).toThrow('Clipboard asset record id does not match asset metadata')
  })
})
