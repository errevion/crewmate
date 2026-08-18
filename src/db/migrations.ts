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
}
