import { createHash, randomUUID } from 'node:crypto'

import {
  planPasteBoardClipboard,
  type BoardClipboardPayload,
  type BoardReferenceRecord,
  type ClipboardDowngradeReport,
  type MaterializedClipboardPatch,
  type StoredBoard,
} from '@infinite-board/board-core'
import {
  applyClipboardReferenceRecords,
  assertBoardReferenceSnapshotConsistent,
  downgradeClipboardReferenceRecords,
} from '@infinite-board/tldraw-adapter'

import type { LocalDatabase } from '../../db/schema.js'
import {
  AssetHashMetadataMismatchError,
  AssetRepository,
  AssetUsageRepository,
  type TransactionalAssetPut,
} from '../assets/asset-repository.js'
import { BoardRepository, RevisionConflictError } from '../boards/board-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'

export interface ClipboardCommandReceipt {
  commandId: string
  boardId: string
  revision: number
  snapshot: unknown
  idMap: Record<string, string>
  createdReferenceIds: string[]
  downgrade?: ClipboardDowngradeReport
}

export interface ClipboardReferencePasteContext {
  sourceProjectId: string
  sourceBoardId: string
  copiedAt: string
}

interface StoredClipboardReceipt {
  commandId: string
  sessionId: string
  boardId: string
  beforeSnapshot: unknown
  afterSnapshot: unknown
  assetUsages: MaterializedClipboardPatch['assetUsages']
  references: BoardReferenceRecord[]
  downgrade?: ClipboardDowngradeReport
  expiresAt: number
  state: 'applied' | 'undone'
}

interface PreparedClipboardPaste {
  nextSnapshot: unknown
  references: BoardReferenceRecord[]
  downgrade?: ClipboardDowngradeReport
}

export class ClipboardCommandExpiredError extends Error {
  readonly code = 'CLIPBOARD_COMMAND_EXPIRED'

  constructor() {
    super('CLIPBOARD_COMMAND_EXPIRED')
    this.name = 'ClipboardCommandExpiredError'
  }
}

export class StaleClipboardCommandError extends Error {
  readonly code = 'STALE_CLIPBOARD_COMMAND'

  constructor() {
    super('STALE_CLIPBOARD_COMMAND')
    this.name = 'StaleClipboardCommandError'
  }
}

export class ClipboardReferenceInvalidError extends Error {
  readonly code = 'CLIPBOARD_REFERENCE_INVALID'

  constructor(readonly validation: { code: string; details: Record<string, unknown> }) {
    super('CLIPBOARD_REFERENCE_INVALID')
    this.name = 'ClipboardReferenceInvalidError'
  }
}

export class ClipboardCommandService {
  private readonly receipts = new Map<string, StoredClipboardReceipt>()
  private readonly references: BoardReferenceRepository
  private readonly receiptTtlMs: number

  constructor(
    private readonly database: LocalDatabase,
    private readonly boards: BoardRepository,
    private readonly assets: AssetRepository,
    referencesOrReceiptTtl?: BoardReferenceRepository | number,
    receiptTtlMs = 10 * 60 * 1000,
  ) {
    this.references =
      referencesOrReceiptTtl instanceof BoardReferenceRepository
        ? referencesOrReceiptTtl
        : new BoardReferenceRepository(database)
    this.receiptTtlMs =
      typeof referencesOrReceiptTtl === 'number' ? referencesOrReceiptTtl : receiptTtlMs
  }

  applyMaterializedClipboardCommand(
    boardId: string,
    expectedRevision: number,
    patch: MaterializedClipboardPatch,
    sessionId: string,
    referenceContext?: ClipboardReferencePasteContext,
  ): ClipboardCommandReceipt {
    const board = this.boards.get(boardId)
    if (!board) throw new Error(`Board ${boardId} was not found`)
    if (board.revision !== expectedRevision) throw new RevisionConflictError(board.revision)

    this.validateAssetBlobs(patch)
    const prepared = this.prepareReferencePaste(board.id, patch, referenceContext)
    const usages = new AssetUsageRepository(this.database)
    const commandId = randomUUID()
    const storedAssets: TransactionalAssetPut[] = []

    const commit = this.database.transaction(() => {
      for (const asset of patch.assetBlobs) {
        storedAssets.push(
          this.assets.putByHashInTransaction(asset.bytes, { mime: asset.mime, createdAt: new Date().toISOString() }),
        )
      }
      for (const reference of prepared.references) this.references.create(reference)
      const savedBoard = this.boards.saveSnapshot(boardId, expectedRevision, prepared.nextSnapshot)
      for (const usage of patch.assetUsages) {
        usages.create({
          projectId: board.projectId,
          boardId,
          shapeId: usage.shapeId,
          assetRecordId: usage.assetRecordId,
          sha256: usage.sha256,
          createdAt: new Date().toISOString(),
        })
      }
      return savedBoard
    })
    const savedBoard = (() => {
      try {
        return commit()
      } catch (error) {
        for (const storedAsset of storedAssets.reverse()) storedAsset.rollbackFile()
        throw error
      }
    })()
    this.receipts.set(commandId, {
      commandId,
      sessionId,
      boardId,
      beforeSnapshot: board.tldrawSnapshot,
      afterSnapshot: prepared.nextSnapshot,
      assetUsages: patch.assetUsages,
      references: prepared.references,
      ...(prepared.downgrade ? { downgrade: prepared.downgrade } : {}),
      expiresAt: Date.now() + this.receiptTtlMs,
      state: 'applied',
    })

    return {
      commandId,
      boardId,
      revision: savedBoard.revision,
      snapshot: savedBoard.tldrawSnapshot,
      idMap: patch.idMap,
      createdReferenceIds: prepared.references.map((reference) => reference.id),
      ...(prepared.downgrade ? { downgrade: prepared.downgrade } : {}),
    }
  }

