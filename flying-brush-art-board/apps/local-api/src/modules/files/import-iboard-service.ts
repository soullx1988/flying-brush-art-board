import {
  createIboardMergePlan,
  type DecodedIboardProject,
  type IboardMergeIdMap,
} from '@infinite-board/interop'

import type { LocalDatabase } from '../../db/schema.js'
import {
  AssetRepository,
  AssetUsageRepository,
  type TransactionalAssetPut,
} from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import {
  assertIboardBoardSnapshotsSupported,
  normalizeIboardBoardSnapshot,
} from './iboard-runtime-compatibility.js'

export type IboardMergeFaultPoint =
  | 'asset-materialize'
  | 'id-remap'
  | 'third-board'
  | 'reference'
  | 'database-commit'

export interface IboardMergeCommitRequest {
  targetProjectId: string
  database: LocalDatabase
  assets: AssetRepository
  namespace: string
  now?: () => string
  faultAt?: IboardMergeFaultPoint
}

export interface IboardMergeCommitResult {
  targetProjectId: string
  importedRootBoardId: string
  importedBoardIds: string[]
  importedReferenceIds: string[]
  importedBoardCount: number
  importedReferenceCount: number
  idMap: IboardMergeIdMap
}

function injectFault(actual: IboardMergeFaultPoint, configured?: IboardMergeFaultPoint): void {
  if (configured === actual) throw new Error(`IBOARD_IMPORT_FAULT:${actual}`)
}

export async function commitIboardMerge(
  decoded: DecodedIboardProject,
  request: IboardMergeCommitRequest,
): Promise<IboardMergeCommitResult> {
  const projects = new ProjectRepository(request.database)
  if (!projects.get(request.targetProjectId)) throw new Error('IBOARD_TARGET_PROJECT_NOT_FOUND')

  injectFault('id-remap', request.faultAt)
  const plan = createIboardMergePlan(decoded, {
    targetProjectId: request.targetProjectId,
    namespace: request.namespace,
  })
  // Defense in depth for direct service callers and for any incompatibility
  // introduced by ID remapping. This must happen before assets or DB rows are
  // materialized so an unsupported archive fails atomically.
  assertIboardBoardSnapshotsSupported(plan.boards)
  const normalizedBoards = plan.boards.map((board) => ({
    ...board,
    // 中文注释：导入边界先做一次 runtime 规范化，避免首次打开画板时再发生脏写。
    tldrawSnapshot: normalizeIboardBoardSnapshot(board.tldrawSnapshot),
  }))
  injectFault('asset-materialize', request.faultAt)

  const timestamp = (request.now ?? (() => new Date().toISOString()))()
  const boards = new BoardRepository(request.database)
  const references = new BoardReferenceRepository(request.database)
  const usages = new AssetUsageRepository(request.database)
  const materialized: TransactionalAssetPut[] = []

  try {
    return request.database.transaction((): IboardMergeCommitResult => {
      for (const asset of plan.assets) {
        const put = request.assets.putByHashInTransaction(asset.bytes, {
          mime: asset.mime,
          createdAt: timestamp,
        })
        if (put.asset.sha256 !== asset.sha256) throw new Error('ASSET_HASH_METADATA_MISMATCH')
        materialized.push(put)
      }

      for (const [index, board] of normalizedBoards.entries()) {
        boards.create({
          ...board,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        if (index === 2) injectFault('third-board', request.faultAt)
      }

      for (const [index, reference] of plan.references.entries()) {
        references.create(reference)
        if (index === 0) injectFault('reference', request.faultAt)
      }

      for (const asset of plan.assets) {
        for (const usage of asset.usages) {
          usages.create({
            projectId: request.targetProjectId,
            boardId: usage.boardId,
            shapeId: usage.shapeId,
            assetRecordId: usage.assetRecordId,
            sha256: asset.sha256,
            createdAt: timestamp,
          })
        }
      }

      injectFault('database-commit', request.faultAt)
      return {
        targetProjectId: request.targetProjectId,
        importedRootBoardId: plan.importedRootBoardId,
        importedBoardIds: Object.values(plan.idMap.boards),
        importedReferenceIds: Object.values(plan.idMap.references),
        importedBoardCount: plan.boards.length,
        importedReferenceCount: plan.references.length,
        idMap: plan.idMap,
      }
    })()
  } catch (error) {
    for (const put of materialized.reverse()) put.rollbackFile()
    throw error
  }
}
