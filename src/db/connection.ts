import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from './migrations.js';

const DB_DIR = '.crewmate';
const DB_FILE = 'crewmate.db';

let db: Database.Database | null = null;

/**
 * Returns the singleton SQLite database connection, initializing it on first call
 */
export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbDir = join(process.cwd(), DB_DIR);
  mkdirSync(dbDir, { recursive: true });

  const dbPath = join(dbDir, DB_FILE);
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

// Clean up database on process exit
process.on('exit', () => {
  if (db) {
    db.close();
  }
});

// Handle graceful shutdown signals
process.on('SIGTERM', () => {
  if (db) {
    db.close();
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  if (db) {
    db.close();
    process.exit(0);
  }
});