  createBoardAndApplyMaterializedClipboardCommand(
    board: StoredBoard,
    patch: MaterializedClipboardPatch,
    sessionId: string,
    referenceContext?: ClipboardReferencePasteContext,
  ): ClipboardCommandReceipt {
    if (board.revision !== 0) throw new RevisionConflictError(board.revision)

    this.validateAssetBlobs(patch)
    const usages = new AssetUsageRepository(this.database)
    const commandId = randomUUID()
    const storedAssets: TransactionalAssetPut[] = []
    let prepared: PreparedClipboardPaste | undefined

    const commit = this.database.transaction(() => {
      this.boards.create(board)
      prepared = this.prepareReferencePaste(board.id, patch, referenceContext)
      for (const asset of patch.assetBlobs) {
        storedAssets.push(
          this.assets.putByHashInTransaction(asset.bytes, { mime: asset.mime, createdAt: new Date().toISOString() }),
        )
      }
      for (const reference of prepared.references) this.references.create(reference)
      const savedBoard = this.boards.saveSnapshot(board.id, 0, prepared.nextSnapshot)
      for (const usage of patch.assetUsages) {
        usages.create({
          projectId: board.projectId,
          boardId: board.id,
          shapeId: usage.shapeId,
          assetRecordId: usage.assetRecordId,
          sha256: usage.sha256,
          createdAt: new Date().toISOString(),
        })
      }
      return savedBoard
    })
    const savedBoard = (() => {
      try {
        return commit()
      } catch (error) {
        for (const storedAsset of storedAssets.reverse()) storedAsset.rollbackFile()
        throw error
      }
    })()
    const committed = prepared!
    this.receipts.set(commandId, {
      commandId,
      sessionId,
      boardId: board.id,
      beforeSnapshot: board.tldrawSnapshot,
      afterSnapshot: committed.nextSnapshot,
      assetUsages: patch.assetUsages,
      references: committed.references,
      ...(committed.downgrade ? { downgrade: committed.downgrade } : {}),
      expiresAt: Date.now() + this.receiptTtlMs,
      state: 'applied',
    })

    return {
      commandId,
      boardId: board.id,
      revision: savedBoard.revision,
      snapshot: savedBoard.tldrawSnapshot,
      idMap: patch.idMap,
      createdReferenceIds: committed.references.map((reference) => reference.id),
      ...(committed.downgrade ? { downgrade: committed.downgrade } : {}),
    }
  }

  undo(commandId: string, expectedRevision: number, sessionId: string): ClipboardCommandReceipt {
    const receipt = this.getActiveReceipt(commandId, 'applied', sessionId)
    const board = this.boards.get(receipt.boardId)
    if (!board) throw new ClipboardCommandExpiredError()
    if (board.revision !== expectedRevision) throw new RevisionConflictError(board.revision)
    const usageRepository = new AssetUsageRepository(this.database)

    const commit = this.database.transaction(() => {
      const savedBoard = this.boards.saveSnapshot(receipt.boardId, expectedRevision, receipt.beforeSnapshot)
      for (const usage of receipt.assetUsages) {
        this.database
          .prepare(
            `DELETE FROM asset_usages
             WHERE project_id = ? AND board_id = ? AND shape_id = ? AND asset_record_id = ? AND sha256 = ?`,
          )
          .run(board.projectId, receipt.boardId, usage.shapeId, usage.assetRecordId, usage.sha256)
      }
      for (const reference of receipt.references) {
        if (!this.references.remove(reference.id)) throw new StaleClipboardCommandError()
      }
      return savedBoard
    })
    const savedBoard = commit()
    void usageRepository
    receipt.state = 'undone'

    return {
      commandId,
      boardId: receipt.boardId,
      revision: savedBoard.revision,
      snapshot: savedBoard.tldrawSnapshot,
      idMap: {},
      createdReferenceIds: receipt.references.map((reference) => reference.id),
      ...(receipt.downgrade ? { downgrade: receipt.downgrade } : {}),
    }
  }

