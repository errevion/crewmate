import type { WorkflowDefinition } from './graph.js';

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'paused',
  'cancelled',
] as const;

/**
 * Status of a workflow run
 */
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const STAGE_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'paused',
] as const;

/**
 * Status of an individual stage run
 */
export type StageRunStatus = (typeof STAGE_RUN_STATUSES)[number];

/**
 * Persisted stage run in SQLite
 */
export interface StageRun {
  id: string;
  workflowRunId: string;
  stageId: string;
  status: StageRunStatus;
  context: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Persisted workflow run in SQLite
 */
export interface WorkflowRun {
  id: string;
  briefId: string;
  workflowDef: WorkflowDefinition;
  status: WorkflowRunStatus;
  currentStage: string | null;
  context: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

/**
 * Detailed view of a workflow run including all stage runs
 */
export interface WorkflowRunView extends WorkflowRun {
  stageRuns: StageRun[];
}

/**
 * Concise workflow execution summary tailored for AI agents (Frontman)
 */
export interface WorkflowSummary {
  id: string;
  briefId: string;
  status: WorkflowRunStatus;
  currentStage: string | null;
  stageName?: string;
  stageDescription?: string;
  startedAt: string;
  completedAt: string | null;
  activeNodes?: {
    id: string;
    name?: string;
    type: string;
    prompt?: string;
    allowedTools?: string[];
    deniedTools?: string[];
    config?: Record<string, unknown>;
  }[];
  edges?: {
    from: string;
    to: string;
    condition?: {
      type: string;
      field?: string;
      operator?: string;
      value?: unknown;
    };
    label?: string;
  }[];
  context?: Record<string, unknown>;
  stages?: {
    id: string;
    name: string;
    status: StageRunStatus | 'pending';
  }[];
}
