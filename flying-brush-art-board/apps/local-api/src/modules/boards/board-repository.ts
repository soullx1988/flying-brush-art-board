import {
  BoardReferenceGraphError,
  removeNavigationBoard,
  type ProjectNavigation,
  type ImportSource,
  type StoredBoard,
} from '@infinite-board/board-core'
import { randomUUID } from 'node:crypto'
import {
  assertBoardReferenceSnapshotConsistent,
  updateBoardReferenceShape,
} from '@infinite-board/tldraw-adapter'

import type { LocalDatabase } from '../../db/schema.js'

interface BoardRow {
  id: string
  project_id: string
  title: string
  tldraw_snapshot: string
  source_metadata: string | null
  revision: number
  created_at: string
  updated_at: string
}

function toBoard(row: BoardRow): StoredBoard {
  const base: StoredBoard = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    tldrawSnapshot: JSON.parse(row.tldraw_snapshot) as unknown,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  if (row.source_metadata) {
    return { ...base, sourceMetadata: JSON.parse(row.source_metadata) as ImportSource }
  }

  return base
}

export class RevisionConflictError extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number) {
    super('REVISION_CONFLICT')
    this.name = 'RevisionConflictError'
    this.currentRevision = currentRevision
  }
}

export class BoardRepository {
  constructor(private readonly database: LocalDatabase) {}

  create(board: StoredBoard): StoredBoard {
    this.database
      .prepare(
        `INSERT INTO boards (
          id, project_id, title, tldraw_snapshot, source_metadata, revision, created_at, updated_at
        ) VALUES (
          @id, @projectId, @title, @tldrawSnapshot, @sourceMetadata, @revision, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...board,
        tldrawSnapshot: JSON.stringify(board.tldrawSnapshot),
        sourceMetadata: board.sourceMetadata ? JSON.stringify(board.sourceMetadata) : null,
      })
    return board
  }

  duplicate(sourceBoardId: string, input: { id: string; title: string }): StoredBoard {
    const source = this.get(sourceBoardId)
    if (!source) throw new Error('BOARD_NOT_FOUND')
    const outbound = this.database.prepare('SELECT * FROM board_references WHERE source_board_id=? ORDER BY id').all(sourceBoardId) as Array<{
      id: string; project_id: string; source_board_id: string; target_board_id: string; shape_id: string; kind: 'embed' | 'link'; created_at: string; updated_at: string
    }>
    const references = outbound.map((row) => ({
      id: row.id, projectId: row.project_id, sourceBoardId: row.source_board_id,
      targetBoardId: row.target_board_id, shapeId: row.shape_id, kind: row.kind,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }))
    assertBoardReferenceSnapshotConsistent(source.tldrawSnapshot, references)
    const timestamp = new Date().toISOString()
    let snapshot = structuredClone(source.tldrawSnapshot)
    const duplicatedReferences = references.map((reference) => {
      const duplicated = { ...reference, id: randomUUID(), sourceBoardId: input.id, createdAt: timestamp, updatedAt: timestamp }
      const targetTitle = this.get(reference.targetBoardId)?.title ?? reference.targetBoardId
      snapshot = updateBoardReferenceShape(snapshot, duplicated, targetTitle)
      return duplicated
    })
    assertBoardReferenceSnapshotConsistent(snapshot, duplicatedReferences)
    const duplicated: StoredBoard = {
      id: input.id,
      projectId: source.projectId,
      title: input.title,
      tldrawSnapshot: snapshot,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.database.transaction(() => {
      this.create(duplicated)
      const insertReference = this.database.prepare(`INSERT INTO board_references
        (id,project_id,source_board_id,target_board_id,shape_id,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      for (const reference of duplicatedReferences) {
        insertReference.run(reference.id, reference.projectId, reference.sourceBoardId, reference.targetBoardId, reference.shapeId, reference.kind, reference.createdAt, reference.updatedAt)
      }
      this.database.prepare(`INSERT INTO asset_usages(project_id,board_id,shape_id,asset_record_id,sha256,created_at)
        SELECT project_id, ?, shape_id, asset_record_id, sha256, ? FROM asset_usages WHERE board_id=?`)
        .run(duplicated.id, timestamp, source.id)
    })()
    return this.get(duplicated.id)!
  }

  get(boardId: string): StoredBoard | undefined {
    const row = this.database.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as BoardRow | undefined
    return row ? toBoard(row) : undefined
  }

  listByProject(projectId: string): StoredBoard[] {
    return (
      this.database.prepare('SELECT * FROM boards WHERE project_id = ? ORDER BY id').all(projectId) as BoardRow[]
    ).map(toBoard)
  }

  saveSnapshot(boardId: string, expectedRevision: number, snapshot: unknown): StoredBoard {
    const updatedAt = new Date().toISOString()
    const result = this.database
      .prepare(
        `UPDATE boards
         SET tldraw_snapshot = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(JSON.stringify(snapshot), updatedAt, boardId, expectedRevision)

    if (result.changes === 0) {
      const current = this.get(boardId)
      if (!current) throw new Error(`Board ${boardId} was not found`)
      throw new RevisionConflictError(current.revision)
    }

    return this.get(boardId)!
  }

  /**
   * tldraw rooms are the authoritative writer for free-form canvas changes.
   * Unlike a REST save, this is already serialized by one room per Board and
   * must not depend on a browser-held compare-and-swap revision.
   */
  saveRealtimeSnapshot(boardId: string, snapshot: unknown): StoredBoard {
    const updatedAt = new Date().toISOString()
    const result = this.database
      .prepare(
        `UPDATE boards
         SET tldraw_snapshot = ?, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(snapshot), updatedAt, boardId)
    if (result.changes === 0) throw new Error(`Board ${boardId} was not found`)
    return this.get(boardId)!
  }

  rename(boardId: string, title: string): StoredBoard {
    const result = this.database
      .prepare('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, new Date().toISOString(), boardId)
    if (result.changes === 0) throw new Error(`Board ${boardId} was not found`)
    return this.get(boardId)!
  }

  remove(projectId: string, boardId: string): boolean {
    const project = this.database
      .prepare('SELECT root_board_id FROM projects WHERE id = ?')
      .get(projectId) as { root_board_id: string } | undefined
    if (!project) throw new Error(`Project ${projectId} was not found`)
    if (project.root_board_id === boardId) {
      throw new BoardReferenceGraphError('ROOT_BOARD_DELETE_FORBIDDEN', { boardId })
    }

    const inboundReferences = this.database
      .prepare('SELECT id FROM board_references WHERE project_id = ? AND target_board_id = ? ORDER BY id')
      .all(projectId, boardId) as Array<{ id: string }>
    if (inboundReferences.length > 0) {
      throw new BoardReferenceGraphError('BOARD_REFERENCED', {
        boardId,
        inboundReferenceIds: inboundReferences.map((reference) => reference.id),
      })
    }

    return this.database.transaction(() => {
      const removed = this.database.prepare('DELETE FROM boards WHERE id = ? AND project_id = ?').run(boardId, projectId).changes > 0
      if (removed) {
        const row = this.database.prepare('SELECT navigation_json FROM projects WHERE id = ?').get(projectId) as { navigation_json: string | null }
        if (row.navigation_json) this.database.prepare('UPDATE projects SET navigation_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(removeNavigationBoard(JSON.parse(row.navigation_json) as ProjectNavigation, boardId)), new Date().toISOString(), projectId)
      }
      return removed
    })()
  }
}
