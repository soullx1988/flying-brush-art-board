import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

import { describe, expect, it } from 'vitest'

import { createDatabase, DATABASE_MIGRATIONS } from '../../db/schema.js'

const script = (name: string) => readFileSync(join(process.cwd(), 'scripts', name), 'utf8')

describe('local PowerShell lifecycle scripts', () => {
  it('uses one repository-local data directory and port convention consistently', () => {
    const start = script('start-local.ps1')
    const backup = script('backup.ps1')
    const restore = script('restore.ps1')
    const migrate = script('migrate-local.ts')

    for (const content of [start, backup, restore]) {
      expect(content).toContain("Join-Path $projectRoot '.infinite-board-data'")
      expect(content).toContain('[string]$DataDirectory')
      expect(content).toContain('[string]$LocalAppDataBase')
      expect(content).toContain('$env:INFINITE_BOARD_DATA_DIR')
    }
    expect(start).toContain('[int]$WebPort = 4173')
    expect(start).toContain('$env:INFINITE_BOARD_DATA_DIR = $applicationDataDirectory')
    expect(start).toContain('$env:INFINITE_BOARD_DATA_DIR = $previousDataDirectory')
    expect(start).toContain("'scripts/migrate-local.ts'")
    expect(start).toContain("--filter './packages/**'")
    expect(start).toContain('Stop-ProcessTree $webProcess')
    expect(start).toContain('Stop-ProcessTree $apiProcess')
    expect(migrate).toContain('resolveAppDataDirectory()')
    expect(migrate).not.toContain('LOCALAPPDATA_REQUIRED')
    expect(start).not.toContain('[int]$ApiPort')
    expect(restore).not.toContain('[int]$ApiPort')
    expect(restore).toContain("Join-Path $applicationDataDirectory '.infinite-board.lock'")
    expect(restore).toContain('Stop the local API using this data directory')
  })

  it('keeps the batch launcher on the same checked lifecycle implementation', () => {
    const start = readFileSync(join(process.cwd(), 'start-dev.bat'), 'utf8')

    expect(start).toContain('scripts\\start-local.ps1')
    expect(start).not.toContain('start "Infinite Board API"')
    expect(start).not.toContain(':startup_failed')
  })

  it('makes pnpm dev inherit the repository-local data directory', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const wrapper = script('dev-local.ts')
    expect(packageJson.scripts.predev).toContain('./packages/**')
    expect(packageJson.scripts.dev).toBe('tsx scripts/dev-local.ts')
    expect(wrapper).toContain("resolve(process.cwd(), '.infinite-board-data')")
    expect(wrapper).toContain('INFINITE_BOARD_DATA_DIR: dataDirectory')
  })

  it('terminates backup and restore CLI processes after their durable work completes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-backup-cli-'))
    const dataDirectory = join(directory, 'data')
    const databasePath = join(dataDirectory, 'infinite-board.sqlite')
    const backupRoot = join(directory, 'backups')
    mkdirSync(dataDirectory)
    mkdirSync(join(dataDirectory, 'assets'))
    const database = createDatabase(databasePath)
    database.exec('CREATE TABLE backup_cli_probe (payload BLOB NOT NULL); INSERT INTO backup_cli_probe VALUES (zeroblob(8388608))')
    database.close()

    try {
      const backup = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backup-cli.ts', 'backup'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          INFINITE_BOARD_BACKUP_DATA_DIRECTORY: dataDirectory,
          INFINITE_BOARD_BACKUP_ROOT_DIRECTORY: backupRoot,
        },
      })
      expect(backup.error).toBeUndefined()
      expect(backup.status, backup.stderr).toBe(0)
      const record = JSON.parse(backup.stdout) as { directory: string }

      const restore = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backup-cli.ts', 'restore'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          INFINITE_BOARD_RESTORE_DATA_DIRECTORY: dataDirectory,
          INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY: record.directory,
        },
      })
      expect(restore.error).toBeUndefined()
      expect(restore.status, restore.stderr).toBe(0)
      expect(JSON.parse(restore.stdout)).toMatchObject({
        validation: { database: 'ok', referenceGraph: 'ok', referenceShapes: 'ok', collaboration: 'ok' },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 40_000)

  it('backs up an older live schema without applying pending migrations to the source database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-backup-readonly-'))
    const dataDirectory = join(directory, 'data')
    const databasePath = join(dataDirectory, 'infinite-board.sqlite')
    const backupRoot = join(directory, 'backups')
    mkdirSync(dataDirectory)
    mkdirSync(join(dataDirectory, 'assets'))
    const legacy = new Database(databasePath)
    try {
      legacy.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
      for (const migration of DATABASE_MIGRATIONS.filter((item) => item.id !== '0015_realtime_snapshot_board_revision')) {
        legacy.exec(migration.sql)
        legacy.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)')
          .run(migration.id, '2026-08-10T00:00:00.000Z')
      }
      expect(legacy.prepare("SELECT name FROM pragma_table_info('realtime_room_snapshots') WHERE name='board_revision'").get()).toBeUndefined()
    } finally {
      legacy.close()
    }

    try {
      const backup = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backup-cli.ts', 'backup'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          INFINITE_BOARD_BACKUP_DATA_DIRECTORY: dataDirectory,
          INFINITE_BOARD_BACKUP_ROOT_DIRECTORY: backupRoot,
        },
      })
      expect(backup.error).toBeUndefined()
      expect(backup.status, backup.stderr).toBe(0)

      const source = new Database(databasePath, { readonly: true })
      try {
        expect(source.prepare("SELECT name FROM pragma_table_info('realtime_room_snapshots') WHERE name='board_revision'").get()).toBeUndefined()
        expect(source.prepare("SELECT id FROM schema_migrations WHERE id='0015_realtime_snapshot_board_revision'").get()).toBeUndefined()
      } finally {
        source.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
