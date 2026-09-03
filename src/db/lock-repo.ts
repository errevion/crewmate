import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { findProjectRoot } from './connection.js';
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
  const trimmed = filePath.trim();
  if (!trimmed) {
    return '';
  }
  const resolved = resolve(trimmed);
  const root = findProjectRoot(process.cwd());
  const rel = relative(root, resolved);
  const normalized = rel.replace(/\\/g, '/');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLowerCase()
    : normalized;
}

function rowToLock(row: Record<string, unknown>): FileLock {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    filePath: row.file_path as string,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string) ?? null,
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

  const cleanExpiredStmt = db.prepare(
    `DELETE FROM file_locks WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`
  );
  const findLockStmt = db.prepare(`SELECT * FROM file_locks WHERE file_path = ?`);
  const insertLockStmt = db.prepare(
    `INSERT INTO file_locks (id, task_id, file_path, expires_at) VALUES (?, ?, ?, datetime('now', '+5 minutes'))`
  );

  const tx = db.transaction(() => {
    cleanExpiredStmt.run();

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

    const newlyLocked: string[] = [];
    for (const filePath of normalizedPaths) {
      const existing = findLockStmt.get(filePath) as Record<string, unknown> | undefined;
      if (!existing) {
        insertLockStmt.run(generateId(), taskId, filePath);
        newlyLocked.push(filePath);
      } else {
        db.prepare(
          `UPDATE file_locks SET expires_at = datetime('now', '+5 minutes') WHERE id = ?`
        ).run(existing.id);
      }
    }

    return {
      ok: true as const,
      locked: normalizedPaths,
    };
  });

  return tx.immediate();
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
  const expiredFilter = `(expires_at IS NULL OR expires_at >= datetime('now'))`;
  if (taskId) {
    const stmt = db.prepare(
      `SELECT * FROM file_locks WHERE task_id = ? AND ${expiredFilter} ORDER BY created_at ASC`
    );
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map(rowToLock);
  }

  const stmt = db.prepare(
    `SELECT * FROM file_locks WHERE ${expiredFilter} ORDER BY created_at ASC`
  );
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(rowToLock);
}

/**
 * Releases a lock on a specific file path regardless of which task holds it
 */
export function releaseLockByPath(db: Database.Database, filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  const info = db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(normalized);
  return info.changes > 0;
}

/**
 * Clears all locks in the system, or all locks held by a specific task
 */
export function clearAllLocks(db: Database.Database, taskId?: string): number {
  if (taskId) {
    const info = db.prepare('DELETE FROM file_locks WHERE task_id = ?').run(taskId);
    return info.changes;
  }
  const info = db.prepare('DELETE FROM file_locks').run();
  return info.changes;
}

/**
 * Cleans up stale / expired locks immediately
 */
export function cleanStaleLocks(db: Database.Database): number {
  const info = db
    .prepare("DELETE FROM file_locks WHERE expires_at IS NOT NULL AND expires_at < datetime('now')")
    .run();
  return info.changes;
}
