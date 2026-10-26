import { assertProjectNavigationValid, type ProjectNavigation, type ProjectRecord } from '@infinite-board/board-core'

import type { LocalDatabase } from '../../db/schema.js'

interface ProjectRow {
  id: string
  title: string
  root_board_id: string
  format_version: number
  automation_tag?: string | null
  navigation_json?: string | null
  created_at: string
  updated_at: string
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    title: row.title,
    rootBoardId: row.root_board_id,
    formatVersion: row.format_version,
    ...(row.navigation_json ? { navigation: JSON.parse(row.navigation_json) as ProjectNavigation } : {}),
    ...(row.automation_tag ? { automationTag: row.automation_tag } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ProjectRepository {
  constructor(private readonly database: LocalDatabase) {}

  create(project: ProjectRecord): ProjectRecord {
    this.database
      .prepare(
        `INSERT INTO projects (id, title, root_board_id, format_version, created_at, updated_at, navigation_json)
         VALUES (@id, @title, @rootBoardId, @formatVersion, @createdAt, @updatedAt, @navigationJson)`,
      )
      .run({ ...project, navigationJson: project.navigation ? JSON.stringify(project.navigation) : null })
    return project
  }

  get(projectId: string): ProjectRecord | undefined {
    const row = this.database.prepare(`
      SELECT projects.*, automation_projects.tag AS automation_tag
      FROM projects
      LEFT JOIN automation_projects ON automation_projects.project_id = projects.id
      WHERE projects.id = ?
    `).get(projectId) as
      | ProjectRow
      | undefined
    return row ? toProject(row) : undefined
  }

  list(): ProjectRecord[] {
    return (this.database.prepare(`
      SELECT projects.*, automation_projects.tag AS automation_tag
      FROM projects
      LEFT JOIN automation_projects ON automation_projects.project_id = projects.id
      ORDER BY projects.updated_at DESC, projects.id
    `).all() as ProjectRow[]).map(toProject)
  }

  markAutomation(projectId: string, tag: string): void {
    this.database.prepare('INSERT INTO automation_projects(project_id, tag, created_at) VALUES (?, ?, ?)')
      .run(projectId, tag, new Date().toISOString())
  }

  rename(projectId: string, title: string): ProjectRecord {
    const result = this.database
      .prepare('UPDATE projects SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, new Date().toISOString(), projectId)
    if (result.changes === 0) throw new Error(`Project ${projectId} was not found`)
    return this.get(projectId)!
  }

  saveNavigation(projectId: string, navigation: ProjectNavigation): ProjectRecord {
    return this.database.transaction(() => {
      const project = this.get(projectId)
      if (!project) throw new Error('PROJECT_NOT_FOUND')
      if ((project.navigation?.revision ?? 0) !== navigation.revision) throw new Error('NAVIGATION_REVISION_CONFLICT')
      const boards = this.database.prepare('SELECT id FROM boards WHERE project_id = ?').all(projectId) as { id: string }[]
      assertProjectNavigationValid(navigation, boards.map((board) => board.id))
      this.database.prepare('UPDATE projects SET navigation_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ ...navigation, revision: navigation.revision + 1 }), new Date().toISOString(), projectId)
      return this.get(projectId)!
    })()
  }

  setRootBoardId(projectId: string, rootBoardId: string): ProjectRecord {
    const board = this.database
      .prepare('SELECT id FROM boards WHERE id = ? AND project_id = ?')
      .get(rootBoardId, projectId)
    if (!board) throw new Error(`Board ${rootBoardId} does not belong to project ${projectId}`)

    const result = this.database
      .prepare('UPDATE projects SET root_board_id = ?, updated_at = ? WHERE id = ?')
      .run(rootBoardId, new Date().toISOString(), projectId)
    if (result.changes === 0) throw new Error(`Project ${projectId} was not found`)
    return this.get(projectId)!
  }

  remove(projectId: string): boolean {
    const removeProject = this.database.transaction((id: string) => {
      // References use RESTRICT for their target board so a project containing
      // cross-board links must release those links before its boards cascade.
      this.database.prepare('DELETE FROM board_references WHERE project_id = ?').run(id)
      return this.database.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
    })
    return removeProject(projectId)
  }
}
