import type { BoardReferenceKind, BoardReferenceRecord } from '@infinite-board/board-core'

import type { LocalDatabase } from '../../db/schema.js'

interface ReferenceRow {
  id: string
  project_id: string
  source_board_id: string
  target_board_id: string
  shape_id: string
  kind: BoardReferenceKind
  created_at: string
  updated_at: string
}

function toReference(row: ReferenceRow): BoardReferenceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceBoardId: row.source_board_id,
    targetBoardId: row.target_board_id,
    shapeId: row.shape_id,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface UpdateBoardReferenceInput {
  targetBoardId?: string
  shapeId?: string
  kind?: BoardReferenceKind
  updatedAt?: string
}

export class BoardReferenceRepository {
  constructor(private readonly database: LocalDatabase) {}

  create(reference: BoardReferenceRecord): BoardReferenceRecord {
    this.database
      .prepare(
        `INSERT INTO board_references (
          id, project_id, source_board_id, target_board_id, shape_id, kind, created_at, updated_at
        ) VALUES (
          @id, @projectId, @sourceBoardId, @targetBoardId, @shapeId, @kind, @createdAt, @updatedAt
        )`,
      )
      .run(reference)
    return reference
  }

  get(referenceId: string): BoardReferenceRecord | undefined {
    const row = this.database.prepare('SELECT * FROM board_references WHERE id = ?').get(referenceId) as
      | ReferenceRow
      | undefined
    return row ? toReference(row) : undefined
  }

  listByProject(projectId: string): BoardReferenceRecord[] {
    return (
      this.database.prepare('SELECT * FROM board_references WHERE project_id = ? ORDER BY id').all(projectId) as ReferenceRow[]
    ).map(toReference)
  }

  listInbound(boardId: string): BoardReferenceRecord[] {
    return (
      this.database.prepare('SELECT * FROM board_references WHERE target_board_id = ? ORDER BY id').all(boardId) as ReferenceRow[]
    ).map(toReference)
  }

  listOutbound(boardId: string): BoardReferenceRecord[] {
    return (
      this.database.prepare('SELECT * FROM board_references WHERE source_board_id = ? ORDER BY id').all(boardId) as ReferenceRow[]
    ).map(toReference)
  }

  hasInbound(boardId: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM board_references WHERE target_board_id = ? LIMIT 1').get(boardId))
  }

  update(referenceId: string, input: UpdateBoardReferenceInput): BoardReferenceRecord {
    const current = this.get(referenceId)
    if (!current) throw new Error(`Reference ${referenceId} was not found`)

    const next = {
      ...current,
      targetBoardId: input.targetBoardId ?? current.targetBoardId,
      shapeId: input.shapeId ?? current.shapeId,
      kind: input.kind ?? current.kind,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    }
    this.database
      .prepare(
        `UPDATE board_references
         SET target_board_id = @targetBoardId, shape_id = @shapeId, kind = @kind, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run(next)
    return next
  }

  remove(referenceId: string): boolean {
    return this.database.prepare('DELETE FROM board_references WHERE id = ?').run(referenceId).changes > 0
  }
}
