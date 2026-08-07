import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

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
      assets.putByHash(asset.bytes, { mime: asset.mime, createdAt: timestamp })
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
    expect(restored.validation).toEqual({ database: 'ok', referenceGraph: 'ok', referenceShapes: 'ok', collaboration: 'ok' })
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
})
