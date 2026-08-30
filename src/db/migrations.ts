import type Database from 'better-sqlite3';

/**
 * Executes database schema migrations to ensure tables exist
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      work_type TEXT CHECK(work_type IS NULL OR work_type IN ('software', 'infrastructure', 'data', 'documentation', 'audit')),
      goal TEXT,
      scope TEXT,
      functional_requirements TEXT,
      technical_stack TEXT,
      constraints TEXT,
      existing_codebase TEXT,
      reference_materials TEXT,
      acceptance_criteria TEXT,
      quality_standards TEXT,
      dependencies TEXT,
      risks TEXT,
      deliverables TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'complete')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                    TEXT PRIMARY KEY,
      brief_id              TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      title                 TEXT NOT NULL,
      description           TEXT NOT NULL,
      dependencies          TEXT NOT NULL DEFAULT '[]',
      field                 TEXT,
      artifact_requirements TEXT NOT NULL DEFAULT '[]',
      status                TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_locks (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_path  TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_artifacts (
      id            TEXT PRIMARY KEY,
      task_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      brief_id      TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      type          TEXT NOT NULL CHECK(type IN ('fact', 'decision', 'api_contract', 'constraint', 'note', 'log')),
      content       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'invalidated')),
      superseded_by TEXT REFERENCES execution_artifacts(id) ON DELETE SET NULL,
      tags          TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_events (
      id         TEXT PRIMARY KEY,
      brief_id   TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      actor      TEXT NOT NULL CHECK(actor IN ('frontman', 'scout', 'planner', 'executor')),
      type       TEXT NOT NULL CHECK(type IN ('dispatched', 'started', 'locked', 'artifact', 'completed', 'error')),
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_brief_id ON execution_events (brief_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_task_id ON execution_events (task_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_created_at ON execution_events (created_at)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS frontman_activities (
      id            TEXT PRIMARY KEY,
      brief_id      TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL CHECK(activity_type IN ('questioning', 'awaiting_response', 'analyzing', 'planning', 'orchestrating', 'reviewing', 'idle')),
      message       TEXT,
      metadata      TEXT,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at      TEXT
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_frontman_activities_brief_id ON frontman_activities (brief_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_frontman_activities_started_at ON frontman_activities (started_at)`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_liveness (
      id                TEXT PRIMARY KEY,
      brief_id          TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
      harness           TEXT NOT NULL,
      pid               INTEGER,
      status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'idle', 'stopped')),
      last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_session_liveness_brief_id ON session_liveness (brief_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_session_liveness_last_heartbeat ON session_liveness (last_heartbeat_at)`
  );

  try {
    db.exec(`ALTER TABLE file_locks ADD COLUMN expires_at TEXT`);
  } catch {
    // column already exists
  }

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN artifact_requirements TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // column already exists
  }

  try {
    db.exec(`ALTER TABLE execution_artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  } catch {
    // column already exists
  }

  try {
    db.exec(
      `ALTER TABLE execution_artifacts ADD COLUMN superseded_by TEXT REFERENCES execution_artifacts(id) ON DELETE SET NULL`
    );
  } catch {
    // column already exists
  }

  try {
    db.exec(`ALTER TABLE execution_artifacts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // column already exists
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_brief_id ON tasks (brief_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_file_locks_task_id ON file_locks (task_id)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_execution_artifacts_brief_id ON execution_artifacts (brief_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_execution_artifacts_task_id ON execution_artifacts (task_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_execution_artifacts_status ON execution_artifacts (status)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_execution_artifacts_type ON execution_artifacts (type)`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_session_liveness_brief_harness ON session_liveness (brief_id, harness)`
  );
}
