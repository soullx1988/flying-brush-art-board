import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

import { decodeIboard } from '../../../../../packages/interop/src/index.js'
import { createReferenceGraphProjectFixture } from '../../../../../packages/test-fixtures/src/iboard/reference-graph-project.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, type LocalDatabase } from '../../db/schema.js'
import { AssetRepository, AssetUsageRepository } from '../assets/asset-repository.js'
import { BoardReferenceRepository } from '../board-references/board-reference-repository.js'
import { BoardRepository } from '../boards/board-repository.js'
import { ProjectRepository } from '../projects/project-repository.js'
import { BackupService } from './backup-service.js'

const timestamp = '2026-07-23T08:00:00.000Z'

describe('BackupService', () => {
  let directory: string
  let databasePath: string
  let database: LocalDatabase
  let assetDirectory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'infinite-board-backup-'))
    databasePath = join(directory, 'data.sqlite')
    assetDirectory = join(directory, 'assets')
    database = createDatabase(databasePath)

    const fixture = createReferenceGraphProjectFixture()
    const projects = new ProjectRepository(database)
    const boards = new BoardRepository(database)
    const references = new BoardReferenceRepository(database)
    const assets = new AssetRepository(database, assetDirectory)
    const usages = new AssetUsageRepository(database)
    projects.create(fixture.project)
    fixture.boards.forEach((board) => boards.create(board))
    fixture.references.forEach((reference) => references.create(reference))
    fixture.assets.forEach((asset) => {
      assets.putByHash(asset.bytes, { mime: asset.mime, createdAt: timestamp, ownerOpenId: 'backup-owner' })
      asset.usages.forEach((usage) => usages.create({
        projectId: fixture.project.id,
        ...usage,
        sha256: asset.sha256,
        createdAt: timestamp,
      }))
    })
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates a consistent SQLite backup and a complete .iboard archive for every project', async () => {
    const service = new BackupService({
      database,
      databasePath,
      assetDirectory,
      backupRootDirectory: join(directory, 'backups'),
      now: () => timestamp,
    })

    const backup = await service.createBackup()

    expect(existsSync(backup.databasePath)).toBe(true)
    expect(backup.projectArchives).toHaveLength(1)
    const archive = decodeIboard(new Uint8Array(readFileSync(backup.projectArchives[0]!.path)))
    expect(archive.manifest.projectId).toBe('project-source')
    expect(archive.boards).toHaveLength(4)
    expect(archive.references).toHaveLength(6)
    expect(archive.assets).toHaveLength(1)
    expect(existsSync(join(backup.assetDirectory, archive.assets[0]!.sha256))).toBe(true)

    const copied = createDatabase(backup.databasePath)
    expect(copied.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(copied.prepare('SELECT COUNT(*) AS count FROM board_references').get()).toEqual({ count: 6 })
    expect(copied.prepare('SELECT COUNT(*) AS count FROM asset_upload_owners').get()).toEqual({ count: 1 })
    copied.close()
  })

  it('exports every .iboard from the SQLite snapshot rather than later live writes', async () => {
    const originalBackup = database.backup.bind(database)
    vi.spyOn(database, 'backup').mockImplementation(async (destination, options) => {
      const result = await originalBackup(destination, options)
      database.prepare("UPDATE projects SET title = 'changed after SQLite snapshot'").run()
      return result
    })
    const service = new BackupService({
      database,
      databasePath,
      assetDirectory,
      backupRootDirectory: join(directory, 'backups'),
      now: () => timestamp,
    })

    const backup = await service.createBackup()
    const archive = decodeIboard(new Uint8Array(readFileSync(backup.projectArchives[0]!.path)))

    expect(archive.manifest.title).toBe('Reference graph fixture')
  })

  it('refuses to publish a backup when an asset blob no longer matches SQLite metadata', async () => {
    const backupRootDirectory = join(directory, 'backups')
    const service = new BackupService({ database, databasePath, assetDirectory, backupRootDirectory, now: () => timestamp })
    const asset = database.prepare('SELECT sha256 FROM assets').get() as { sha256: string }
    const path = join(assetDirectory, asset.sha256)
    const corrupted = new Uint8Array(readFileSync(path))
    const lastIndex = corrupted.byteLength - 1
    corrupted[lastIndex] = corrupted[lastIndex]! ^ 0xff
    writeFileSync(path, corrupted)

    await expect(service.createBackup()).rejects.toMatchObject({
      code: `BACKUP_ASSET_HASH_MISMATCH:${asset.sha256}`,
    })
    expect(readdirSync(backupRootDirectory)).toEqual([])
  })

  it('retains seven daily backups and four older weekly backups only after creating a new valid backup', async () => {
    const backupRootDirectory = join(directory, 'backups')
    mkdirSync(backupRootDirectory, { recursive: true })
    for (let day = 0; day < 33; day += 1) {
      const createdAt = new Date(Date.UTC(2026, 5, 20 + day)).toISOString()
      const historyDirectory = join(backupRootDirectory, `backup-history-${day}`)
      mkdirSync(historyDirectory)
      writeFileSync(join(historyDirectory, 'manifest.json'), JSON.stringify({ createdAt }))
    }
    const preservedUnknown = join(backupRootDirectory, 'backup-manual-recovery')
    mkdirSync(preservedUnknown)

    const service = new BackupService({ database, databasePath, assetDirectory, backupRootDirectory, now: () => timestamp })
    const backup = await service.createBackup()

    const retained = readdirSync(backupRootDirectory).filter((name) => name.startsWith('backup-'))
    expect(retained).toHaveLength(12)
    expect(existsSync(backup.directory)).toBe(true)
    expect(existsSync(preservedUnknown)).toBe(true)
  })

  it('uses a safe archive name while retaining a project identifier with path-sensitive characters', async () => {
    new ProjectRepository(database).create({
      id: 'project:one',
      title: 'Project identifier with colon',
      rootBoardId: 'project-one-root',
      formatVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    new BoardRepository(database).create({
      id: 'project-one-root',
      projectId: 'project:one',
      title: 'Project one board',
      tldrawSnapshot: { store: {} },
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const service = new BackupService({
      database,
      databasePath,
      assetDirectory,
      backupRootDirectory: join(directory, 'backups'),
      now: () => timestamp,
    })

    const backup = await service.createBackup()
    const archive = backup.projectArchives.find((entry) => entry.projectId === 'project:one')!

    expect(dirname(archive.path)).toBe(join(backup.directory, 'projects'))
    expect(basename(archive.path)).toBe(`project-${createHash('sha256').update('project:one').digest('hex')}.iboard`)
    expect(decodeIboard(new Uint8Array(readFileSync(archive.path))).manifest.projectId).toBe('project:one')
  })

  it('makes a restore point and validates restored database, reference graph, and reference shapes', async () => {
    const service = new BackupService({
      database,
      databasePath,
      assetDirectory,
      backupRootDirectory: join(directory, 'backups'),
      now: () => timestamp,
    })
    const backup = await service.createBackup()

    database.prepare("UPDATE projects SET title = 'changed after backup'").run()
    writeFileSync(join(assetDirectory, 'temporary-content'), 'remove me')
    database.close()

    const restored = await service.restoreBackup(backup.directory)
    database = createDatabase(databasePath)

    expect(restored.restorePointDirectory).toContain('restore-points')
    expect(new ProjectRepository(database).get('project-source')!.title).toBe('Reference graph fixture')
    expect(existsSync(join(assetDirectory, 'temporary-content'))).toBe(false)
    const asset = database.prepare('SELECT sha256 FROM assets').get() as { sha256: string }
    expect(existsSync(join(assetDirectory, asset.sha256))).toBe(true)
    expect(new AssetRepository(database, assetDirectory).hasUploadOwnership(asset.sha256, 'backup-owner')).toBe(true)
    expect(restored.validation).toEqual({ database: 'ok', referenceGraph: 'ok', referenceShapes: 'ok', collaboration: 'ok' })
  })

  it('restores an older pre-privacy backup by migrating only a staging copy', async () => {
    const service = new BackupService({
      database,
      databasePath,
      assetDirectory,
      backupRootDirectory: join(directory, 'backups'),
      now: () => timestamp,
    })
    const backup = await service.createBackup()
    const legacy = new Database(backup.databasePath)
    legacy.exec(`
      DROP TABLE asset_upload_owners;
      DROP TABLE project_members;
      DROP TABLE board_access_policies;
      DROP TABLE project_access_policies;
      ALTER TABLE workspace_bootstrap_markers RENAME TO workspace_bootstrap_markers_current;
      CREATE TABLE workspace_bootstrap_markers (
        template_key TEXT PRIMARY KEY,
        template_version INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO workspace_bootstrap_markers(template_key,template_version,project_id,applied_at)
        SELECT template_key,template_version,project_id,applied_at FROM workspace_bootstrap_markers_current;
      DROP TABLE workspace_bootstrap_markers_current;
      DELETE FROM schema_migrations WHERE id IN (
        '0012_board_privacy',
        '0013_asset_upload_owners',
        '0014_owner_scoped_workspace_bootstrap'
      );
    `)
    legacy.close()
    const originalBackupBytes = readFileSync(backup.databasePath)
    database.close()

    await service.restoreBackup(backup.directory)
    database = createDatabase(databasePath)

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='asset_upload_owners'").get())
      .toBeDefined()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_access_policies'").get())
      .toBeDefined()
    expect(database.prepare("SELECT id FROM schema_migrations WHERE id='0014_owner_scoped_workspace_bootstrap'").get())
      .toEqual({ id: '0014_owner_scoped_workspace_bootstrap' })
    expect(readFileSync(backup.databasePath)).toEqual(originalBackupBytes)
  })

  it('rejects a backup whose project root does not belong to one of its Boards', async () => {
    const backupRootDirectory = join(directory, 'backups')
    const service = new BackupService({ database, databasePath, assetDirectory, backupRootDirectory, now: () => timestamp })
    const backup = await service.createBackup()
    const corruptBackup = join(directory, 'invalid-root-backup')
    cpSync(backup.directory, corruptBackup, { recursive: true })
    const corrupt = new Database(join(corruptBackup, 'database.sqlite'))
    corrupt.prepare("UPDATE projects SET root_board_id='missing-root' WHERE id='project-source'").run()
    corrupt.close()

    await expect(service.restoreBackup(corruptBackup)).rejects.toMatchObject({
      code: 'PROJECT_ROOT_BOARD_INVALID:project-source',
    })
    expect(existsSync(join(backupRootDirectory, 'restore-points'))).toBe(false)
  })

  it('rolls back the live database and assets when a copied backup fails restored-state validation', async () => {
    const service = new BackupService({
      database,
      databasePath,
      assetDirectory,
      backupRootDirectory: join(directory, 'backups'),
      now: () => timestamp,
    })
    const backup = await service.createBackup()
    const corruptBackup = join(directory, 'corrupt-backup-copy')
    cpSync(backup.directory, corruptBackup, { recursive: true })

    const corruptDatabase = createDatabase(join(corruptBackup, 'database.sqlite'))
    corruptDatabase.prepare("DELETE FROM board_references WHERE id = 'ref-a-b'").run()
    corruptDatabase.close()

    database.prepare("UPDATE projects SET title = 'state before failed restore'").run()
    writeFileSync(join(assetDirectory, 'state-before-failed-restore'), 'keep me')
    database.close()

    await expect(service.restoreBackup(corruptBackup)).rejects.toThrow()
    database = createDatabase(databasePath)

    expect(new ProjectRepository(database).get('project-source')?.title).toBe('state before failed restore')
    expect(existsSync(join(assetDirectory, 'state-before-failed-restore'))).toBe(true)
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(new BoardReferenceRepository(database).listByProject('project-source')).toHaveLength(6)
  })

  it('rejects missing, wrong-sized, and wrong-hash backup assets before touching live state', async () => {
    const backupRootDirectory = join(directory, 'backups')
    const service = new BackupService({ database, databasePath, assetDirectory, backupRootDirectory, now: () => timestamp })
    const backup = await service.createBackup()
    const asset = database.prepare('SELECT sha256 FROM assets').get() as { sha256: string }
    database.prepare("UPDATE projects SET title = 'live state must survive invalid backup'").run()
    writeFileSync(join(assetDirectory, 'live-marker'), 'keep me')

    const corruptions = [
      {
        name: 'missing',
        expectedCode: `BACKUP_ASSET_MISSING:${asset.sha256}`,
        apply(path: string) { rmSync(path) },
      },
      {
        name: 'wrong-size',
        expectedCode: `BACKUP_ASSET_SIZE_MISMATCH:${asset.sha256}`,
        apply(path: string) { writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0])])) },
      },
      {
        name: 'wrong-hash',
        expectedCode: `BACKUP_ASSET_HASH_MISMATCH:${asset.sha256}`,
        apply(path: string) {
          const bytes = new Uint8Array(readFileSync(path))
          const lastIndex = bytes.byteLength - 1
          bytes[lastIndex] = bytes[lastIndex]! ^ 0xff
          writeFileSync(path, bytes)
        },
      },
    ]

    for (const corruption of corruptions) {
      const copy = join(directory, `corrupt-assets-${corruption.name}`)
      cpSync(backup.directory, copy, { recursive: true })
      corruption.apply(join(copy, 'assets', asset.sha256))
      await expect(service.restoreBackup(copy)).rejects.toMatchObject({
        code: corruption.expectedCode,
      })
      expect(new ProjectRepository(database).get('project-source')?.title).toBe('live state must survive invalid backup')
      expect(readFileSync(join(assetDirectory, 'live-marker'), 'utf8')).toBe('keep me')
      expect(new AssetRepository(database, assetDirectory).hasUploadOwnership(asset.sha256, 'backup-owner')).toBe(true)
    }
    expect(existsSync(join(backupRootDirectory, 'restore-points'))).toBe(false)
  })
})
