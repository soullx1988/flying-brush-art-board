import { randomUUID } from 'node:crypto'

import {
  planCreateBoardReference,
  planCreateEmbeddedBoard,
  planRemoveBoardReference,
  planUpdateBoardReference,
  type BoardReferenceKind,
  type BoardReferenceRecord,
  type StoredBoard,
} from '@infinite-board/board-core'
import {
  BoardReferenceConsistencyError,
  assertBoardReferenceSnapshotConsistent,
  getBoardReferenceShape,
  insertBoardReferenceShape,
  removeBoardReferenceShape,
  updateBoardReferenceShape,
} from '@infinite-board/tldraw-adapter'

import type { LocalDatabase } from '../../db/schema.js'
import { BoardRepository } from '../boards/board-repository.js'
import { BoardReferenceRepository } from './board-reference-repository.js'
import type { BoardDocumentCoordinator } from '../realtime/board-document-coordinator.js'

export interface CreateBoardReferenceCommand {
  sourceBoardId: string
  targetBoardId: string
  shapeId: string
  kind: BoardReferenceKind
  expectedRevision: number
  placement?: { x: number; y: number }
  actorOpenId?: string
}

export interface UpdateBoardReferenceCommand {
  referenceId: string
  targetBoardId?: string
  kind?: BoardReferenceKind
  expectedRevision: number
  actorOpenId?: string
}

export interface RemoveBoardReferenceCommand {
  referenceId: string
  expectedRevision: number
  actorOpenId?: string
}

export interface CreateEmbeddedBoardReferenceCommand {
  sourceBoardId: string
  board: StoredBoard
  shapeId: string
  expectedRevision: number
  placement?: { x: number; y: number }
  actorOpenId?: string
}

export interface BoardReferenceMutationResult {
  reference: BoardReferenceRecord
  boardId: string
  revision: number
  snapshot: unknown
}

export interface BoardReferenceServicePort {
  create(command: CreateBoardReferenceCommand): Promise<BoardReferenceMutationResult>
  createEmbeddedBoard(command: CreateEmbeddedBoardReferenceCommand): Promise<BoardReferenceMutationResult>
  update(command: UpdateBoardReferenceCommand): Promise<BoardReferenceMutationResult>
  remove(command: RemoveBoardReferenceCommand): Promise<BoardReferenceMutationResult>
}

export class BoardReferenceMutationUnavailableError extends Error {
  readonly code = 'BOARD_REFERENCE_COMMAND_REQUIRED'

  constructor() {
    super('BOARD_REFERENCE_COMMAND_REQUIRED')
    this.name = 'BoardReferenceMutationUnavailableError'
  }
}

export class BoardReferenceCommandError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code)
    this.name = 'BoardReferenceCommandError'
  }
}

export interface BoardReferenceServiceOptions {
  createId?: () => string
  now?: () => string
  coordinator?: BoardDocumentCoordinator
}

export class BoardReferenceService implements BoardReferenceServicePort {
  private readonly createId: () => string
  private readonly now: () => string
  private readonly coordinator: BoardDocumentCoordinator | undefined

  constructor(
    private readonly database: LocalDatabase,
    private readonly boards: BoardRepository,
    private readonly references: BoardReferenceRepository,
    options: BoardReferenceServiceOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
    this.coordinator = options.coordinator
  }

