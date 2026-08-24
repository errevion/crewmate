import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { ExecutionEvent, EventActor, EventType } from '../models/event.js';

/**
 *
 */
export function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToEvent(row: Record<string, unknown>): ExecutionEvent {
  return {
    id: row.id as string,
    briefId: row.brief_id as string,
    taskId: (row.task_id as string) || null,
    actor: row.actor as EventActor,
    type: row.type as EventType,
    message: row.message as string,
    createdAt: row.created_at as string,
  };
}

/**
 * Creates a workflow lifecycle event
 *
 * @param db The database connection
 * @param briefId The brief this event belongs to
 * @param actor The agent that emitted the event
 * @param type The kind of lifecycle event
 * @param message A human-readable description of the event
 * @param options Optional taskId to link the event to a task
 */
export function createEvent(
  db: Database.Database,
  briefId: string,
  actor: EventActor,
  type: EventType,
  message: string,
  options?: { taskId?: string | null }
): ExecutionEvent {
  const id = generateId();
  db.prepare(
    `INSERT INTO execution_events (id, brief_id, task_id, actor, type, message) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, briefId, options?.taskId ?? null, actor, type, message);

  const row = db.prepare(`SELECT * FROM execution_events WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

  if (!row) {
    throw new Error('Failed to create execution event');
  }

  return rowToEvent(row);
}

/**
 *
 */
export interface ListEventsFilter {
  briefId?: string;
  taskId?: string;
  actor?: EventActor;
  type?: EventType;
  limit?: number;
}

/**
 * Counts workflow lifecycle events for a brief
 *
 * @param db The database connection
 * @param briefId The brief to count events for
 */
export function countEvents(db: Database.Database, briefId: string): number {
  const stmt = db.prepare(`SELECT COUNT(*) AS count FROM execution_events WHERE brief_id = ?`);
  const row = stmt.get(briefId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Lists workflow lifecycle events, optionally filtered
 *
 * @param db The database connection
 * @param filter Optional filters (briefId, taskId, actor, type, limit)
 */
export function listEvents(db: Database.Database, filter?: ListEventsFilter): ExecutionEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.briefId) {
    conditions.push('brief_id = ?');
    params.push(filter.briefId);
  }

  if (filter?.taskId) {
    conditions.push('task_id = ?');
    params.push(filter.taskId);
  }

  if (filter?.actor) {
    conditions.push('actor = ?');
    params.push(filter.actor);
  }

  if (filter?.type) {
    conditions.push('type = ?');
    params.push(filter.type);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit =
    filter?.limit && Number.isFinite(filter.limit) && filter.limit > 0
      ? ` LIMIT ${Math.floor(filter.limit)}`
      : '';
  const stmt = db.prepare(
    `SELECT * FROM execution_events ${whereClause} ORDER BY created_at DESC, rowid DESC${safeLimit}`
  );
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}
