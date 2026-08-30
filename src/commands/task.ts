import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { TASK_STATUSES } from '../models/task.js';
import { BRIEF_FIELDS } from '../models/brief.js';
import { ARTIFACT_TYPES, type ArtifactType } from '../models/artifact.js';
import {
  createTask,
  getTaskById,
  listTasksByBrief,
  updateTaskStatus,
  removeTask,
  validateDependencies,
} from '../db/task-repo.js';
import { getBriefById as getBrief } from '../db/brief-repo.js';
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

      if (dependencies.length > 0) {
        const depCheck = validateDependencies(getDb(), briefId, dependencies);
        if (!depCheck.valid) {
          fail(depCheck.error || 'Invalid dependencies');
        }
      }

      const field = opts.field ? opts.field : null;
      if (field && !(BRIEF_FIELDS as readonly string[]).includes(field)) {
        fail(`Invalid field "${field}". Must be one of: ${BRIEF_FIELDS.join(', ')}`);
      }

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

      const task = createTask(getDb(), briefId, opts.title, opts.description, {
        dependencies,
        field,
        artifactRequirements,
      });

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

  // task update <taskId> --status <s> [--skip-artifact-check]
  taskGroup
    .command('update')
    .description('Update a task status')
    .argument('<task-id>', 'The task ID to update')
    .option('--status <status>', 'New status (pending | in_progress | completed)', '')
    .option('--skip-artifact-check', 'Skip artifact verification on completion', false)
    .action((taskId, opts) => {
      if (!opts.status) {
        fail('--status is required');
      }

      if (!TASK_STATUSES.includes(opts.status as (typeof TASK_STATUSES)[number])) {
        fail(`Invalid status: ${opts.status}. Must be one of: ${TASK_STATUSES.join(', ')}`);
      }

      const task = getTaskById(getDb(), taskId);
      if (!task) {
        fail(`Task not found: ${taskId}`);
      }

      const newStatus = opts.status as (typeof TASK_STATUSES)[number];
      const VALID_TRANSITIONS: Record<string, string[]> = {
        pending: ['in_progress'],
        in_progress: ['completed', 'pending'],
        completed: [],
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

      updateTaskStatus(getDb(), taskId, newStatus);
      out({
        ok: true,
        id: task.id,
        status: opts.status,
        title: task.title,
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
