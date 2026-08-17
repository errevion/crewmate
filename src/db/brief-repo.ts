import { randomBytes } from 'node:crypto';
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
 * @returns The newly created brief object with ID assigned
 */
export function createBrief(): Brief {
  const db = getDb();
  const id = generateId();

  db.prepare('INSERT INTO briefs (id) VALUES (?)').run(id);

  const row = db.prepare('SELECT * FROM briefs WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToBrief(row);
}

/**
 * Retrieves the most recently created brief from the database
 *
 * @returns The latest brief object, or null if no briefs exist
 */
export function getLatestBrief(): Brief | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM briefs ORDER BY created_at DESC LIMIT 1').get() as
    Record<string, unknown> | undefined;
  return row ? rowToBrief(row) : null;
}

/**
 * Retrieves a specific brief by its ID
 *
 * @param id - The unique identifier of the brief to retrieve
 * @returns The brief object if found, or null if not found
 */
export function getBriefById(id: string): Brief | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM briefs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToBrief(row) : null;
}

/**
 * Resolves a brief by ID or falls back to the latest one
 *
 * @param id - Optional brief identifier
 * @returns The resolved brief object or null if not found
 */
export function resolveBrief(id?: string): Brief | null {
  return id ? getBriefById(id) : getLatestBrief();
}

/**
 * Sets a field value on an existing brief
 *
 * @param briefId - The unique identifier of the brief
 * @param field - The field name to update
 * @param value - The new value for the field
 */
export function setField(briefId: string, field: BriefField, value: unknown): void {
  const db = getDb();
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
 * @returns The field value, or null/undefined if not found
 */
export function getField(briefId: string, field: BriefField): unknown {
  const db = getDb();
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
 */
export function markComplete(briefId: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE briefs SET status = 'complete', updated_at = datetime('now') WHERE id = ?"
  ).run(briefId);
}
