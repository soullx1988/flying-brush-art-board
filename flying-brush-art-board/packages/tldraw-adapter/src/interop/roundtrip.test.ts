import { describe, expect, it } from 'vitest'

import {
  interopSceneSchema,
  type InteropScene,
} from '@infinite-board/interop'

import { interopSceneToSnapshot } from './to-snapshot.js'
import { snapshotToInteropScene } from './from-snapshot.js'
import { loadSnapshotIntoStore } from '../snapshot.js'
import { createBoardStore } from '../store.js'

const geometry = { x: 10, y: 20, width: 240, height: 120, rotation: 0 }

describe('InteropScene tldraw adapter', () => {
  it('round-trips supported visual elements and keeps container ownership separate from board targets', () => {
    const scene: InteropScene = {
      formatVersion: 1,
      elements: [
        { id: 'shape', type: 'shape', shape: 'rectangle', text: 'Shape', geometry, zIndex: 'a1', style: {} },
        { id: 'text', type: 'text', text: 'Text', geometry, zIndex: 'a2', style: {} },
        { id: 'sticky', type: 'sticky', text: 'Sticky', geometry, zIndex: 'a3', style: {} },
        {
          id: 'connector', type: 'connector', geometry, zIndex: 'a4', style: {},
          start: { elementId: 'shape' }, end: { x: 400, y: 300 },
        },
        { id: 'section', type: 'section', title: 'Section', geometry, zIndex: 'a5', style: {} },
        { id: 'table', type: 'table', cells: [['A', 'B']], geometry, zIndex: 'a6', style: {} },
        { id: 'paint', type: 'paint', points: [{ x: 0, y: 0 }, { x: 20, y: 30 }], geometry, zIndex: 'a7', style: {} },
        { id: 'image', type: 'image', src: 'data:image/png;base64,AA==', mimeType: 'image/png', geometry, zIndex: 'a8', style: {} },
        { id: 'svg', type: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', geometry, zIndex: 'a9', style: {} },
        {
          id: 'mind-map', type: 'mind-map', text: 'Root', geometry, zIndex: 'a10', style: {},
          layout: 'bilateral', theme: 'colorful', rootShape: 'pill',
          rootStyle: { fillColor: 'indigo', textColor: 'gray', fontSize: 'l' },
          children: [{
            id: 'branch', text: 'Branch', side: 'left', collapsed: true, shape: 'underline',
            style: { fillColor: 'purple', textColor: 'black', fontFamily: 'serif', edgeColor: 'teal', edgeDash: 'dashed', edgeWidth: 3 },
            children: [],
          }],
        },
        {
          id: 'reference', type: 'board-reference', referenceId: 'reference:one',
          targetBoardId: 'board:target', kind: 'embed', titleFallback: 'Target',
          parentElementId: 'section', geometry, zIndex: 'a11', style: {},
        },
      ],
    }

    expect(interopSceneSchema.parse(scene)).toEqual(scene)
    const snapshot = interopSceneToSnapshot(scene, { referencePolicy: 'preserve' })
    expect(Object.values(snapshot.document.store)).toEqual(expect.arrayContaining([
      expect.objectContaining({ typeName: 'shape', type: 'table' }),
      expect.objectContaining({ typeName: 'shape', type: 'mind-map' }),
    ]))
    expect(() => loadSnapshotIntoStore(createBoardStore(), snapshot)).not.toThrow()
    const restored = snapshotToInteropScene(snapshot)

    expect(restored.elements.map((element) => element.type)).toEqual(
      scene.elements.map((element) => element.type),
    )
    expect(restored.elements.find((element) => element.id === 'reference')).toMatchObject({
      referenceId: 'reference:one',
      targetBoardId: 'board:target',
      kind: 'embed',
      parentElementId: 'section',
    })
    expect(restored.elements.find((element) => element.id === 'mind-map')).toMatchObject({
      type: 'mind-map', text: 'Root', layout: 'bilateral', theme: 'colorful', rootShape: 'pill',
      rootStyle: { fillColor: 'indigo', textColor: 'gray', fontSize: 'l' },
      children: [{
        id: 'branch', text: 'Branch', side: 'left', collapsed: true, shape: 'underline',
        style: { fillColor: 'purple', textColor: 'black', fontFamily: 'serif', edgeColor: 'teal', edgeDash: 'dashed', edgeWidth: 3 },
        children: [],
      }],
    })
  })

  it('preserves unsupported source payloads and records them in the compatibility report', () => {
    const sourcePayload = { stencil: 'vendor-specific', secretId: 'external-only' }
    const snapshot = {
      store: {
        'document:document': { id: 'document:document', typeName: 'document' },
        'page:page': { id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1' },
        'shape:unknown': {
          id: 'shape:unknown', typeName: 'shape', type: 'vendor-widget', parentId: 'page:page',
          index: 'a1', x: 5, y: 6, props: { w: 90, h: 70 }, meta: { sourcePayload },
        },
      },
    }

    const scene = snapshotToInteropScene(snapshot)

    expect(scene.elements).toEqual([
      expect.objectContaining({
        id: 'shape:unknown', type: 'unsupported', sourceType: 'vendor-widget', sourcePayload,
      }),
    ])
    expect(scene.compatibilityReport).toMatchObject({
      unsupportedElementCount: 1,
      issues: [expect.objectContaining({ code: 'UNSUPPORTED_ELEMENT', elementId: 'shape:unknown' })],
    })
  })

  it('validates container relationships without treating a board target as an element parent', () => {
    const scene = {
      formatVersion: 1,
      elements: [{
        id: 'reference', type: 'board-reference', referenceId: 'reference:one',
        targetBoardId: 'board:not-in-scene', kind: 'link', titleFallback: 'External board',
        geometry, zIndex: 'a1', style: {},
      }],
    }

    expect(interopSceneSchema.safeParse(scene).success).toBe(true)
    expect(interopSceneSchema.safeParse({
      ...scene,
      elements: [{ ...scene.elements[0], parentElementId: 'missing-element' }],
    }).success).toBe(false)
  })

  it('downgrades a board reference when the single-board context cannot resolve its target', () => {
    const scene: InteropScene = {
      formatVersion: 1,
      elements: [{
        id: 'reference', type: 'board-reference', referenceId: 'reference:one',
        targetBoardId: 'board:missing', kind: 'embed', titleFallback: 'Missing board',
        geometry, zIndex: 'a1', style: {},
      }],
    }

    const snapshot = interopSceneToSnapshot(scene, {
      referencePolicy: 'preserve',
      canResolveBoardReference: () => false,
    })
    const card = Object.values(snapshot.document.store).find((record) => record.typeName === 'shape')

    expect(card).toMatchObject({ type: 'geo' })
    expect(JSON.stringify(card)).not.toMatch(/referenceId|targetBoardId|"kind"/)
  })

  it('exports the current reference props after a transaction replaces imported metadata ids', () => {
    const scene: InteropScene = {
      formatVersion: 1,
      elements: [{
        id: 'reference', type: 'board-reference', referenceId: 'reference:source',
        targetBoardId: 'board:target', kind: 'link', titleFallback: 'Target',
        geometry, zIndex: 'a1', style: {},
      }],
    }
    const snapshot = interopSceneToSnapshot(scene, { referencePolicy: 'preserve' })
    const reference = Object.values(snapshot.document.store).find(
      (record) => record.typeName === 'shape' && record.type === 'board-reference',
    ) as any
    reference.props.referenceId = 'reference:transaction'

    expect(snapshotToInteropScene(snapshot).elements[0]).toMatchObject({
      type: 'board-reference',
      referenceId: 'reference:transaction',
      targetBoardId: 'board:target',
      kind: 'link',
    })
  })
})
