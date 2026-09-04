import {
  BoardReferenceGraphError,
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
  access_level?: 'project' | 'owner-only' | null
  owner_open_id?: string | null
}

function toBoard(row: BoardRow): StoredBoard {
  const base: StoredBoard = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    tldrawSnapshot: JSON.parse(row.tldraw_snapshot) as unknown,
    accessLevel: row.access_level === 'owner-only' ? 'owner-only' : 'project',
    ...(row.owner_open_id ? { ownerOpenId: row.owner_open_id } : {}),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  if (row.source_metadata) {
    return { ...base, sourceMetadata: JSON.parse(row.source_metadata) as ImportSource }
  }

  return base
}

type SnapshotRecord = Record<string, unknown>

function snapshotRecords(snapshot: unknown): Record<string, SnapshotRecord> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const envelope = snapshot as { store?: unknown; document?: { store?: unknown } }
  const store = envelope.document?.store ?? envelope.store
  if (!store || typeof store !== 'object' || Array.isArray(store)) return {}
  return Object.fromEntries(Object.entries(store).filter((entry): entry is [string, SnapshotRecord] => (
    Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1])
  )))
}

function recordMeta(record: SnapshotRecord): Record<string, unknown> {
  return record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta)
    ? record.meta as Record<string, unknown>
    : {}
}

function recordProps(record: SnapshotRecord): Record<string, unknown> {
  return record.props && typeof record.props === 'object' && !Array.isArray(record.props)
    ? record.props as Record<string, unknown>
    : {}
}

export function protectedCoreRecordId(snapshot: unknown): string | undefined {
  return Object.entries(snapshotRecords(snapshot))
    .find(([, record]) => recordMeta(record).protectedCore === true)?.[0]
}

function assertProtectedCorePreserved(
  currentSnapshot: unknown,
  nextSnapshot: unknown,
  allowProtectedCoreBootstrap = false,
): void {
  const current = snapshotRecords(currentSnapshot)
  const next = snapshotRecords(nextSnapshot)
  if (!allowProtectedCoreBootstrap) {
    for (const [recordId, record] of Object.entries(next)) {
      if (recordMeta(record).protectedCore === true && recordMeta(current[recordId] ?? {}).protectedCore !== true) {
        throw new ProtectedCoreMutationError(recordId, 'introduced')
      }
    }
  }
  for (const [recordId, record] of Object.entries(current)) {
    const meta = recordMeta(record)
    if (meta.protectedCore !== true) continue
    const candidate = next[recordId]
    if (!candidate) throw new ProtectedCoreMutationError(recordId, 'removed')

    const nextMeta = recordMeta(candidate)
    if (
      candidate.typeName !== record.typeName
      || candidate.type !== record.type
      || candidate.parentId !== record.parentId
      || candidate.opacity !== record.opacity
      || nextMeta.protectedCore !== true
      || nextMeta.template !== meta.template
      || nextMeta.templateRole !== meta.templateRole
    ) {
      throw new ProtectedCoreMutationError(recordId, 'identity-changed')
    }

    const props = recordProps(record)
    const nextProps = recordProps(candidate)
    if (record.type === 'trading-panel' && nextProps.panelKind !== props.panelKind) {
      throw new ProtectedCoreMutationError(recordId, 'panel-kind-changed')
    }
    if (record.type === 'board-reference' && (
      nextProps.referenceId !== props.referenceId
      || nextProps.targetBoardId !== props.targetBoardId
      || nextProps.kind !== props.kind
    )) {
      throw new ProtectedCoreMutationError(recordId, 'reference-changed')
    }
  }
}

export class RevisionConflictError extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number) {
    super('REVISION_CONFLICT')
    this.name = 'RevisionConflictError'
    this.currentRevision = currentRevision
  }
}

export class ProtectedCoreMutationError extends Error {
  readonly code = 'PROTECTED_CORE_MUTATION_FORBIDDEN'

  constructor(readonly recordId: string, readonly reason: string) {
    super('PROTECTED_CORE_MUTATION_FORBIDDEN')
    this.name = 'ProtectedCoreMutationError'
  }
}

export class BoardRepository {
  constructor(private readonly database: LocalDatabase) {}

  create(board: StoredBoard): StoredBoard {
    return this.createInternal(board, false)
  }

  /** Only the versioned workspace bootstrap may create a board containing a protected record. */
  createTemplate(board: StoredBoard): StoredBoard {
    return this.createInternal(board, true)
  }

  private createInternal(board: StoredBoard, allowProtectedCoreBootstrap: boolean): StoredBoard {
    assertProtectedCorePreserved({}, board.tldrawSnapshot, allowProtectedCoreBootstrap)
    const accessLevel = board.accessLevel === 'owner-only' ? 'owner-only' : 'project'
    const ownerOpenId = board.ownerOpenId?.trim()
    if (accessLevel === 'owner-only' && !ownerOpenId) throw new Error('BOARD_OWNER_REQUIRED')
    const create = this.database.transaction(() => {
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
      this.database.prepare(`INSERT INTO board_access_policies
        (board_id,access_level,owner_open_id,created_at,updated_at) VALUES (?,?,?,?,?)`)
        .run(board.id, accessLevel, accessLevel === 'owner-only' ? ownerOpenId : null, board.createdAt, board.updatedAt)
    })
    create()
    return this.get(board.id)!
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
      accessLevel: source.accessLevel ?? 'project',
      ...(source.ownerOpenId ? { ownerOpenId: source.ownerOpenId } : {}),
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
    const row = this.database.prepare(`SELECT boards.*, board_access_policies.access_level, board_access_policies.owner_open_id
      FROM boards LEFT JOIN board_access_policies ON board_access_policies.board_id = boards.id
      WHERE boards.id = ?`).get(boardId) as BoardRow | undefined
    return row ? toBoard(row) : undefined
  }