  async create(command: CreateBoardReferenceCommand): Promise<BoardReferenceMutationResult> {
    const source = this.requireBoard(command.sourceBoardId)
    const target = this.requireBoard(command.targetBoardId)
    const timestamp = this.now()
    const reference: BoardReferenceRecord = {
      id: this.createId(),
      projectId: source.projectId,
      sourceBoardId: source.id,
      targetBoardId: target.id,
      shapeId: command.shapeId,
      kind: command.kind,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const projectBoards = this.boards.listByProject(source.projectId)
    const projectReferences = this.references.listByProject(source.projectId)
    this.assertValidPlan(planCreateBoardReference({
      boards: projectBoards,
      references: projectReferences,
      reference,
    }))
    if (this.coordinator) {
      const committed = await this.coordinator.runCommand({
        boardId: source.id,
        actorOpenId: command.actorOpenId ?? 'system',
        reason: 'board-reference-create',
        expectedRevision: command.expectedRevision,
        mutate: async (snapshot) => {
          const nextSnapshot = insertBoardReferenceShape(snapshot, reference, target.title, command.placement)
          assertBoardReferenceSnapshotConsistent(nextSnapshot, [...this.references.listOutbound(source.id), reference])
          return { snapshot: nextSnapshot, result: reference, commit: () => { this.references.create(reference) } }
        },
      })
      return { reference: committed.result, boardId: source.id, revision: committed.revision, snapshot: committed.snapshot }
    }
    const nextSnapshot = insertBoardReferenceShape(
      source.tldrawSnapshot,
      reference,
      target.title,
      command.placement,
    )
    assertBoardReferenceSnapshotConsistent(nextSnapshot, [
      ...this.references.listOutbound(source.id),
      reference,
    ])

    const saved = this.database.transaction(() => {
      this.references.create(reference)
      return this.boards.saveSnapshot(source.id, command.expectedRevision, nextSnapshot)
    })()
    return this.result(reference, saved)
  }

  async createEmbeddedBoard(
    command: CreateEmbeddedBoardReferenceCommand,
  ): Promise<BoardReferenceMutationResult> {
    const source = this.requireBoard(command.sourceBoardId)
    const timestamp = this.now()
    const board: StoredBoard = {
      ...command.board,
      projectId: source.projectId,
      revision: 0,
      createdAt: command.board.createdAt || timestamp,
      updatedAt: command.board.updatedAt || timestamp,
    }
    // A newly-created target has no separately supplied reference rows.  Its
    // snapshot therefore may contain ordinary tldraw records, but never a
    // board-reference shape; allowing one would persist an unbacked edge.
    this.assertSnapshotConsistent(board.tldrawSnapshot, [])
    const reference: BoardReferenceRecord = {
      id: this.createId(),
      projectId: source.projectId,
      sourceBoardId: source.id,
      targetBoardId: board.id,
      shapeId: command.shapeId,
      kind: 'embed',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const projectBoards = this.boards.listByProject(source.projectId)
    const projectReferences = this.references.listByProject(source.projectId)
    this.assertValidPlan(planCreateEmbeddedBoard({
      boards: projectBoards,
      references: projectReferences,
      board,
      reference,
    }))
    if (this.coordinator) {
      const committed = await this.coordinator.runCommand({
        boardId: source.id,
        actorOpenId: command.actorOpenId ?? 'system',
        reason: 'board-reference-create-embedded',
        expectedRevision: command.expectedRevision,
        mutate: async (snapshot) => {
          const nextSnapshot = insertBoardReferenceShape(snapshot, reference, board.title, command.placement)
          assertBoardReferenceSnapshotConsistent(nextSnapshot, [...this.references.listOutbound(source.id), reference])
          return {
            snapshot: nextSnapshot,
            result: reference,
            commit: () => { this.boards.create(board); this.references.create(reference) },
          }
        },
      })
      return { reference: committed.result, boardId: source.id, revision: committed.revision, snapshot: committed.snapshot }
    }
    const nextSnapshot = insertBoardReferenceShape(
      source.tldrawSnapshot,
      reference,
      board.title,
      command.placement,
    )
    assertBoardReferenceSnapshotConsistent(nextSnapshot, [
      ...this.references.listOutbound(source.id),
      reference,
    ])

    const saved = this.database.transaction(() => {
      this.boards.create(board)
      this.references.create(reference)
      return this.boards.saveSnapshot(source.id, command.expectedRevision, nextSnapshot)
    })()
    return this.result(reference, saved)
  }

  async update(command: UpdateBoardReferenceCommand): Promise<BoardReferenceMutationResult> {
    const current = this.requireReference(command.referenceId)
    const source = this.requireBoard(current.sourceBoardId)
    this.assertReferenceMutable(source, current)
    const target = this.requireBoard(command.targetBoardId ?? current.targetBoardId)
    const reference: BoardReferenceRecord = {
      ...current,
      targetBoardId: target.id,
      kind: command.kind ?? current.kind,
      updatedAt: this.now(),
    }
    this.assertValidPlan(planUpdateBoardReference({
      boards: this.boards.listByProject(current.projectId),
      references: this.references.listByProject(current.projectId),
      reference,
    }))
    if (this.coordinator) {
      const committed = await this.coordinator.runCommand({
        boardId: source.id,
        actorOpenId: command.actorOpenId ?? 'system',
        reason: 'board-reference-update',
        expectedRevision: command.expectedRevision,
        mutate: async (snapshot) => {
          const nextSnapshot = updateBoardReferenceShape(snapshot, reference, target.title)
          const nextOutbound = this.references.listOutbound(source.id).map((candidate) => candidate.id === reference.id ? reference : candidate)
          assertBoardReferenceSnapshotConsistent(nextSnapshot, nextOutbound)
          return {
            snapshot: nextSnapshot,
            result: reference,
            commit: () => { this.references.update(reference.id, { targetBoardId: reference.targetBoardId, kind: reference.kind, updatedAt: reference.updatedAt }) },
          }
        },
      })
      return { reference: committed.result, boardId: source.id, revision: committed.revision, snapshot: committed.snapshot }
    }
    const nextSnapshot = updateBoardReferenceShape(source.tldrawSnapshot, reference, target.title)
    const nextOutbound = this.references
      .listOutbound(source.id)
      .map((candidate) => (candidate.id === reference.id ? reference : candidate))
    assertBoardReferenceSnapshotConsistent(nextSnapshot, nextOutbound)

    const saved = this.database.transaction(() => {
      this.references.update(reference.id, {
        targetBoardId: reference.targetBoardId,
        kind: reference.kind,
        updatedAt: reference.updatedAt,
      })
      return this.boards.saveSnapshot(source.id, command.expectedRevision, nextSnapshot)
    })()
    return this.result(reference, saved)
  }

  async remove(command: RemoveBoardReferenceCommand): Promise<BoardReferenceMutationResult> {
    const reference = this.requireReference(command.referenceId)
    const source = this.requireBoard(reference.sourceBoardId)
    this.assertReferenceMutable(source, reference)
    this.assertValidPlan(planRemoveBoardReference({
      references: this.references.listByProject(reference.projectId),
      referenceId: reference.id,
    }))
    if (this.coordinator) {
      const committed = await this.coordinator.runCommand({
        boardId: source.id,
        actorOpenId: command.actorOpenId ?? 'system',
        reason: 'board-reference-remove',
        expectedRevision: command.expectedRevision,
        mutate: async (snapshot) => {
          const nextSnapshot = removeBoardReferenceShape(snapshot, reference.shapeId)
          assertBoardReferenceSnapshotConsistent(nextSnapshot, this.references.listOutbound(source.id).filter((candidate) => candidate.id !== reference.id))
          return {
            snapshot: nextSnapshot,
            result: reference,
            commit: () => {
              if (!this.references.remove(reference.id)) throw new BoardReferenceCommandError('BOARD_REFERENCE_NOT_FOUND', { referenceId: reference.id })
            },
          }
        },
      })
      return { reference: committed.result, boardId: source.id, revision: committed.revision, snapshot: committed.snapshot }
    }
    const nextSnapshot = removeBoardReferenceShape(source.tldrawSnapshot, reference.shapeId)
    assertBoardReferenceSnapshotConsistent(
      nextSnapshot,
      this.references.listOutbound(source.id).filter((candidate) => candidate.id !== reference.id),
    )

    const saved = this.database.transaction(() => {
      if (!this.references.remove(reference.id)) {
        throw new BoardReferenceCommandError('BOARD_REFERENCE_NOT_FOUND', { referenceId: reference.id })
      }
      return this.boards.saveSnapshot(source.id, command.expectedRevision, nextSnapshot)
    })()
    return this.result(reference, saved)
  }

  private requireBoard(boardId: string): StoredBoard {
    const board = this.boards.get(boardId)
    if (!board) throw new BoardReferenceCommandError('BOARD_NOT_FOUND', { boardId })
    return board
  }

  private requireReference(referenceId: string): BoardReferenceRecord {
    const reference = this.references.get(referenceId)
    if (!reference) {
      throw new BoardReferenceCommandError('BOARD_REFERENCE_NOT_FOUND', { referenceId })
    }
    return reference
  }

  private assertReferenceMutable(source: StoredBoard, reference: BoardReferenceRecord): void {
    const shape = getBoardReferenceShape(source.tldrawSnapshot, reference.shapeId)
    const meta = shape?.meta as { protectedCore?: unknown } | undefined
    if (meta?.protectedCore === true) {
      throw new BoardReferenceCommandError('PROTECTED_CORE_MUTATION_FORBIDDEN', {
        referenceId: reference.id,
        shapeId: reference.shapeId,
      })
    }
  }

  private assertValidPlan(plan: ReturnType<typeof planCreateBoardReference>): void {
    if (!plan.validation.ok) {
      throw new BoardReferenceCommandError(plan.validation.error.code, { ...plan.validation.error.details })
    }
  }

  private assertSnapshotConsistent(snapshot: unknown, references: readonly BoardReferenceRecord[]): void {
    try {
      assertBoardReferenceSnapshotConsistent(snapshot, references)
    } catch (error) {
      if (error instanceof BoardReferenceConsistencyError) {
        throw new BoardReferenceCommandError(error.code, { ...error.details })
      }
      throw error
    }
  }

  private result(reference: BoardReferenceRecord, board: StoredBoard): BoardReferenceMutationResult {
    return {
      reference,
      boardId: board.id,
      revision: board.revision,
      snapshot: board.tldrawSnapshot,
    }
  }
}
