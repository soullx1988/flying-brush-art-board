import { exportProjectToIboard } from '../../../../../packages/interop/src/index.js'
import { createReferenceGraphProjectFixture } from '../../../../../packages/test-fixtures/src/iboard/reference-graph-project.js'
import { describe, expect, it } from 'vitest'

import {
  IBOARD_BOARD_SNAPSHOT_UNSUPPORTED,
  analyzeIboardForImport,
} from './iboard-runtime-compatibility.js'

function runtimeCompatibleFixture() {
  const fixture = createReferenceGraphProjectFixture()
  for (const board of fixture.boards) {
    const snapshot = board.tldrawSnapshot as { schema?: unknown; store: Record<string, Record<string, unknown>> }
    delete snapshot.schema
    const image = snapshot.store['shape:image-a']
    if (image) {
      Object.assign(image, { x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1 })
      image.props = {
        assetId: 'asset:image-a', w: 20, h: 20, playing: false, url: '', crop: null,
        flipX: false, flipY: false, altText: '',
      }
    }
    const asset = snapshot.store['asset:image-a']
    if (asset) {
      asset.props = {
        src: asset.props && typeof asset.props === 'object'
          ? (asset.props as { src?: unknown }).src ?? null
          : null,
        name: 'fixture.png', mimeType: 'image/png', w: 20, h: 20, isAnimated: false,
      }
    }
    const binding = snapshot.store['binding:image-to-ref']
    if (binding) {
      binding.props = {
        terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false, isPrecise: false, snap: 'none',
      }
    }
  }
  return fixture
}

function archiveWithRecord(record: Record<string, unknown>): Uint8Array {
  const fixture = runtimeCompatibleFixture()
  const board = fixture.boards.find((item) => item.id === 'board-c')!
  const snapshot = board.tldrawSnapshot as { store: Record<string, unknown> }
  snapshot.store[String(record.id)] = record
  return exportProjectToIboard(fixture)
}

function shapeRecord(type: string, props: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `shape:${type}`,
    typeName: 'shape',
    type,
    parentId: 'page:board-c',
    index: 'a2',
    x: 0,
    y: 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
    props,
  }
}

describe('analyzeIboardForImport', () => {
  it('keeps structurally and runtime-compatible archives importable', () => {
    const analysis = analyzeIboardForImport(exportProjectToIboard(runtimeCompatibleFixture()))

    expect(analysis.inspection.compatible).toBe(true)
    expect(analysis.inspection.issues).toEqual([])
    expect(analysis.decoded?.boards).toHaveLength(4)
  })

  it.each([
    ['unknown shape', shapeRecord('alien-widget', {})],
    ['malformed known shape', shapeRecord('table', {})],
    ['unknown record type', { id: 'plugin-record:one', typeName: 'plugin-record' }],
  ])('fails closed for a runtime-incompatible %s', (_label, record) => {
    const analysis = analyzeIboardForImport(archiveWithRecord(record))

    expect(analysis.inspection).toMatchObject({
      compatible: false,
      sourceProject: { id: 'project-source' },
      boardCount: 4,
      issues: [{
        code: IBOARD_BOARD_SNAPSHOT_UNSUPPORTED,
        message: expect.any(String),
        action: expect.any(String),
      }],
    })
    expect(analysis).not.toHaveProperty('decoded')
  })
})
