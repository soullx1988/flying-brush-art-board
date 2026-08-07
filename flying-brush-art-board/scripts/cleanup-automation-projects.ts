import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createDatabase } from '../apps/local-api/src/db/schema.js'

export function cleanupAutomationProjects(dataDirectory = process.env.INFINITE_BOARD_DATA_DIR?.trim()
  ? resolve(process.env.INFINITE_BOARD_DATA_DIR)
  : resolve(process.cwd(), '.infinite-board-data')): Array<{ project_id: string; tag: string }> {
  const database = createDatabase(join(dataDirectory, 'infinite-board.sqlite'))

  try {
    const projects = database.prepare('SELECT project_id, tag FROM automation_projects ORDER BY created_at').all() as Array<{ project_id: string; tag: string }>
    const cleanup = database.transaction(() => {
      const removeReferences = database.prepare('DELETE FROM board_references WHERE project_id = ?')
      const removeProject = database.prepare('DELETE FROM projects WHERE id = ?')
      for (const project of projects) {
        removeReferences.run(project.project_id)
        removeProject.run(project.project_id)
      }
    })
    cleanup()
    return projects
  } finally {
    database.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projects = cleanupAutomationProjects()
  console.log(`Removed ${projects.length} automation project(s).`)
  for (const project of projects) console.log(`- ${project.project_id} [${project.tag}]`)
}
