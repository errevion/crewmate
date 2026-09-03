import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type {
  WorkflowRun,
  WorkflowRunView,
  StageRun,
  WorkflowRunStatus,
  StageRunStatus,
} from '../models/workflow-run.js';
import type { WorkflowDefinition } from '../models/graph.js';

/**
 * Generates an 8-character hex ID
 */
export function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToStageRun(row: Record<string, unknown>): StageRun {
  let context: Record<string, unknown> = {};
  try {
    if (row.context) {
      context = JSON.parse(row.context as string);
    }
  } catch {
    context = {};
  }

  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    stageId: row.stage_id as string,
    status: row.status as StageRunStatus,
    context,
    startedAt: (row.started_at as string) || null,
    completedAt: (row.completed_at as string) || null,
  };
}

function rowToWorkflowRun(row: Record<string, unknown>): WorkflowRun {
  let workflowDef: WorkflowDefinition;
  try {
    workflowDef = JSON.parse(row.workflow_def as string);
  } catch {
    workflowDef = { id: 'unknown', name: 'Unknown Workflow', stages: [] };
  }

  let context: Record<string, unknown> = {};
  try {
    if (row.context) {
      context = JSON.parse(row.context as string);
    }
  } catch {
    context = {};
  }

  return {
    id: row.id as string,
    briefId: row.brief_id as string,
    workflowDef,
    status: row.status as WorkflowRunStatus,
    currentStage: (row.current_stage as string) || null,
    context,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) || null,
  };
}

/**
 * Creates and initializes a new workflow run with pending stage runs
 */
export function createWorkflowRun(
  db: Database.Database,
  briefId: string,
  workflowDef: WorkflowDefinition,
  initialContext: Record<string, unknown> = {}
): WorkflowRunView {
  const runId = generateId();
  const firstStage = workflowDef.stages.length > 0 ? workflowDef.stages[0].id : null;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workflow_runs (id, brief_id, workflow_def, status, current_stage, context, started_at)
       VALUES (?, ?, ?, 'running', ?, ?, datetime('now'))`
    ).run(runId, briefId, JSON.stringify(workflowDef), firstStage, JSON.stringify(initialContext));

    for (let i = 0; i < workflowDef.stages.length; i++) {
      const stage = workflowDef.stages[i];
      const stageRunId = generateId();
      const isFirst = i === 0;
      db.prepare(
        `INSERT INTO stage_runs (id, workflow_run_id, stage_id, status, context, started_at)
         VALUES (?, ?, ?, ?, '{}', ${isFirst ? "datetime('now')" : 'NULL'})`
      ).run(stageRunId, runId, stage.id, isFirst ? 'running' : 'pending');
    }
  });

  tx();

  const run = getWorkflowRunById(db, runId);
  if (!run) {
    throw new Error(`Failed to retrieve newly created workflow run ${runId}`);
  }
  return run;
}

/**
 * Gets a workflow run and all its stages by run ID
 */
export function getWorkflowRunById(db: Database.Database, id: string): WorkflowRunView | null {
  const row = db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  const stageRows = db
    .prepare(`SELECT * FROM stage_runs WHERE workflow_run_id = ? ORDER BY rowid ASC`)
    .all(id) as Record<string, unknown>[];

  const workflowRun = rowToWorkflowRun(row);
  const stageRuns = stageRows.map(rowToStageRun);

  return {
    ...workflowRun,
    stageRuns,
  };
}

/**
 * Gets the most recent or active workflow run for a brief
 */
export function getActiveWorkflowRunByBrief(
  db: Database.Database,
  briefId?: string
): WorkflowRunView | null {
  let row: Record<string, unknown> | undefined;

  if (briefId) {
    row = db
      .prepare(
        `SELECT * FROM workflow_runs WHERE brief_id = ? ORDER BY COALESCE(completed_at, started_at) DESC, rowid DESC LIMIT 1`
      )
      .get(briefId) as Record<string, unknown> | undefined;
  } else {
    row = db
      .prepare(
        `SELECT * FROM workflow_runs ORDER BY COALESCE(completed_at, started_at) DESC, rowid DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
  }

  if (!row) {
    return null;
  }

  return getWorkflowRunById(db, row.id as string);
}

/**
 * Advances the active workflow run to the next stage (or completes if last)
 */
