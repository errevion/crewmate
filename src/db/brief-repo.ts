import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { getDb } from './connection.js';
import {
  type Brief,
  type BriefField,
  COLUMN_TO_FIELD,
  FIELD_TO_COLUMN,
  JSON_FIELDS,
} from '../models/brief.js';

function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToBrief(row: Record<string, unknown>): Brief {
  const brief: Record<string, unknown> = {};

  for (const [col, val] of Object.entries(row)) {
    const mapped = COLUMN_TO_FIELD[col];
    const camelField = mapped
      ? mapped
      : col === 'created_at'
        ? 'createdAt'
        : col === 'updated_at'
          ? 'updatedAt'
          : col;

    if (JSON_FIELDS.includes(camelField as BriefField) && typeof val === 'string') {
      try {
        brief[camelField] = JSON.parse(val);
      } catch {
        brief[camelField] = val;
      }
    } else {
      brief[camelField] = val ?? null;
    }
  }

  return brief as unknown as Brief;
}

/**
 * Creates a new brief entry in the database
 *
 * @param db Database connection (defaults to the shared connection)
 * @returns The newly created brief object with ID assigned
 */
export function createBrief(db: Database.Database = getDb()): Brief {
  const id = generateId();

  db.prepare('INSERT INTO briefs (id) VALUES (?)').run(id);

  const row = db.prepare('SELECT * FROM briefs WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToBrief(row);
}

/**
 * Retrieves all briefs ordered by updated_at / created_at descending
 *
 * @param db Database connection (defaults to the shared connection)
 * @returns Array of brief objects
 */
export function listBriefs(db: Database.Database = getDb()): Brief[] {
  const rows = db
    .prepare('SELECT * FROM briefs ORDER BY COALESCE(updated_at, created_at) DESC, rowid DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToBrief);
}

/**
 * Retrieves the most recently created or updated brief from the database
 *
 * @param db Database connection (defaults to the shared connection)
 * @returns The latest brief object, or null if no briefs exist
 */
export function getLatestBrief(db: Database.Database = getDb()): Brief | null {
  const row = db
    .prepare(
      'SELECT * FROM briefs ORDER BY COALESCE(updated_at, created_at) DESC, rowid DESC LIMIT 1'
    )
    .get() as Record<string, unknown> | undefined;
  return row ? rowToBrief(row) : null;
}

/**
 * Retrieves a specific brief by its ID
 *
 * @param id - The unique identifier of the brief to retrieve
 * @param db Database connection (defaults to the shared connection)
 * @returns The brief object if found, or null if not found
 */
export function getBriefById(id: string, db: Database.Database = getDb()): Brief | null {
  const row = db.prepare('SELECT * FROM briefs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToBrief(row) : null;
}

/**
 * Resolves a brief by ID or falls back to the latest one
 *
 * @param id - Optional brief identifier
 * @param db Database connection (defaults to the shared connection)
 * @returns The resolved brief object or null if not found
 */
export function resolveBrief(id?: string, db: Database.Database = getDb()): Brief | null {
  return id ? getBriefById(id, db) : getLatestBrief(db);
}

/**
 * Sets a field value on an existing brief
 *
 * @param briefId - The unique identifier of the brief
 * @param field - The field name to update
 * @param value - The new value for the field
 * @param db Database connection (defaults to the shared connection)
 */
export function setField(
  briefId: string,
  field: BriefField,
  value: unknown,
  db: Database.Database = getDb()
): void {
  const column = FIELD_TO_COLUMN[field];
  const storeValue = JSON_FIELDS.includes(field) ? JSON.stringify(value) : (value as string);

  db.prepare(`UPDATE briefs SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(
    storeValue,
    briefId
  );
}

/**
 * Gets a field value from an existing brief
 *
 * @param briefId - The unique identifier of the brief
 * @param field - The field name to retrieve
 * @param db Database connection (defaults to the shared connection)
 * @returns The field value, or null/undefined if not found
 */
export function getField(
  briefId: string,
  field: BriefField,
  db: Database.Database = getDb()
): unknown {
  const column = FIELD_TO_COLUMN[field];
  const row = db.prepare(`SELECT ${column} FROM briefs WHERE id = ?`).get(briefId) as
    Record<string, unknown> | undefined;

  if (!row) {
    return undefined;
  }

  const raw = row[column];
  if (JSON_FIELDS.includes(field) && typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw ?? null;
}

/**
 * Marks a brief as complete
 *
 * @param briefId - The unique identifier of the brief to mark complete
 * @param db Database connection (defaults to the shared connection)
 */
export function markComplete(briefId: string, db: Database.Database = getDb()): void {
  db.prepare(
    "UPDATE briefs SET status = 'complete', updated_at = datetime('now') WHERE id = ?"
  ).run(briefId);
}
