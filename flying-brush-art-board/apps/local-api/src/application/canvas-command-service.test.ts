import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../db/schema.js'
import { AssetRepository } from '../modules/assets/asset-repository.js'
import { BoardRepository } from '../modules/boards/board-repository.js'
import { BoardDocumentCoordinator } from '../modules/realtime/board-document-coordinator.js'
import { CanvasCommandService } from './canvas-command-service.js'

const directories: string[] = []
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})

function setup() {
  const database = createDatabase(':memory:')
  database.exec("INSERT INTO projects VALUES ('p','P','b',1,'t','t'); INSERT INTO boards VALUES ('b','p','B','{\"store\":{}}',NULL,0,'t','t')")
  const boards = new BoardRepository(database)
  const realtime = { applyCommittedSnapshot: vi.fn(async () => undefined) }
  const directory = mkdtempSync(join(tmpdir(), 'canvas-command-'))
  directories.push(directory)
  const service = new CanvasCommandService(database, boards, new BoardDocumentCoordinator(database, boards, realtime), new AssetRepository(database, directory))
  const context = { actorOpenId: 'u', actorName: 'User', clientId: 'c', requestId: 'r', operationId: 'o' }
  return { database, boards, realtime, service, context }
}

describe('CanvasCommandService', () => {
  it('commits a validated batch with one checkpoint, revision and realtime broadcast', async () => {
    const { database, realtime, service, context } = setup()
    try {
      const result = await service.batch('b', [
        { action: 'create', kind: 'geo', x: 20, y: 30, width: 160, height: 90, text: '开始' },
        { action: 'create', kind: 'note', x: 260, y: 30, text: '待办' },
      ], 0, context)
      expect(result).toMatchObject({ revision: 1, affectedIds: [expect.stringMatching(/^shape:/), expect.stringMatching(/^shape:/)] })
      expect(database.prepare('SELECT COUNT(*) AS count FROM board_checkpoints').get()).toEqual({ count: 1 })
      expect(realtime.applyCommittedSnapshot).toHaveBeenCalledTimes(1)
      expect(service.inspect('b')).toMatchObject({ shapeCount: 2, typeCounts: { geo: 1, note: 1 } })
    } finally { database.close() }
  })

  it('does not persist a partial batch when a later action fails', async () => {
    const { database, boards, realtime, service, context } = setup()
    try {
      await expect(service.batch('b', [
        { action: 'create', kind: 'geo', x: 0, y: 0 },
        { action: 'update', shapeId: 'shape:missing', text: 'x' },
      ], 0, context)).rejects.toThrow('SHAPE_NOT_FOUND')
      expect(boards.get('b')).toMatchObject({ revision: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM board_checkpoints').get()).toEqual({ count: 0 })
      expect(realtime.applyCommittedSnapshot).not.toHaveBeenCalled()
    } finally { database.close() }
  })

  it('creates arrow bindings only through controlled endpoint inputs', async () => {
    const { database, boards, service, context } = setup()
    try {
      const nodes = await service.batch('b', [
        { action: 'create', kind: 'geo', x: 0, y: 0 },
        { action: 'create', kind: 'geo', x: 400, y: 0 },
      ], 0, context)
      const [fromShapeId, toShapeId] = nodes.affectedIds
      if (!fromShapeId || !toShapeId) throw new Error('TEST_SHAPES_MISSING')
      const arrow = await service.create('b', {
        kind: 'arrow', x: 0, y: 0, fromShapeId, toShapeId,
      }, 1, context)
      expect(arrow.revision).toBe(2)
      const snapshot = boards.get('b')!.tldrawSnapshot as { store: Record<string, { typeName?: string; type?: string }> }
      expect(Object.values(snapshot.store).filter((record) => record.typeName === 'binding' && record.type === 'arrow')).toHaveLength(2)
    } finally { database.close() }
  })

  it('reports actual rendered bounds for notes, text and lines', async () => {
    const { database, service, context } = setup()
    try {
      const result = await service.batch('b', [
        { action: 'create', kind: 'note', x: 0, y: 0, width: 220, height: 140, text: 'Note' },
        { action: 'create', kind: 'note', x: 0, y: 300, height: 140, text: 'Height only' },
        { action: 'create', kind: 'text', x: 300, y: 0, width: 260, height: 60, text: 'Text' },
        { action: 'create', kind: 'line', x: 300, y: 200, width: 240, height: 80 },
      ], 0, context)

      expect(result.shapes).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'note', width: 220, height: 220 }),
        expect.objectContaining({ type: 'note', width: 140, height: 140 }),
        expect.objectContaining({ type: 'text', width: 260, height: 40 }),
        expect.objectContaining({ type: 'line', width: 240, height: 80 }),
      ]))
      expect(service.inspect('b')).toMatchObject({
        shapeCount: 4,
        bounds: { x: 0, y: 0, width: 560, height: 440 },
      })
    } finally { database.close() }
  })
})
