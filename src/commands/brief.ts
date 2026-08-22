import { Command } from 'commander';
import { createBrief, resolveBrief, setField, getField, markComplete } from '../db/brief-repo.js';
import {
  isValidField,
  parseFieldValue,
  getRequiredFieldStatuses,
  getMissingRequiredFields,
  isBriefComplete,
} from '../utils/validation.js';
import { BRIEF_FIELDS, type BriefField } from '../models/brief.js';

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

type BriefCommandSuccess =
  | CreateBriefResult
  | SetFieldResult
  | GetFieldResult
  | ShowBriefResult
  | StatusResult
  | CompleteBriefResult;

interface ErrorOutput {
  ok: false;
  error: string;
  validFields?: string[];
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
    .argument('<field>', `Field name (${BRIEF_FIELDS.join(', ')})`)
    .argument('<value...>', 'Field value (string or JSON)')
    .option('--base64', 'Interpret value as a base64-encoded string')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((field: string, valueParts: string[], opts: { id?: string; base64?: boolean }) => {
      let value = valueParts.join(' ');
      if (opts.base64) {
        try {
          value = Buffer.from(value, 'base64').toString('utf-8');
        } catch {
          fail('Invalid base64 encoding for field value');
        }
      }
      if (!isValidField(field)) {
        fail(`Unknown field "${field}"`, {
          validFields: [...BRIEF_FIELDS],
        });
      }

      const b = resolveOrFail(opts.id);

      let parsed: unknown;
      try {
        parsed = parseFieldValue(field as BriefField, value);
      } catch (e) {
        fail((e as Error).message);
      }

      setField(b.id, field as BriefField, parsed);
      out({ ok: true, field, value: parsed });
    });

  brief
    .command('get')
    .description('Get a field value from the brief')
    .argument('<field>', 'Field name')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((field: string, opts: { id?: string }) => {
      if (!isValidField(field)) {
        fail(`Unknown field "${field}"`, {
          validFields: [...BRIEF_FIELDS],
        });
      }

      const b = resolveOrFail(opts.id);
      const value = getField(b.id, field as BriefField);
      out({ ok: true, field, value: value ?? null });
    });

  brief
    .command('show')
    .description('Show the full brief')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      out({ ok: true, brief: b });
    });

  brief
    .command('status')
    .description('Show brief completeness status')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      const required = getRequiredFieldStatuses(b);
      const complete = isBriefComplete(b);
      out({ ok: true, status: b.status, required, complete });
    });

  brief
    .command('complete')
    .description('Mark brief as complete')
    .option('--id <briefId>', 'Brief ID (defaults to latest)')
    .action((opts: { id?: string }) => {
      const b = resolveOrFail(opts.id);
      const missing = getMissingRequiredFields(b);

      if (missing.length > 0) {
        fail('Missing required fields', { missing });
      }

      markComplete(b.id);
      out({ ok: true, id: b.id, status: 'complete' });
    });
}
