import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { getTaskById } from '../db/task-repo.js';
import { acquireLocks, releaseLocks, listLocks, normalizeFilePath } from '../db/lock-repo.js';

interface AcquireLockResult {
  ok: true;
  taskId: string;
  files: string[];
}

interface ReleaseLockResult {
  ok: true;
  taskId: string;
  released: number;
}

interface ListLocksResult {
  ok: true;
  locks: Array<{
    id: string;
    taskId: string;
    filePath: string;
    createdAt: string;
  }>;
}

interface ErrorOutput {
  ok: false;
  error: string;
  conflict?: string;
  lockedBy?: string;
}

function out(result: AcquireLockResult | ReleaseLockResult | ListLocksResult | ErrorOutput): void {
  process.stdout.write(JSON.stringify(result) + '\n');
}

function fail(message: string, extra?: { conflict?: string; lockedBy?: string }): never {
  out({ ok: false, error: message, ...extra });
  process.exit(1);
}

/**
 *
 */
export function registerLockCommand(program: Command): void {
  const lockGroup = program
    .command('lock')
    .description('Manage file locks for parallel task execution');

  // lock acquire <task-id> --files <paths...>
  lockGroup
    .command('acquire')
    .description('Acquire write locks on files for a task')
    .argument('<task-id>', 'The task ID acquiring the lock')
    .option('--files <files...>', 'File paths to lock')
    .action((taskId, opts) => {
      const task = getTaskById(getDb(), taskId);
      if (!task) {
        fail(`Task not found: ${taskId}`);
      }

      const files = (opts.files ?? []).map(normalizeFilePath).filter(Boolean);
      if (files.length === 0) {
        fail('--files is required and must contain at least one file path');
      }

      const result = acquireLocks(getDb(), taskId, files);
      if (!result.ok) {
        fail(`File already locked by task ${result.lockedBy}: ${result.conflict}`, {
          conflict: result.conflict,
          lockedBy: result.lockedBy,
        });
      }

      out({
        ok: true,
        taskId,
        files: result.locked,
      });
    });

  // lock release <task-id> [--files <paths...>]
  lockGroup
    .command('release')
    .description('Release file locks held by a task')
    .argument('<task-id>', 'The task ID releasing the lock')
    .option('--files <files...>', 'Specific file paths to release (optional)')
    .action((taskId, opts) => {
      const task = getTaskById(getDb(), taskId);
      if (!task) {
        fail(`Task not found: ${taskId}`);
      }

      const files = opts.files && opts.files.length > 0 ? opts.files : undefined;
      const result = releaseLocks(getDb(), taskId, files);

      out({
        ok: true,
        taskId,
        released: result.released,
      });
    });

  // lock list [--task <task-id>]
  lockGroup
    .command('list')
    .description('List active file locks')
    .option('--task <task-id>', 'Filter locks by task ID')
    .action((opts) => {
      const locks = listLocks(getDb(), opts.task);
      out({
        ok: true,
        locks: locks.map((l) => ({
          id: l.id,
          taskId: l.taskId,
          filePath: l.filePath,
          createdAt: l.createdAt,
        })),
      });
    });
}
