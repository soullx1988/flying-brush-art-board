import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applyDatabaseMigrations, DATABASE_MIGRATIONS, listAppliedDatabaseMigrations } from './schema.js'

describe('SQLite schema migrations', () => {
  const directories: string[] = []

  afterEach(() => {
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  })

  it('records and idempotently applies the initial migration to an uninitialized database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-migrations-'))
    directories.push(directory)
    const database = new Database(join(directory, 'data.sqlite'))
    try {
      expect(applyDatabaseMigrations(database)).toEqual([
        '0001_initial',
        '0002_collaboration',
        '0003_comment_shape_offsets',
        '0004_audit_deleted_entities',
        '0005_automation_projects',
        '0006_local_login_users',
        '0007_oauth_state_redirect_uri',
        '0008_remote_mcp',
        '0009_mcp_client_enabled',
        '0010_mcp_v2_oauth',
        '0011_project_navigation',
      ])
      expect(listAppliedDatabaseMigrations(database)).toEqual([
        '0001_initial',
        '0002_collaboration',
        '0003_comment_shape_offsets',
        '0004_audit_deleted_entities',
        '0005_automation_projects',
        '0006_local_login_users',
        '0007_oauth_state_redirect_uri',
        '0008_remote_mcp',
        '0009_mcp_client_enabled',
        '0010_mcp_v2_oauth',
        '0011_project_navigation',
      ])
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'board_references'").get()).toEqual({
        name: 'board_references',
      })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_users'").get()).toEqual({
        name: 'app_users',
      })
      expect(database.prepare("SELECT name FROM pragma_table_info('oauth_states') WHERE name = 'redirect_uri'").get()).toEqual({
        name: 'redirect_uri',
      })
      for (const name of ['mcp_oauth_clients', 'mcp_oauth_requests', 'mcp_oauth_grants', 'mcp_oauth_codes', 'mcp_oauth_access_tokens', 'mcp_oauth_refresh_tokens', 'mcp_operations', 'mcp_confirmations']) {
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)).toEqual({ name })
      }
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_access_tokens'").get()).toBeUndefined()
      expect(applyDatabaseMigrations(database)).toEqual([])
    } finally {
      database.close()
    }
  })

  it('rehearses the destructive v1-to-v2 migration while preserving operations and audit history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'infinite-board-migrations-v2-'))
    directories.push(directory)
    const database = new Database(join(directory, 'data.sqlite'))
    try {
      database.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);')
      for (const migration of DATABASE_MIGRATIONS.filter((item) => item.id !== '0010_mcp_v2_oauth')) {
        database.exec(migration.sql)
        database.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES (?,?)').run(migration.id, '2026-07-30T00:00:00.000Z')
      }
      database.prepare(`INSERT INTO mcp_access_tokens
        (id,token_hash,open_id,client_name,scopes_json,created_at,expires_at,last_used_at,revoked_at,enabled)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run('legacy', 'hash', 'ou_test', 'legacy PAT', '["project:read"]', 't', 'z', null, null, 1)
      database.prepare(`INSERT INTO mcp_operations
        (id,actor_open_id,client_id,tool_name,idempotency_key,request_hash,status,result_json,error_code,project_id,board_id,before_revision,after_revision,created_at,updated_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('op', 'ou_test', 'legacy', 'project_list', null, 'hash', 'succeeded', '{}', null, null, null, null, null, 't', 't', 'z')
      database.prepare('INSERT INTO audit_events(id,actor_open_id,project_id,board_id,action,summary_json,created_at) VALUES (?,?,?,?,?,?,?)')
        .run('audit', 'ou_test', null, null, 'mcp.project_list', '{}', 't')

      expect(applyDatabaseMigrations(database)).toEqual(['0010_mcp_v2_oauth'])
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_access_tokens'").get()).toBeUndefined()
      expect(database.prepare('SELECT id FROM mcp_operations WHERE id=?').get('op')).toEqual({ id: 'op' })
      expect(database.prepare('SELECT id FROM audit_events WHERE id=?').get('audit')).toEqual({ id: 'audit' })
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_oauth_grants'").get()).toEqual({ name: 'mcp_oauth_grants' })
    } finally {
      database.close()
    }
  })
})
