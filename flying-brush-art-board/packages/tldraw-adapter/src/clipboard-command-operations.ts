import type { BoardReferenceRecord, CopiedBoardReference } from '@infinite-board/board-core'

import {
  degradeBoardReferenceShape,
  updateBoardReferenceShape,
} from './board-reference-snapshot-operations.js'

export function applyClipboardReferenceRecords(
  snapshot: unknown,
  references: readonly BoardReferenceRecord[],
  titlesByBoardId: ReadonlyMap<string, string> = new Map(),
): unknown {
  return references.reduce(
    (current, reference) =>
      updateBoardReferenceShape(
        current,
        reference,
        titlesByBoardId.get(reference.targetBoardId) ?? 'Linked board',
      ),
    snapshot,
  )
}

export function boardReferenceUrl(projectId: string, boardId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}`
}

export function downgradeClipboardReferenceRecords(
  snapshot: unknown,
  candidates: readonly CopiedBoardReference[],
  _sourceProjectId: string,
): unknown {
  return candidates.reduce(
    (current, candidate) =>
      degradeBoardReferenceShape(
        current,
        candidate.shapeId,
        '',
      ),
    snapshot,
  )
}
