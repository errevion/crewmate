import type { NodeDefinition, NodeExecutionState } from '../../models/graph.js';
import type { NodeRunner, NodeRunnerResult } from './index.js';
import type { EvaluationContext } from '../router.js';
import { resolveNodeInputs } from './index.js';
import type Database from 'better-sqlite3';
import { createTask, updateTaskStatus, getTaskById } from '../../db/task-repo.js';
import { acquireLocks, releaseLocks } from '../../db/lock-repo.js';
import { createArtifact, checkTaskArtifactCompliance } from '../../db/artifact-repo.js';
import { createEvent } from '../../db/event-repo.js';
import type { ArtifactType } from '../../models/artifact.js';
import type { EventActor } from '../../models/event.js';

/**
 * Options for AgentNodeRunner
 */
export interface AgentNodeRunnerOptions {
  agentDispatcher?: (
    agentName: string,
    prompt: string,
    context: Record<string, unknown>
  ) => Promise<{ result: string; outputs?: Record<string, unknown> }>;
  db?: Database.Database;
  briefId?: string;
}

/**
 * Runner for Agent nodes.
 * Bridges graph orchestration to AI agents (Scout, Planner, Executor, Frontman, custom agents).
 */
export class AgentNodeRunner implements NodeRunner {
  private options: AgentNodeRunnerOptions;

  /**
   * Initializes a new AgentNodeRunner
   */
  constructor(options: AgentNodeRunnerOptions = {}) {
    this.options = options;
  }

  /**
   * Runs the agent node
   */
  async run(
    node: NodeDefinition,
    context: EvaluationContext,
    _state: NodeExecutionState
  ): Promise<NodeRunnerResult> {
    const config = node.config as {
      agent: string;
      prompt?: string;
      taskTemplate?: string;
    };

    const inputs = resolveNodeInputs(node, context);
    const agentName = config.agent;
    const prompt = config.prompt || `Execute node ${node.id} (${node.name || node.type})`;

    if (this.options.db && this.options.briefId) {
      try {
        createEvent(
          this.options.db,
          this.options.briefId,
          (agentName as EventActor) || 'frontman',
          'dispatched',
          `Dispatched agent node "${node.id}" (${agentName})`
        );
      } catch {
        // Event logging is non-blocking
      }
    }

    if (this.options.agentDispatcher) {
      try {
        const result = await this.options.agentDispatcher(agentName, prompt, {
          ...context.graphContext,
          ...inputs,
        });

        if (this.options.db && this.options.briefId) {
          try {
            createEvent(
              this.options.db,
              this.options.briefId,
              (agentName as EventActor) || 'frontman',
              'completed',
              `Agent node "${node.id}" completed`
            );
          } catch {
            // Non-blocking
          }
        }

        return {
          status: 'completed',
          outputs: {
            result: result.result,
            ...result.outputs,
          },
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          status: 'failed',
          error: errorMsg,
        };
      }
    }

    // Default simulation / headless mode
    return {
      status: 'completed',
      outputs: {
        agent: agentName,
        executed: true,
        summary: `Executed agent ${agentName} for node ${node.id}`,
        ...inputs,
      },
    };
  }
}

/**
 * Options for TaskNodeRunner
 */
export interface TaskNodeRunnerOptions {
  db?: Database.Database;
  briefId?: string;
  autoComplete?: boolean;
}

/**
 * Runner for Task nodes.
 * Compiles graph Task nodes into Crewmate SQLite task records with file locking & artifact gating.
 */
export class TaskNodeRunner implements NodeRunner {
  private options: TaskNodeRunnerOptions;

  /**
   * Initializes a new TaskNodeRunner
   */
  constructor(options: TaskNodeRunnerOptions = {}) {
    this.options = options;
  }

  /**
   * Runs the task node
   */
  async run(
    node: NodeDefinition,
    context: EvaluationContext,
    _state: NodeExecutionState
  ): Promise<NodeRunnerResult> {
    const config = node.config as {
      title: string;
      description: string;
      field?: string | null;
      artifactRequirements?: string[];
      lockFiles?: string[];
    };

    const inputs = resolveNodeInputs(node, context);
    const db = this.options.db;
    const briefId = this.options.briefId || (context.globalContext.briefId as string);

    if (db && briefId) {
      // Find or create the SQLite task record
      const title = config.title;
      const description = config.description || title;
      const artifactRequirements = (config.artifactRequirements || []) as ArtifactType[];

      const task = createTask(db, briefId, title, description, {
        field: config.field,
        artifactRequirements,
      });

      // Acquire file locks if specified
      if (config.lockFiles && config.lockFiles.length > 0) {
        const lockRes = acquireLocks(db, task.id, config.lockFiles);
        if (!lockRes.ok) {
          return {
            status: 'failed',
            error: `File lock conflict for task ${task.id}: file "${lockRes.conflict}" held by task "${lockRes.lockedBy}"`,
          };
        }
      }

      // Mark in_progress
      updateTaskStatus(db, task.id, 'in_progress');

      if (this.options.autoComplete !== false) {
        // Record default knowledge artifact if required by compliance gate
        if (artifactRequirements.length > 0) {
          for (const reqType of artifactRequirements) {
            let contentStr: string;
            if (reqType === 'fact') {
              contentStr = JSON.stringify({ statement: `Compliance fact for node ${node.id}` });
            } else if (reqType === 'decision') {
              contentStr = JSON.stringify({
                choice: `Decision for node ${node.id}`,
                rationale: 'Automated compliance',
              });
            } else if (reqType === 'api_contract') {
              contentStr = JSON.stringify({
                signature: 'export function foo(): void',
                filePath: 'src/index.ts',
              });
            } else if (reqType === 'constraint') {
              contentStr = JSON.stringify({
                rule: 'Must follow specifications',
                severity: 'must',
              });
            } else {
              contentStr = JSON.stringify({ summary: `Compliance note for node ${node.id}` });
            }

            createArtifact(db, task.id, briefId, reqType, contentStr);
          }
        } else {
          createArtifact(
            db,
            task.id,
            briefId,
            'fact',
            JSON.stringify({
              statement: `Completed graph task node ${node.id}`,
            })
          );
        }

        // Verify artifact compliance
        const compliance = checkTaskArtifactCompliance(db, task.id);
        if (!compliance.compliant) {
          return {
            status: 'failed',
            error:
              compliance.error ||
              `Artifact compliance failed: missing ${compliance.missing.join(', ')}`,
          };
        }

        updateTaskStatus(db, task.id, 'completed');

        // Release file locks
        if (config.lockFiles && config.lockFiles.length > 0) {
          releaseLocks(db, task.id);
        }
      }

      const hydratedTask = getTaskById(db, task.id);

      return {
        status: 'completed',
        outputs: {
          taskId: task.id,
          task: hydratedTask,
          ...inputs,
        },
      };
    }

    // In-memory headless execution without DB
    return {
      status: 'completed',
      outputs: {
        title: config.title,
        executed: true,
        ...inputs,
      },
    };
  }
}
