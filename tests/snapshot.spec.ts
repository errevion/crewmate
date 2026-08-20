import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createBrief, setField, markComplete } from '../src/db/brief-repo.js';
import { createTask, updateTaskStatus } from '../src/db/task-repo.js';
import { setActivity } from '../src/db/activity-repo.js';
import { buildSnapshot } from '../src/utils/snapshot.js';

describe('Workflow Snapshot Frontman State Derivation', () => {
  let db: Database.Database;
  let briefId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const brief = createBrief(db);
    briefId = brief.id;
  });

  it('derives asking state when activityType is questioning or awaiting_response', () => {
    setActivity(db, briefId, 'questioning', { message: 'Pick a framework' });
    let snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('asking');
    expect(snapshot?.currentActivity?.activityType).toBe('questioning');

    setActivity(db, briefId, 'awaiting_response', { message: 'Waiting for answer' });
    snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('asking');
  });

  it('derives thinking state when activityType is analyzing, planning, orchestrating, or reviewing', () => {
    setActivity(db, briefId, 'analyzing');
    let snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('thinking');

    setActivity(db, briefId, 'planning');
    snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('thinking');

    setActivity(db, briefId, 'orchestrating');
    snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('thinking');

    setActivity(db, briefId, 'reviewing');
    snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('thinking');
  });

  it('derives idle state when activityType is idle', () => {
    setActivity(db, briefId, 'idle');
    const snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('idle');
  });

  it('falls back to draft brief status when no activity record exists (backward compatibility)', () => {
    // No activity created, brief in draft
    const snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('asking');
    expect(snapshot?.currentActivity).toBeNull();
  });

  it('falls back to thinking when brief is completed and tasks are in progress or empty', () => {
    setField(briefId, 'workType', 'software', db);
    setField(briefId, 'goal', 'Build app', db);
    setField(briefId, 'scope', { included: ['x'], excluded: [] }, db);
    setField(briefId, 'functionalRequirements', ['req1'], db);
    setField(briefId, 'acceptanceCriteria', ['crit1'], db);
    markComplete(briefId, db);

    const task = createTask(db, briefId, 'Task 1', 'Do something');
    let snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('thinking');

    updateTaskStatus(db, task.id, 'completed');
    snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('idle');
  });
});
