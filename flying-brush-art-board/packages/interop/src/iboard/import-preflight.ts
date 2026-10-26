import { createHash } from 'node:crypto'

import {
  assertBoardReferenceGraphValid,
  assertProjectNavigationValid,
  type BoardReferenceRecord,
  type StoredBoard,
} from '@infinite-board/board-core'
import {
  assertIboardAssetUsagesValid,
  assertIboardReferenceShapesConsistent,
  IboardAssetValidationError,
} from './export-project.js'
import {
  assertSafeIboardArchivePath,
  parseIboardJson,
  readIboardArchive,
  requireIboardArchiveEntry,
  type IboardArchiveReadLimits,
} from './archive-reader.js'
import {
  parseIboardBoardV1,
  parseIboardManifestV1,
  parseIboardReferencesV1,
  type IboardAssetInputV1,
  type IboardAssetUsageV1,
  type IboardBoardV1,
  type IboardManifestV1,
} from './schema-v1.js'

export interface IboardPreflightBoard extends IboardBoardV1 {
  id: string
  projectId: string
}

export interface IboardPreflightResult {
  manifest: IboardManifestV1
  boards: IboardPreflightBoard[]
  references: BoardReferenceRecord[]
  assets: IboardAssetInputV1[]
}

export type IboardPreflightLimits = IboardArchiveReadLimits

function assertUniqueManifestEntries(manifest: IboardManifestV1): void {
  const boardIds = new Set<string>()
  const paths = new Set<string>(['manifest.json', manifest.referencesPath])
  for (const board of manifest.boards) {
    if (boardIds.has(board.id)) throw new Error('IBOARD_BOARD_DUPLICATE_ID')
    boardIds.add(board.id)
    assertSafeIboardArchivePath(board.path)
    if (board.path !== `boards/${board.id}.json`) throw new Error('IBOARD_BOARD_PATH_INVALID')
    if (paths.has(board.path)) throw new Error('IBOARD_ARCHIVE_DUPLICATE_PATH')
    paths.add(board.path)
  }
  if (!boardIds.has(manifest.rootBoardId)) throw new Error('IBOARD_ROOT_BOARD_NOT_FOUND')

  const assetHashes = new Set<string>()
  for (const asset of manifest.assets) {
    if (assetHashes.has(asset.sha256)) throw new Error('IBOARD_ASSET_DUPLICATE_HASH')
    assetHashes.add(asset.sha256)
    assertSafeIboardArchivePath(asset.path)
    if (asset.path !== `assets/${asset.sha256}`) throw new Error('IBOARD_ASSET_PATH_INVALID')
    if (paths.has(asset.path)) throw new Error('IBOARD_ARCHIVE_DUPLICATE_PATH')
    paths.add(asset.path)
  }
}

function asStoredBoards(boards: readonly IboardPreflightBoard[]): StoredBoard[] {
  return boards.map((board) => ({
    ...board,
    createdAt: '',
    updatedAt: '',
  }))
}

function compareUsage(left: IboardAssetUsageV1, right: IboardAssetUsageV1): number {
  const byBoard = left.boardId.localeCompare(right.boardId)
  if (byBoard !== 0) return byBoard
  const byShape = left.shapeId.localeCompare(right.shapeId)
  return byShape !== 0 ? byShape : left.assetRecordId.localeCompare(right.assetRecordId)
}

export function preflightIboardEntries(
  entries: Record<string, Uint8Array>,
): IboardPreflightResult {
  const paths = Object.keys(entries)

  const manifest = parseIboardManifestV1(
    parseIboardJson(requireIboardArchiveEntry(entries, 'manifest.json'), 'IBOARD_MANIFEST_JSON_INVALID'),
  )
  assertUniqueManifestEntries(manifest)
  if (manifest.navigation) assertProjectNavigationValid(manifest.navigation, manifest.boards.map((board) => board.id))
  const declaredPaths = new Set([
    'manifest.json',
    manifest.referencesPath,
    ...manifest.boards.map((board) => board.path),
    ...manifest.assets.map((asset) => asset.path),
  ])
  if (paths.some((path) => !declaredPaths.has(path))) throw new Error('IBOARD_ARCHIVE_ENTRY_UNDECLARED')

  const boards = manifest.boards
    .map((descriptor): IboardPreflightBoard => ({
      id: descriptor.id,
      projectId: manifest.projectId,
      ...parseIboardBoardV1(
        parseIboardJson(requireIboardArchiveEntry(entries, descriptor.path), 'IBOARD_BOARD_JSON_INVALID'),
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const references = parseIboardReferencesV1(
    parseIboardJson(requireIboardArchiveEntry(entries, manifest.referencesPath), 'IBOARD_REFERENCES_JSON_INVALID'),
  ).sort((left, right) => left.id.localeCompare(right.id))
  const assets = manifest.assets
    .map((descriptor): IboardAssetInputV1 => {
      const bytes = requireIboardArchiveEntry(entries, descriptor.path)
      const actualHash = createHash('sha256').update(bytes).digest('hex')
      if (actualHash !== descriptor.sha256 || bytes.byteLength !== descriptor.size) {
        throw new IboardAssetValidationError(descriptor.sha256)
      }
      return {
        sha256: descriptor.sha256,
        mime: descriptor.mime,
        size: descriptor.size,
        bytes,
        usages: [...descriptor.usages].sort(compareUsage),
      }
    })
    .sort((left, right) => left.sha256.localeCompare(right.sha256))

  const storedBoards = asStoredBoards(boards)
  assertBoardReferenceGraphValid(storedBoards, references)
  assertIboardReferenceShapesConsistent(storedBoards, references)
  assertIboardAssetUsagesValid(assets, boards)

  return { manifest, boards, references, assets }
}

export function preflightIboardImport(
  archive: Uint8Array,
  limits: IboardPreflightLimits = {},
): IboardPreflightResult {
  return preflightIboardEntries(readIboardArchive(archive, limits))
}
