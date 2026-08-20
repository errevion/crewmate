import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createEvent, listEvents, countEvents } from '../src/db/event-repo.js';
import { buildSnapshot, newEvents } from '../src/utils/snapshot.js';
import { SPINNERS, buildDispatchFrame, buildWorkScene } from '../src/utils/ascii.js';

function seed(db: Database.Database): void {
  db.prepare(`INSERT INTO briefs (id) VALUES ('brief-1')`).run();
  db.prepare(`INSERT INTO briefs (id) VALUES ('brief-2')`).run();
  db.prepare(
    `INSERT INTO tasks (id, brief_id, title, description) VALUES ('task-1', 'brief-1', 'Task 1', 'Desc 1')`
  ).run();
  db.prepare(
    `INSERT INTO tasks (id, brief_id, title, description) VALUES ('task-2', 'brief-1', 'Task 2', 'Desc 2')`
  ).run();
}

describe('execution events repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('should create an execution event', () => {
    const event = createEvent(db, 'brief-1', 'executor', 'locked', 'Locked 2 file(s) for task-1', {
      taskId: 'task-1',
    });

    expect(event).toBeDefined();
    expect(event.id).toHaveLength(8);
    expect(event.briefId).toBe('brief-1');
    expect(event.taskId).toBe('task-1');
    expect(event.actor).toBe('executor');
    expect(event.type).toBe('locked');
    expect(event.message).toBe('Locked 2 file(s) for task-1');
    expect(event.createdAt).toBeDefined();
  });

  it('should support events without a linked task', () => {
    const event = createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched scout');
    expect(event.taskId).toBeNull();
  });

  it('should list events filtered by brief, task, actor, and type', () => {
    createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched scout');
    createEvent(db, 'brief-1', 'executor', 'started', 'Started task-1', { taskId: 'task-1' });
    createEvent(db, 'brief-1', 'executor', 'completed', 'Completed task-1', { taskId: 'task-1' });
    createEvent(db, 'brief-2', 'planner', 'started', 'Started planning');

    expect(listEvents(db).length).toBe(4);

    const brief1 = listEvents(db, { briefId: 'brief-1' });
    expect(brief1.length).toBe(3);

    const task1 = listEvents(db, { taskId: 'task-1' });
    expect(task1.length).toBe(2);

    const dispatches = listEvents(db, { type: 'dispatched' });
    expect(dispatches.length).toBe(1);
    expect(dispatches[0].actor).toBe('frontman');

    const executors = listEvents(db, { actor: 'executor' });
    expect(executors.length).toBe(2);
  });

  it('should list events newest-first and respect limit', () => {
    createEvent(db, 'brief-1', 'executor', 'started', 'Started task-1', { taskId: 'task-1' });
    createEvent(db, 'brief-1', 'executor', 'completed', 'Completed task-1', { taskId: 'task-1' });

    const limited = listEvents(db, { briefId: 'brief-1', limit: 1 });
    expect(limited.length).toBe(1);
    expect(limited[0].type).toBe('completed');
  });

  it('should count events for a brief', () => {
    createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched scout');
    createEvent(db, 'brief-2', 'planner', 'started', 'Started planning');

    expect(countEvents(db, 'brief-1')).toBe(1);
    expect(countEvents(db, 'brief-2')).toBe(1);
  });
});

