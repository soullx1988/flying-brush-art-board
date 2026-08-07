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
  FOREIGN KEY (project_id, source_board_id)
    REFERENCES boards(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, target_board_id)
    REFERENCES boards(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_board_references_source
  ON board_references(source_board_id);
CREATE INDEX IF NOT EXISTS idx_board_references_target
  ON board_references(target_board_id);
CREATE INDEX IF NOT EXISTS idx_board_references_project_kind
  ON board_references(project_id, kind);

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
  FOREIGN KEY (project_id, board_id)
    REFERENCES boards(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (sha256) REFERENCES assets(sha256) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_asset_usages_project_board
  ON asset_usages(project_id, board_id);
CREATE INDEX IF NOT EXISTS idx_asset_usages_sha256
  ON asset_usages(sha256);
