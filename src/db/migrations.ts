import type Database from 'better-sqlite3';

/**
 * Executes database schema migrations to ensure tables exist
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      work_type TEXT,
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
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      brief_id     TEXT NOT NULL REFERENCES briefs(id),
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      dependencies TEXT NOT NULL DEFAULT '[]',
      field        TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_locks (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id),
      file_path  TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_artifacts (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id),
      brief_id   TEXT NOT NULL REFERENCES briefs(id),
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_events (
      id         TEXT PRIMARY KEY,
      brief_id   TEXT NOT NULL REFERENCES briefs(id),
      task_id    TEXT REFERENCES tasks(id),
      actor      TEXT NOT NULL,
      type       TEXT NOT NULL,
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
      brief_id      TEXT NOT NULL REFERENCES briefs(id),
      activity_type TEXT NOT NULL,
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
      brief_id          TEXT NOT NULL REFERENCES briefs(id),
      harness           TEXT NOT NULL,
      pid               INTEGER,
      status            TEXT NOT NULL DEFAULT 'active',
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
}
