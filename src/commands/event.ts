import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { getTaskById } from '../db/task-repo.js';
import { getLatestBrief, getBriefById } from '../db/brief-repo.js';
import { EVENT_ACTORS, EVENT_TYPES, type EventActor, type EventType } from '../models/event.js';
import { createEvent, listEvents } from '../db/event-repo.js';

interface AddEventResult {
  ok: true;
  id: string;
  briefId: string;
  taskId: string | null;
  actor: string;
  type: string;
  message: string;
  createdAt: string;
}

interface ListEventsResult {
  ok: true;
  events: Array<{
    id: string;
    briefId: string;
    taskId: string | null;
    actor: string;
    type: string;
    message: string;
    createdAt: string;
  }>;
}

interface ErrorOutput {
  ok: false;
  error: string;
}

function out(result: AddEventResult | ListEventsResult | ErrorOutput): void {
  process.stdout.write(JSON.stringify(result) + '\n');
}

function fail(message: string): never {
  out({ ok: false, error: message });
  process.exit(1);
}

function resolveTargetBrief(opts: { task?: string; brief?: string }): string {
  if (opts.brief) {
    const brief = getBriefById(opts.brief);
    if (!brief) {
      fail(`Brief not found: ${opts.brief}`);
    }
    return brief.id;
  }

  if (opts.task) {
    const task = getTaskById(getDb(), opts.task);
    if (!task) {
      fail(`Task not found: ${opts.task}`);
    }
    return task.briefId;
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
export function registerEventCommand(program: Command): void {
  const eventGroup = program
    .command('event')
    .description('Record and list workflow lifecycle events for live visualization');

  // event add --actor <a> --type <t> --message <m> [--task <taskId>] [--brief <briefId>]
  eventGroup
    .command('add')
    .description('Record a workflow lifecycle event')
    .option('--actor <actor>', `Agent that emitted the event (${EVENT_ACTORS.join(' | ')})`, '')
    .option('--type <type>', `Event type (${EVENT_TYPES.join(' | ')})`, '')
    .option('--message <message>', 'Human-readable event description', '')
    .option('--task <taskId>', 'Optional task this event relates to')
    .option('--brief <briefId>', 'Optional brief ID (defaults to task brief or latest)')
    .action(
      (opts: { actor: string; type: string; message: string; task?: string; brief?: string }) => {
        if (!opts.actor) {
          fail(`--actor is required (${EVENT_ACTORS.join(' | ')})`);
        }
        if (!EVENT_ACTORS.includes(opts.actor as EventActor)) {
          fail(`Invalid actor: ${opts.actor}. Must be one of: ${EVENT_ACTORS.join(', ')}`);
        }

        if (!opts.type) {
          fail(`--type is required (${EVENT_TYPES.join(' | ')})`);
        }
        if (!EVENT_TYPES.includes(opts.type as EventType)) {
          fail(`Invalid event type: ${opts.type}. Must be one of: ${EVENT_TYPES.join(', ')}`);
        }

        if (!opts.message || !opts.message.trim()) {
          fail('--message is required');
        }

        const briefId = resolveTargetBrief(opts);

        // Deduplication guardrail: avoid duplicate recent events of identical actor + type (especially dispatches)
        const recentEvents = listEvents(getDb(), {
          briefId,
          taskId: opts.task,
          actor: opts.actor as EventActor,
          type: opts.type as EventType,
          limit: 3,
        });

        const now = Date.now();
        const duplicate = recentEvents.find((e) => {
          const createdAtUtc = e.createdAt.endsWith('Z') ? e.createdAt : e.createdAt + 'Z';
          const age = now - new Date(createdAtUtc).getTime();
          if (age > 4000) {
            return false;
          }
          return e.message === opts.message.trim();
        });

        if (duplicate) {
          out({
            ok: true,
            id: duplicate.id,
            briefId: duplicate.briefId,
            taskId: duplicate.taskId,
            actor: duplicate.actor,
            type: duplicate.type,
            message: duplicate.message,
            createdAt: duplicate.createdAt,
          });
          return;
        }

        const event = createEvent(
          getDb(),
          briefId,
          opts.actor as EventActor,
          opts.type as EventType,
          opts.message.trim(),
          { taskId: opts.task ?? null }
        );

        out({
          ok: true,
          id: event.id,
          briefId: event.briefId,
          taskId: event.taskId,
          actor: event.actor,
          type: event.type,
          message: event.message,
          createdAt: event.createdAt,
        });
      }
    );

  // event list [--brief <b>] [--task <t>] [--actor <a>] [--type <t>] [--limit <n>]
  eventGroup
    .command('list')
    .description('List workflow lifecycle events')
    .option('--brief <briefId>', 'Filter by brief ID')
    .option('--task <taskId>', 'Filter by task ID')
    .option('--actor <actor>', 'Filter by actor')
    .option('--type <type>', 'Filter by event type')
    .option('--limit <n>', 'Limit number of events returned', '100')
    .action(
      (opts: { brief?: string; task?: string; actor?: string; type?: string; limit?: string }) => {
        let targetBriefId = opts.brief;

        if (!targetBriefId && !opts.task) {
          const latest = getLatestBrief();
          if (latest) {
            targetBriefId = latest.id;
          }
        }

        if (opts.actor && !EVENT_ACTORS.includes(opts.actor as EventActor)) {
          fail(`Invalid actor: ${opts.actor}. Must be one of: ${EVENT_ACTORS.join(', ')}`);
        }

        if (opts.type && !EVENT_TYPES.includes(opts.type as EventType)) {
          fail(`Invalid event type: ${opts.type}. Must be one of: ${EVENT_TYPES.join(', ')}`);
        }

        const events = listEvents(getDb(), {
          briefId: targetBriefId,
          taskId: opts.task,
          actor: opts.actor ? (opts.actor as EventActor) : undefined,
          type: opts.type ? (opts.type as EventType) : undefined,
          limit: opts.limit
            ? Number.isFinite(parseInt(opts.limit, 10))
              ? parseInt(opts.limit, 10)
              : undefined
            : undefined,
        });

        out({
          ok: true,
          events: events.map((e) => ({
            id: e.id,
            briefId: e.briefId,
            taskId: e.taskId,
            actor: e.actor,
            type: e.type,
            message: e.message,
            createdAt: e.createdAt,
          })),
        });
      }
    );
}
