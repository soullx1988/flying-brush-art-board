import type { ProjectRecord } from '@infinite-board/board-core'

import type { LocalDatabase } from '../../db/schema.js'
import { ProtectedCoreMutationError, protectedCoreRecordId } from '../boards/board-repository.js'

interface ProjectRow {
  id: string
  title: string
  root_board_id: string
  format_version: number
  automation_tag?: string | null
  owner_open_id?: string | null
  created_at: string
  updated_at: string
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    title: row.title,
    rootBoardId: row.root_board_id,
    formatVersion: row.format_version,
    ...(row.automation_tag ? { automationTag: row.automation_tag } : {}),
    ...(row.owner_open_id ? { ownerOpenId: row.owner_open_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface WorkspaceBootstrapMarker {
  template_key: string
  owner_open_id: string
  template_version: number
}

export class ProtectedWorkspaceDeleteError extends Error {
  readonly code = 'PROTECTED_WORKSPACE_DELETE_REQUIRES_CONFIRMATION'

  constructor(
    readonly projectId: string,
    readonly templateKey: string,
    readonly templateVersion: number,
  ) {
    super('PROTECTED_WORKSPACE_DELETE_REQUIRES_CONFIRMATION')
    this.name = 'ProtectedWorkspaceDeleteError'
  }
}

export class ProjectRepository {
  constructor(private readonly database: LocalDatabase) {}

  create(project: ProjectRecord): ProjectRecord {
    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO projects (id, title, root_board_id, format_version, created_at, updated_at)
           VALUES (@id, @title, @rootBoardId, @formatVersion, @createdAt, @updatedAt)`,
        )
        .run(project)
      if (project.ownerOpenId) {
        this.database.prepare(`INSERT INTO project_access_policies
          (project_id,owner_open_id,created_at,updated_at) VALUES (?,?,?,?)`)
          .run(project.id, project.ownerOpenId, project.createdAt, project.updatedAt)
        this.database.prepare(`INSERT INTO project_members
          (project_id,member_open_id,role,created_at) VALUES (?,?,?,?)`)
          .run(project.id, project.ownerOpenId, 'owner', project.createdAt)
      }
    })
    create()
    return this.get(project.id)!
  }

  get(projectId: string): ProjectRecord | undefined {
    const row = this.database.prepare(`
      SELECT projects.*, automation_projects.tag AS automation_tag,
        project_access_policies.owner_open_id AS owner_open_id
      FROM projects
      LEFT JOIN automation_projects ON automation_projects.project_id = projects.id
      LEFT JOIN project_access_policies ON project_access_policies.project_id = projects.id
      WHERE projects.id = ?
    `).get(projectId) as
      | ProjectRow
      | undefined
    return row ? toProject(row) : undefined
  }

  list(): ProjectRecord[] {
    return (this.database.prepare(`
      SELECT projects.*, automation_projects.tag AS automation_tag,
        project_access_policies.owner_open_id AS owner_open_id
      FROM projects
      LEFT JOIN automation_projects ON automation_projects.project_id = projects.id
      LEFT JOIN project_access_policies ON project_access_policies.project_id = projects.id
      ORDER BY projects.updated_at DESC, projects.id
    `).all() as ProjectRow[]).map(toProject)
  }

  markAutomation(projectId: string, tag: string): void {
    this.database.prepare('INSERT INTO automation_projects(project_id, tag, created_at) VALUES (?, ?, ?)')
      .run(projectId, tag, new Date().toISOString())
  }

  claimOwnershipIfUnowned(projectId: string, ownerOpenId: string): ProjectRecord {
    const timestamp = new Date().toISOString()
    this.database.prepare(`INSERT OR IGNORE INTO project_access_policies
      (project_id,owner_open_id,created_at,updated_at) VALUES (?,?,?,?)`)
      .run(projectId, ownerOpenId, timestamp, timestamp)
    this.database.prepare(`INSERT OR IGNORE INTO project_members
      (project_id,member_open_id,role,created_at) VALUES (?,?,?,?)`)
      .run(projectId, ownerOpenId, 'owner', timestamp)
    return this.get(projectId)!
  }

  isMember(projectId: string, actorOpenId: string | undefined): boolean {
    if (!actorOpenId) return false
    return Boolean(this.database.prepare(`SELECT 1 FROM project_members
      WHERE project_id=? AND member_open_id=?`).get(projectId, actorOpenId))
  }

  addMember(projectId: string, memberOpenId: string): void {
    const normalized = memberOpenId.trim()
    if (!normalized) throw new Error('PROJECT_MEMBER_REQUIRED')
    this.database.prepare(`INSERT OR IGNORE INTO project_members
      (project_id,member_open_id,role,created_at) VALUES (?,?,?,?)`)
      .run(projectId, normalized, 'member', new Date().toISOString())
  }

  rename(projectId: string, title: string): ProjectRecord {
    const result = this.database
      .prepare('UPDATE projects SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, new Date().toISOString(), projectId)
    if (result.changes === 0) throw new Error(`Project ${projectId} was not found`)
    return this.get(projectId)!
  }

  setRootBoardId(projectId: string, rootBoardId: string): ProjectRecord {
    const board = this.database
      .prepare(`SELECT b.id,COALESCE(policy.access_level,'project') AS access_level
        FROM boards b
        LEFT JOIN board_access_policies policy ON policy.board_id=b.id
        WHERE b.id = ? AND b.project_id = ?`)
      .get(rootBoardId, projectId) as { id: string; access_level: string } | undefined
    if (!board) {
      throw Object.assign(new Error(`Board ${rootBoardId} does not belong to project ${projectId}`), {
        code: 'BOARD_NOT_IN_PROJECT',
      })
    }
    if (board.access_level === 'owner-only') {
      throw Object.assign(new Error('ROOT_BOARD_MUST_BE_PROJECT_ACCESSIBLE'), {
        code: 'ROOT_BOARD_MUST_BE_PROJECT_ACCESSIBLE',
      })
    }


    const project = this.database.prepare('SELECT root_board_id FROM projects WHERE id = ?')
      .get(projectId) as { root_board_id: string } | undefined
    if (!project) throw new Error(`Project ${projectId} was not found`)
    if (project.root_board_id !== rootBoardId) {
      const currentRoot = this.database.prepare('SELECT tldraw_snapshot FROM boards WHERE id = ? AND project_id = ?')
        .get(project.root_board_id, projectId) as { tldraw_snapshot: string } | undefined
      if (currentRoot) {
        const recordId = protectedCoreRecordId(JSON.parse(currentRoot.tldraw_snapshot) as unknown)
        if (recordId) throw new ProtectedCoreMutationError(recordId, 'root-board-change')
      }
    }

    const result = this.database
      .prepare('UPDATE projects SET root_board_id = ?, updated_at = ? WHERE id = ?')
      .run(rootBoardId, new Date().toISOString(), projectId)
    if (result.changes === 0) throw new Error(`Project ${projectId} was not found`)
    return this.get(projectId)!
  }

  remove(projectId: string, options: { confirmedProtectedWorkspaceDelete?: boolean } = {}): boolean {
    const marker = this.database.prepare(`SELECT template_key, owner_open_id, template_version
      FROM workspace_bootstrap_markers WHERE project_id = ? ORDER BY template_key, owner_open_id LIMIT 1`)
      .get(projectId) as WorkspaceBootstrapMarker | undefined
    if (marker && !options.confirmedProtectedWorkspaceDelete) {
      throw new ProtectedWorkspaceDeleteError(projectId, marker.template_key, marker.template_version)
    }

    const removeProject = this.database.transaction((id: string) => {
      // References use RESTRICT for their target board so a project containing
      // cross-board links must release those links before its boards cascade.
      this.database.prepare('DELETE FROM board_references WHERE project_id = ?').run(id)
      // A confirmed deletion retires the current managed workspace completely;
      // removing the marker lets the owner bootstrap a clean replacement later.
      this.database.prepare('DELETE FROM workspace_bootstrap_markers WHERE project_id = ?').run(id)
      return this.database.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
    })
    return removeProject(projectId)
  }
}
