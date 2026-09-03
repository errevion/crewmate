import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createBrief } from '../src/db/brief-repo.js';
import {
  createWorkflowRun,
  getWorkflowRunById,
  getActiveWorkflowRunByBrief,
  advanceWorkflowRun,
  skipStageInWorkflowRun,
  setStageInWorkflowRun,
  updateWorkflowRunStatus,
  listWorkflowRuns,
} from '../src/db/workflow-repo.js';
import { DEFAULT_WORKFLOW } from '../src/graph/default-workflow.js';

describe('Workflow Repository & Run State Persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('creates a workflow run with initialized stages', () => {
    const brief = createBrief(db, 'software', 'Test workflow');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW, { env: 'test' });

    expect(run.id).toBeDefined();
    expect(run.briefId).toBe(brief.id);
    expect(run.status).toBe('running');
    expect(run.currentStage).toBe('discussion');
    expect(run.context).toEqual({ env: 'test' });
    expect(run.stageRuns).toHaveLength(5);
    expect(run.stageRuns[0].stageId).toBe('discussion');
    expect(run.stageRuns[0].status).toBe('running');
    expect(run.stageRuns[1].status).toBe('pending');
  });

  it('fetches the active workflow run by brief', () => {
    const brief = createBrief(db, 'software', 'Test workflow');
    createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    const active = getActiveWorkflowRunByBrief(db, brief.id);
    expect(active).not.toBeNull();
    expect(active?.briefId).toBe(brief.id);
    expect(active?.currentStage).toBe('discussion');
  });

  it('advances through stages sequentially to completion', () => {
    const brief = createBrief(db, 'software', 'Test workflow');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    // Advance Stage 1 (discussion) -> Stage 2 (research)
    const afterStage1 = advanceWorkflowRun(db, run.id, { briefDone: true });
    expect(afterStage1.currentStage).toBe('research');
    expect(afterStage1.context.briefDone).toBe(true);
    expect(afterStage1.stageRuns.find((s) => s.stageId === 'discussion')?.status).toBe('completed');
    expect(afterStage1.stageRuns.find((s) => s.stageId === 'research')?.status).toBe('running');

    // Advance Stage 2 -> Stage 3 (planning)
    const afterStage2 = advanceWorkflowRun(db, run.id, { researchDone: true });
    expect(afterStage2.currentStage).toBe('planning');

    // Advance Stage 3 -> Stage 4 (execution)
    const afterStage3 = advanceWorkflowRun(db, run.id, { planningDone: true });
    expect(afterStage3.currentStage).toBe('execution');

    // Advance Stage 4 -> Stage 5 (verification)
    const afterStage4 = advanceWorkflowRun(db, run.id, { executionDone: true });
    expect(afterStage4.currentStage).toBe('verification');

    // Advance Stage 5 -> Completed
    const afterStage5 = advanceWorkflowRun(db, run.id, { verificationDone: true });
    expect(afterStage5.currentStage).toBeNull();
    expect(afterStage5.status).toBe('completed');
    expect(afterStage5.completedAt).toBeDefined();
  });

  it('skips a stage cleanly and advances to the next', () => {
    const brief = createBrief(db, 'software', 'Test workflow');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    // Skip current active stage (discussion)
    const afterSkip = skipStageInWorkflowRun(db, run.id, 'discussion');
    expect(afterSkip.currentStage).toBe('research');
    expect(afterSkip.stageRuns.find((s) => s.stageId === 'discussion')?.status).toBe('skipped');
    expect(afterSkip.stageRuns.find((s) => s.stageId === 'research')?.status).toBe('running');
  });

  it('allows jumping directly to a specific stage', () => {
    const brief = createBrief(db, 'software', 'Test workflow');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    const jumped = setStageInWorkflowRun(db, run.id, 'execution');
    expect(jumped.currentStage).toBe('execution');
    expect(jumped.stageRuns.find((s) => s.stageId === 'execution')?.status).toBe('running');
  });

  it('pauses and resumes workflow runs', () => {
    const brief = createBrief(db, 'software', 'Test workflow');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    const paused = updateWorkflowRunStatus(db, run.id, 'paused');
    expect(paused.status).toBe('paused');

    const resumed = updateWorkflowRunStatus(db, run.id, 'running');
    expect(resumed.status).toBe('running');
  });

  it('lists all workflow runs', () => {
    const brief1 = createBrief(db, 'software', 'Test 1');
    const brief2 = createBrief(db, 'software', 'Test 2');
    createWorkflowRun(db, brief1.id, DEFAULT_WORKFLOW);
    createWorkflowRun(db, brief2.id, DEFAULT_WORKFLOW);

    const allRuns = listWorkflowRuns(db);
    expect(allRuns).toHaveLength(2);

    const brief1Runs = listWorkflowRuns(db, brief1.id);
    expect(brief1Runs).toHaveLength(1);
    expect(brief1Runs[0].briefId).toBe(brief1.id);
  });
});
