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
  supersedeArtifact,
  nextIssueNumber,
  searchArtifacts,
  precheckFile,
  generateBriefing,
  generateContext,
} from '../db/artifact-repo.js';
import type { ArtifactOutcome } from '../models/artifact.js';

function out(result: Record<string, unknown>): void {
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
    .option('--base64', 'Interpret content as base64-encoded string')
    .option('--brief <briefId>', 'Optional brief ID (defaults to task brief or latest)')
    .option('--tags <tags...>', 'Optional tags for categorization', [])
    .option('--at <location>', 'File location to capture in the artifact')
    .action((taskId, opts) => {
      if (!opts.type) {
        fail(`--type is required (${ARTIFACT_TYPES.join(' | ')})`);
      }

      if (!ARTIFACT_TYPES.includes(opts.type as ArtifactType)) {
        fail(`Invalid artifact type: ${opts.type}. Must be one of: ${ARTIFACT_TYPES.join(', ')}`);
      }

      let content = opts.content || '';
      if (opts.base64 && content) {
        try {
          content = Buffer.from(content, 'base64').toString('utf-8');
        } catch {
          fail('Failed to decode base64 content');
        }
      }

      if (!content || !content.trim()) {
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
          content.trim(),
          { tags, location: opts.at }
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
          location: artifact.location,
          outcome: artifact.outcome,
          issueId: artifact.issueId,
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

  // artifact supersede <old-id> <new-id>
  artifactGroup
    .command('supersede')
    .description('Mark an old artifact as superseded by a newer one')
    .argument('<old-id>', 'The old artifact ID')
    .argument('<new-id>', 'The new artifact ID replacing it')
    .action((oldId, newId) => {
      const db = getDb();
      const oldArt = getArtifactById(db, oldId);
      if (!oldArt) {
        fail(`Old artifact not found: ${oldId}`);
      }
      const newArt = getArtifactById(db, newId);
      if (!newArt) {
        fail(`New artifact not found: ${newId}`);
      }

      supersedeArtifact(db, oldId, newId);
      out({
        ok: true,
        supersededId: oldId,
        byId: newId,
      });
    });

  function resolveBriefAndTask(opts: { brief?: string; task?: string }): {
    resolvedBriefId: string;
    effectiveTaskId: string | null;
  } {
    let resolvedBriefId: string | null = opts.brief || null;
    const effectiveTaskId: string | null = opts.task || null;

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

    return { resolvedBriefId, effectiveTaskId };
  }

  artifactGroup
    .command('log')
    .description('Log an issue')
    .argument('<summary>', 'Summary of the issue')
    .option('--at <location>', 'File location')
    .option('--brief <briefId>', 'Optional brief ID')
    .option('--task <taskId>', 'Optional task ID')
    .action((summary, opts) => {
      const db = getDb();
      const { resolvedBriefId, effectiveTaskId } = resolveBriefAndTask(opts);

      const issueNumber = nextIssueNumber(db, resolvedBriefId);
      const content = JSON.stringify({ summary, issueNumber, location: opts.at });

      try {
        const artifact = createArtifact(db, effectiveTaskId, resolvedBriefId, 'issue', content, {
          location: opts.at,
        });
        out({ ok: true, artifact });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to create artifact');
      }
    });

  artifactGroup
    .command('attempt')
    .description('Record an attempt')
    .argument('<summary>', 'Summary of the attempt')
    .option('--failed', 'Mark attempt as failed')
    .option('--worked', 'Mark attempt as worked')
    .option('--partial', 'Mark attempt as partial')
    .option('--at <location>', 'File location')
    .option('--issue <issueId>', 'Associated issue ID')
    .option('--brief <briefId>', 'Optional brief ID')
    .option('--task <taskId>', 'Optional task ID')
    .action((summary, opts) => {
      const db = getDb();
      const { resolvedBriefId, effectiveTaskId } = resolveBriefAndTask(opts);

      let outcome: ArtifactOutcome = 'failed';
      if (opts.worked) {
        outcome = 'worked';
      }
      if (opts.partial) {
        outcome = 'partial';
      }

      let issueId = opts.issue;
      if (!issueId) {
        const issue = db
          .prepare(
            "SELECT id FROM execution_artifacts WHERE type = 'issue' AND status = 'active' AND brief_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .get(resolvedBriefId) as { id: string } | undefined;
        if (issue) {
          issueId = issue.id;
        }
      }

      const content = JSON.stringify({ summary, outcome, location: opts.at });

      try {
        const artifact = createArtifact(db, effectiveTaskId, resolvedBriefId, 'attempt', content, {
          location: opts.at,
          outcome,
          issueId,
        });
        out({ ok: true, artifact });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to create artifact');
      }
    });

  artifactGroup
    .command('fix')
    .description('Record a fix')
    .argument('<summary>', 'Summary of the fix')
    .option('--at <location>', 'File location')
    .option('--issue <issueId>', 'Associated issue ID')
    .option('--brief <briefId>', 'Optional brief ID')
    .option('--task <taskId>', 'Optional task ID')
    .action((summary, opts) => {
      const db = getDb();
      const { resolvedBriefId, effectiveTaskId } = resolveBriefAndTask(opts);

      let issueId = opts.issue;
      if (!issueId) {
        const issue = db
          .prepare(
            "SELECT id FROM execution_artifacts WHERE type = 'issue' AND status = 'active' AND brief_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .get(resolvedBriefId) as { id: string } | undefined;
        if (issue) {
          issueId = issue.id;
        }
      }

      const content = JSON.stringify({ summary, location: opts.at });

      try {
        const artifact = createArtifact(db, effectiveTaskId, resolvedBriefId, 'fix', content, {
          location: opts.at,
          issueId,
        });
        if (issueId) {
          db.prepare("UPDATE execution_artifacts SET status = 'resolved' WHERE id = ?").run(
            issueId
          );
        }
        out({ ok: true, artifact });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to create artifact');
      }
    });

  artifactGroup
    .command('search')
    .description('Search artifacts')
    .argument('<query>', 'Search query')
    .option('--brief <id>', 'Filter by brief ID')
    .option('--type <type>', 'Filter by artifact type')
    .option('--status <status>', 'Filter by artifact status')
    .option('--failed-only', 'Show only failed artifacts')
    .option('--limit <n>', 'Limit number of results', parseInt)
    .action((query, opts) => {
      const db = getDb();
      try {
        const artifacts = searchArtifacts(db, query, opts);
        out({ ok: true, artifacts });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to search artifacts');
      }
    });

  artifactGroup
    .command('precheck')
    .description('Precheck a file')
    .argument('<filepath>', 'File path to precheck')
    .option('--brief <id>', 'Brief ID')
    .action((filepath, opts) => {
      const db = getDb();
      let resolvedBriefId = opts.brief;
      if (!resolvedBriefId) {
        const latest = getLatestBrief();
        if (latest) {
          resolvedBriefId = latest.id;
        } else {
          fail('Brief not found. Provide --brief');
        }
      }
      try {
        const warnings = precheckFile(db, filepath, resolvedBriefId);
        out({ ok: true, warnings });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to precheck file');
      }
    });

  artifactGroup
    .command('brief')
    .description('Generate briefing')
    .option('--brief <id>', 'Brief ID')
    .action((opts) => {
      const db = getDb();
      let resolvedBriefId = opts.brief;
      if (!resolvedBriefId) {
        const latest = getLatestBrief();
        if (latest) {
          resolvedBriefId = latest.id;
        } else {
          fail('Brief not found. Provide --brief');
        }
      }
      try {
        const briefing = generateBriefing(db, resolvedBriefId);
        out({ ok: true, briefing });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to generate briefing');
      }
    });

  artifactGroup
    .command('context')
    .description('Generate context')
    .option('--brief <id>', 'Brief ID')
    .option('--tokens <n>', 'Token limit', parseInt)
    .option('--focus <path>', 'Focus path')
    .action((opts) => {
      const db = getDb();
      let resolvedBriefId = opts.brief;
      if (!resolvedBriefId) {
        const latest = getLatestBrief();
        if (latest) {
          resolvedBriefId = latest.id;
        } else {
          fail('Brief not found. Provide --brief');
        }
      }
      try {
        const context = generateContext(db, resolvedBriefId, opts);
        out({ ok: true, context });
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to generate context');
      }
    });
}
