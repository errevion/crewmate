import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { getTaskById } from '../db/task-repo.js';
import { getLatestBrief, getBriefById } from '../db/brief-repo.js';
import {
  ARTIFACT_TYPES,
  ARTIFACT_STATUSES,
  type ArtifactType,
  type ArtifactStatus,
} from '../models/artifact.js';
import {
  createArtifact,
  listArtifacts,
  getArtifactById,
  invalidateArtifact,
} from '../db/artifact-repo.js';

interface AddArtifactResult {
  ok: true;
  id: string;
  taskId: string | null;
  briefId: string;
  type: string;
  content: string;
  status: string;
  supersededBy: string | null;
  tags: string[];
}

interface GetArtifactResult {
  ok: true;
  artifact: {
    id: string;
    taskId: string | null;
    briefId: string;
    type: string;
    content: string;
    status: string;
    supersededBy: string | null;
    tags: string[];
    createdAt: string;
  };
}

interface ListArtifactsResult {
  ok: true;
  artifacts: Array<{
    id: string;
    taskId: string | null;
    briefId: string;
    type: string;
    content: string;
    status: string;
    supersededBy: string | null;
    tags: string[];
    createdAt: string;
  }>;
}

interface InvalidateArtifactResult {
  ok: true;
  id: string;
  status: 'invalidated';
}

interface ErrorOutput {
  ok: false;
  error: string;
}

function out(
  result:
    | AddArtifactResult
    | GetArtifactResult
    | ListArtifactsResult
    | InvalidateArtifactResult
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
export function registerArtifactCommand(program: Command): void {
  const artifactGroup = program
    .command('artifact')
    .description('Manage execution artifacts and incremental knowledge base');

  // artifact add [task-id] --type <type> --content <content> [--brief <briefId>] [--tags <tags...>]
  artifactGroup
    .command('add')
    .description('Add an execution artifact / knowledge fact for a task or brief')
    .argument('[task-id]', 'The task ID creating the artifact (optional for brief-level facts)')
    .option('--type <type>', `Artifact type (${ARTIFACT_TYPES.join(' | ')})`, '')
    .option('--content <content>', 'Artifact content / note / contract description', '')
    .option('--brief <briefId>', 'Optional brief ID (defaults to task brief or latest)')
    .option('--tags <tags...>', 'Optional tags for categorization', [])
    .action((taskId, opts) => {
      if (!opts.type) {
        fail(`--type is required (${ARTIFACT_TYPES.join(' | ')})`);
      }

      if (!ARTIFACT_TYPES.includes(opts.type as ArtifactType)) {
        fail(`Invalid artifact type: ${opts.type}. Must be one of: ${ARTIFACT_TYPES.join(', ')}`);
      }

      if (!opts.content || !opts.content.trim()) {
        fail('--content is required');
      }

      let resolvedBriefId: string | null = opts.brief || null;
      const effectiveTaskId: string | null = taskId || null;

      if (effectiveTaskId) {
        const task = getTaskById(getDb(), effectiveTaskId);
        if (!task) {
          fail(`Task not found: ${effectiveTaskId}`);
        }
        if (resolvedBriefId && resolvedBriefId !== task.briefId) {
          fail(`Task ${effectiveTaskId} belongs to brief ${task.briefId}, not ${resolvedBriefId}`);
        }
        resolvedBriefId = task.briefId;
      }

      if (!resolvedBriefId) {
        const latest = getLatestBrief();
        if (latest) {
          resolvedBriefId = latest.id;
        }
      }

      if (!resolvedBriefId) {
        fail('Brief not found. Provide --brief or an existing task ID');
      }

      const brief = getBriefById(resolvedBriefId);
      if (!brief) {
        fail(`Brief not found: ${resolvedBriefId}`);
      }

      let tags: string[] = [];
      if (opts.tags && Array.isArray(opts.tags)) {
        tags = opts.tags.filter((t: unknown): t is string => typeof t === 'string' && !!t.trim());
      }

      try {
        const artifact = createArtifact(
          getDb(),
          effectiveTaskId,
          resolvedBriefId,
          opts.type as ArtifactType,
          opts.content.trim(),
          { tags }
        );

        out({
          ok: true,
          id: artifact.id,
          taskId: artifact.taskId,
          briefId: artifact.briefId,
          type: artifact.type,
          content: artifact.content,
          status: artifact.status,
          supersededBy: artifact.supersededBy,
          tags: artifact.tags,
        });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to create artifact');
      }
    });

  // artifact list [--brief <briefId>] [--task <taskId>] [--for-task <taskId>] [--type <type>] [--status <status>]
  artifactGroup
    .command('list')
    .description('List execution artifacts')
    .option('--brief <briefId>', 'Filter by brief ID')
    .option('--task <taskId>', 'Filter by task ID')
    .option('--for-task <taskId>', 'Filter for tasks upstream in DAG (ancestors + brief-level)')
    .option('--type <type>', 'Filter by artifact type')
    .option(
      '--status <status>',
      `Filter by status (active | superseded | invalidated | all, default: active)`,
      'active'
    )
    .action((opts) => {
      let targetBriefId = opts.brief;

      if (!targetBriefId && !opts.task && !opts.forTask) {
        const latest = getLatestBrief();
        if (latest) {
          targetBriefId = latest.id;
        }
      }

      if (opts.type && !ARTIFACT_TYPES.includes(opts.type as ArtifactType)) {
        fail(`Invalid artifact type: ${opts.type}. Must be one of: ${ARTIFACT_TYPES.join(', ')}`);
      }

      const validStatuses = [...ARTIFACT_STATUSES, 'all'] as const;
      if (opts.status && !validStatuses.includes(opts.status as (typeof validStatuses)[number])) {
        fail(`Invalid status: ${opts.status}. Must be one of: ${validStatuses.join(', ')}`);
      }

      const artifacts = listArtifacts(getDb(), {
        briefId: targetBriefId,
        taskId: opts.task,
        forTask: opts.forTask,
        type: opts.type ? (opts.type as ArtifactType) : undefined,
        status: opts.status as ArtifactStatus | 'all',
      });

      out({
        ok: true,
        artifacts: artifacts.map((a) => ({
          id: a.id,
          taskId: a.taskId,
          briefId: a.briefId,
          type: a.type,
          content: a.content,
          status: a.status,
          supersededBy: a.supersededBy,
          tags: a.tags,
          createdAt: a.createdAt,
        })),
      });
    });

  // artifact get <id>
  artifactGroup
    .command('get')
    .description('Get a single execution artifact by ID')
    .argument('<artifact-id>', 'The artifact ID to retrieve')
    .action((artifactId) => {
      const artifact = getArtifactById(getDb(), artifactId);
      if (!artifact) {
        fail(`Artifact not found: ${artifactId}`);
      }

      out({
        ok: true,
        artifact: {
          id: artifact.id,
          taskId: artifact.taskId,
          briefId: artifact.briefId,
          type: artifact.type,
          content: artifact.content,
          status: artifact.status,
          supersededBy: artifact.supersededBy,
          tags: artifact.tags,
          createdAt: artifact.createdAt,
        },
      });
    });

  // artifact invalidate <id>
  artifactGroup
    .command('invalidate')
    .description('Mark an artifact as invalidated / obsolete')
    .argument('<artifact-id>', 'The artifact ID to invalidate')
    .action((artifactId) => {
      const artifact = getArtifactById(getDb(), artifactId);
      if (!artifact) {
        fail(`Artifact not found: ${artifactId}`);
      }

      invalidateArtifact(getDb(), artifactId);
      out({
        ok: true,
        id: artifactId,
        status: 'invalidated',
      });
    });
}
