import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LocalDatabase } from '../../db/schema.js'
import { assertAssetContentValid, AssetContentValidationError } from './asset-content-validation.js'

export interface StoredAsset {
  sha256: string
  mime: string
  size: number
  createdAt: string
}

export interface AssetUsageRecord {
  projectId: string
  boardId: string
  shapeId: string
  assetRecordId: string
  sha256: string
  createdAt: string
}

export interface PutAssetMetadata {
  mime: string
  createdAt: string
  ownerOpenId?: string
}

export type RemoveOwnedAssetResult = 'not-owned' | 'in-use' | 'released' | 'removed'

export interface TransactionalAssetPut {
  asset: StoredAsset
  rollbackFile(): void
}

export interface StoredAssetPutResult {
  asset: StoredAsset
  created: boolean
}

export interface MaterializeAssetForBoardInput extends PutAssetMetadata {
  projectId: string
  boardId: string
  shapeId: string
  assetRecordId: string
  bytes: Uint8Array
}

interface AssetRow {
  sha256: string
  mime: string
  size: number
  created_at: string
}

interface AssetUsageRow {
  project_id: string
  board_id: string
  shape_id: string
  asset_record_id: string
  sha256: string
  created_at: string
}

function toAsset(row: AssetRow): StoredAsset {
  return { sha256: row.sha256, mime: row.mime, size: row.size, createdAt: row.created_at }
}

function toUsage(row: AssetUsageRow): AssetUsageRecord {
  return {
    projectId: row.project_id,
    boardId: row.board_id,
    shapeId: row.shape_id,
    assetRecordId: row.asset_record_id,
    sha256: row.sha256,
    createdAt: row.created_at,
  }
}

export class AssetHashMetadataMismatchError extends Error {
  readonly code = 'ASSET_HASH_METADATA_MISMATCH'

  constructor() {
    super('ASSET_HASH_METADATA_MISMATCH')
    this.name = 'AssetHashMetadataMismatchError'
  }
}

export class AssetStoredContentMismatchError extends Error {
  readonly code = 'ASSET_STORED_CONTENT_MISMATCH'

  constructor() {
    super('ASSET_STORED_CONTENT_MISMATCH')
    this.name = 'AssetStoredContentMismatchError'
  }
}

export class AssetUsageRepository {
  constructor(private readonly database: LocalDatabase) {}

  create(usage: AssetUsageRecord): AssetUsageRecord {
    this.database
      .prepare(
        `INSERT INTO asset_usages (
          project_id, board_id, shape_id, asset_record_id, sha256, created_at
        ) VALUES (
          @projectId, @boardId, @shapeId, @assetRecordId, @sha256, @createdAt
        )`,
      )
      .run(usage)
    return usage
  }

  listByProject(projectId: string): AssetUsageRecord[] {
    return (
      this.database.prepare('SELECT * FROM asset_usages WHERE project_id = ? ORDER BY board_id, shape_id').all(projectId) as AssetUsageRow[]
    ).map(toUsage)
  }

  listBySha256(sha256: string): AssetUsageRecord[] {
    return (
      this.database.prepare('SELECT * FROM asset_usages WHERE sha256 = ? ORDER BY project_id, board_id').all(sha256) as AssetUsageRow[]
    ).map(toUsage)
  }
}

