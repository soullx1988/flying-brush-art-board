import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../../apps/local-api/src/db/schema.js'
import { cleanupAutomationProjects } from '../../scripts/cleanup-automation-projects.js'

const timestamp = '2026-08-11T00:00:00.000Z'

function seedProject(database: Database.Database, id: string, tag?: string): void {
  database.prepare(`
    INSERT INTO projects (id, title, root_board_id, format_version, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, id, `${id}-root`, timestamp, timestamp)
  if (tag) {
    database.prepare(`
      INSERT INTO automation_projects (project_id, tag, created_at) VALUES (?, ?, ?)
    `).run(id, tag, timestamp)
  }
}

function cleanupEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.INFINITE_BOARD_CLEANUP_DATA_DIRECTORY
  delete environment.INFINITE_BOARD_CLEANUP_AUTOMATION_TAG
  delete environment.INFINITE_BOARD_CLEANUP_CONFIRM
  return { ...environment, ...overrides }
}

describe('automation project cleanup safety', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createSeededDataDirectory(): string {
    const root = mkdtempSync(join(tmpdir(), 'infinite-board-cleanup-safety-'))
    temporaryDirectories.push(root)
    const dataDirectory = join(root, 'data')
    mkdirSync(dataDirectory)
    const database = createDatabase(join(dataDirectory, 'infinite-board.sqlite'))
    try {
      seedProject(database, 'target-project', 'target-run')
      seedProject(database, 'other-automation-project', 'other-run')
      seedProject(database, 'ordinary-project')
    } finally {
      database.close()
    }
    return dataDirectory
  }

  it('deletes only projects carrying the exact explicitly requested tag', () => {
    const dataDirectory = createSeededDataDirectory()

    expect(cleanupAutomationProjects({ dataDirectory, automationTag: 'target-run' }))
      .toEqual([{ project_id: 'target-project', tag: 'target-run' }])

    const database = new Database(join(dataDirectory, 'infinite-board.sqlite'), { readonly: true })
    try {
      expect(database.prepare('SELECT id FROM projects ORDER BY id').all()).toEqual([
        { id: 'ordinary-project' },
        { id: 'other-automation-project' },
      ])
      expect(database.prepare('SELECT project_id, tag FROM automation_projects').all()).toEqual([
        { project_id: 'other-automation-project', tag: 'other-run' },
      ])
    } finally {
      database.close()
    }
  })

  it('refuses implicit or ambiguous cleanup targets', () => {
    expect(() => cleanupAutomationProjects({ dataDirectory: '.infinite-board-data', automationTag: 'target-run' }))
      .toThrow('explicit absolute dataDirectory')
    expect(() => cleanupAutomationProjects({ dataDirectory: process.cwd(), automationTag: '' }))
      .toThrow('one exact automationTag')
    expect(() => cleanupAutomationProjects({ dataDirectory: process.cwd(), automationTag: 'target run' }))
      .toThrow('one exact automationTag')
  })

  it('does not use the legacy formal data-directory environment variable as a cleanup default', () => {
    const dataDirectory = createSeededDataDirectory()
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/cleanup-automation-projects.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanupEnvironment({ INFINITE_BOARD_DATA_DIR: dataDirectory }),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('INFINITE_BOARD_CLEANUP_DATA_DIRECTORY is required')
    const database = new Database(join(dataDirectory, 'infinite-board.sqlite'), { readonly: true })
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 3 })
    } finally {
      database.close()
    }
  })

  it('requires a tag-bound confirmation phrase before the CLI deletes anything', () => {
    const dataDirectory = createSeededDataDirectory()
    const baseEnvironment = {
      INFINITE_BOARD_CLEANUP_DATA_DIRECTORY: dataDirectory,
      INFINITE_BOARD_CLEANUP_AUTOMATION_TAG: 'target-run',
    }
    const refused = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/cleanup-automation-projects.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanupEnvironment({
        ...baseEnvironment,
        INFINITE_BOARD_CLEANUP_CONFIRM: 'DELETE_AUTOMATION_PROJECTS:other-run',
      }),
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('INFINITE_BOARD_CLEANUP_CONFIRM must equal DELETE_AUTOMATION_PROJECTS:target-run')

    const accepted = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/cleanup-automation-projects.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanupEnvironment({
        ...baseEnvironment,
        INFINITE_BOARD_CLEANUP_CONFIRM: 'DELETE_AUTOMATION_PROJECTS:target-run',
      }),
    })
    expect(accepted.status, accepted.stderr).toBe(0)
    expect(accepted.stdout).toContain('Removed 1 automation project(s) tagged target-run.')

    const database = new Database(join(dataDirectory, 'infinite-board.sqlite'), { readonly: true })
    try {
      expect(database.prepare('SELECT id FROM projects ORDER BY id').all()).toEqual([
        { id: 'ordinary-project' },
        { id: 'other-automation-project' },
      ])
    } finally {
      database.close()
    }
  }, 20_000)
})
