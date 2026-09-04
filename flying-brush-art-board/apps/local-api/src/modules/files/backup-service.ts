import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import {
  assertBoardReferenceGraphValid,
  type BoardReferenceRecord,
  type ProjectRecord,
  type StoredBoard,
} from '@infinite-board/board-core'
import { exportProjectToIboard, type IboardAssetInputV1 } from '@infinite-board/interop'
import { assertBoardReferenceSnapshotConsistent } from '@infinite-board/tldraw-adapter'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { assertAssetContentValid, AssetContentValidationError } from '../assets/asset-content-validation.js'
import { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'

export interface BackupProjectArchive {
  projectId: string
  path: string
}

export interface BackupRecord {
  directory: string
  databasePath: string
  assetDirectory: string
  projectArchives: BackupProjectArchive[]
}

export interface RestoreValidation {
  database: 'ok'
  referenceGraph: 'ok'
  referenceShapes: 'ok'
  collaboration: 'ok'
}

export interface RestoreResult {
  restorePointDirectory: string
  validation: RestoreValidation
}

export interface BackupServiceOptions {
  database: LocalDatabase
  databasePath: string
  assetDirectory: string
  backupRootDirectory: string
  now?: () => string
  retention?: { daily: number; weekly: number }
}

export class BackupValidationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'BackupValidationError'
  }
}

function exportedAssets(database: LocalDatabase, assets: AssetRepository, projectId: string): IboardAssetInputV1[] {
  const usagesByHash = new Map<string, ReturnType<AssetUsageRepository['listByProject']>>()
  for (const usage of new AssetUsageRepository(database).listByProject(projectId)) {
    const usages = usagesByHash.get(usage.sha256) ?? []
    usages.push(usage)
    usagesByHash.set(usage.sha256, usages)
  }

  return [...usagesByHash.entries()].map(([sha256, usages]) => {
    const asset = assets.get(sha256)
    const bytes = assets.readBytes(sha256)
    if (!asset || !bytes) throw new BackupValidationError(`BACKUP_ASSET_MISSING:${sha256}`)
    return {
      sha256,
      mime: asset.mime,
      size: asset.size,
      bytes,
      usages: usages.map((usage) => ({
        boardId: usage.boardId,
        shapeId: usage.shapeId,
        assetRecordId: usage.assetRecordId,
      })),
    }
  })
}

function timestampDirectoryPart(timestamp: string): string {
  return timestamp.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '') || 'backup'
}

function projectArchiveFileName(projectId: string): string {
  return `project-${createHash('sha256').update(projectId).digest('hex')}.iboard`
}

function copyDirectory(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  if (!existsSync(source)) return
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    cpSync(join(source, entry.name), join(destination, entry.name), { recursive: true })
  }
}

function removeSqliteSidecars(databasePath: string): void {
  rmSync(`${databasePath}-wal`, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
}

function createOfflineDatabaseBackup(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new Database(sourcePath, { readonly: true })
  return source.backup(destinationPath).then(() => undefined).finally(() => source.close())
}

interface BackupRetentionRecord {
  directory: string
  createdAt: Date
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function utcWeek(value: Date): string {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function readBackupRetentionRecords(root: string): BackupRetentionRecord[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith('backup-')) return []
    const directory = join(root, entry.name)
    try {
      if (!statSync(directory).isDirectory()) return []
      const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as { createdAt?: unknown }
      const createdAt = typeof manifest.createdAt === 'string' ? new Date(manifest.createdAt) : undefined
      return createdAt && !Number.isNaN(createdAt.getTime()) ? [{ directory, createdAt }] : []
    } catch {
      // A directory without a valid manifest may be a manually recovered
      // backup. Never delete it automatically.
      return []
    }
  })
}

/**
 * Backs up a running application's SQLite connection through SQLite's backup
 * API. Restore is intentionally offline: the caller must stop the local API
 * first, then reopen boards from the project home after it returns.
 */
export class BackupService {
  private readonly now: () => string
  private readonly retention: { daily: number; weekly: number }

  constructor(private readonly options: BackupServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.retention = options.retention ?? { daily: 7, weekly: 4 }
  }

