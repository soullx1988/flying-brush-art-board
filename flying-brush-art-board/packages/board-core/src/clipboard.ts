import type { BoardReferenceKind, BoardReferenceRecord } from './board-reference.js'

export interface CopiedBoardReference {
  shapeId: string
  referenceId: string
  targetBoardId: string
  kind: BoardReferenceKind
}

export interface ClipboardAsset {
  assetRecordId: string
  sha256: string
  mime: string
  size: number
  /** The serialized tldraw asset record needed to recreate this resource. */
  record: Record<string, unknown>
  sourceUrl?: string
}

export interface BoardClipboardPayload {
  version: 1
  sourceProjectId: string
  sourceBoardId: string
  shapes: unknown[]
  bindings: unknown[]
  references: CopiedBoardReference[]
  assets: ClipboardAsset[]
  copiedAt: string
}

export interface ClipboardPasteRequest {
  payload: BoardClipboardPayload
  expectedRevision: number
  /** Per application instance ID used to scope undo/redo command receipts. */
  sessionId: string
  placement: { x: number; y: number } | { viewportCenter: true }
}

export interface ClipboardCommandReplayRequest {
  expectedRevision: number
  sessionId: string
}

export interface MaterializedClipboardPatch {
  nextSnapshot: unknown
  idMap: Record<string, string>
  assetBlobs: Array<{
    sha256: string
    mime: string
    size: number
    bytes: Uint8Array
  }>
  assetUsages: Array<{
    shapeId: string
    assetRecordId: string
    sha256: string
  }>
  referenceCandidates: CopiedBoardReference[]
}

export interface ClipboardDowngradeReport {
  code: 'CLIPBOARD_REFERENCE_DOWNGRADED_CROSS_PROJECT'
  shapeIds: string[]
}

export interface ClipboardReferenceDraft extends Omit<
  BoardReferenceRecord,
  'createdAt' | 'updatedAt'
> {}

export interface ClipboardReferencePastePlan {
  references: ClipboardReferenceDraft[]
  downgrade?: ClipboardDowngradeReport
}

export interface PlanCopiedBoardReferencesInput {
  sourceProjectId: string
  targetProjectId: string
  targetBoardId: string
  candidates: readonly CopiedBoardReference[]
  createId: () => string
}

export function planCopiedBoardReferences(
  input: PlanCopiedBoardReferencesInput,
): ClipboardReferencePastePlan {
  if (input.sourceProjectId !== input.targetProjectId) {
    return {
      references: [],
      downgrade: {
        code: 'CLIPBOARD_REFERENCE_DOWNGRADED_CROSS_PROJECT',
        shapeIds: input.candidates.map((candidate) => candidate.shapeId),
      },
    }
  }

  return {
    references: input.candidates.map((candidate) => ({
      id: input.createId(),
      projectId: input.targetProjectId,
      sourceBoardId: input.targetBoardId,
      targetBoardId: candidate.targetBoardId,
      shapeId: input.createId(),
      kind: candidate.kind,
    })),
  }
}