describe('workflow snapshot', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seed(db);
  });

  it('should derive ready vs blocked tasks from the dependency graph', () => {
    db.prepare(`UPDATE tasks SET status = 'completed' WHERE id = 'task-1'`).run();
    db.prepare(`UPDATE tasks SET status = 'pending' WHERE id = 'task-2'`).run();
    db.prepare(`UPDATE tasks SET dependencies = '["task-1"]' WHERE id = 'task-2'`).run();

    const snapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
    expect(byId.get('task-2')?.ready).toBe(true);
    expect(byId.get('task-2')?.blocked).toBe(false);
    expect(snapshot.completedCount).toBe(1);
    expect(snapshot.totalCount).toBe(2);
  });

  it('should mark a pending task with unfinished dependencies as blocked', () => {
    db.prepare(`UPDATE tasks SET dependencies = '["task-1"]' WHERE id = 'task-2'`).run();

    const snapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    if (!snapshot) return;
    const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
    expect(byId.get('task-2')?.ready).toBe(false);
    expect(byId.get('task-2')?.blocked).toBe(true);
  });

  it('should derive agent states from the latest event per actor', () => {
    createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched executor', {
      taskId: 'task-1',
    });
    createEvent(db, 'brief-1', 'executor', 'started', 'Started task-1', { taskId: 'task-1' });
    createEvent(db, 'brief-1', 'executor', 'error', 'Lock conflict on src/a.ts', {
      taskId: 'task-1',
    });

    const snapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    if (!snapshot) return;

    const frontman = snapshot.agents.find((a) => a.actor === 'frontman');
    expect(frontman?.state).toBe('active');
    expect(frontman?.taskTitle).toBe('Task 1');

    const executor = snapshot.agents.find((a) => a.actor === 'executor');
    expect(executor?.state).toBe('error');

    const scout = snapshot.agents.find((a) => a.actor === 'scout');
    expect(scout?.state).toBe('idle');
  });

  it('should only include active dispatches in dispatchEdges', () => {
    // 1. Dispatch scout and executor
    createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched scout to explore codebase');
    createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched executor for Task 1', {
      taskId: 'task-1',
    });

    const activeSnapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    expect(activeSnapshot?.dispatchEdges.length).toBe(2);

    // 2. Scout finishes exploring
    createEvent(db, 'brief-1', 'scout', 'completed', 'Finished codebase exploration');

    const scoutDoneSnapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    expect(scoutDoneSnapshot?.dispatchEdges.length).toBe(1);
    expect(scoutDoneSnapshot?.dispatchEdges[0].target).toBe('executor');

    // 3. Task 1 completes
    db.prepare(`UPDATE tasks SET status = 'completed' WHERE id = 'task-1'`).run();
    createEvent(db, 'brief-1', 'executor', 'completed', 'Completed Task 1', { taskId: 'task-1' });

    const allDoneSnapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    expect(allDoneSnapshot?.dispatchEdges.length).toBe(0);
  });

  it('should return null when no brief exists', () => {
    const empty = new Database(':memory:');
    runMigrations(empty);
    expect(buildSnapshot({}, empty)).toBeNull();
  });
});

describe('newEvents diffing', () => {
  it('should only return events not already seen', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seed(db);
    createEvent(db, 'brief-1', 'frontman', 'dispatched', 'Dispatched scout');
    const snapshot = buildSnapshot({ briefId: 'brief-1' }, db);
    if (!snapshot) return;

    const seen = new Set(snapshot.events.map((e) => e.id));
    expect(newEvents(snapshot, seen).length).toBe(0);

    createEvent(db, 'brief-1', 'scout', 'started', 'Started exploring');
    const snapshot2 = buildSnapshot({ briefId: 'brief-1' }, db);
    if (!snapshot2) return;
    const fresh = newEvents(snapshot2, seen);
    expect(fresh.length).toBe(1);
    expect(fresh[0].actor).toBe('scout');
  });
});

describe('ascii animation frames', () => {
  it('should render dispatch frames with the target label', () => {
    const frame = buildDispatchFrame(0.5, 'executor');
    expect(frame).toContain('FRONTMAN');
    expect(frame.toUpperCase()).toContain('EXECUTOR');
    expect(frame).toContain('( )');
    expect(frame.split('\n').length).toBe(4);
  });

  it('should render progressively different frames as progress advances', () => {
    expect(buildDispatchFrame(0, 'executor')).not.toBe(buildDispatchFrame(1, 'executor'));
  });

  it('should render an idle work scene when no active work', () => {
    const scene = buildWorkScene([]);
    expect(scene).toContain('FRONTMAN');
    expect(scene).toContain('waiting for dispatch');
  });

  it('should render active work with spinners', () => {
    const scene = buildWorkScene([{ label: 'Implement auth', spinner: SPINNERS[0] }]);
    expect(scene).toContain('Implement auth');
    expect(scene).toContain(SPINNERS[0]);
  });
});
