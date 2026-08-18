import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { ExecutionArtifact, ArtifactType } from '../models/artifact.js';

/**
 *
 */
export function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToArtifact(row: Record<string, unknown>): ExecutionArtifact {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    briefId: row.brief_id as string,
    type: row.type as ArtifactType,
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

/**
 *
 */
export function createArtifact(
  db: Database.Database,
  taskId: string,
  briefId: string,
  type: ArtifactType,
  content: string
): ExecutionArtifact {
  const id = generateId();
  db.prepare(
    `INSERT INTO execution_artifacts (id, task_id, brief_id, type, content) VALUES (?, ?, ?, ?, ?)`
  ).run(id, taskId, briefId, type, content);

  const row = db.prepare(`SELECT * FROM execution_artifacts WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

  if (!row) {
    throw new Error('Failed to create execution artifact');
  }

  return rowToArtifact(row);
}

/**
 *
 */
export interface ListArtifactsFilter {
  briefId?: string;
  taskId?: string;
  type?: ArtifactType;
}

/**
 *
 */
export function listArtifacts(
  db: Database.Database,
  filter?: ListArtifactsFilter
): ExecutionArtifact[] {
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

  if (filter?.type) {
    conditions.push('type = ?');
    params.push(filter.type);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(
    `SELECT * FROM execution_artifacts ${whereClause} ORDER BY created_at ASC`
  );
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(rowToArtifact);
}
