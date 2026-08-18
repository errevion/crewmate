import type { Command } from 'commander';
import { getDb } from '../db/connection.js';
import { getTaskById } from '../db/task-repo.js';
import { getLatestBrief, getBriefById } from '../db/brief-repo.js';
import { ARTIFACT_TYPES, type ArtifactType } from '../models/artifact.js';
import { createArtifact, listArtifacts } from '../db/artifact-repo.js';

interface AddArtifactResult {
  ok: true;
  id: string;
  taskId: string;
  briefId: string;
  type: string;
  content: string;
}

interface ListArtifactsResult {
  ok: true;
  artifacts: Array<{
    id: string;
    taskId: string;
    briefId: string;
    type: string;
    content: string;
    createdAt: string;
  }>;
}

interface ErrorOutput {
  ok: false;
  error: string;
}

function out(result: AddArtifactResult | ListArtifactsResult | ErrorOutput): void {
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

  // artifact add <task-id> --type <type> --content <content> [--brief <briefId>]
  artifactGroup
    .command('add')
    .description('Add an execution artifact / knowledge fact for a task')
    .argument('<task-id>', 'The task ID creating the artifact')
    .option('--type <type>', `Artifact type (${ARTIFACT_TYPES.join(' | ')})`, '')
    .option('--content <content>', 'Artifact content / note / contract description', '')
    .option('--brief <briefId>', 'Optional brief ID (defaults to task brief)')
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

      const task = getTaskById(getDb(), taskId);
      if (!task) {
        fail(`Task not found: ${taskId}`);
      }

      const briefId = opts.brief || task.briefId;
      const brief = getBriefById(briefId);
      if (!brief) {
        fail(`Brief not found: ${briefId}`);
      }

      const artifact = createArtifact(
        getDb(),
        taskId,
        briefId,
        opts.type as ArtifactType,
        opts.content.trim()
      );

      out({
        ok: true,
        id: artifact.id,
        taskId: artifact.taskId,
        briefId: artifact.briefId,
        type: artifact.type,
        content: artifact.content,
      });
    });

  // artifact list [--brief <briefId>] [--task <taskId>] [--type <type>]
  artifactGroup
    .command('list')
    .description('List execution artifacts')
    .option('--brief <briefId>', 'Filter by brief ID')
    .option('--task <taskId>', 'Filter by task ID')
    .option('--type <type>', 'Filter by artifact type')
    .action((opts) => {
      let targetBriefId = opts.brief;

      if (!targetBriefId && !opts.task) {
        const latest = getLatestBrief();
        if (latest) {
          targetBriefId = latest.id;
        }
      }

      if (opts.type && !ARTIFACT_TYPES.includes(opts.type as ArtifactType)) {
        fail(`Invalid artifact type: ${opts.type}. Must be one of: ${ARTIFACT_TYPES.join(', ')}`);
      }

      const artifacts = listArtifacts(getDb(), {
        briefId: targetBriefId,
        taskId: opts.task,
        type: opts.type ? (opts.type as ArtifactType) : undefined,
      });

      out({
        ok: true,
        artifacts: artifacts.map((a) => ({
          id: a.id,
          taskId: a.taskId,
          briefId: a.briefId,
          type: a.type,
          content: a.content,
          createdAt: a.createdAt,
        })),
      });
    });
}
