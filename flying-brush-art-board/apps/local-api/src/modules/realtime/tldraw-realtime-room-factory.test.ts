import { describe, expect, it } from 'vitest'

import { createBoardStore, interopSceneToSnapshot } from '@infinite-board/tldraw-adapter'

import { tldrawRealtimeRoomFactory } from './tldraw-realtime-room-factory.js'

describe('tldrawRealtimeRoomFactory', () => {
  it('creates a valid empty tldraw room snapshot without a browser or network', () => {
    const room = tldrawRealtimeRoomFactory.create({
      boardId: 'board-1',
      onDataChange() {},
      onMessage() {},
    })
    expect(room.getCurrentSnapshot()).toMatchObject({ documents: expect.any(Array) })
    expect(room.getNumActiveSessions()).toBe(0)
  })

  it('accepts a Board REST snapshot without sync-core schema metadata', () => {
    const room = tldrawRealtimeRoomFactory.create({
      boardId: 'board-1',
      onDataChange() {},
      onMessage() {},
    })

    expect(() => room.loadSnapshot({ store: {} })).not.toThrow()
  })

  it('does not report a server-applied snapshot as a collaborative edit', async () => {
    let changeCount = 0
    const room = tldrawRealtimeRoomFactory.create({
      boardId: 'board-command',
      onDataChange() { changeCount += 1 },
      onMessage() {},
    })
    const snapshot = interopSceneToSnapshot({
      formatVersion: 1,
      elements: [{
        id: 'command-shape',
        type: 'shape',
        shape: 'rectangle',
        geometry: { x: 10, y: 20, width: 100, height: 80 },
        zIndex: 'a1',
        style: {},
      }],
    }, { referencePolicy: 'preserve' })

    await Promise.resolve()
    await room.loadSnapshot(snapshot)
    await Promise.resolve()

    expect(changeCount).toBe(0)
  })

  it('normalizes an editor snapshot produced by the draw.io importer', () => {
    const snapshot = interopSceneToSnapshot({ formatVersion: 1, elements: [] }, { referencePolicy: 'preserve' })

    expect(() => tldrawRealtimeRoomFactory.create({
      boardId: 'drawio-board',
      initialSnapshot: snapshot,
      onDataChange() {},
      onMessage() {},
    })).not.toThrow()
  })

  it('reindexes decimal legacy indices before initializing a realtime room', () => {
    const snapshot = interopSceneToSnapshot({
      formatVersion: 1,
      elements: Array.from({ length: 20 }, (_, index) => ({
        id: `legacy-${index + 1}`,
        type: 'shape' as const,
        shape: 'rectangle',
        geometry: { x: index * 20, y: 0, width: 10, height: 10 },
        zIndex: `a${index + 1}`,
        style: {},
      })),
    }, { referencePolicy: 'preserve' })
    const legacyStore = structuredClone(snapshot.document.store) as unknown as Record<string, Record<string, unknown>>
    const shapes = Object.values(legacyStore).filter((record) => record.typeName === 'shape')
    shapes.forEach((shape, index) => { shape.index = `a${index + 1}` })

    const room = tldrawRealtimeRoomFactory.create({
      boardId: 'legacy-board',
      initialSnapshot: {
        document: { store: legacyStore },
        session: {},
      },
      onDataChange() {},
      onMessage() {},
    })

    expect(JSON.stringify(room.getCurrentSnapshot())).not.toContain('"index":"a20"')
  })

  it('repairs invalid legacy geo values in persisted sync-core documents', () => {
    const room = tldrawRealtimeRoomFactory.create({
      boardId: 'legacy-pill-board',
      initialSnapshot: {
        documents: [{
          state: {
            id: 'shape:legacy-pill', typeName: 'shape', type: 'geo', parentId: 'page:page', index: 'a1',
            x: 10, y: 20, rotation: 0, isLocked: false, opacity: 1, meta: {},
            props: {
              w: 160, h: 64, geo: 'pill', color: 'black', fill: 'none', dash: 'draw',
              growY: 0, url: '', scale: 1, size: 'm', font: 'draw', align: 'middle',
              verticalAlign: 'middle', labelColor: 'black', richText: { type: 'doc', content: [] },
            },
          },
          lastChangedClock: 1,
        }],
        clock: 1,
        schema: createBoardStore().schema.serialize(),
      },
      onDataChange() {},
      onMessage() {},
    })

    const serialized = JSON.stringify(room.getCurrentSnapshot())
    expect(serialized).toContain('"geo":"oval"')
    expect(serialized).not.toContain('"geo":"pill"')
  })
})
