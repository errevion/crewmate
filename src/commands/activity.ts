import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { getLatestBrief, getBriefById } from '../db/brief-repo.js';
import { FRONTMAN_ACTIVITIES, type FrontmanActivityType } from '../models/activity.js';
import {
  setActivity,
  getCurrentActivity,
  clearActivity,
  listActivities,
} from '../db/activity-repo.js';

interface ActivityOutput {
  ok: true;
  activity: {
    id: string;
    briefId: string;
    activityType: string;
    message: string | null;
    metadata: Record<string, unknown> | null;
    startedAt: string;
    endedAt: string | null;
  } | null;
}

interface ListActivitiesOutput {
  ok: true;
  activities: Array<{
    id: string;
    briefId: string;
    activityType: string;
    message: string | null;
    metadata: Record<string, unknown> | null;
    startedAt: string;
    endedAt: string | null;
  }>;
}

interface ClearActivityOutput {
  ok: true;
  cleared: boolean;
}

interface ErrorOutput {
  ok: false;
  error: string;
}

function out(
  result: ActivityOutput | ListActivitiesOutput | ClearActivityOutput | ErrorOutput
): void {
  process.stdout.write(JSON.stringify(result) + '\n');
}

function fail(message: string): never {
  out({ ok: false, error: message });
  process.exit(1);
}

function resolveTargetBrief(opts: { brief?: string }): string {
  if (opts.brief) {
    const brief = getBriefById(opts.brief);
    if (!brief) {
      fail(`Brief not found: ${opts.brief}`);
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
export function registerActivityCommand(program: Command): void {
  const activityGroup = program
    .command('activity')
    .description('Manage and query Frontman activity state for live visualization');

  // activity set <type> [--message <message>] [--metadata <json>] [--brief <briefId>]
  activityGroup
    .command('set <type>')
    .description(`Set Frontman's active state (${FRONTMAN_ACTIVITIES.join(' | ')})`)
    .option('--message <message>', 'Optional message or context description')
    .option('--metadata <metadata>', 'Optional JSON metadata')
    .option('--brief <briefId>', 'Optional brief ID (defaults to latest)')
    .action((type: string, opts: { message?: string; metadata?: string; brief?: string }) => {
      if (!FRONTMAN_ACTIVITIES.includes(type as FrontmanActivityType)) {
        fail(`Invalid activity type: ${type}. Must be one of: ${FRONTMAN_ACTIVITIES.join(', ')}`);
      }

      let parsedMetadata: Record<string, unknown> | null = null;
      if (opts.metadata) {
        try {
          parsedMetadata = JSON.parse(opts.metadata);
        } catch {
          fail('Invalid JSON in --metadata');
        }
      }

      const briefId = resolveTargetBrief(opts);
      const activity = setActivity(getDb(), briefId, type as FrontmanActivityType, {
        message: opts.message?.trim() || null,
        metadata: parsedMetadata,
      });

      out({
        ok: true,
        activity,
      });
    });

  // activity get [--brief <briefId>]
  activityGroup
    .command('get')
    .description('Get the current active Frontman activity')
    .option('--brief <briefId>', 'Optional brief ID (defaults to latest)')
    .action((opts: { brief?: string }) => {
      let targetBriefId = opts.brief;
      if (!targetBriefId) {
        const latest = getLatestBrief();
        if (latest) {
          targetBriefId = latest.id;
        }
      }

      if (!targetBriefId) {
        out({ ok: true, activity: null });
        return;
      }

      const activity = getCurrentActivity(getDb(), targetBriefId);
      out({
        ok: true,
        activity,
      });
    });

  // activity clear [--brief <briefId>]
  activityGroup
    .command('clear')
    .description('Clear (end) the current active Frontman activity')
    .option('--brief <briefId>', 'Optional brief ID (defaults to latest)')
    .action((opts: { brief?: string }) => {
      const briefId = resolveTargetBrief(opts);
      const cleared = clearActivity(getDb(), briefId);
      out({
        ok: true,
        cleared,
      });
    });

  // activity list [--brief <briefId>] [--limit <n>]
  activityGroup
    .command('list')
    .description('List recent Frontman activities')
    .option('--brief <briefId>', 'Optional brief ID (defaults to latest)')
    .option('--limit <n>', 'Limit number of activities returned', '50')
    .action((opts: { brief?: string; limit?: string }) => {
      let targetBriefId = opts.brief;
      if (!targetBriefId) {
        const latest = getLatestBrief();
        if (latest) {
          targetBriefId = latest.id;
        }
      }

      if (!targetBriefId) {
        out({ ok: true, activities: [] });
        return;
      }

      const activities = listActivities(getDb(), {
        briefId: targetBriefId,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });

      out({
        ok: true,
        activities,
      });
    });
}
