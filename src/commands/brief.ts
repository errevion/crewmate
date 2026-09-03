import { Command } from 'commander';
import {
  createBrief,
  resolveBrief,
  setField,
  getField,
  markComplete,
  reopenBrief,
  deleteBrief,
  deleteField,
} from '../db/brief-repo.js';
import { listWorkflowRuns } from '../db/workflow-repo.js';
import { listLocks } from '../db/lock-repo.js';
import { listTasksByBrief } from '../db/task-repo.js';
import { getDb } from '../db/connection.js';
import {
  parseFieldValue,
  getRequiredFieldStatuses,
  getMissingRequiredFields,
  isBriefComplete,
} from '../utils/validation.js';

// Output result types
interface CreateBriefResult {
  ok: true;
  id: string;
}

interface SetFieldResult {
  ok: true;
  field: string;
  value: unknown;
}

interface UnsetFieldResult {
  ok: true;
  id: string;
  field: string;
}

interface GetFieldResult {
  ok: true;
  field: string;
  value: unknown | null;
}

interface ShowBriefResult {
  ok: true;
  brief: ReturnType<typeof resolveBrief>;
}

interface StatusResult {
  ok: true;
  status: string;
  required: Record<string, 'set' | 'missing'>;
  complete: boolean;
}

interface CompleteBriefResult {
  ok: true;
  id: string;
  status: 'complete';
}

interface ReopenBriefResult {
  ok: true;
  id: string;
  status: 'draft';
}

interface DeleteBriefResult {
  ok: true;
  deletedId: string;
}

type BriefCommandSuccess =
  | CreateBriefResult
  | SetFieldResult
  | UnsetFieldResult
  | GetFieldResult
  | ShowBriefResult
  | StatusResult
  | CompleteBriefResult
  | ReopenBriefResult
  | DeleteBriefResult;

interface ErrorOutput {
  ok: false;
  error: string;
  missing?: string[];
  id?: string;
}

function out(data: BriefCommandSuccess | ErrorOutput): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function fail(error: string, extra?: Omit<ErrorOutput, 'ok' | 'error'>): never {
  out({ ok: false, error, ...extra });
  process.exit(1);
}

function resolveOrFail(id?: string) {
  const brief = resolveBrief(id);
  if (!brief) {
    fail('No brief found', id ? { id } : undefined);
  }
  return brief;
}

/**
 * Registers the brief command group with the Commander program
 *
 * @param program The Commander program instance to register commands on
 */
export function registerBriefCommand(program: Command): void {
  const brief = program.command('brief').description('Manage project briefs for AI agent workflow');

  brief
    .command('init')
    .description('Create a new brief')
    .action(() => {
      const b = createBrief();
      out({ ok: true, id: b.id });
    });

  brief
    .command('set')
    .description('Set a field on the brief')
    .argument('<field>', 'Field name')
    .argument('<value...>', 'Field value (string or JSON)')
    .option('--base64', 'Interpret value as a base64-encoded string')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((field: string, valueParts: string[], opts: { id?: string; base64?: boolean }) => {
      let value = valueParts.join(' ');
      if (opts.base64) {
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        if (!base64Regex.test(value)) {
          fail('Invalid base64 encoding for field value');
        }
        value = Buffer.from(value, 'base64').toString('utf-8');
      }

      const b = resolveOrFail(opts.id);

      if (b.status === 'complete') {
        fail('Cannot modify a completed brief. Create a new brief or revert status first.');
      }

      let parsed: unknown;
      try {
        parsed = parseFieldValue(field, value);
      } catch (e) {
        fail((e as Error).message);
      }

      setField(b.id, field, parsed);
      out({ ok: true, field, value: parsed });
    });

  brief
    .command('get')
    .description('Get a field value from the brief')
    .argument('<field>', 'Field name')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((field: string, opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      const value = getField(b.id, field);
      out({ ok: true, field, value: value ?? null });
    });

  brief
    .command('show')
    .description('Show the full brief fields')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      out({ ok: true, brief: b });
    });

  brief
    .command('status')
    .description('Show brief completeness status')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .option('--required-fields <fields>', 'Comma-separated list of required fields', '')
    .action((opts: { id?: string; requiredFields?: string }) => {
      const b = resolveOrFail(opts.id);
      const reqList = opts.requiredFields
        ? opts.requiredFields.split(',').map((s) => s.trim())
        : [];
      const required = getRequiredFieldStatuses(b, reqList);
      const complete = isBriefComplete(b, reqList);
      out({ ok: true, status: b.status, required, complete });
    });

  brief
    .command('complete')
    .description('Mark brief as complete')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .option('--required-fields <fields>', 'Comma-separated list of required fields', '')
    .action((opts: { id?: string; requiredFields?: string }) => {
      const b = resolveOrFail(opts.id);
      const reqList = opts.requiredFields
        ? opts.requiredFields.split(',').map((s) => s.trim())
        : [];
      const missing = getMissingRequiredFields(b, reqList);

      if (missing.length > 0) {
        fail('Missing required fields', { missing });
      }

      markComplete(b.id);
      out({ ok: true, id: b.id, status: 'complete' });
    });

  brief
    .command('reopen')
    .description('Reopen a completed brief back to draft status')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      reopenBrief(b.id);
      out({ ok: true, id: b.id, status: 'draft' });
    });

  brief
    .command('unset')
    .description('Remove a field from the brief')
    .argument('<field>', 'Field name to remove')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((field: string, opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      if (b.status === 'complete') {
        fail('Cannot modify a completed brief. Reopen the brief first.');
      }
      deleteField(b.id, field);
      out({ ok: true, id: b.id, field });
    });

  brief
    .command('delete')
    .description('Delete a brief and all associated data')
    .argument('[id]', 'Brief ID (defaults to latest)')
    .option('-f, --force', 'Force deletion even if workflow runs or locks are active')
    .action((id: string | undefined, opts: { force?: boolean }) => {
      const b = resolveOrFail(id);
      const db = getDb();

      if (!opts.force) {
        // Safety check 1: Active workflow runs
        const runs = listWorkflowRuns(db, b.id);
        const activeRun = runs.find((r) => r.status === 'running' || r.status === 'paused');
        if (activeRun) {
          fail(
            `Cannot delete brief with active workflow run (${activeRun.id}, status: ${activeRun.status}). Cancel the workflow first or use --force.`
          );
        }

        // Safety check 2: Active file locks
        const tasks = listTasksByBrief(db, b.id);
        const taskIds = new Set(tasks.map((t) => t.id));
        const allLocks = listLocks(db);
        const heldLocks = allLocks.filter((l) => taskIds.has(l.taskId));
        if (heldLocks.length > 0) {
          fail(
            `Cannot delete brief with active file locks held (${heldLocks.length} locks). Release locks first or use --force.`
          );
        }
      }

      deleteBrief(b.id, db);
      out({ ok: true, deletedId: b.id });
    });
}
