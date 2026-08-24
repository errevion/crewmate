import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { getLatestBrief, getBriefById } from '../db/brief-repo.js';
import { recordHeartbeat, markSessionStopped, getLatestSession } from '../db/session-repo.js';
import type { SessionStatus } from '../models/session.js';

interface SessionResult {
  ok: true;
  session?: unknown;
}

interface ErrorOutput {
  ok: false;
  error: string;
}

function out(result: SessionResult | ErrorOutput): void {
  process.stdout.write(JSON.stringify(result) + '\n');
}

function fail(message: string): never {
  out({ ok: false, error: message });
  process.exit(1);
}

function resolveTargetBrief(briefId?: string): string {
  if (briefId) {
    const brief = getBriefById(briefId);
    if (!brief) {
      fail(`Brief not found: ${briefId}`);
    }
    return brief.id;
  }

  const latest = getLatestBrief();
  if (!latest) {
    fail('No brief found');
  }
  return latest.id;
}

/**
 *
 */
export function registerSessionCommand(program: Command): void {
  const sessionGroup = program
    .command('session')
    .description('Manage harness session liveness and heartbeat');

  sessionGroup
    .command('heartbeat')
    .description('Record a session heartbeat')
    .option('--brief <briefId>', 'Optional brief ID')
    .option('--harness <harness>', 'Harness name (e.g. opencode)', 'opencode')
    .option('--pid <pid>', 'Process ID of the harness')
    .option('--status <status>', 'Session status (active | idle | stopped)', 'active')
    .action((opts: { brief?: string; harness: string; pid?: string; status: string }) => {
      const briefId = resolveTargetBrief(opts.brief);
      const pidNum = opts.pid ? parseInt(opts.pid, 10) : null;
      if (pidNum !== null && (!Number.isFinite(pidNum) || pidNum <= 0)) {
        fail(`Invalid PID: ${opts.pid}`);
      }
      const validStatuses = ['active', 'idle', 'stopped'];
      if (!validStatuses.includes(opts.status)) {
        fail(`Invalid status: ${opts.status}. Must be one of: ${validStatuses.join(', ')}`);
      }
      const status = opts.status as SessionStatus;

      const session = recordHeartbeat(getDb(), briefId, opts.harness, pidNum, status);
      out({ ok: true, session });
    });

  sessionGroup
    .command('stop')
    .description('Mark a harness session as stopped')
    .option('--brief <briefId>', 'Optional brief ID')
    .option('--harness <harness>', 'Harness name', 'opencode')
    .action((opts: { brief?: string; harness: string }) => {
      const briefId = resolveTargetBrief(opts.brief);
      markSessionStopped(getDb(), briefId, opts.harness);
      out({ ok: true });
    });

  sessionGroup
    .command('status')
    .description('Get the latest session status for a brief')
    .option('--brief <briefId>', 'Optional brief ID')
    .action((opts: { brief?: string }) => {
      const briefId = resolveTargetBrief(opts.brief);
      const session = getLatestSession(getDb(), briefId);
      out({ ok: true, session });
    });
}
