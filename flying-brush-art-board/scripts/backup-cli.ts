import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

import { createDatabase } from '../apps/local-api/src/db/schema.js'
import { BackupService } from '../apps/local-api/src/modules/files/backup-service.js'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}

async function main(): Promise<void> {
  const action = process.argv[2]
  const dataDirectory = requiredEnvironment(
    action === 'backup' ? 'INFINITE_BOARD_BACKUP_DATA_DIRECTORY' : 'INFINITE_BOARD_RESTORE_DATA_DIRECTORY',
  )
  const databasePath = join(dataDirectory, 'infinite-board.sqlite')

  if (!existsSync(databasePath)) throw new Error('LOCAL_DATABASE_NOT_FOUND')

  if (action === 'backup') {
    // Backup is read-only with respect to the live application database. In
    // particular, a newer backup script must never migrate a database still
    // served by an older running API during an upgrade handoff.
    const database = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const backup = await new BackupService({
        database,
        databasePath,
        assetDirectory: join(dataDirectory, 'assets'),
        backupRootDirectory: requiredEnvironment('INFINITE_BOARD_BACKUP_ROOT_DIRECTORY'),
      }).createBackup()
      console.log(JSON.stringify(backup, null, 2))
    } finally {
      database.close()
    }
    return
  }

  if (action === 'restore') {
    const placeholder = createDatabase(':memory:')
    try {
      const result = await new BackupService({
        database: placeholder,
        databasePath,
        assetDirectory: join(dataDirectory, 'assets'),
        backupRootDirectory: join(dataDirectory, 'backups'),
      }).restoreBackup(requiredEnvironment('INFINITE_BOARD_RESTORE_BACKUP_DIRECTORY'))
      console.log(JSON.stringify(result, null, 2))
    } finally {
      placeholder.close()
    }
    return
  }

  throw new Error('BACKUP_ACTION_INVALID')
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  },
)
