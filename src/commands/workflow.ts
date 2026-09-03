import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { validateWorkflow, validateGraph } from '../graph/validator.js';
import { GraphEngine } from '../graph/engine.js';
import { DEFAULT_WORKFLOW } from '../graph/default-workflow.js';
import { getModularWorkflowFiles } from '../graph/modular-templates.js';
import { loadAndResolveWorkflow } from '../graph/resolver.js';
import { success, failure } from '../utils/errors.js';
import { AgentNodeRunner, TaskNodeRunner } from '../graph/runners/agent-task.js';
import { getDb } from '../db/connection.js';
import {
  createWorkflowRun,
  getWorkflowRunById,
  getActiveWorkflowRunByBrief,
  advanceWorkflowRun,
  skipStageInWorkflowRun,
  setStageInWorkflowRun,
  updateWorkflowRunStatus,
  listWorkflowRuns,
  deleteWorkflowRun,
} from '../db/workflow-repo.js';
import { resolveBrief } from '../db/brief-repo.js';
import type { WorkflowDefinition, AgentNodeConfig } from '../models/graph.js';
import type { WorkflowRunView, WorkflowSummary } from '../models/workflow-run.js';

function formatAgentSummary(run: WorkflowRunView): WorkflowSummary {
  const currentStageDef = run.workflowDef.stages.find((s) => s.id === run.currentStage);
  const stageRunMap = new Map((run.stageRuns || []).map((sr) => [sr.stageId, sr.status]));

  const activeNodes = (currentStageDef?.graph?.nodes || []).map((node) => {
    const isAgent = node.type === 'agent';
    const agentConfig = isAgent ? (node.config as AgentNodeConfig) : undefined;
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      prompt: agentConfig?.prompt,
      allowedTools: agentConfig?.allowedTools,
      deniedTools: agentConfig?.deniedTools,
      config: node.config,
    };
  });

  const stagesSummary = (run.workflowDef.stages || []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    status: stageRunMap.get(stage.id) || 'pending',
  }));

  const edges = (currentStageDef?.graph?.edges || []).map((edge) => ({
    from: edge.from,
    to: edge.to,
    condition: edge.condition
      ? {
          type: edge.condition.type,
          field: edge.condition.field,
          operator: edge.condition.operator,
          value: edge.condition.value,
        }
      : undefined,
    label: edge.label,
  }));

  return {
    id: run.id,
    briefId: run.briefId,
    status: run.status,
    currentStage: run.currentStage,
    stageName: currentStageDef?.name,
    stageDescription: currentStageDef?.description,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    activeNodes,
    edges: edges.length > 0 ? edges : undefined,
    context: Object.keys(run.context || {}).length > 0 ? run.context : undefined,
    stages: stagesSummary,
  };
}

function regenerateModularWorkflow(targetDir: string = process.cwd()): void {
  const files = getModularWorkflowFiles();
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = resolve(targetDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
  }
}

function loadCustomWorkflowOrDefault(customPath?: string): WorkflowDefinition {
  if (customPath) {
    const fullPath = resolve(process.cwd(), customPath);
    if (existsSync(fullPath)) {
      return loadAndResolveWorkflow(fullPath);
    }
  }

  const workflowsDir = resolve(process.cwd(), '.crewmate', 'workflows');
  const defaultFilePath = resolve(workflowsDir, 'default.json');

  if (existsSync(workflowsDir)) {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.json'));
    if (files.length > 0) {
      const targetPath = existsSync(defaultFilePath)
        ? defaultFilePath
        : resolve(workflowsDir, files[0]);
      try {
        return loadAndResolveWorkflow(targetPath);
      } catch {
        // Fallback to regeneration
      }
    }
  }

  // Regenerate modular workflow if no workflow files detected in workflows/
  regenerateModularWorkflow(process.cwd());
  return DEFAULT_WORKFLOW;
}

/**
 * Registers workflow CLI commands
 */
