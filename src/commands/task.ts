import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { TASK_STATUSES, type Task } from '../models/task.js';
import { ARTIFACT_TYPES, type ArtifactType } from '../models/artifact.js';
import {
  createTask,
  getTaskById,
  listTasksByBrief,
  updateTask,
  removeTask,
  deleteTasksByBrief,
  validateDependencies,
} from '../db/task-repo.js';
import { getBriefById as getBrief, resolveBrief } from '../db/brief-repo.js';
import { checkTaskArtifactCompliance } from '../db/artifact-repo.js';

interface AddTaskResult {
  ok: true;
  id: string;
  title: string;
  artifactRequirements: string[];
}

interface ListTasksResult {
  ok: true;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    dependencies: string[];
    status: string;
    field: string | null;
    artifactRequirements: string[];
  }>;
}

interface GetTaskResult {
  ok: true;
  task: {
    id: string;
    briefId: string;
    title: string;
    description: string;
    dependencies: string[];
    field: string | null;
    artifactRequirements: string[];
    status: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface UpdateTaskResult {
  ok: true;
  id: string;
  status: string;
  title?: string;
  task?: Task;
}

interface ClearTasksResult {
  ok: true;
  briefId: string;
  message: string;
}

interface RemoveTaskResult {
  ok: true;
  id: string;
}

interface ErrorOutput {
  ok: false;
  error: string;
}

function out(
  result:
    | AddTaskResult
    | ListTasksResult
    | GetTaskResult
    | UpdateTaskResult
    | ClearTasksResult
    | RemoveTaskResult
    | ErrorOutput
): void {
  process.stdout.write(JSON.stringify(result) + '\n');
}

function fail(message: string): never {
  out({ ok: false, error: message });
  process.exit(1);
}

/**
 *
 */
export function registerTaskCommand(program: Command): void {
  const taskGroup = program.command('task').description('Manage tasks within a brief');

  // task add <brief-id> --title <t> --description <d> [--dependencies <ids>] [--field <f>] [--artifact-requirements <types...>]
  taskGroup
    .command('add')
    .description('Add a new task to a brief')
    .argument('<brief-id>', 'The brief ID to link this task to')
    .option('--title <title>', 'Task title (required)', '')
    .option('--description <description>', 'Task description (required)', '')
    .option('--dependencies <deps...>', 'Array of task IDs that this task depends on', [])
    .option('--field <field>', 'Brief field this task addresses', '')
    .option(
      '--artifact-requirements <reqs...>',
      `Required artifact types on completion (${ARTIFACT_TYPES.join(' | ')})`,
      []
    )
    .action((briefId, opts) => {
      if (!opts.title || !opts.title.trim()) {
        fail('--title and --description are required');
      }
      if (!opts.description || !opts.description.trim()) {
        fail('--title and --description are required');
      }

      const brief = getBrief(briefId);
      if (!brief) {
        fail(`Brief not found: ${briefId}`);
      }

      let dependencies: string[] = [];
      try {
        if (opts.dependencies && opts.dependencies.length > 0) {
          dependencies = JSON.parse(JSON.stringify(opts.dependencies));
        }
      } catch (e) {
        fail(`Invalid dependencies JSON: ${e}`);
      }

      const field = opts.field ? opts.field : null;

      const artifactRequirements: ArtifactType[] = [];
      if (opts.artifactRequirements && Array.isArray(opts.artifactRequirements)) {
        for (const req of opts.artifactRequirements) {
          if (!ARTIFACT_TYPES.includes(req as ArtifactType)) {
            fail(
              `Invalid artifact requirement: ${req}. Must be one of: ${ARTIFACT_TYPES.join(', ')}`
            );
          }
          artifactRequirements.push(req as ArtifactType);
        }
      }

      const db = getDb();
      const task = db.transaction(() => {
        if (dependencies.length > 0) {
          const depCheck = validateDependencies(db, briefId, dependencies);
          if (!depCheck.valid) {
            fail(depCheck.error || 'Invalid dependencies');
          }
        }

        return createTask(db, briefId, opts.title, opts.description, {
          dependencies,
          field,
          artifactRequirements,
        });
      })();

      out({
        ok: true,
        id: task.id,
        title: task.title,
        artifactRequirements: task.artifactRequirements,
      });
    });

  // task list --brief <id>
  taskGroup
    .command('list')
    .description('List all tasks for a brief')
    .option('--brief <id>', 'The brief ID to list tasks for')
    .action((opts) => {
      const briefId = opts.brief;
      if (!briefId) {
        fail('--brief is required');
      }

      const brief = getBrief(briefId);
      if (!brief) {
        fail(`Brief not found: ${briefId}`);
      }

      const tasks = listTasksByBrief(getDb(), briefId);
      out({
        ok: true,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          dependencies: t.dependencies,
          status: t.status,
          field: t.field,
          artifactRequirements: t.artifactRequirements,
        })),
      });
    });

  // task get <taskId>
  taskGroup
    .command('get')
    .description('Get a single task by ID')
    .argument('<task-id>', 'The task ID to retrieve')
    .action((taskId) => {
      const task = getTaskById(getDb(), taskId);
      if (!task) {
        fail(`Task not found: ${taskId}`);
      }

      out({
        ok: true,
        task: {
          id: task.id,
          briefId: task.briefId,
          title: task.title,
          description: task.description,
          dependencies: task.dependencies,
          field: task.field,
          artifactRequirements: task.artifactRequirements,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      });
    });

  // task update <taskId> [--status <s>] [--title <t>] [--description <d>] [--field <f>] [--dependencies <deps...>] [--artifact-requirements <reqs...>] [--skip-artifact-check]
  taskGroup
    .command('update')
    .description('Update a task status or details')
    .argument('<task-id>', 'The task ID to update')
    .option('--status <status>', 'New status (pending | in_progress | completed)')
    .option('--title <title>', 'New task title')
    .option('--description <description>', 'New task description')
    .option('--field <field>', 'Brief field this task addresses')
    .option('--dependencies <dependencies...>', 'Array of task IDs this task depends on')
    .option(
      '--artifact-requirements <requirements...>',
      'Required artifact types before completion'
    )
    .option('--skip-artifact-check', 'Skip artifact verification on completion', false)
    .action(
      (
        taskId,
        opts: {
          status?: string;
          title?: string;
          description?: string;
          field?: string;
          dependencies?: string[];
          artifactRequirements?: string[];
          skipArtifactCheck?: boolean;
        }
      ) => {
        const hasAnyUpdate =
          opts.status !== undefined ||
          opts.title !== undefined ||
          opts.description !== undefined ||
          opts.field !== undefined ||
          opts.dependencies !== undefined ||
          opts.artifactRequirements !== undefined;

        if (!hasAnyUpdate) {
          fail(
            'At least one update option must be provided (--status, --title, --description, --field, --dependencies, --artifact-requirements)'
          );
        }

        const task = getTaskById(getDb(), taskId);
        if (!task) {
          fail(`Task not found: ${taskId}`);
        }

        let newStatus: (typeof TASK_STATUSES)[number] | undefined;
        if (opts.status) {
          if (!TASK_STATUSES.includes(opts.status as (typeof TASK_STATUSES)[number])) {
            fail(`Invalid status: ${opts.status}. Must be one of: ${TASK_STATUSES.join(', ')}`);
          }

          newStatus = opts.status as (typeof TASK_STATUSES)[number];
          // Allow reopening completed tasks
          const VALID_TRANSITIONS: Record<string, string[]> = {
            pending: ['in_progress'],
            in_progress: ['completed', 'pending'],
            completed: ['in_progress', 'pending'],
          };

          const allowed = VALID_TRANSITIONS[task.status] ?? [];
          if (newStatus !== task.status && !allowed.includes(newStatus)) {
            fail(
              `Invalid status transition: ${task.status} -> ${newStatus}. Allowed: ${allowed.join(', ') || 'none'}`
            );
          }

          // Hard Completion Gate: Check artifact compliance before marking as completed
          if (newStatus === 'completed' && !opts.skipArtifactCheck) {
            const compliance = checkTaskArtifactCompliance(getDb(), taskId);
            if (!compliance.compliant) {
              fail(compliance.error || 'Cannot complete task: artifact requirements not satisfied');
            }
          }
        }

        if (opts.artifactRequirements) {
          for (const req of opts.artifactRequirements) {
            if (!ARTIFACT_TYPES.includes(req as ArtifactType)) {
              fail(
                `Invalid artifact requirement: "${req}". Must be one of: ${ARTIFACT_TYPES.join(', ')}`
              );
            }
          }
        }

        try {
          const updated = updateTask(getDb(), taskId, {
            title: opts.title,
            description: opts.description,
            field: opts.field,
            dependencies: opts.dependencies,
            artifactRequirements: opts.artifactRequirements,
            status: newStatus,
          });

          out({
            ok: true,
            id: task.id,
            status: updated?.status ?? task.status,
            title: updated?.title ?? task.title,
            ...(updated ? { task: updated } : {}),
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          fail(msg);
        }
      }
    );

  // task clear [--brief <briefId>]
  taskGroup
    .command('clear')
    .description('Clear all tasks for a brief')
    .option('--brief <brief-id>', 'Brief ID (defaults to latest brief)')
    .action((opts: { brief?: string }) => {
      const brief = resolveBrief(opts.brief);
      if (!brief) {
        fail('No brief found');
      }
      deleteTasksByBrief(getDb(), brief.id);
      out({
        ok: true,
        briefId: brief.id,
        message: `Cleared all tasks for brief ${brief.id}`,
      });
    });

  // task remove <taskId>
  taskGroup
    .command('remove')
    .description('Remove a task')
    .argument('<task-id>', 'The task ID to remove')
    .action((taskId) => {
      const task = getTaskById(getDb(), taskId);
      if (!task) {
        fail(`Task not found: ${taskId}`);
      }

      removeTask(getDb(), taskId);
      out({
        ok: true,
        id: task.id,
      });
    });
}
