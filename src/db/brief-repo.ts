import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { getDb } from './connection.js';
import type { Brief, BriefField } from '../models/brief.js';

function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToBrief(row: Record<string, unknown>, fieldRows: Record<string, unknown>[]): Brief {
  const brief: Brief = {
    id: row.id as string,
    status: row.status as 'draft' | 'complete',
    fields: {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };

  for (const fRow of fieldRows) {
    const fieldName = fRow.field_name as string;
    const fieldValue = fRow.field_value as string;

    if (fieldValue === null) {
      brief.fields[fieldName] = null;
      continue;
    }

    try {
      brief.fields[fieldName] = JSON.parse(fieldValue);
    } catch {
      brief.fields[fieldName] = fieldValue;
    }
  }

  return brief;
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
  return rowToBrief(row, []);
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

  if (rows.length === 0) {
    return [];
  }

  const briefIds = rows.map((r) => r.id);
  const placeholders = briefIds.map(() => '?').join(',');
  const fieldRows = db
    .prepare(`SELECT * FROM brief_fields WHERE brief_id IN (${placeholders})`)
    .all(...briefIds) as Record<string, unknown>[];

  const fieldsByBriefId = fieldRows.reduce<Record<string, Record<string, unknown>[]>>(
    (acc, row) => {
      const briefId = row.brief_id as string;
      if (!acc[briefId]) {
        acc[briefId] = [];
      }
      acc[briefId].push(row);
      return acc;
    },
    {}
  );

  return rows.map((row) => rowToBrief(row, fieldsByBriefId[row.id as string] || []));
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

  if (!row) {
    return null;
  }

  const fieldRows = db
    .prepare('SELECT * FROM brief_fields WHERE brief_id = ?')
    .all(row.id) as Record<string, unknown>[];

  return rowToBrief(row, fieldRows);
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

  if (!row) {
    return null;
  }

  const fieldRows = db.prepare('SELECT * FROM brief_fields WHERE brief_id = ?').all(id) as Record<
    string,
    unknown
  >[];

  return rowToBrief(row, fieldRows);
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
  const storeValue = typeof value === 'string' ? value : JSON.stringify(value);

  db.prepare(
    `
    INSERT INTO brief_fields (brief_id, field_name, field_value)
    VALUES (?, ?, ?)
    ON CONFLICT(brief_id, field_name) DO UPDATE SET field_value = excluded.field_value
  `
  ).run(briefId, field, storeValue);

  db.prepare(`UPDATE briefs SET updated_at = datetime('now') WHERE id = ?`).run(briefId);
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
  const row = db
    .prepare(`SELECT field_value FROM brief_fields WHERE brief_id = ? AND field_name = ?`)
    .get(briefId, field) as Record<string, unknown> | undefined;

  if (!row) {
    return undefined;
  }

  const raw = row.field_value;
  if (raw === null) {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
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

/**
 * Reopens a completed brief back to draft status
 *
 * @param briefId - The unique identifier of the brief to reopen
 * @param db Database connection (defaults to the shared connection)
 */
export function reopenBrief(briefId: string, db: Database.Database = getDb()): void {
  db.prepare("UPDATE briefs SET status = 'draft', updated_at = datetime('now') WHERE id = ?").run(
    briefId
  );
}

/**
 * Deletes a brief and cascades all child entities via SQLite foreign key rules
 *
 * @param briefId - The unique identifier of the brief to delete
 * @param db Database connection (defaults to the shared connection)
 * @returns true if a row was deleted, false otherwise
 */
export function deleteBrief(briefId: string, db: Database.Database = getDb()): boolean {
  const info = db.prepare('DELETE FROM briefs WHERE id = ?').run(briefId);
  return info.changes > 0;
}

/**
 * Deletes a specific field from a brief
 *
 * @param briefId - The unique identifier of the brief
 * @param fieldName - The name of the field to remove
 * @param db Database connection (defaults to the shared connection)
 * @returns true if a field was deleted, false otherwise
 */
export function deleteField(
  briefId: string,
  fieldName: string,
  db: Database.Database = getDb()
): boolean {
  const info = db
    .prepare('DELETE FROM brief_fields WHERE brief_id = ? AND field_name = ?')
    .run(briefId, fieldName);

  if (info.changes > 0) {
    db.prepare("UPDATE briefs SET updated_at = datetime('now') WHERE id = ?").run(briefId);
    return true;
  }
  return false;
}
