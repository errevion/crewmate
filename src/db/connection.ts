import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { runMigrations } from './migrations.js';

const DB_DIR = '.crewmate';
const DB_FILE = 'crewmate.db';

let db: Database.Database | null = null;

function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    if (existsSync(join(current, DB_DIR)) && existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

/**
 * Returns the singleton SQLite database connection, initializing it on first call
 */
export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const projectRoot = findProjectRoot(process.cwd());
  const dbDir = join(projectRoot, DB_DIR);
  mkdirSync(dbDir, { recursive: true });

  const dbPath = join(dbDir, DB_FILE);
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  return db;
}

function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // already closed
    }
    db = null;
  }
}

process.on('exit', closeDb);

process.on('SIGTERM', () => {
  closeDb();
  process.exit(143);
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(130);
});