export function registerWorkflowCommands(program: Command): void {
  const workflowCmd = program.command('workflow').description('Graph-based workflow orchestration');

  workflowCmd
    .command('validate')
    .description('Validate a workflow or graph definition file (JSON)')
    .argument('<filePath>', 'Path to JSON workflow or graph definition')
    .action((filePath: string) => {
      const fullPath = resolve(process.cwd(), filePath);
      if (!existsSync(fullPath)) {
        process.stdout.write(
          JSON.stringify(failure(`File not found: ${fullPath}`), null, 2) + '\n'
        );
        process.exitCode = 1;
        return;
      }

      try {
        const content = JSON.parse(readFileSync(fullPath, 'utf8'));
        if (content.stages) {
          const resolved = loadAndResolveWorkflow(fullPath);
          const res = validateWorkflow(resolved);
          if (res.valid) {
            process.stdout.write(
              JSON.stringify(success({ valid: true, type: 'workflow' }), null, 2) + '\n'
            );
          } else {
            process.stdout.write(
              JSON.stringify(failure('Workflow validation failed', res.errors), null, 2) + '\n'
            );
            process.exitCode = 1;
          }
        } else if (content.nodes && content.edges) {
          const res = validateGraph(content);
          if (res.valid) {
            process.stdout.write(
              JSON.stringify(success({ valid: true, type: 'graph' }), null, 2) + '\n'
            );
          } else {
            process.stdout.write(
              JSON.stringify(failure('Graph validation failed', res.errors), null, 2) + '\n'
            );
            process.exitCode = 1;
          }
        } else {
          process.stdout.write(
            JSON.stringify(
              failure(
                'Invalid file format: expected a workflow (with stages) or graph (with nodes & edges)'
              ),
              null,
              2
            ) + '\n'
          );
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(
          JSON.stringify(failure(`JSON parse error: ${errorMsg}`), null, 2) + '\n'
        );
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('start')
    .description('Start a new workflow run and persist state to SQLite')
    .option('-f, --file <filePath>', 'Path to custom workflow definition JSON')
    .option('-c, --context <jsonString>', 'Initial context JSON string')
    .option('--brief <briefId>', 'Brief ID (defaults to active brief)')
    .option('--agent-summary', 'Return a concise summary tailored for AI agents')
    .action(
      (options: { file?: string; context?: string; brief?: string; agentSummary?: boolean }) => {
        try {
          const db = getDb();
          const brief = resolveBrief(options.brief, db);
          if (!brief) {
            process.stdout.write(
              JSON.stringify(
                failure('No brief found. Please create a brief first or pass --brief <id>.'),
                null,
                2
              ) + '\n'
            );
            process.exitCode = 1;
            return;
          }

          const workflowDef = loadCustomWorkflowOrDefault(options.file);
          const validation = validateWorkflow(workflowDef);
          if (!validation.valid) {
            process.stdout.write(
              JSON.stringify(failure('Invalid workflow definition', validation.errors), null, 2) +
                '\n'
            );
            process.exitCode = 1;
            return;
          }

          let initialContext: Record<string, unknown> = {};
          if (options.context) {
            try {
              initialContext = JSON.parse(options.context);
            } catch {
              initialContext = {};
            }
          }

          const run = createWorkflowRun(db, brief.id, workflowDef, initialContext);
          const outputData = options.agentSummary ? formatAgentSummary(run) : run;
          process.stdout.write(JSON.stringify(success(outputData), null, 2) + '\n');
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
          process.exitCode = 1;
        }
      }
    );

  workflowCmd
    .command('status')
    .description('Get the status of an active or specified workflow run')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .option('--brief <briefId>', 'Filter by brief ID')
    .option('--agent-summary', 'Return a concise summary tailored for AI agents')
    .action((options: { run?: string; brief?: string; agentSummary?: boolean }) => {
      try {
        const db = getDb();
        let run;
        if (options.run) {
          run = getWorkflowRunById(db, options.run);
        } else {
          run = getActiveWorkflowRunByBrief(db, options.brief);
        }

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found.'), null, 2) + '\n'
          );
          return;
        }

        const outputData = options.agentSummary ? formatAgentSummary(run) : run;
        process.stdout.write(JSON.stringify(success(outputData), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('advance')
    .description('Advance the workflow run to the next stage')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .option('-o, --outputs <jsonString>', 'Stage outputs JSON to pass to context')
    .option('--agent-summary', 'Return a concise summary tailored for AI agents')
    .action((options: { run?: string; outputs?: string; agentSummary?: boolean }) => {
      try {
        const db = getDb();
        const run = options.run
          ? getWorkflowRunById(db, options.run)
          : getActiveWorkflowRunByBrief(db);

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found to advance.'), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        let stageOutputs: Record<string, unknown> = {};
        if (options.outputs) {
          try {
            stageOutputs = JSON.parse(options.outputs);
          } catch {
            stageOutputs = {};
          }
        }

        const updated = advanceWorkflowRun(db, run.id, stageOutputs);
        const outputData = options.agentSummary ? formatAgentSummary(updated) : updated;
        process.stdout.write(JSON.stringify(success(outputData), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('skip')
    .description('Skip a stage in the workflow run')
    .argument('<stageId>', 'Stage ID to skip')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .option('--agent-summary', 'Return a concise summary tailored for AI agents')
    .action((stageId: string, options: { run?: string; agentSummary?: boolean }) => {
      try {
        const db = getDb();
        const run = options.run
          ? getWorkflowRunById(db, options.run)
          : getActiveWorkflowRunByBrief(db);

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found.'), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const updated = skipStageInWorkflowRun(db, run.id, stageId);
        const outputData = options.agentSummary ? formatAgentSummary(updated) : updated;
        process.stdout.write(JSON.stringify(success(outputData), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('set-stage')
    .description('Jump to a specific stage in the workflow run')
    .argument('<stageId>', 'Stage ID to jump to')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .option('--agent-summary', 'Return a concise summary tailored for AI agents')
    .action((stageId: string, options: { run?: string; agentSummary?: boolean }) => {
      try {
        const db = getDb();
        const run = options.run
          ? getWorkflowRunById(db, options.run)
          : getActiveWorkflowRunByBrief(db);

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found.'), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const updated = setStageInWorkflowRun(db, run.id, stageId);
        const outputData = options.agentSummary ? formatAgentSummary(updated) : updated;
        process.stdout.write(JSON.stringify(success(outputData), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('pause')
    .description('Pause the active workflow run')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .action((options: { run?: string }) => {
      try {
        const db = getDb();
        const run = options.run
          ? getWorkflowRunById(db, options.run)
          : getActiveWorkflowRunByBrief(db);

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found.'), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const updated = updateWorkflowRunStatus(db, run.id, 'paused');
        process.stdout.write(JSON.stringify(success(updated), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('resume')
    .description('Resume a paused workflow run')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .action((options: { run?: string }) => {
      try {
        const db = getDb();
        const run = options.run
          ? getWorkflowRunById(db, options.run)
          : getActiveWorkflowRunByBrief(db);

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found.'), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const updated = updateWorkflowRunStatus(db, run.id, 'running');
        process.stdout.write(JSON.stringify(success(updated), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('cancel')
    .description('Cancel an active or paused workflow run')
    .option('--run <runId>', 'Workflow run ID (defaults to active run)')
    .action((options: { run?: string }) => {
      try {
        const db = getDb();
        const run = options.run
          ? getWorkflowRunById(db, options.run)
          : getActiveWorkflowRunByBrief(db);

        if (!run) {
          process.stdout.write(
            JSON.stringify(failure('No active workflow run found.'), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const updated = updateWorkflowRunStatus(db, run.id, 'cancelled');
        process.stdout.write(JSON.stringify(success(updated), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('delete')
    .description('Delete a workflow run and all associated stage runs')
    .argument('<runId>', 'Workflow run ID to delete')
    .action((runId: string) => {
      try {
        const db = getDb();
        const deleted = deleteWorkflowRun(db, runId);
        if (!deleted) {
          process.stdout.write(
            JSON.stringify(failure(`Workflow run "${runId}" not found.`), null, 2) + '\n'
          );
          process.exitCode = 1;
          return;
        }
        process.stdout.write(JSON.stringify(success({ deletedId: runId }), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('list-runs')
    .description('List all workflow runs')
    .option('--brief <briefId>', 'Filter by brief ID')
    .action((options: { brief?: string }) => {
      try {
        const db = getDb();
        const runs = listWorkflowRuns(db, options.brief);
        process.stdout.write(JSON.stringify(success(runs), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg), null, 2) + '\n');
        process.exitCode = 1;
      }
    });

  workflowCmd
    .command('run')
    .description('Run a workflow or graph definition headlessly')
    .option(
      '-f, --file <filePath>',
      'Path to workflow definition JSON (runs default workflow if omitted)'
    )
    .option('-c, --context <jsonString>', 'Initial execution context JSON')
    .option('--brief <briefId>', 'Optional brief ID to bind database state')
    .action(async (options: { file?: string; context?: string; brief?: string }) => {
      try {
        let workflow = DEFAULT_WORKFLOW;
        if (options.file) {
          const fullPath = resolve(process.cwd(), options.file);
          if (!existsSync(fullPath)) {
            process.stdout.write(
              JSON.stringify(failure(`Workflow file not found: ${fullPath}`), null, 2) + '\n'
            );
            process.exitCode = 1;
            return;
          }
          workflow = loadAndResolveWorkflow(fullPath);
        }

        let initialContext: Record<string, unknown> = {};
        if (options.context) {
          initialContext = JSON.parse(options.context);
        }
        if (options.brief) {
          initialContext.briefId = options.brief;
        }

        let db;
        try {
          db = getDb();
        } catch {
          // DB optional
        }

        const engine = new GraphEngine();
        engine.registerRunner(
          'agent',
          new AgentNodeRunner({ db, briefId: options.brief || (initialContext.briefId as string) })
        );
        engine.registerRunner(
          'task',
          new TaskNodeRunner({ db, briefId: options.brief || (initialContext.briefId as string) })
        );

        const result = await engine.executeWorkflow(workflow, initialContext);
        process.stdout.write(JSON.stringify(success(result), null, 2) + '\n');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(JSON.stringify(failure(errorMsg, err), null, 2) + '\n');
        process.exitCode = 1;
      }
    });
}