export class AssetRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly assetDirectory: string,
  ) {
    mkdirSync(assetDirectory, { recursive: true })
  }

  get(sha256: string): StoredAsset | undefined {
    const row = this.database.prepare('SELECT * FROM assets WHERE sha256 = ?').get(sha256) as AssetRow | undefined
    return row ? toAsset(row) : undefined
  }

  readBytes(sha256: string): Uint8Array | undefined {
    const asset = this.get(sha256)
    if (!asset) return undefined
    const path = join(this.assetDirectory, sha256)
    if (!existsSync(path)) return undefined
    const bytes = new Uint8Array(readFileSync(path))
    if (bytes.byteLength !== asset.size || this.hash(bytes) !== sha256) return undefined
    try {
      assertAssetContentValid(bytes, asset.mime)
      return bytes
    } catch (error) {
      if (error instanceof AssetContentValidationError) return undefined
      throw error
    }
  }

  putByHash(bytes: Uint8Array, metadata: PutAssetMetadata): StoredAsset {
    return this.putByHashWithResult(bytes, metadata).asset
  }

  putByHashWithResult(bytes: Uint8Array, metadata: PutAssetMetadata): StoredAssetPutResult {
    assertAssetContentValid(bytes, metadata.mime)
    const sha256 = this.hash(bytes)
    const existedBefore = Boolean(this.get(sha256))
    const createdFile = this.writeContentIfMissing(sha256, bytes)

    try {
      const persist = this.database.transaction(() => {
        const asset = this.insertOrValidateAsset(sha256, bytes, metadata)
        if (metadata.ownerOpenId) this.claimUploadOwnership(sha256, metadata.ownerOpenId, metadata.createdAt)
        return asset
      })
      const asset = persist()
      return { asset, created: !existedBefore }
    } catch (error) {
      this.compensateFile(sha256, createdFile)
      throw error
    }
  }

  removeIfUnused(sha256: string): boolean {
    const remove = this.database.transaction(() => {
      const usage = this.database.prepare('SELECT 1 FROM asset_usages WHERE sha256 = ? LIMIT 1').get(sha256)
      if (usage) return false
      return this.database.prepare('DELETE FROM assets WHERE sha256 = ?').run(sha256).changes > 0
    })
    const removed = remove()
    if (removed) rmSync(join(this.assetDirectory, sha256), { force: true })
    return removed
  }

  hasUploadOwnership(sha256: string, ownerOpenId: string | undefined): boolean {
    if (!ownerOpenId) return false
    return Boolean(this.database.prepare(
      'SELECT 1 FROM asset_upload_owners WHERE sha256 = ? AND owner_open_id = ? LIMIT 1',
    ).get(sha256, ownerOpenId))
  }

  removeUnusedOwnedBy(sha256: string, ownerOpenId: string): RemoveOwnedAssetResult {
    const remove = this.database.transaction((): RemoveOwnedAssetResult => {
      if (!this.hasUploadOwnership(sha256, ownerOpenId)) return 'not-owned'
      if (this.database.prepare('SELECT 1 FROM asset_usages WHERE sha256 = ? LIMIT 1').get(sha256)) return 'in-use'

      this.database.prepare('DELETE FROM asset_upload_owners WHERE sha256 = ? AND owner_open_id = ?')
        .run(sha256, ownerOpenId)
      if (this.database.prepare('SELECT 1 FROM asset_upload_owners WHERE sha256 = ? LIMIT 1').get(sha256)) {
        return 'released'
      }
      const removed = this.database.prepare('DELETE FROM assets WHERE sha256 = ?').run(sha256).changes > 0
      return removed ? 'removed' : 'not-owned'
    })
    const result = remove()
    if (result === 'removed') rmSync(join(this.assetDirectory, sha256), { force: true })
    return result
  }

  /**
   * Stores an asset while a caller-owned SQLite transaction is active. Call
   * `rollbackFile` only after that transaction has rolled back.
   */
  putByHashInTransaction(bytes: Uint8Array, metadata: PutAssetMetadata): TransactionalAssetPut {
    assertAssetContentValid(bytes, metadata.mime)
    const sha256 = this.hash(bytes)
    const existedBefore = Boolean(this.get(sha256))
    const createdFile = this.writeContentIfMissing(sha256, bytes)

    try {
      const asset = this.insertOrValidateAsset(sha256, bytes, metadata)
      if (metadata.ownerOpenId) this.claimUploadOwnership(sha256, metadata.ownerOpenId, metadata.createdAt)
      return {
        asset,
        rollbackFile: () => {
          if (createdFile && !existedBefore) rmSync(join(this.assetDirectory, sha256), { force: true })
        },
      }
    } catch (error) {
      this.compensateFile(sha256, createdFile)
      throw error
    }
  }

  materializeForBoard(input: MaterializeAssetForBoardInput): StoredAsset {
    assertAssetContentValid(input.bytes, input.mime)
    const sha256 = this.hash(input.bytes)
    const createdFile = this.writeContentIfMissing(sha256, input.bytes)

    try {
      const writeUsage = this.database.transaction(() => {
        const asset = this.insertOrValidateAsset(sha256, input.bytes, input)
        new AssetUsageRepository(this.database).create({
          projectId: input.projectId,
          boardId: input.boardId,
          shapeId: input.shapeId,
          assetRecordId: input.assetRecordId,
          sha256,
          createdAt: input.createdAt,
        })
        return asset
      })
      return writeUsage()
    } catch (error) {
      this.compensateFile(sha256, createdFile)
      throw error
    }
  }

  private hash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
  }

  private writeContentIfMissing(sha256: string, bytes: Uint8Array): boolean {
    const path = join(this.assetDirectory, sha256)
    if (existsSync(path)) {
      const existing = new Uint8Array(readFileSync(path))
      if (existing.byteLength !== bytes.byteLength || this.hash(existing) !== sha256) {
        throw new AssetStoredContentMismatchError()
      }
      return false
    }

    const temporaryPath = `${path}.tmp-${process.pid}`
    writeFileSync(temporaryPath, bytes)
    renameSync(temporaryPath, path)
    return true
  }

  private insertOrValidateAsset(sha256: string, bytes: Uint8Array, metadata: PutAssetMetadata): StoredAsset {
    const existing = this.get(sha256)
    if (existing) {
      if (existing.mime !== metadata.mime || existing.size !== bytes.byteLength) {
        throw new AssetHashMetadataMismatchError()
      }
      return existing
    }

    const asset: StoredAsset = {
      sha256,
      mime: metadata.mime,
      size: bytes.byteLength,
      createdAt: metadata.createdAt,
    }
    this.database
      .prepare('INSERT INTO assets (sha256, mime, size, created_at) VALUES (@sha256, @mime, @size, @createdAt)')
      .run(asset)
    return asset
  }

  private claimUploadOwnership(sha256: string, ownerOpenId: string, createdAt: string): void {
    const normalizedOwner = ownerOpenId.trim()
    if (!normalizedOwner) throw new Error('ASSET_OWNER_REQUIRED')
    this.database.prepare(`INSERT INTO asset_upload_owners(sha256,owner_open_id,created_at)
      VALUES (?,?,?) ON CONFLICT(sha256,owner_open_id) DO NOTHING`)
      .run(sha256, normalizedOwner, createdAt)
  }

  private compensateFile(sha256: string, createdFile: boolean): void {
    if (!createdFile || this.get(sha256)) return
    rmSync(join(this.assetDirectory, sha256), { force: true })
  }
}