export function advanceWorkflowRun(
  db: Database.Database,
  runId: string,
  stageOutputs: Record<string, unknown> = {}
): WorkflowRunView {
  const run = getWorkflowRunById(db, runId);
  if (!run) {
    throw new Error(`Workflow run ${runId} not found`);
  }

  const stages = run.workflowDef.stages;
  const currentStageId = run.currentStage;
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  const tx = db.transaction(() => {
    // 1. Mark current stage as completed
    if (currentStageId) {
      db.prepare(
        `UPDATE stage_runs 
         SET status = 'completed', context = ?, completed_at = datetime('now')
         WHERE workflow_run_id = ? AND stage_id = ?`
      ).run(JSON.stringify(stageOutputs), runId, currentStageId);
    }

    // 2. Merge stage outputs into global workflow context
    const updatedGlobalContext = {
      ...run.context,
      ...stageOutputs,
    };

    const nextIndex = currentIndex + 1;
    if (nextIndex < stages.length) {
      // Advance to next stage
      const nextStage = stages[nextIndex];
      db.prepare(
        `UPDATE workflow_runs 
         SET current_stage = ?, context = ?
         WHERE id = ?`
      ).run(nextStage.id, JSON.stringify(updatedGlobalContext), runId);

      db.prepare(
        `UPDATE stage_runs 
         SET status = 'running', started_at = datetime('now')
         WHERE workflow_run_id = ? AND stage_id = ?`
      ).run(runId, nextStage.id);
    } else {
      // Completed all stages
      db.prepare(
        `UPDATE workflow_runs 
         SET current_stage = NULL, status = 'completed', context = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(JSON.stringify(updatedGlobalContext), runId);
    }
  });

  tx();

  const updatedRun = getWorkflowRunById(db, runId);
  if (!updatedRun) {
    throw new Error(`Failed to retrieve advanced workflow run ${runId}`);
  }
  return updatedRun;
}

/**
 * Skips a stage in a workflow run
 */
export function skipStageInWorkflowRun(
  db: Database.Database,
  runId: string,
  stageId: string
): WorkflowRunView {
  const run = getWorkflowRunById(db, runId);
  if (!run) {
    throw new Error(`Workflow run ${runId} not found`);
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE stage_runs 
       SET status = 'skipped', completed_at = datetime('now')
       WHERE workflow_run_id = ? AND stage_id = ?`
    ).run(runId, stageId);

    // If skipping the currently active stage, advance to the next
    if (run.currentStage === stageId) {
      const stages = run.workflowDef.stages;
      const currentIndex = stages.findIndex((s) => s.id === stageId);
      const nextIndex = currentIndex + 1;

      if (nextIndex < stages.length) {
        const nextStage = stages[nextIndex];
        db.prepare(`UPDATE workflow_runs SET current_stage = ? WHERE id = ?`).run(
          nextStage.id,
          runId
        );
        db.prepare(
          `UPDATE stage_runs SET status = 'running', started_at = datetime('now') WHERE workflow_run_id = ? AND stage_id = ?`
        ).run(runId, nextStage.id);
      } else {
        db.prepare(
          `UPDATE workflow_runs SET current_stage = NULL, status = 'completed', completed_at = datetime('now') WHERE id = ?`
        ).run(runId);
      }
    }
  });

  tx();

  const updatedRun = getWorkflowRunById(db, runId);
  if (!updatedRun) {
    throw new Error(`Failed to retrieve workflow run ${runId} after skip`);
  }
  return updatedRun;
}

/**
 * Sets the active stage directly
 */
export function setStageInWorkflowRun(
  db: Database.Database,
  runId: string,
  stageId: string
): WorkflowRunView {
  const run = getWorkflowRunById(db, runId);
  if (!run) {
    throw new Error(`Workflow run ${runId} not found`);
  }

  const stageExists = run.workflowDef.stages.some((s) => s.id === stageId);
  if (!stageExists) {
    throw new Error(`Stage "${stageId}" does not exist in workflow definition`);
  }

  const tx = db.transaction(() => {
    if (run.currentStage && run.currentStage !== stageId) {
      db.prepare(
        `UPDATE stage_runs SET status = 'paused' WHERE workflow_run_id = ? AND stage_id = ?`
      ).run(runId, run.currentStage);
    }

    db.prepare(`UPDATE workflow_runs SET current_stage = ?, status = 'running' WHERE id = ?`).run(
      stageId,
      runId
    );

    db.prepare(
      `UPDATE stage_runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE workflow_run_id = ? AND stage_id = ?`
    ).run(runId, stageId);
  });

  tx();

  const updatedRun = getWorkflowRunById(db, runId);
  if (!updatedRun) {
    throw new Error(`Failed to retrieve workflow run ${runId} after set-stage`);
  }
  return updatedRun;
}

/**
 * Updates status of a workflow run (pause / resume / cancel)
 */
export function updateWorkflowRunStatus(
  db: Database.Database,
  runId: string,
  status: WorkflowRunStatus
): WorkflowRunView {
  const run = getWorkflowRunById(db, runId);
  if (!run) {
    throw new Error(`Workflow run ${runId} not found`);
  }

  const completedAt = ['completed', 'failed', 'cancelled'].includes(status)
    ? "datetime('now')"
    : 'NULL';

  db.prepare(
    `UPDATE workflow_runs 
     SET status = ?, completed_at = ${completedAt}
     WHERE id = ?`
  ).run(status, runId);

  const updatedRun = getWorkflowRunById(db, runId);
  if (!updatedRun) {
    throw new Error(`Failed to retrieve workflow run ${runId} after status update`);
  }
  return updatedRun;
}

/**
 * Lists all workflow runs
 */
export function listWorkflowRuns(db: Database.Database, briefId?: string): WorkflowRun[] {
  let rows: Record<string, unknown>[];
  if (briefId) {
    rows = db
      .prepare(`SELECT * FROM workflow_runs WHERE brief_id = ? ORDER BY started_at DESC`)
      .all(briefId) as Record<string, unknown>[];
  } else {
    rows = db.prepare(`SELECT * FROM workflow_runs ORDER BY started_at DESC`).all() as Record<
      string,
      unknown
    >[];
  }

  return rows.map(rowToWorkflowRun);
}

/**
 * Deletes a workflow run and cascades all associated stage runs
 */
export function deleteWorkflowRun(db: Database.Database, runId: string): boolean {
  const info = db.prepare('DELETE FROM workflow_runs WHERE id = ?').run(runId);
  return info.changes > 0;
}
