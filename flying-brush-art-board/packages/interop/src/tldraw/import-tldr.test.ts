import { describe, expect, it } from 'vitest'

import {
  createBoardStore,
} from '../../../tldraw-adapter/src/store.js'
import {
  getStoreSnapshot,
} from '../../../tldraw-adapter/src/snapshot.js'

import { importTldr, MAX_TLDR_SHAPES, TldrImportError } from './import-tldr.js'

function fixtureBytes() {
  const store = createBoardStore()
  const base = Object.values(getStoreSnapshot(store).store)
  return new TextEncoder().encode(JSON.stringify({
    tldrawFileFormatVersion: 1,
    schema: store.schema.serialize(),
    records: [
      ...base,
      {
        id: 'shape:reference', typeName: 'shape', type: 'board-reference', parentId: 'page:page',
        index: 'a1', x: 10, y: 20, rotation: 0, isLocked: false, opacity: 1, meta: {},
        props: {
          w: 280, h: 140, referenceId: 'reference:source', targetBoardId: 'board:target',
          kind: 'embed', titleFallback: 'Target',
        },
      },
    ],
  }))
}

function fixtureWithOwnedPointers() {
  const store = createBoardStore()
  return new TextEncoder().encode(JSON.stringify({
    tldrawFileFormatVersion: 1,
    schema: store.schema.serialize(),
    records: [
      ...Object.values(getStoreSnapshot(store).store),
      {
        id: 'shape:target', typeName: 'shape', type: 'geo', parentId: 'page:page', index: 'a1',
        x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
        props: {
          w: 100, h: 100, geo: 'rectangle', dash: 'draw', growY: 0, url: '', scale: 1,
          color: 'black', labelColor: 'black', fill: 'none', size: 'm', font: 'draw',
          align: 'middle', verticalAlign: 'middle', richText: { type: 'doc', content: [] },
        },
      },
      {
        id: 'shape:arrow', typeName: 'shape', type: 'arrow', parentId: 'page:page', index: 'a2',
        x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
        props: {
          kind: 'arc', elbowMidPoint: 0.5, dash: 'draw', size: 'm', fill: 'none', color: 'black',
          labelColor: 'black', bend: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 100 },
          arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: { type: 'doc', content: [] },
          labelPosition: 0.5, font: 'draw', scale: 1,
        },
      },
      {
        id: 'binding:arrow-target', typeName: 'binding', type: 'arrow',
        fromId: 'shape:arrow', toId: 'shape:target',
        props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' },
        meta: {},
      },
      {
        id: 'asset:image', typeName: 'asset', type: 'image',
        props: { w: 10, h: 10, name: 'image.png', isAnimated: false, mimeType: 'image/png', src: 'data:image/png;base64,AA==' },
        meta: {},
      },
      {
        id: 'shape:image', typeName: 'shape', type: 'image', parentId: 'page:page', index: 'a3',
        x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
        props: { w: 10, h: 10, assetId: 'asset:image', playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' },
      },
      {
        id: 'shape:vendor', typeName: 'shape', type: 'vendor-widget', parentId: 'page:page', index: 'a4',
        x: 0, y: 0, props: { w: 50, h: 50, vendorId: 'opaque' }, meta: {},
      },
    ],
  }))
}

describe('importTldr', () => {
  it('accepts 10,000 shapes and rejects shape 10,001 before migration', () => {
    const store = createBoardStore()
    const base = Object.values(getStoreSnapshot(store).store)
    const shape = {
      typeName: 'shape', type: 'geo', parentId: 'page:page', index: 'a1',
      x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, meta: {},
      props: {
        w: 1, h: 1, geo: 'rectangle', dash: 'draw', growY: 0, url: '', scale: 1,
        color: 'black', labelColor: 'black', fill: 'none', size: 'm', font: 'draw',
        align: 'middle', verticalAlign: 'middle', richText: { type: 'doc', content: [] },
      },
    }
    const shapes = Array.from({ length: MAX_TLDR_SHAPES }, (_, index) => ({
      ...shape,
      id: `shape:limit-${index}`,
    }))
    const file = (records: unknown[]) => new TextEncoder().encode(JSON.stringify({
      tldrawFileFormatVersion: 1,
      schema: store.schema.serialize(),
      records,
    }))

    const accepted = importTldr(file([...base, ...shapes]))
    expect(Object.values(accepted.value.document.store)
      .filter((record) => (record as { typeName?: string }).typeName === 'shape')).toHaveLength(10_000)

    expect(() => importTldr(file([...base, ...shapes, { ...shape, id: 'shape:limit-10000' }]))).toThrow(
      expect.objectContaining({ code: 'TLDR_LIMIT_EXCEEDED' }) satisfies Partial<TldrImportError>,
    )
  })

  it('performs a pure, deterministic migration and remaps imported records', () => {
    const bytes = fixtureBytes()

    const first = importTldr(bytes)
    const second = importTldr(bytes)
    const records = Object.values(first.value.document.store) as unknown as Array<Record<string, unknown>>
    const visualCard = records.find((record) => record.typeName === 'shape')

    expect(second).toEqual(first)
    expect(visualCard).toMatchObject({ type: 'geo' })
    expect(visualCard?.id).not.toBe('shape:reference')
    expect(visualCard?.parentId).not.toBe('page:page')
    expect(JSON.stringify(visualCard)).not.toMatch(/referenceId|targetBoardId|"kind"/)
    expect(first.report).toMatchObject({
      downgradedElementCount: 1,
      issues: [expect.objectContaining({ code: 'BOARD_REFERENCE_DOWNGRADED' })],
    })
  })

  it('rejects unsupported file versions with a stable schema error code', () => {
    const invalid = new TextEncoder().encode(JSON.stringify({
      tldrawFileFormatVersion: 99,
      schema: {},
      records: [],
    }))

    expect(() => importTldr(invalid)).toThrow(
      expect.objectContaining({ code: 'TLDR_SCHEMA_UNSUPPORTED' }) satisfies Partial<TldrImportError>,
    )
  })

  it('remaps bindings and asset pointers while preserving unsupported source payloads', () => {
    const result = importTldr(fixtureWithOwnedPointers())
    const records = Object.values(result.value.document.store) as unknown as Array<Record<string, any>>
    const binding = records.find((record) => record.typeName === 'binding')!
    const image = records.find((record) => record.typeName === 'shape' && record.type === 'image')!
    const asset = records.find((record) => record.typeName === 'asset')!
    const vendorCard = records.find((record) => record.meta?.sourcePayload?.type === 'vendor-widget')!

    expect(binding.id).not.toBe('binding:arrow-target')
    expect(binding.fromId).not.toBe('shape:arrow')
    expect(binding.toId).not.toBe('shape:target')
    expect(image.props.assetId).toBe(asset.id)
    expect(asset.id).not.toBe('asset:image')
    expect(vendorCard.meta.sourcePayload).toMatchObject({
      id: 'shape:vendor', type: 'vendor-widget', props: { vendorId: 'opaque' },
    })
    expect(result.report).toMatchObject({
      unsupportedElementCount: 1,
      issues: [expect.objectContaining({ code: 'UNSUPPORTED_ELEMENT', elementId: 'shape:vendor' })],
    })
  })
})
