import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { resolveAppDataDirectory } from '../apps/local-api/src/data-directory.js'
import { createDatabase, listAppliedDatabaseMigrations } from '../apps/local-api/src/db/schema.js'

const applicationDataDirectory = resolveAppDataDirectory()
mkdirSync(applicationDataDirectory, { recursive: true })

const database = createDatabase(join(applicationDataDirectory, 'infinite-board.sqlite'))
try {
  console.log(JSON.stringify({ migrations: listAppliedDatabaseMigrations(database) }))
} finally {
  database.close()
}
