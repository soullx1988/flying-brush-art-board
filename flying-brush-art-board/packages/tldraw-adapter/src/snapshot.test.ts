import { describe, expect, it } from 'vitest'

import { createBoardReferenceShape } from './board-reference-snapshot-operations.js'
import { addMindMapChild, createMindMapProps, updateMindMapNodeStyle } from './shapes/mind-map/operations.js'
import { createTableProps, toggleTableHeaderRow, updateTableCellStyles } from './shapes/table/operations.js'
import { createBoardStore } from './store.js'
import { getStoreSnapshot, loadSnapshotIntoStore } from './snapshot.js'

describe('board snapshot adapter', () => {
  it('round-trips the fixed tldraw 5.2.5 store snapshot', () => {
    const source = createBoardStore()
    const snapshot = getStoreSnapshot(source)
    const target = createBoardStore()

    loadSnapshotIntoStore(target, snapshot)

    expect(getStoreSnapshot(target)).toEqual(snapshot)
  })

  it('loads a legacy Board snapshot that omitted tldraw schema metadata', () => {
    const source = createBoardStore()
    const snapshot = getStoreSnapshot(source)
    const legacySnapshot = { store: snapshot.store }
    const target = createBoardStore()

    loadSnapshotIntoStore(target, legacySnapshot)

    expect(getStoreSnapshot(target).store).toEqual(snapshot.store)
  })

  it('repairs legacy geo aliases without changing mind-map node shapes', () => {
    const snapshot = getStoreSnapshot(createBoardStore()) as { store: Record<string, any> }
    const page = Object.values(snapshot.store).find((record) => record.typeName === 'page')!
    snapshot.store['shape:legacy-pill'] = {
      id: 'shape:legacy-pill', typeName: 'shape', type: 'geo', parentId: page.id, index: 'a1',
      x: 10, y: 20, rotation: 0, isLocked: false, opacity: 1, meta: {},
      props: {
        w: 160, h: 64, geo: 'pill', color: 'black', fill: 'none', dash: 'draw',
        growY: 0, url: '', scale: 1, size: 'm', font: 'draw', align: 'middle',
        verticalAlign: 'middle', labelColor: 'black', richText: { type: 'doc', content: [] },
      },
    }
    const target = createBoardStore()

    loadSnapshotIntoStore(target, snapshot)

    expect(target.get('shape:legacy-pill' as any)).toMatchObject({
      type: 'geo',
      props: { geo: 'oval' },
    })
  })

  it('loads an editor snapshot whose document omitted tldraw schema metadata', () => {
    const source = createBoardStore()
    const snapshot = getStoreSnapshot(source)
    const legacyEditorSnapshot = {
      document: { store: snapshot.store },
      session: {},
    }
    const target = createBoardStore()

    loadSnapshotIntoStore(target, legacyEditorSnapshot)

    expect(getStoreSnapshot(target).store).toEqual(snapshot.store)
  })

  it('reindexes decimal legacy indices while preserving their numeric order', () => {
    const source = createBoardStore()
    const snapshot = getStoreSnapshot(source)
    const documentRecord = Object.values(snapshot.store).find((record) => record.typeName === 'document')!
    const pageRecord = Object.values(snapshot.store).find((record) => record.typeName === 'page')!
    const legacyShapes = Array.from({ length: 12 }, (_, index) => {
      const position = index + 1
      const shape = createBoardReferenceShape({
        id: `reference:legacy-${position}`,
        projectId: 'project:legacy',
        sourceBoardId: 'board:legacy-source',
        targetBoardId: 'board:legacy-target',
        shapeId: `shape:legacy-${position}`,
        kind: 'link',
        createdAt: '',
        updatedAt: '',
      }, `Legacy ${position}`, {
        parentId: pageRecord.id,
        index: `a${position}`,
      })
      return [shape.id, shape] as const
    })
    const target = createBoardStore()

    loadSnapshotIntoStore(target, {
      document: {
        store: Object.fromEntries([
          [documentRecord.id, documentRecord],
          [pageRecord.id, pageRecord],
          ...legacyShapes,
        ]),
      },
      session: {},
    })

    const orderedShapeIds = Object.values(getStoreSnapshot(target).store)
      .filter((record) => record.typeName === 'shape')
      .sort((left, right) => left.index.localeCompare(right.index))
      .map((record) => record.id)
    expect(orderedShapeIds).toEqual(legacyShapes.map(([id]) => id))
  })

  it('upgrades legacy imported table cards to native table records', () => {
    const snapshot = getStoreSnapshot(createBoardStore()) as { store: Record<string, any>; schema: unknown }
    const page = Object.values(snapshot.store).find((record) => record.typeName === 'page')!
    snapshot.store['shape:legacy-table'] = {
      id: 'shape:legacy-table', typeName: 'shape', type: 'geo', parentId: page.id, index: 'a1',
      x: 10, y: 20, rotation: 0, isLocked: false, opacity: 1,
      props: { w: 240, h: 120 },
      meta: { interopElement: { id: 'table', type: 'table', cells: [['A', 'B'], ['C', 'D']], geometry: { x: 10, y: 20, width: 240, height: 120 }, zIndex: 'a1', style: {} } },
    }
    const target = createBoardStore()

    loadSnapshotIntoStore(target, snapshot)

    expect(target.get('shape:legacy-table' as any)).toMatchObject({
      type: 'table',
      props: expect.objectContaining({ rows: expect.any(Array), columns: expect.any(Array) }),
    })
  })

  it('preserves table cell styles and mind-map branch styles through board snapshot round-trips', () => {
    const source = createBoardStore()
    const initialSnapshot = getStoreSnapshot(source)
    const page = Object.values(initialSnapshot.store).find((record) => record.typeName === 'page')!
    loadSnapshotIntoStore(source, initialSnapshot)
    const tableBase = createTableProps(2, 2)
    const tableProps = toggleTableHeaderRow(updateTableCellStyles(
      tableBase,
      [tableBase.rows[1]!.cells[1]!.id],
      { align: 'right', background: 'yellow', border: 'strong' },
    ), tableBase.rows[0]!.id)
    const mindMapBase = createMindMapProps('Root')
    const added = addMindMapChild(mindMapBase, mindMapBase.nodes[0]!.id)
    const mindMapProps = {
      ...updateMindMapNodeStyle(added.props, added.nodeId!, {
        color: 'violet',
        shape: 'pill',
        style: { fillColor: 'purple', fontSize: 'xl', edgeColor: 'teal', edgeDash: 'dotted', edgeWidth: 4 },
      }),
      theme: 'colorful' as const,
    }
    source.put([{
      id: 'shape:styled-table', typeName: 'shape', type: 'table', parentId: page.id, index: 'a1',
      x: 10, y: 20, rotation: 0, opacity: 1, isLocked: false, props: tableProps, meta: {},
    }, {
      id: 'shape:styled-mind-map', typeName: 'shape', type: 'mind-map', parentId: page.id, index: 'a2',
      x: 300, y: 20, rotation: 0, opacity: 1, isLocked: false, props: mindMapProps, meta: {},
    }] as any)

    const target = createBoardStore()
    loadSnapshotIntoStore(target, getStoreSnapshot(source))

    expect(target.get('shape:styled-table' as any)).toMatchObject({
      props: {
        rows: [
          expect.objectContaining({ cells: expect.arrayContaining([expect.objectContaining({ header: true })]) }),
          expect.objectContaining({
            cells: expect.arrayContaining([expect.objectContaining({ align: 'right', background: 'yellow', border: 'strong' })]),
          }),
        ],
      },
    })
    expect(target.get('shape:styled-mind-map' as any)).toMatchObject({
      props: {
        theme: 'colorful',
        nodes: expect.arrayContaining([expect.objectContaining({
          id: added.nodeId, color: 'violet', shape: 'pill',
          style: expect.objectContaining({ fillColor: 'purple', fontSize: 'xl', edgeColor: 'teal', edgeDash: 'dotted', edgeWidth: 4 }),
        })]),
      },
    })
  })

  it.each([
    ['an unsupported record type', { id: 'record:unknown', typeName: 'unknown-record' }],
    ['an unsupported shape type', { id: 'shape:unknown', typeName: 'shape', type: 'unknown-shape' }],
  ])('rejects %s instead of silently dropping it', (_label, record) => {
    const snapshot = getStoreSnapshot(createBoardStore()) as { store: Record<string, unknown> }
    snapshot.store[record.id] = record

    expect(() => loadSnapshotIntoStore(createBoardStore(), snapshot)).toThrow(/unknown record/i)
  })
})
