import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { BoardReferenceRecord, MaterializedClipboardPatch } from '@infinite-board/board-core'
import {
  assertBoardReferenceSnapshotConsistent,
  createBoardReferenceShape,
} from '@infinite-board/tldraw-adapter'

import { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { ClipboardCommandService } from './clipboard-command-service.js'

const now = '2026-07-23T00:00:00.000Z'
const sessionId = 'session:test'

describe('clipboard command service', () => {
  let database: LocalDatabase
  let assetDirectory: string
  let boards: BoardRepository
  let assets: AssetRepository
  let usages: AssetUsageRepository
  let references: BoardReferenceRepository
  let service: ClipboardCommandService

  beforeEach(() => {
    database = createDatabase(':memory:')
    assetDirectory = mkdtempSync(join(tmpdir(), 'infinite-board-clipboard-assets-'))
    const projects = new ProjectRepository(database)
    boards = new BoardRepository(database)
    assets = new AssetRepository(database, assetDirectory)
    usages = new AssetUsageRepository(database)
    references = new BoardReferenceRepository(database)
    projects.create({
      id: 'project-1',
      title: 'Project',
      rootBoardId: 'A',
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    boards.create({
      id: 'A',
      projectId: 'project-1',
      title: 'A',
      tldrawSnapshot: { store: [] },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    boards.create({
      id: 'B',
      projectId: 'project-1',
      title: 'B',
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    service = new ClipboardCommandService(database, boards, assets, references)
  })

  afterEach(() => {
    database.close()
    rmSync(assetDirectory, { recursive: true, force: true })
  })

  function patch(bytes = new Uint8Array([1, 2, 3])): MaterializedClipboardPatch {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return {
      nextSnapshot: { store: [{ id: 'shape:paste' }] },
      idMap: { 'shape:source': 'shape:paste' },
      assetBlobs: [{ sha256, mime: 'image/png', size: bytes.byteLength, bytes }],
      assetUsages: [{ shapeId: 'shape:paste', assetRecordId: 'asset:paste', sha256 }],
      referenceCandidates: [],
    }
  }

  function referencePatch(kind: 'embed' | 'link' = 'link'): MaterializedClipboardPatch {
    const copied: BoardReferenceRecord = {
      id: 'reference:copied',
      projectId: 'project-1',
      sourceBoardId: 'source-board',
      targetBoardId: 'B',
      shapeId: 'shape:paste-reference',
      kind,
      createdAt: now,
      updatedAt: now,
    }
    return {
      nextSnapshot: {
        store: {
          'shape:paste-reference': createBoardReferenceShape(copied, 'B'),
        },
      },
      idMap: { 'shape:copied-reference': 'shape:paste-reference' },
      assetBlobs: [],
      assetUsages: [],
      referenceCandidates: [{
        shapeId: 'shape:paste-reference',
        referenceId: copied.id,
        targetBoardId: copied.targetBoardId,
        kind,
      }],
    }
  }

  it('applies, undoes and redoes one materialized patch atomically', () => {
    const receipt = service.applyMaterializedClipboardCommand('A', 0, patch(), sessionId)
    expect(boards.get('A')).toMatchObject({ revision: 1, tldrawSnapshot: { store: [{ id: 'shape:paste' }] } })
    expect(usages.listByProject('project-1')).toHaveLength(1)

    service.undo(receipt.commandId, 1, sessionId)
    expect(boards.get('A')).toMatchObject({ revision: 2, tldrawSnapshot: { store: [] } })
    expect(usages.listByProject('project-1')).toEqual([])

    service.redo(receipt.commandId, 2, sessionId)
    expect(boards.get('A')).toMatchObject({ revision: 3, tldrawSnapshot: { store: [{ id: 'shape:paste' }] } })
    expect(usages.listByProject('project-1')).toHaveLength(1)
  })

  it('does not allow another application session to replay a clipboard receipt', () => {
    const receipt = service.applyMaterializedClipboardCommand('A', 0, patch(), 'session:one')

    expect(() => service.undo(receipt.commandId, 1, 'session:two')).toThrow('CLIPBOARD_COMMAND_EXPIRED')
    expect(boards.get('A')).toMatchObject({ revision: 1, tldrawSnapshot: { store: [{ id: 'shape:paste' }] } })
  })

  it('rejects an absent or stale expected revision without overwriting the newer snapshot', () => {
    expect(() => service.applyMaterializedClipboardCommand('A', 1, patch(), sessionId)).toThrow(
      expect.objectContaining({ currentRevision: 0 }) satisfies Partial<RevisionConflictError>,
    )
    expect(boards.get('A')).toMatchObject({ revision: 0, tldrawSnapshot: { store: [] } })
  })

  it('rolls back snapshot and asset usages when a patch cannot create its relation', () => {
    const initial = patch(new Uint8Array([1]))
    assets.materializeForBoard({
      projectId: 'project-1',
      boardId: 'A',
      shapeId: 'shape:paste',
      assetRecordId: 'asset:paste',
      bytes: initial.assetBlobs[0]!.bytes,
      mime: 'image/png',
      createdAt: now,
    })

    expect(() => service.applyMaterializedClipboardCommand('A', 0, initial, sessionId)).toThrow()
    expect(boards.get('A')).toMatchObject({ revision: 0, tldrawSnapshot: { store: [] } })
    expect(usages.listByProject('project-1')).toHaveLength(1)
  })

  it('removes newly materialized asset metadata and files when the transaction fails after asset storage', () => {
    const existing = patch(new Uint8Array([9]))
    assets.materializeForBoard({
      projectId: 'project-1',
      boardId: 'A',
      shapeId: 'shape:paste',
      assetRecordId: 'asset:paste',
      bytes: existing.assetBlobs[0]!.bytes,
      mime: 'image/png',
      createdAt: now,
    })
    const attempted = patch()

    expect(() => service.applyMaterializedClipboardCommand('A', 0, attempted, sessionId)).toThrow()
    expect(boards.get('A')).toMatchObject({ revision: 0, tldrawSnapshot: { store: [] } })
    expect(usages.listByProject('project-1')).toHaveLength(1)
    expect(assets.get(attempted.assetBlobs[0]!.sha256)).toBeUndefined()
    expect(existsSync(join(assetDirectory, attempted.assetBlobs[0]!.sha256))).toBe(false)
  })

  it('leaves no forward, undo, or redo partial state when a snapshot write fails', () => {
    const applied = service.applyMaterializedClipboardCommand('A', 0, patch(), sessionId)
    database.exec("CREATE TRIGGER reject_board_updates BEFORE UPDATE ON boards BEGIN SELECT RAISE(ABORT, 'forced'); END")

    expect(() => service.undo(applied.commandId, 1, sessionId)).toThrow('forced')
    expect(boards.get('A')).toMatchObject({ revision: 1, tldrawSnapshot: { store: [{ id: 'shape:paste' }] } })
    expect(usages.listByProject('project-1')).toHaveLength(1)

    database.exec('DROP TRIGGER reject_board_updates')
    service.undo(applied.commandId, 1, sessionId)
    database.exec("CREATE TRIGGER reject_board_updates BEFORE UPDATE ON boards BEGIN SELECT RAISE(ABORT, 'forced'); END")

    expect(() => service.redo(applied.commandId, 2, sessionId)).toThrow('forced')
    expect(boards.get('A')).toMatchObject({ revision: 2, tldrawSnapshot: { store: [] } })
    expect(usages.listByProject('project-1')).toEqual([])

    database.exec('DROP TRIGGER reject_board_updates')
    service.redo(applied.commandId, 2, sessionId)
    expect(boards.get('A')).toMatchObject({ revision: 3, tldrawSnapshot: { store: [{ id: 'shape:paste' }] } })
  })

  it('removes newly materialized asset files when snapshot CAS fails inside the transaction', () => {
    const attempted = patch()
    database.exec("CREATE TRIGGER reject_board_updates BEFORE UPDATE ON boards BEGIN SELECT RAISE(ABORT, 'forced'); END")

    expect(() => service.applyMaterializedClipboardCommand('A', 0, attempted, sessionId)).toThrow('forced')
    expect(boards.get('A')).toMatchObject({ revision: 0, tldrawSnapshot: { store: [] } })
    expect(usages.listByProject('project-1')).toEqual([])
    expect(assets.get(attempted.assetBlobs[0]!.sha256)).toBeUndefined()
    expect(existsSync(join(assetDirectory, attempted.assetBlobs[0]!.sha256))).toBe(false)
  })

  it('rolls back a newly created board, its recoverable reference, and asset when its paste fails', () => {
    const attempted = {
      ...referencePatch(),
      assetBlobs: patch().assetBlobs,
      assetUsages: patch().assetUsages,
    }
    database.exec("CREATE TRIGGER reject_board_updates BEFORE UPDATE ON boards BEGIN SELECT RAISE(ABORT, 'forced'); END")

    expect(() => service.createBoardAndApplyMaterializedClipboardCommand({
      id: 'C', projectId: 'project-1', title: 'Imported', tldrawSnapshot: { store: {} }, revision: 0,
      createdAt: now, updatedAt: now,
    }, attempted, sessionId, {
      sourceProjectId: 'project-1', sourceBoardId: 'C', copiedAt: now,
    })).toThrow('forced')

    expect(boards.get('C')).toBeUndefined()
    expect(references.listOutbound('C')).toEqual([])
    expect(usages.listByProject('project-1')).toEqual([])
    expect(assets.get(attempted.assetBlobs[0]!.sha256)).toBeUndefined()
    expect(existsSync(join(assetDirectory, attempted.assetBlobs[0]!.sha256))).toBe(false)
  })

  it('applies one same-project reference receipt and atomically undoes and redoes its edge and shape', () => {
    const applied = service.applyMaterializedClipboardCommand('A', 0, referencePatch(), sessionId, {
      sourceProjectId: 'project-1',
      sourceBoardId: 'source-board',
      copiedAt: now,
    })
    const created = references.listOutbound('A')

    expect(created).toHaveLength(1)
    expect(applied.createdReferenceIds).toEqual([created[0]!.id])
    expect(() => assertBoardReferenceSnapshotConsistent(applied.snapshot, created)).not.toThrow()

    const undone = service.undo(applied.commandId, 1, sessionId)
    expect(references.listOutbound('A')).toEqual([])
    expect(undone.revision).toBe(2)

    const redone = service.redo(applied.commandId, 2, sessionId)
    expect(references.listOutbound('A')).toEqual(created)
    expect(redone.createdReferenceIds).toEqual([created[0]!.id])
    expect(() =>
      assertBoardReferenceSnapshotConsistent(redone.snapshot, references.listOutbound('A')),
    ).not.toThrow()
  })
})
