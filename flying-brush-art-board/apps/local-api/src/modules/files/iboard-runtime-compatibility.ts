import {
  inspectAndDecodeIboard,
  type IboardArchiveReadLimits,
  type IboardInspectAnalysis,
  type ImportInspectionIssue,
} from '@infinite-board/interop'
import {
  createBoardStore,
  getStoreSnapshot,
  loadSnapshotIntoStore,
} from '@infinite-board/tldraw-adapter'

export const IBOARD_BOARD_SNAPSHOT_UNSUPPORTED = 'IBOARD_BOARD_SNAPSHOT_UNSUPPORTED'

interface IboardSnapshotCarrier {
  id: string
  tldrawSnapshot: unknown
}

export class IboardBoardSnapshotUnsupportedError extends Error {
  readonly code = IBOARD_BOARD_SNAPSHOT_UNSUPPORTED

  constructor(
    readonly boardId: string,
    readonly snapshotCause: unknown,
  ) {
    super(`${IBOARD_BOARD_SNAPSHOT_UNSUPPORTED}:${boardId}`)
    this.name = 'IboardBoardSnapshotUnsupportedError'
  }
}

export function assertIboardBoardSnapshotsSupported(
  boards: readonly IboardSnapshotCarrier[],
): void {
  for (const board of boards) {
    try {
      const store = createBoardStore()
      loadSnapshotIntoStore(store, board.tldrawSnapshot)
    } catch (error) {
      throw new IboardBoardSnapshotUnsupportedError(board.id, error)
    }
  }
}

export function normalizeIboardBoardSnapshot(snapshot: unknown): unknown {
  const store = createBoardStore()
  loadSnapshotIntoStore(store, snapshot)
  return getStoreSnapshot(store)
}

function unsupportedSnapshotIssue(boardId: string): ImportInspectionIssue {
  return {
    code: IBOARD_BOARD_SNAPSHOT_UNSUPPORTED,
    message: `画板快照与当前版本不兼容：${boardId}`,
    action: '请使用当前版本重新导出 .iboard 文件，或升级应用后重试。',
  }
}

/**
 * Structural .iboard compatibility is necessary but insufficient: a decoded
 * snapshot must also load into the exact pinned store schema used by web and
 * realtime. Keep that runtime-specific check at the local-api boundary so the
 * interop package does not acquire a circular dependency on tldraw-adapter.
 */
export function analyzeIboardForImport(
  bytes: Uint8Array,
  limits: IboardArchiveReadLimits = {},
): IboardInspectAnalysis {
  const analysis = inspectAndDecodeIboard(bytes, limits)
  if (!analysis.decoded) return analysis

  try {
    assertIboardBoardSnapshotsSupported(analysis.decoded.boards)
    return analysis
  } catch (error) {
    if (!(error instanceof IboardBoardSnapshotUnsupportedError)) throw error
    return {
      inspection: {
        ...analysis.inspection,
        compatible: false,
        issues: [unsupportedSnapshotIssue(error.boardId)],
      },
    }
  }
}
