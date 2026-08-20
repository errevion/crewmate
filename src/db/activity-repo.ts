import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { FrontmanActivity, FrontmanActivityType } from '../models/activity.js';

/**
 *
 */
export function generateActivityId(): string {
  return randomBytes(4).toString('hex');
}

function rowToActivity(row: Record<string, unknown>): FrontmanActivity {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata && typeof row.metadata === 'string') {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }

  return {
    id: row.id as string,
    briefId: row.brief_id as string,
    activityType: row.activity_type as FrontmanActivityType,
    message: (row.message as string) || null,
    metadata,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string) || null,
  };
}

/**
 * Sets a new active activity for Frontman on a brief.
 * Ends any currently ongoing activity on the same brief.
 */
export function setActivity(
  db: Database.Database,
  briefId: string,
  activityType: FrontmanActivityType,
  options?: {
    message?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): FrontmanActivity {
  // End any open activities for this brief first
  db.prepare(
    `UPDATE frontman_activities SET ended_at = datetime('now') WHERE brief_id = ? AND ended_at IS NULL`
  ).run(briefId);

  const id = generateActivityId();
  const metadataJson = options?.metadata ? JSON.stringify(options.metadata) : null;
  const message = options?.message ?? null;

  db.prepare(
    `INSERT INTO frontman_activities (id, brief_id, activity_type, message, metadata) VALUES (?, ?, ?, ?, ?)`
  ).run(id, briefId, activityType, message, metadataJson);

  const row = db.prepare(`SELECT * FROM frontman_activities WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

  if (!row) {
    throw new Error('Failed to record frontman activity');
  }

  return rowToActivity(row);
}

/**
 * Gets the current active activity for a brief (where ended_at is NULL).
 */
export function getCurrentActivity(
  db: Database.Database,
  briefId: string
): FrontmanActivity | null {
  const row = db
    .prepare(
      `SELECT * FROM frontman_activities WHERE brief_id = ? AND ended_at IS NULL ORDER BY started_at DESC, rowid DESC LIMIT 1`
    )
    .get(briefId) as Record<string, unknown> | undefined;

  return row ? rowToActivity(row) : null;
}

/**
 * Clears/ends any active activity for a brief.
 */
export function clearActivity(db: Database.Database, briefId: string): boolean {
  const result = db
    .prepare(
      `UPDATE frontman_activities SET ended_at = datetime('now') WHERE brief_id = ? AND ended_at IS NULL`
    )
    .run(briefId);

  return result.changes > 0;
}

/**
 *
 */
export interface ListActivitiesFilter {
  briefId?: string;
  limit?: number;
}

/**
 * Lists past and present activities for a brief.
 */
export function listActivities(
  db: Database.Database,
  filter?: ListActivitiesFilter
): FrontmanActivity[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.briefId) {
    conditions.push('brief_id = ?');
    params.push(filter.briefId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = filter?.limit ? ` LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
  const stmt = db.prepare(
    `SELECT * FROM frontman_activities ${whereClause} ORDER BY started_at DESC, rowid DESC${limitClause}`
  );
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(rowToActivity);
}
