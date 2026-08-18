import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { FileLock } from '../models/lock.js';

/**
 *
 */
export function generateId(): string {
  return randomBytes(4).toString('hex');
}

/**
 *
 */
export function normalizeFilePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/');
}

function rowToLock(row: Record<string, unknown>): FileLock {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    filePath: row.file_path as string,
    createdAt: row.created_at as string,
  };
}

/**
 *
 */
export interface AcquireLocksSuccess {
  ok: true;
  locked: string[];
}

/**
 *
 */
export interface AcquireLocksFailure {
  ok: false;
  conflict: string;
  lockedBy: string;
}

/**
 *
 */
export type AcquireLocksResult = AcquireLocksSuccess | AcquireLocksFailure;

/**
 * Attempts to atomically acquire locks on multiple files for a given task.
 * Fails if any file is already locked by another task.
 */
export function acquireLocks(
  db: Database.Database,
  taskId: string,
  filePaths: string[]
): AcquireLocksResult {
  const normalizedPaths = Array.from(new Set(filePaths.map(normalizeFilePath).filter(Boolean)));

  if (normalizedPaths.length === 0) {
    return { ok: true, locked: [] };
  }

  const findLockStmt = db.prepare(`SELECT * FROM file_locks WHERE file_path = ?`);
  const insertLockStmt = db.prepare(
    `INSERT INTO file_locks (id, task_id, file_path) VALUES (?, ?, ?)`
  );

  const tx = db.transaction(() => {
    // 1. Check all paths for conflicts with OTHER tasks
    for (const filePath of normalizedPaths) {
      const existing = findLockStmt.get(filePath) as Record<string, unknown> | undefined;
      if (existing && existing.task_id !== taskId) {
        return {
          ok: false as const,
          conflict: filePath,
          lockedBy: existing.task_id as string,
        };
      }
    }

    // 2. Insert locks for paths not yet locked by this task
    const newlyLocked: string[] = [];
    for (const filePath of normalizedPaths) {
      const existing = findLockStmt.get(filePath) as Record<string, unknown> | undefined;
      if (!existing) {
        insertLockStmt.run(generateId(), taskId, filePath);
        newlyLocked.push(filePath);
      }
    }

    return {
      ok: true as const,
      locked: normalizedPaths,
    };
  });

  return tx();
}

/**
 * Releases file locks held by a task.
 * If filePaths is provided, releases only those files. Otherwise releases all locks for the task.
 */
export function releaseLocks(
  db: Database.Database,
  taskId: string,
  filePaths?: string[]
): { ok: true; released: number } {
  if (filePaths && filePaths.length > 0) {
    const normalized = filePaths.map(normalizeFilePath).filter(Boolean);
    const stmt = db.prepare(`DELETE FROM file_locks WHERE task_id = ? AND file_path = ?`);
    let count = 0;
    const tx = db.transaction(() => {
      for (const p of normalized) {
        const info = stmt.run(taskId, p);
        count += info.changes;
      }
    });
    tx();
    return { ok: true, released: count };
  }

  const info = db.prepare(`DELETE FROM file_locks WHERE task_id = ?`).run(taskId);
  return { ok: true, released: info.changes };
}

/**
 * Lists all active file locks, optionally filtered by taskId.
 */
export function listLocks(db: Database.Database, taskId?: string): FileLock[] {
  if (taskId) {
    const stmt = db.prepare(`SELECT * FROM file_locks WHERE task_id = ? ORDER BY created_at ASC`);
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map(rowToLock);
  }

  const stmt = db.prepare(`SELECT * FROM file_locks ORDER BY created_at ASC`);
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(rowToLock);
}
