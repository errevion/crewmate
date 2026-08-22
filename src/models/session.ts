/**
 * Session liveness entity definition
 */

export const SESSION_STATUSES = ['active', 'idle', 'stopped'] as const;

/**
 *
 */
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 *
 */
export interface SessionLiveness {
  id: string;
  briefId: string;
  harness: string;
  pid: number | null;
  status: SessionStatus;
  lastHeartbeatAt: string;
  createdAt: string;
}
