import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import Database from 'better-sqlite3'

export interface CleanupAutomationProjectsOptions {
  dataDirectory: string
  automationTag: string
  allowMissingDatabase?: boolean
}

interface AutomationProjectRow {
  project_id: string
  tag: string
}

const AUTOMATION_TAG_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/

function validateOptions(options: CleanupAutomationProjectsOptions): {
  dataDirectory: string
  automationTag: string
  allowMissingDatabase: boolean
} {
  if (!options.dataDirectory || !isAbsolute(options.dataDirectory)) {
    throw new Error('Cleanup requires an explicit absolute dataDirectory')
  }
  if (!AUTOMATION_TAG_PATTERN.test(options.automationTag)) {
    throw new Error('Cleanup requires one exact automationTag containing only letters, numbers, underscores, or hyphens')
  }
  return {
    dataDirectory: resolve(options.dataDirectory),
    automationTag: options.automationTag,
    allowMissingDatabase: options.allowMissingDatabase === true,
  }
}

export function cleanupAutomationProjects(
  options: CleanupAutomationProjectsOptions,
): AutomationProjectRow[] {
  const { dataDirectory, automationTag, allowMissingDatabase } = validateOptions(options)
  const databasePath = join(dataDirectory, 'infinite-board.sqlite')
  if (!existsSync(databasePath)) {
    if (allowMissingDatabase) return []
    throw new Error(`Cleanup database does not exist: ${databasePath}`)
  }

  // Do not use createDatabase here: a cleanup command must never migrate or
  // create the target database as a side effect of checking what to remove.
  const database = new Database(databasePath, { fileMustExist: true })
  try {
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 1000')

    const requiredTables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('projects', 'automation_projects', 'board_references')
    `).all() as Array<{ name: string }>
    if (requiredTables.length !== 3) {
      throw new Error('Cleanup target is not a compatible Infinite Board database')
    }

    const cleanup = database.transaction(() => {
      const candidates = database.prepare(`
        SELECT project_id, tag
        FROM automation_projects
        WHERE tag = ?
        ORDER BY created_at, project_id
      `).all(automationTag) as AutomationProjectRow[]
      const stillMarked = database.prepare(`
        SELECT 1 FROM automation_projects WHERE project_id = ? AND tag = ?
      `)
      const removeReferences = database.prepare('DELETE FROM board_references WHERE project_id = ?')
      const removeProject = database.prepare(`
        DELETE FROM projects
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM automation_projects
            WHERE automation_projects.project_id = projects.id
              AND automation_projects.tag = ?
          )
      `)

      for (const project of candidates) {
        if (!stillMarked.get(project.project_id, automationTag)) {
          throw new Error(`Automation marker changed during cleanup: ${project.project_id}`)
        }
        removeReferences.run(project.project_id)
        const removed = removeProject.run(project.project_id, automationTag)
        if (removed.changes !== 1) {
          throw new Error(`Cleanup refused an imprecise project deletion: ${project.project_id}`)
        }
      }
      return candidates
    })

    return cleanup.immediate()
  } finally {
    database.close()
  }
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function runCli(): void {
  const dataDirectory = requiredEnvironmentValue('INFINITE_BOARD_CLEANUP_DATA_DIRECTORY')
  const automationTag = requiredEnvironmentValue('INFINITE_BOARD_CLEANUP_AUTOMATION_TAG')
  const confirmation = requiredEnvironmentValue('INFINITE_BOARD_CLEANUP_CONFIRM')
  const expectedConfirmation = `DELETE_AUTOMATION_PROJECTS:${automationTag}`
  if (confirmation !== expectedConfirmation) {
    throw new Error(`INFINITE_BOARD_CLEANUP_CONFIRM must equal ${expectedConfirmation}`)
  }

  const projects = cleanupAutomationProjects({ dataDirectory, automationTag })
  console.log(`Removed ${projects.length} automation project(s) tagged ${automationTag}.`)
  for (const project of projects) console.log(`- ${project.project_id} [${project.tag}]`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
