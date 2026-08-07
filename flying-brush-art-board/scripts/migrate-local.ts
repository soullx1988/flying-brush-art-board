import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { createDatabase, listAppliedDatabaseMigrations } from '../apps/local-api/src/db/schema.js'

const localAppDataBase = process.env.LOCALAPPDATA
if (!localAppDataBase) throw new Error('LOCALAPPDATA_REQUIRED')

const applicationDataDirectory = join(localAppDataBase, 'InfiniteBoard')
mkdirSync(applicationDataDirectory, { recursive: true })

const database = createDatabase(join(applicationDataDirectory, 'infinite-board.sqlite'))
try {
  console.log(JSON.stringify({ migrations: listAppliedDatabaseMigrations(database) }))
} finally {
  database.close()
}