  redo(commandId: string, expectedRevision: number, sessionId: string): ClipboardCommandReceipt {
    const receipt = this.getActiveReceipt(commandId, 'undone', sessionId)
    const board = this.boards.get(receipt.boardId)
    if (!board) throw new ClipboardCommandExpiredError()
    if (board.revision !== expectedRevision) throw new RevisionConflictError(board.revision)
    const usages = new AssetUsageRepository(this.database)

    const commit = this.database.transaction(() => {
      const savedBoard = this.boards.saveSnapshot(receipt.boardId, expectedRevision, receipt.afterSnapshot)
      for (const usage of receipt.assetUsages) {
        usages.create({
          projectId: board.projectId,
          boardId: receipt.boardId,
          shapeId: usage.shapeId,
          assetRecordId: usage.assetRecordId,
          sha256: usage.sha256,
          createdAt: new Date().toISOString(),
        })
      }
      for (const reference of receipt.references) this.references.create(reference)
      return savedBoard
    })
    const savedBoard = commit()
    receipt.state = 'applied'

    return {
      commandId,
      boardId: receipt.boardId,
      revision: savedBoard.revision,
      snapshot: savedBoard.tldrawSnapshot,
      idMap: {},
      createdReferenceIds: receipt.references.map((reference) => reference.id),
      ...(receipt.downgrade ? { downgrade: receipt.downgrade } : {}),
    }
  }

  getCommandBoardId(commandId: string, sessionId: string): string {
    const receipt = this.receipts.get(commandId)
    if (!receipt || receipt.expiresAt < Date.now()) {
      this.receipts.delete(commandId)
      throw new ClipboardCommandExpiredError()
    }
    if (receipt.sessionId !== sessionId) throw new ClipboardCommandExpiredError()
    return receipt.boardId
  }

  private getActiveReceipt(
    commandId: string,
    expectedState: StoredClipboardReceipt['state'],
    sessionId: string,
  ): StoredClipboardReceipt {
    const receipt = this.receipts.get(commandId)
    if (!receipt || receipt.expiresAt < Date.now()) {
      this.receipts.delete(commandId)
      throw new ClipboardCommandExpiredError()
    }
    // Treat another application session exactly like an absent/expired
    // receipt, so a command ID cannot be replayed or probed cross-session.
    if (receipt.sessionId !== sessionId) throw new ClipboardCommandExpiredError()
    if (receipt.state !== expectedState) throw new StaleClipboardCommandError()
    return receipt
  }

  private validateAssetBlobs(patch: MaterializedClipboardPatch): void {
    for (const asset of patch.assetBlobs) {
      const sha256 = createHash('sha256').update(asset.bytes).digest('hex')
      if (sha256 !== asset.sha256 || asset.bytes.byteLength !== asset.size) {
        throw new AssetHashMetadataMismatchError()
      }
    }
  }

  private prepareReferencePaste(
    boardId: string,
    patch: MaterializedClipboardPatch,
    referenceContext?: ClipboardReferencePasteContext,
  ): PreparedClipboardPaste {
    if (patch.referenceCandidates.length === 0) {
      return { nextSnapshot: patch.nextSnapshot, references: [] }
    }

    const board = this.boards.get(boardId)!
    if (!referenceContext) {
      throw new ClipboardReferenceInvalidError({
        code: 'CLIPBOARD_FORMAT_UNSUPPORTED',
        details: {},
      })
    }
    const project = new ProjectRepository(this.database).get(board.projectId)
    if (!project) throw new Error(`Project ${board.projectId} was not found`)
    const payload: BoardClipboardPayload = {
      version: 1,
      sourceProjectId: referenceContext.sourceProjectId,
      sourceBoardId: referenceContext.sourceBoardId,
      shapes: [],
      bindings: [],
      references: patch.referenceCandidates,
      assets: [],
      copiedAt: referenceContext.copiedAt,
    }
    let callIndex = 0
    const createId = () => {
      const candidateIndex = Math.floor(callIndex / 2)
      const isShapeId = callIndex++ % 2 === 1
      return isShapeId
        ? patch.referenceCandidates[candidateIndex]!.shapeId
        : randomUUID()
    }
    const plan = planPasteBoardClipboard({
      project,
      boards: this.boards.listByProject(project.id),
      references: this.references.listByProject(project.id),
      targetBoardId: boardId,
      payload,
      createId,
      createdAt: payload.copiedAt,
      assetUsages: patch.assetUsages,
    })
    if (!plan.validation.ok) {
      throw new ClipboardReferenceInvalidError({
        code: plan.validation.error.code,
        details: { ...plan.validation.error.details },
      })
    }
    if (plan.downgrade) {
      return {
        nextSnapshot: downgradeClipboardReferenceRecords(
          patch.nextSnapshot,
          patch.referenceCandidates,
          referenceContext.sourceProjectId,
        ),
        references: [],
        downgrade: plan.downgrade,
      }
    }

    const references = [...plan.mutations.references.create]
    const titles = new Map(
      this.boards.listByProject(project.id).map((candidate) => [candidate.id, candidate.title]),
    )
    const nextSnapshot = applyClipboardReferenceRecords(patch.nextSnapshot, references, titles)
    assertBoardReferenceSnapshotConsistent(nextSnapshot, [
      ...this.references.listOutbound(boardId),
      ...references,
    ])
    return { nextSnapshot, references }
  }
}
