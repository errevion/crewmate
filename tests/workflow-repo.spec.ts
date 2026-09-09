import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createBrief } from '../src/db/brief-repo.js';
import {
  createWorkflowRun,
  getWorkflowRunById,
  getActiveWorkflowRunByBrief,
  advanceWorkflowRun,
  advanceNodeInWorkflowRun,
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
    expect(run.stageRuns[0].currentNode).toBe('frontman-interview');
    expect(run.stageRuns[0].completedNodes).toEqual([]);
    expect(run.stageRuns[1].status).toBe('pending');
    expect(run.stageRuns[1].currentNode).toBeNull();
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

  it('advances nodes within a stage following edge conditions', () => {
    const brief = createBrief(db, 'software', 'Test node advance');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    expect(run.stageRuns[0].currentNode).toBe('frontman-interview');
    expect(run.stageRuns[0].completedNodes).toEqual([]);

    const afterNode1 = advanceNodeInWorkflowRun(db, run.id, { interviewDone: true });
    expect(afterNode1.currentStage).toBe('discussion');
    const discussionStage = afterNode1.stageRuns.find((s) => s.stageId === 'discussion');
    expect(discussionStage?.currentNode).toBe('validate-brief');
    expect(discussionStage?.completedNodes).toEqual(['frontman-interview']);
  });

  it('auto-advances stage when advancing past exit node', () => {
    const brief = createBrief(db, 'software', 'Test exit node');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    advanceNodeInWorkflowRun(db, run.id, {});
    const afterExitNode = advanceNodeInWorkflowRun(db, run.id, { isComplete: true });

    expect(afterExitNode.currentStage).toBe('research');
    expect(afterExitNode.stageRuns.find((s) => s.stageId === 'discussion')?.status).toBe(
      'completed'
    );
    expect(afterExitNode.stageRuns.find((s) => s.stageId === 'research')?.status).toBe('running');
    expect(afterExitNode.stageRuns.find((s) => s.stageId === 'research')?.currentNode).toBe(
      'scout-explore'
    );
  });

  it('sets entry node when advancing to a new stage via advanceWorkflowRun', () => {
    const brief = createBrief(db, 'software', 'Test stage advance entry node');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    const afterAdvance = advanceWorkflowRun(db, run.id, { briefDone: true });
    expect(afterAdvance.currentStage).toBe('research');
    const researchStage = afterAdvance.stageRuns.find((s) => s.stageId === 'research');
    expect(researchStage?.currentNode).toBe('scout-explore');
    expect(researchStage?.completedNodes).toEqual([]);
  });

  it('sets entry node when skipping to a new stage', () => {
    const brief = createBrief(db, 'software', 'Test skip entry node');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    const afterSkip = skipStageInWorkflowRun(db, run.id, 'discussion');
    expect(afterSkip.currentStage).toBe('research');
    const researchStage = afterSkip.stageRuns.find((s) => s.stageId === 'research');
    expect(researchStage?.currentNode).toBe('scout-explore');
  });

  it('preserves or sets entry node when jumping to a stage via set-stage', () => {
    const brief = createBrief(db, 'software', 'Test set-stage entry node');
    const run = createWorkflowRun(db, brief.id, DEFAULT_WORKFLOW);

    const jumped = setStageInWorkflowRun(db, run.id, 'execution');
    expect(jumped.currentStage).toBe('execution');
    const executionStage = jumped.stageRuns.find((s) => s.stageId === 'execution');
    expect(executionStage?.currentNode).toBe('executor-run');
  });
});