  async createBackup(): Promise<BackupRecord> {
    mkdirSync(this.options.backupRootDirectory, { recursive: true })
    const directory = mkdtempSync(join(this.options.backupRootDirectory, `backup-${timestampDirectoryPart(this.now())}-`))
    const databasePath = join(directory, 'database.sqlite')
    const assetDirectory = join(directory, 'assets')
    const projectDirectory = join(directory, 'projects')

    try {
      await this.options.database.backup(databasePath)
      copyDirectory(this.options.assetDirectory, assetDirectory)
      mkdirSync(projectDirectory, { recursive: true })
      this.validateDatabaseAndAssets(databasePath, assetDirectory)

      const snapshot = new Database(databasePath, { readonly: true })
      let projectArchives: BackupProjectArchive[]
      try {
        const assets = new AssetRepository(snapshot, assetDirectory)
        const boards = new BoardRepository(snapshot)
        const references = new BoardReferenceRepository(snapshot)
        projectArchives = new ProjectRepository(snapshot).list().map((project) => {
          const archivePath = join(projectDirectory, projectArchiveFileName(project.id))
          const archive = exportProjectToIboard({
            project,
            boards: boards.listByProject(project.id),
            references: references.listByProject(project.id),
            assets: exportedAssets(snapshot, assets, project.id),
          })
          writeFileSync(archivePath, archive)
          return { projectId: project.id, path: archivePath }
        })
      } finally {
        snapshot.close()
      }

      writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
        format: 1,
        createdAt: this.now(),
        database: basename(databasePath),
        assets: 'assets',
        projects: projectArchives.map((archive) => ({ projectId: archive.projectId, path: `projects/${basename(archive.path)}` })),
      }, null, 2))

      this.pruneBackups()
      return { directory, databasePath, assetDirectory, projectArchives }
    } catch (error) {
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
  }

  private pruneBackups(): void {
    const records = readBackupRetentionRecords(this.options.backupRootDirectory)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    const keep = new Set<string>()
    const daily = new Set<string>()
    const weekly = new Set<string>()
    for (const record of records) {
      const day = utcDay(record.createdAt)
      if (daily.size < this.retention.daily && !daily.has(day)) {
        daily.add(day)
        keep.add(record.directory)
      }
    }
    for (const record of records) {
      if (keep.has(record.directory)) continue
      const week = utcWeek(record.createdAt)
      if (weekly.size < this.retention.weekly && !weekly.has(week)) {
        weekly.add(week)
        keep.add(record.directory)
      }
    }
    for (const record of records) {
      if (!keep.has(record.directory)) rmSync(record.directory, { recursive: true, force: true })
    }
  }

  async restoreBackup(backupDirectory: string): Promise<RestoreResult> {
    const backupDatabasePath = join(backupDirectory, 'database.sqlite')
    const assetDirectory = join(backupDirectory, 'assets')
    if (!existsSync(backupDatabasePath) || !existsSync(assetDirectory)) {
      throw new BackupValidationError('BACKUP_INCOMPLETE')
    }

    // Never migrate the user's backup in place. A staging copy accepts older
    // supported schemas, runs the current recorded migrations, and is fully
    // validated before a restore point or live file is touched.
    mkdirSync(this.options.backupRootDirectory, { recursive: true })
    const stagingDirectory = mkdtempSync(join(this.options.backupRootDirectory, '.restore-stage-'))
    const databasePath = join(stagingDirectory, 'database.sqlite')
    try {
      await createOfflineDatabaseBackup(backupDatabasePath, databasePath)
      const migrated = createDatabase(databasePath)
      migrated.close()
      this.validateDatabaseAndAssets(databasePath, assetDirectory)

      const restoreRoot = join(this.options.backupRootDirectory, 'restore-points')
      mkdirSync(restoreRoot, { recursive: true })
      const restorePointDirectory = mkdtempSync(join(restoreRoot, `restore-${timestampDirectoryPart(this.now())}-`))
      const restorePointDatabase = join(restorePointDirectory, 'database.sqlite')
      const restorePointAssets = join(restorePointDirectory, 'assets')
      const assetParentDirectory = dirname(this.options.assetDirectory)
      mkdirSync(assetParentDirectory, { recursive: true })
      const temporaryAssets = mkdtempSync(join(assetParentDirectory, '.infinite-board-restore-assets-'))
      const previousAssets = `${this.options.assetDirectory}.before-restore`

      try {
        await createOfflineDatabaseBackup(this.options.databasePath, restorePointDatabase)
        copyDirectory(this.options.assetDirectory, restorePointAssets)
        copyDirectory(assetDirectory, temporaryAssets)
        // Detect an incomplete or corrupted copy before swapping either live
        // component. Validation is repeated after the swap to cover I/O races.
        this.validateDatabaseAndAssets(databasePath, temporaryAssets)

        removeSqliteSidecars(this.options.databasePath)
        await createOfflineDatabaseBackup(databasePath, this.options.databasePath)
        rmSync(previousAssets, { recursive: true, force: true })
        if (existsSync(this.options.assetDirectory)) renameSync(this.options.assetDirectory, previousAssets)
        renameSync(temporaryAssets, this.options.assetDirectory)

        const validation = this.validateDatabaseAndAssets(this.options.databasePath, this.options.assetDirectory)
        rmSync(previousAssets, { recursive: true, force: true })
        return { restorePointDirectory, validation }
      } catch (error) {
        if (existsSync(restorePointDatabase)) {
          removeSqliteSidecars(this.options.databasePath)
          await createOfflineDatabaseBackup(restorePointDatabase, this.options.databasePath)
        }
        if (existsSync(previousAssets)) {
          rmSync(this.options.assetDirectory, { recursive: true, force: true })
          renameSync(previousAssets, this.options.assetDirectory)
        }
        throw error
      } finally {
        rmSync(temporaryAssets, { recursive: true, force: true })
      }
    } finally {
      rmSync(stagingDirectory, { recursive: true, force: true })
    }
  }

  private validateDatabaseAndAssets(databasePath: string, assetDirectory: string): RestoreValidation {
    const database = new Database(databasePath, { readonly: true })
    try {
      if (database.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new BackupValidationError('DATABASE_INTEGRITY_CHECK_FAILED')
      }
      if ((database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length > 0) {
        throw new BackupValidationError('DATABASE_FOREIGN_KEY_CHECK_FAILED')
      }

      const projects = new ProjectRepository(database)
      const boards = new BoardRepository(database)
      const references = new BoardReferenceRepository(database)
      for (const project of projects.list()) this.validateProject(project, boards, references)
      for (const table of [
        'realtime_room_snapshots',
        'realtime_room_updates',
        'comment_threads',
        'comment_messages',
        'audit_events',
        'asset_upload_owners',
      ]) {
        if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
          throw new BackupValidationError(`COLLABORATION_TABLE_MISSING:${table}`)
        }
      }
      if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'").get()) {
        throw new BackupValidationError('ASSET_TABLE_MISSING')
      }
      const assetRows = database.prepare('SELECT sha256, mime, size FROM assets ORDER BY sha256').all() as Array<{
        sha256: unknown
        mime: unknown
        size: unknown
      }>
      for (const row of assetRows) {
        if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) {
          throw new BackupValidationError('BACKUP_ASSET_HASH_INVALID')
        }
        const sha256 = row.sha256
        const path = join(assetDirectory, sha256)
        if (!existsSync(path)) throw new BackupValidationError(`BACKUP_ASSET_MISSING:${sha256}`)
        const stat = lstatSync(path)
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new BackupValidationError(`BACKUP_ASSET_NOT_FILE:${sha256}`)
        }
        if (typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 0 || stat.size !== row.size) {
          throw new BackupValidationError(`BACKUP_ASSET_SIZE_MISMATCH:${sha256}`)
        }
        const bytes = new Uint8Array(readFileSync(path))
        if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
          throw new BackupValidationError(`BACKUP_ASSET_HASH_MISMATCH:${sha256}`)
        }
        if (typeof row.mime !== 'string') {
          throw new BackupValidationError(`BACKUP_ASSET_CONTENT_INVALID:${sha256}:UNSUPPORTED_MIME`)
        }
        try {
          assertAssetContentValid(bytes, row.mime)
        } catch (error) {
          if (error instanceof AssetContentValidationError) {
            throw new BackupValidationError(`BACKUP_ASSET_CONTENT_INVALID:${sha256}:${error.reason}`)
          }
          throw error
        }
      }
      return { database: 'ok', referenceGraph: 'ok', referenceShapes: 'ok', collaboration: 'ok' }
    } finally {
      database.close()
    }
  }

  private validateProject(
    project: ProjectRecord,
    boards: BoardRepository,
    references: BoardReferenceRepository,
  ): void {
    const projectBoards = boards.listByProject(project.id)
    if (!projectBoards.some((board) => board.id === project.rootBoardId)) {
      throw new BackupValidationError(`PROJECT_ROOT_BOARD_INVALID:${project.id}`)
    }
    const projectReferences = references.listByProject(project.id)
    assertBoardReferenceGraphValid(projectBoards, projectReferences)
    const outboundByBoard = new Map<string, BoardReferenceRecord[]>()
    for (const reference of projectReferences) {
      const outbound = outboundByBoard.get(reference.sourceBoardId) ?? []
      outbound.push(reference)
      outboundByBoard.set(reference.sourceBoardId, outbound)
    }
    for (const board of projectBoards) {
      assertBoardReferenceSnapshotConsistent(board.tldrawSnapshot, outboundByBoard.get(board.id) ?? [])
    }
  }
}