  listByProject(projectId: string): StoredBoard[] {
    return (
      this.database.prepare(`SELECT boards.*, board_access_policies.access_level, board_access_policies.owner_open_id
        FROM boards LEFT JOIN board_access_policies ON board_access_policies.board_id = boards.id
        WHERE boards.project_id = ? ORDER BY boards.id`).all(projectId) as BoardRow[]
    ).map(toBoard)
  }

  saveSnapshot(boardId: string, expectedRevision: number, snapshot: unknown): StoredBoard {
    return this.saveSnapshotInternal(boardId, expectedRevision, snapshot, false)
  }

  /** Only the versioned workspace bootstrap may introduce a protected record. */
  saveTemplateSnapshot(boardId: string, expectedRevision: number, snapshot: unknown): StoredBoard {
    return this.saveSnapshotInternal(boardId, expectedRevision, snapshot, true)
  }

  private saveSnapshotInternal(
    boardId: string,
    expectedRevision: number,
    snapshot: unknown,
    allowProtectedCoreBootstrap: boolean,
  ): StoredBoard {
    const current = this.get(boardId)
    if (!current) throw new Error(`Board ${boardId} was not found`)
    if (current.revision !== expectedRevision) throw new RevisionConflictError(current.revision)
    assertProtectedCorePreserved(current.tldrawSnapshot, snapshot, allowProtectedCoreBootstrap)
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
   * Room projections and structural commands share one content revision so
   * every whole-snapshot CAS, destructive preview, and undo remains invalidated
   * by a newer collaborative edit. Identical room echoes are no-ops: loading a
   * committed command snapshot back into the room must not consume a second
   * revision.
   */
  saveRealtimeSnapshot(boardId: string, snapshot: unknown): StoredBoard {
    const serializedSnapshot = JSON.stringify(snapshot)
    const updatedAt = new Date().toISOString()
    return this.database.transaction(() => {
      const current = this.database.prepare('SELECT tldraw_snapshot FROM boards WHERE id = ?')
        .get(boardId) as { tldraw_snapshot: string } | undefined
      if (!current) throw new Error(`Board ${boardId} was not found`)
      if (current.tldraw_snapshot === serializedSnapshot) return this.get(boardId)!
      assertProtectedCorePreserved(JSON.parse(current.tldraw_snapshot) as unknown, snapshot)

      this.database
        .prepare(
          `UPDATE boards
           SET tldraw_snapshot = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(serializedSnapshot, updatedAt, boardId)
      return this.get(boardId)!
    })()
  }

  rename(boardId: string, title: string): StoredBoard {
    const result = this.database
      .prepare('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, new Date().toISOString(), boardId)
    if (result.changes === 0) throw new Error(`Board ${boardId} was not found`)
    return this.get(boardId)!
  }

  setAccess(boardId: string, accessLevel: 'project' | 'owner-only', ownerOpenId?: string): StoredBoard {
    const board = this.get(boardId)
    if (!board) throw new Error(`Board ${boardId} was not found`)
    const normalizedOwner = ownerOpenId?.trim()
    if (accessLevel === 'owner-only' && !normalizedOwner) throw new Error('BOARD_OWNER_REQUIRED')
    const timestamp = new Date().toISOString()
    this.database.prepare(`INSERT INTO board_access_policies
      (board_id,access_level,owner_open_id,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(board_id) DO UPDATE SET
        access_level=excluded.access_level,
        owner_open_id=excluded.owner_open_id,
        updated_at=excluded.updated_at`)
      .run(boardId, accessLevel, accessLevel === 'owner-only' ? normalizedOwner : null, timestamp, timestamp)
    return this.get(boardId)!
  }

  remove(projectId: string, boardId: string): boolean {
    const project = this.database
      .prepare('SELECT root_board_id FROM projects WHERE id = ?')
      .get(projectId) as { root_board_id: string } | undefined
    if (!project) throw new Error(`Project ${projectId} was not found`)

    const board = this.database
      .prepare('SELECT tldraw_snapshot FROM boards WHERE id = ? AND project_id = ?')
      .get(boardId, projectId) as { tldraw_snapshot: string } | undefined
    if (board) {
      const recordId = protectedCoreRecordId(JSON.parse(board.tldraw_snapshot) as unknown)
      if (recordId) throw new ProtectedCoreMutationError(recordId, 'board-delete')
    }

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

    return (
      this.database.prepare('DELETE FROM boards WHERE id = ? AND project_id = ?').run(boardId, projectId).changes > 0
    )
  }
}
