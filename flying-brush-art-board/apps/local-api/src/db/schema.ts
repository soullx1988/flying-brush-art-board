import Database from 'better-sqlite3'
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export type LocalDatabase = Database.Database

export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  rootBoardId: text('root_board_id').notNull(),
  formatVersion: integer('format_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const boardsTable = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    title: text('title').notNull(),
    tldrawSnapshot: text('tldraw_snapshot').notNull(),
    sourceMetadata: text('source_metadata'),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_boards_project_id').on(table.projectId, table.id),
    foreignKey({ columns: [table.projectId], foreignColumns: [projectsTable.id] }).onDelete('cascade'),
  ],
)

export const projectAccessPoliciesTable = sqliteTable('project_access_policies', {
  projectId: text('project_id').primaryKey().references(() => projectsTable.id, { onDelete: 'cascade' }),
  ownerOpenId: text('owner_open_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const projectMembersTable = sqliteTable(
  'project_members',
  {
    projectId: text('project_id').notNull().references(() => projectsTable.id, { onDelete: 'cascade' }),
    memberOpenId: text('member_open_id').notNull(),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.memberOpenId] })],
)

export const boardAccessPoliciesTable = sqliteTable('board_access_policies', {
  boardId: text('board_id').primaryKey().references(() => boardsTable.id, { onDelete: 'cascade' }),
  accessLevel: text('access_level', { enum: ['project', 'owner-only'] }).notNull(),
  ownerOpenId: text('owner_open_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const boardReferencesTable = sqliteTable(
  'board_references',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    sourceBoardId: text('source_board_id').notNull(),
    targetBoardId: text('target_board_id').notNull(),
    shapeId: text('shape_id').notNull(),
    kind: text('kind', { enum: ['embed', 'link'] }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_board_references_source_shape').on(table.sourceBoardId, table.shapeId),
    index('idx_board_references_source').on(table.sourceBoardId),
    index('idx_board_references_target').on(table.targetBoardId),
    index('idx_board_references_project_kind').on(table.projectId, table.kind),
    foreignKey({
      columns: [table.projectId, table.sourceBoardId],
      foreignColumns: [boardsTable.projectId, boardsTable.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.targetBoardId],
      foreignColumns: [boardsTable.projectId, boardsTable.id],
    }).onDelete('restrict'),
  ],
)

export const assetsTable = sqliteTable('assets', {
  sha256: text('sha256').primaryKey(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
})

export const assetUploadOwnersTable = sqliteTable(
  'asset_upload_owners',
  {
    sha256: text('sha256').notNull().references(() => assetsTable.sha256, { onDelete: 'cascade' }),
    ownerOpenId: text('owner_open_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sha256, table.ownerOpenId] })],
)

export const assetUsagesTable = sqliteTable(
  'asset_usages',
  {
    projectId: text('project_id').notNull(),
    boardId: text('board_id').notNull(),
    shapeId: text('shape_id').notNull(),
    assetRecordId: text('asset_record_id').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.boardId, table.shapeId, table.assetRecordId] }),
    index('idx_asset_usages_project_board').on(table.projectId, table.boardId),
    index('idx_asset_usages_sha256').on(table.sha256),
    foreignKey({ columns: [table.projectId], foreignColumns: [projectsTable.id] }).onDelete('cascade'),
    foreignKey({
      columns: [table.projectId, table.boardId],
      foreignColumns: [boardsTable.projectId, boardsTable.id],
    }).onDelete('cascade'),
    foreignKey({ columns: [table.sha256], foreignColumns: [assetsTable.sha256] }).onDelete('restrict'),
  ],
)

export const mcpOAuthClientsTable = sqliteTable(
  'mcp_oauth_clients',
  {
    clientId: text('client_id').primaryKey(),
    metadataJson: text('metadata_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
)

export const mcpOAuthRequestsTable = sqliteTable(
  'mcp_oauth_requests',
  {
    requestHash: text('request_hash').primaryKey(),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    state: text('state'),
    codeChallenge: text('code_challenge').notNull(),
    resource: text('resource').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_mcp_oauth_requests_expiry').on(table.expiresAt),
    foreignKey({ columns: [table.clientId], foreignColumns: [mcpOAuthClientsTable.clientId] }).onDelete('cascade'),
  ],
)

export const mcpOAuthGrantsTable = sqliteTable(
  'mcp_oauth_grants',
  {
    id: text('id').primaryKey(),
    openId: text('open_id').notNull(),
    userName: text('user_name').notNull(),
    clientId: text('client_id').notNull(),
    clientName: text('client_name').notNull(),
    scopesJson: text('scopes_json').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('idx_mcp_oauth_grants_user').on(table.openId, table.createdAt),
    index('idx_mcp_oauth_grants_client').on(table.clientId, table.createdAt),
    foreignKey({ columns: [table.clientId], foreignColumns: [mcpOAuthClientsTable.clientId] }).onDelete('cascade'),
  ],
)

export const mcpOAuthCodesTable = sqliteTable(
  'mcp_oauth_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    grantId: text('grant_id').notNull(),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    resource: text('resource').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
  },
  (table) => [
    index('idx_mcp_oauth_codes_expiry').on(table.expiresAt),
    foreignKey({ columns: [table.grantId], foreignColumns: [mcpOAuthGrantsTable.id] }).onDelete('cascade'),
    foreignKey({ columns: [table.clientId], foreignColumns: [mcpOAuthClientsTable.clientId] }).onDelete('cascade'),
  ],
)

export const mcpOAuthAccessTokensTable = sqliteTable(
  'mcp_oauth_access_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    grantId: text('grant_id').notNull(),
    clientId: text('client_id').notNull(),
    scopesJson: text('scopes_json').notNull(),
    resource: text('resource').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('idx_mcp_oauth_access_grant').on(table.grantId, table.expiresAt),
    foreignKey({ columns: [table.grantId], foreignColumns: [mcpOAuthGrantsTable.id] }).onDelete('cascade'),
    foreignKey({ columns: [table.clientId], foreignColumns: [mcpOAuthClientsTable.clientId] }).onDelete('cascade'),
  ],
)

export const mcpOAuthRefreshTokensTable = sqliteTable(
  'mcp_oauth_refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    grantId: text('grant_id').notNull(),
    clientId: text('client_id').notNull(),
    scopesJson: text('scopes_json').notNull(),
    resource: text('resource').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('idx_mcp_oauth_refresh_grant').on(table.grantId, table.expiresAt),
    foreignKey({ columns: [table.grantId], foreignColumns: [mcpOAuthGrantsTable.id] }).onDelete('cascade'),
    foreignKey({ columns: [table.clientId], foreignColumns: [mcpOAuthClientsTable.clientId] }).onDelete('cascade'),
  ],
)

export const mcpOperationsTable = sqliteTable(
  'mcp_operations',
  {
    id: text('id').primaryKey(),
    actorOpenId: text('actor_open_id').notNull(),
    clientId: text('client_id').notNull(),
    toolName: text('tool_name').notNull(),
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
    resultJson: text('result_json'),
    errorCode: text('error_code'),
    projectId: text('project_id'),
    boardId: text('board_id'),
    beforeRevision: integer('before_revision'),
    afterRevision: integer('after_revision'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_mcp_operations_actor_created').on(table.actorOpenId, table.createdAt),
    index('idx_mcp_operations_target').on(table.projectId, table.boardId, table.createdAt),
  ],
)

export const mcpConfirmationsTable = sqliteTable(
  'mcp_confirmations',
  {
    tokenHash: text('token_hash').primaryKey(),
    actorOpenId: text('actor_open_id').notNull(),
    clientId: text('client_id').notNull(),
    toolName: text('tool_name').notNull(),
    targetId: text('target_id').notNull(),
    requestHash: text('request_hash').notNull(),
    expectedRevision: integer('expected_revision'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
  },
  (table) => [index('idx_mcp_confirmations_expiry').on(table.expiresAt)],
)

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root_board_id TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  tldraw_snapshot TEXT NOT NULL,
  source_metadata TEXT,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS board_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_board_id TEXT NOT NULL,
  target_board_id TEXT NOT NULL,
  shape_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('embed', 'link')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_board_id, shape_id),
  FOREIGN KEY (project_id, source_board_id) REFERENCES boards(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, target_board_id) REFERENCES boards(project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_board_references_source ON board_references(source_board_id);
CREATE INDEX IF NOT EXISTS idx_board_references_target ON board_references(target_board_id);
CREATE INDEX IF NOT EXISTS idx_board_references_project_kind ON board_references(project_id, kind);
CREATE TABLE IF NOT EXISTS assets (
  sha256 TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_usages (
  project_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  shape_id TEXT NOT NULL,
  asset_record_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, board_id, shape_id, asset_record_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, board_id) REFERENCES boards(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (sha256) REFERENCES assets(sha256) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_asset_usages_project_board ON asset_usages(project_id, board_id);
CREATE INDEX IF NOT EXISTS idx_asset_usages_sha256 ON asset_usages(sha256);
`

export const DATABASE_MIGRATIONS = [
  { id: '0001_initial', sql: INITIAL_SCHEMA_SQL },
  { id: '0002_collaboration', sql: `
CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, verifier_ciphertext TEXT NOT NULL, return_to TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (session_hash TEXT PRIMARY KEY, open_id TEXT NOT NULL, name TEXT NOT NULL, department TEXT, position TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS realtime_room_snapshots (board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE, room_version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, update_count INTEGER NOT NULL, compacted_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS realtime_room_updates (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, payload TEXT NOT NULL, actor_open_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(board_id, sequence));
CREATE TABLE IF NOT EXISTS board_checkpoints (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, snapshot_json TEXT NOT NULL, reason TEXT NOT NULL, actor_open_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comment_threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, shape_id TEXT, x REAL, y REAL, status TEXT NOT NULL CHECK(status IN ('open', 'resolved')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comment_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE, author_open_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_open_id TEXT NOT NULL, project_id TEXT, board_id TEXT REFERENCES boards(id) ON DELETE SET NULL, action TEXT NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_open_id ON app_sessions(open_id);
CREATE INDEX IF NOT EXISTS idx_room_updates_board_sequence ON realtime_room_updates(board_id, sequence);
CREATE INDEX IF NOT EXISTS idx_comments_board_status ON comment_threads(board_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_project_created ON audit_events(project_id, created_at DESC);` },
  { id: '0003_comment_shape_offsets', sql: `
ALTER TABLE comment_threads ADD COLUMN shape_offset_x REAL;
ALTER TABLE comment_threads ADD COLUMN shape_offset_y REAL;` },
  { id: '0004_audit_deleted_entities', sql: `
DROP INDEX IF EXISTS idx_audit_project_created;
ALTER TABLE audit_events RENAME TO audit_events_with_board_fk;
CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_open_id TEXT NOT NULL, project_id TEXT, board_id TEXT, action TEXT NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL);
INSERT INTO audit_events(id,actor_open_id,project_id,board_id,action,summary_json,created_at)
  SELECT id,actor_open_id,project_id,board_id,action,summary_json,created_at FROM audit_events_with_board_fk;
DROP TABLE audit_events_with_board_fk;
CREATE INDEX idx_audit_project_created ON audit_events(project_id, created_at DESC);` },
  { id: '0005_automation_projects', sql: `
CREATE TABLE automation_projects (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_automation_projects_tag ON automation_projects(tag);` },
  { id: '0006_local_login_users', sql: `
CREATE TABLE app_users (
  open_id TEXT PRIMARY KEY,
  union_id TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  en_name TEXT,
  avatar_url TEXT,
  tenant_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
CREATE INDEX idx_app_users_last_login ON app_users(last_login_at DESC);` },
  { id: '0007_oauth_state_redirect_uri', sql: `
ALTER TABLE oauth_states ADD COLUMN redirect_uri TEXT;` },
  { id: '0008_remote_mcp', sql: `
CREATE TABLE mcp_access_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  open_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_mcp_access_tokens_user ON mcp_access_tokens(open_id, created_at DESC);
CREATE TABLE mcp_operations (
  id TEXT PRIMARY KEY,
  actor_open_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  result_json TEXT,
  error_code TEXT,
  project_id TEXT,
  board_id TEXT,
  before_revision INTEGER,
  after_revision INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_mcp_operations_idempotency
  ON mcp_operations(actor_open_id, client_id, tool_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_mcp_operations_actor_created ON mcp_operations(actor_open_id, created_at DESC);
CREATE INDEX idx_mcp_operations_target ON mcp_operations(project_id, board_id, created_at DESC);
CREATE TABLE mcp_confirmations (
  token_hash TEXT PRIMARY KEY,
  actor_open_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_revision INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX idx_mcp_confirmations_expiry ON mcp_confirmations(expires_at);` },
  { id: '0009_mcp_client_enabled', sql: `
ALTER TABLE mcp_access_tokens ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1));` },
  { id: '0010_mcp_v2_oauth', sql: `
DROP INDEX IF EXISTS idx_mcp_access_tokens_user;
DROP TABLE IF EXISTS mcp_access_tokens;
CREATE TABLE mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE mcp_oauth_requests (
  request_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);
CREATE TABLE mcp_oauth_grants (
  id TEXT PRIMARY KEY,
  open_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_mcp_oauth_grants_user ON mcp_oauth_grants(open_id, created_at DESC);
CREATE INDEX idx_mcp_oauth_grants_client ON mcp_oauth_grants(client_id, created_at DESC);
CREATE TABLE mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX idx_mcp_oauth_codes_expiry ON mcp_oauth_codes(expires_at);
CREATE TABLE mcp_oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_mcp_oauth_access_grant ON mcp_oauth_access_tokens(grant_id, expires_at);
CREATE TABLE mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_mcp_oauth_refresh_grant ON mcp_oauth_refresh_tokens(grant_id, expires_at);` },
  { id: '0011_trading_workspace_bootstrap', sql: `
CREATE TABLE workspace_bootstrap_markers (
  template_key TEXT PRIMARY KEY,
  template_version INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  applied_at TEXT NOT NULL
);` },
  { id: '0012_board_privacy', sql: `
CREATE TABLE project_access_policies (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  owner_open_id TEXT NOT NULL CHECK(length(trim(owner_open_id)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE board_access_policies (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK(access_level IN ('project','owner-only')),
  owner_open_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (access_level = 'project' AND owner_open_id IS NULL)
    OR (access_level = 'owner-only' AND owner_open_id IS NOT NULL AND length(trim(owner_open_id)) > 0)
  )
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_open_id TEXT NOT NULL CHECK(length(trim(member_open_id)) > 0),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, member_open_id)
);
CREATE INDEX idx_project_members_user ON project_members(member_open_id, project_id);
CREATE INDEX idx_board_access_owner ON board_access_policies(owner_open_id, access_level);` },
  { id: '0013_asset_upload_owners', sql: `
CREATE TABLE asset_upload_owners (
  sha256 TEXT NOT NULL REFERENCES assets(sha256) ON DELETE CASCADE,
  owner_open_id TEXT NOT NULL CHECK(length(trim(owner_open_id)) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(sha256, owner_open_id)
);
CREATE INDEX idx_asset_upload_owners_user ON asset_upload_owners(owner_open_id, created_at);` },
  { id: '0014_owner_scoped_workspace_bootstrap', sql: `
ALTER TABLE workspace_bootstrap_markers RENAME TO workspace_bootstrap_markers_legacy;
CREATE TABLE workspace_bootstrap_markers (
  template_key TEXT NOT NULL,
  owner_open_id TEXT NOT NULL CHECK(length(trim(owner_open_id)) > 0),
  template_version INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY(template_key, owner_open_id)
);
INSERT INTO workspace_bootstrap_markers (
  template_key, owner_open_id, template_version, project_id, applied_at
)
SELECT
  legacy.template_key,
  COALESCE(policy.owner_open_id, '__legacy_unclaimed__'),
  legacy.template_version,
  legacy.project_id,
  legacy.applied_at
FROM workspace_bootstrap_markers_legacy AS legacy
LEFT JOIN project_access_policies AS policy ON policy.project_id = legacy.project_id;
DROP TABLE workspace_bootstrap_markers_legacy;
CREATE INDEX idx_workspace_bootstrap_project ON workspace_bootstrap_markers(project_id);` },
  { id: '0015_realtime_snapshot_board_revision', sql: `
ALTER TABLE realtime_room_snapshots ADD COLUMN board_revision INTEGER;` },
] as const

export function listAppliedDatabaseMigrations(database: LocalDatabase): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
  return (database.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>)
    .map((migration) => migration.id)
}

/** Applies every known SQL migration exactly once and returns newly applied IDs. */
export function applyDatabaseMigrations(database: LocalDatabase): string[] {
  const applied = new Set(listAppliedDatabaseMigrations(database))
  const newlyApplied: string[] = []
  const apply = database.transaction(() => {
    for (const migration of DATABASE_MIGRATIONS) {
      if (applied.has(migration.id)) continue
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, new Date().toISOString())
      newlyApplied.push(migration.id)
    }
  })
  apply()
  return newlyApplied
}

export function createDatabase(filename: string): LocalDatabase {
  const database = new Database(filename)
  database.pragma('foreign_keys = ON')
  if (filename !== ':memory:') database.pragma('journal_mode = WAL')
  applyDatabaseMigrations(database)
  return database
}
