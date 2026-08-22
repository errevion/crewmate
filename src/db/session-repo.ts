import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { SessionLiveness, SessionStatus } from '../models/session.js';

interface SessionLivenessRow {
  id: string;
  brief_id: string;
  harness: string;
  pid: number | null;
  status: string;
  last_heartbeat_at: string;
  created_at: string;
}

function mapRow(row: SessionLivenessRow): SessionLiveness {
  return {
    id: row.id,
    briefId: row.brief_id,
    harness: row.harness,
    pid: row.pid,
    status: row.status as SessionStatus,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
  };
}

/**
 * Records or updates a session heartbeat
 */
export function recordHeartbeat(
  db: Database.Database,
  briefId: string,
  harness: string,
  pid: number | null,
  status: SessionStatus = 'active'
): SessionLiveness {
  const existing = db
    .prepare<[string, string]>(
      `SELECT * FROM session_liveness WHERE brief_id = ? AND harness = ? ORDER BY last_heartbeat_at DESC LIMIT 1`
    )
    .get(briefId, harness) as SessionLivenessRow | undefined;

  const now = new Date().toISOString();

  if (existing) {
    db.prepare<[string, number | null, string, string]>(
      `UPDATE session_liveness SET status = ?, pid = ?, last_heartbeat_at = ? WHERE id = ?`
    ).run(status, pid ?? existing.pid, now, existing.id);

    return {
      ...mapRow(existing),
      status,
      pid: pid ?? existing.pid,
      lastHeartbeatAt: now,
    };
  }

  const id = nanoid(8);
  db.prepare<[string, string, string, number | null, string, string, string]>(
    `INSERT INTO session_liveness (id, brief_id, harness, pid, status, last_heartbeat_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, briefId, harness, pid, status, now, now);

  return {
    id,
    briefId,
    harness,
    pid,
    status,
    lastHeartbeatAt: now,
    createdAt: now,
  };
}

/**
 * Marks a session as stopped
 */
export function markSessionStopped(db: Database.Database, briefId: string, harness: string): void {
  const now = new Date().toISOString();
  db.prepare<[string, string, string]>(
    `UPDATE session_liveness SET status = 'stopped', last_heartbeat_at = ? WHERE brief_id = ? AND harness = ?`
  ).run(now, briefId, harness);
}

/**
 * Gets the latest session liveness record for a brief
 */
export function getLatestSession(db: Database.Database, briefId: string): SessionLiveness | null {
  const row = db
    .prepare<[string]>(
      `SELECT * FROM session_liveness WHERE brief_id = ? ORDER BY last_heartbeat_at DESC LIMIT 1`
    )
    .get(briefId) as SessionLivenessRow | undefined;

  return row ? mapRow(row) : null;
}

/**
 * Checks if a process PID is currently alive on the system
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // EPERM means process exists but we don't have permission to signal it
    return (err as { code?: string })?.code === 'EPERM';
  }
}
