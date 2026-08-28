import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createBrief, setField, markComplete } from '../src/db/brief-repo.js';
import { createTask, updateTaskStatus } from '../src/db/task-repo.js';
import { setActivity } from '../src/db/activity-repo.js';
import { recordHeartbeat } from '../src/db/session-repo.js';
import { buildSnapshot } from '../src/utils/snapshot.js';
import {
  formatBriefDetails,
  formatTaskDetails,
  formatEventDetails,
  formatLockDetails,
  formatTime,
} from '../src/commands/watch.js';
import type { Brief } from '../src/models/brief.js';
import type { Task } from '../src/models/task.js';
import type { ExecutionEvent } from '../src/models/event.js';
import type { FileLock } from '../src/models/lock.js';

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

  it('derives idle state and inactive status when session is idle (user interrupted)', () => {
    setActivity(db, briefId, 'orchestrating');
    recordHeartbeat(db, briefId, 'opencode', process.pid, 'idle');

    const snapshot = buildSnapshot({ briefId }, db);
    expect(snapshot?.frontmanState).toBe('idle');
    expect(snapshot?.sessionStatus).toBe('idle');
    expect(snapshot?.isSessionActive).toBe(false);
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

  it('builds empty snapshot when allowEmpty is true and no brief exists', () => {
    const emptyDb = new Database(':memory:');
    runMigrations(emptyDb);

    const snapshot = buildSnapshot({ allowEmpty: true }, emptyDb);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.briefId).toBe('(none)');
    expect(snapshot?.briefStatus).toBe('none');
    expect(snapshot?.tasks).toEqual([]);
    expect(snapshot?.events).toEqual([]);
    expect(snapshot?.frontmanState).toBe('idle');
  });
});

describe('formatBriefDetails', () => {
  it('handles null brief', () => {
    const formatted = formatBriefDetails(null);
    expect(formatted).toContain('No brief found');
  });

  it('formats full brief details with all fields', () => {
    const brief: Brief = {
      id: 'abc12345',
      status: 'complete',
      workType: 'software',
      goal: 'Build authentication system',
      scope: { included: ['OAuth2', 'JWT'], excluded: ['SAML'] },
      functionalRequirements: ['Login with Google', 'Refresh token rotation'],
      acceptanceCriteria: ['Passes unit tests', 'Latency < 200ms'],
      technicalStack: {
        frontend: ['React'],
        backend: ['Node.js', 'Express'],
        database: ['SQLite'],
        tools: ['Vitest'],
      },
      constraints: {
        requirements: ['Node 20+'],
        exclusions: ['No external cloud services'],
      },
      deliverables: [{ type: 'code', format: 'repo' }],
      dependencies: ['node-fetch'],
      risks: ['Token expiration edge cases'],
      existingCodebase: ['src/index.ts'],
      referenceMaterials: ['RFC 6749'],
      qualityStandards: {
        performance: { maxResponseTimeMs: 200 },
        security: { rateLimit: true },
        accessibility: {},
      },
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T01:00:00Z',
    };

    const formatted = formatBriefDetails(brief);
    expect(formatted).toContain('abc12345');
    expect(formatted).toContain('complete');
    expect(formatted).toContain('software');
    expect(formatted).toContain('Build authentication system');
    expect(formatted).toContain('OAuth2');
    expect(formatted).toContain('SAML');
    expect(formatted).toContain('Login with Google');
    expect(formatted).toContain('Passes unit tests');
    expect(formatted).toContain('React');
    expect(formatted).toContain('Node 20+');
    expect(formatted).toContain('No external cloud services');
    expect(formatted).toContain('[code] (repo)');
    expect(formatted).toContain('node-fetch');
    expect(formatted).toContain('Token expiration edge cases');
    expect(formatted).toContain('src/index.ts');
    expect(formatted).toContain('RFC 6749');
    expect(formatted).toContain('maxResponseTimeMs');
  });

  it('handles empty / partial brief gracefully', () => {
    const brief: Brief = {
      id: 'draft123',
      status: 'draft',
      workType: null,
      goal: null,
      scope: null,
      functionalRequirements: null,
      acceptanceCriteria: null,
      technicalStack: null,
      constraints: null,
      deliverables: null,
      dependencies: null,
      risks: null,
      existingCodebase: null,
      referenceMaterials: null,
      qualityStandards: null,
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:00:00Z',
    };

    const formatted = formatBriefDetails(brief);
    expect(formatted).toContain('draft123');
    expect(formatted).toContain('draft');
    expect(formatted).toContain('(not set)');
    expect(formatted).toContain('(none)');
  });

  it('handles non-array / string fields in technicalStack, scope, and constraints without throwing', () => {
    const brief: any = {
      id: 'loose123',
      status: 'draft',
      workType: 'software',
      goal: 'Test resilient formatting',
      scope: { included: 'Single scope item', excluded: 'Single exclusion' },
      functionalRequirements: 'Single requirement',
      acceptanceCriteria: 'Single criterion',
      technicalStack: {
        frontend: 'React with Tailwind',
        backend: 'Express.js',
        database: 'SQLite',
        tools: 'Vitest',
      },
      constraints: {
        requirements: 'Node 20+',
        exclusions: 'No external APIs',
      },
      deliverables: { type: 'code', format: 'file' },
      dependencies: 'single-dep',
      risks: 'single-risk',
      existingCodebase: 'src/main.ts',
      referenceMaterials: 'README.md',
      qualityStandards: null,
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:00:00Z',
    };

    expect(() => formatBriefDetails(brief)).not.toThrow();
    const formatted = formatBriefDetails(brief);
    expect(formatted).toContain('React with Tailwind');
    expect(formatted).toContain('Express.js');
    expect(formatted).toContain('Single scope item');
    expect(formatted).toContain('Single requirement');
    expect(formatted).toContain('Node 20+');
  });
});

describe('formatTaskDetails', () => {
  it('handles null task', () => {
    const formatted = formatTaskDetails(null);
    expect(formatted).toContain('No task selected');
  });

  it('formats full task details with all fields and dependencies mapped', () => {
    const depTask: Task = {
      id: 'dep1',
      briefId: 'brief1',
      title: 'Database schema setup',
      description: 'Create SQLite tables',
      dependencies: [],
      field: 'technicalStack',
      status: 'completed',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:10:00Z',
    };

    const task: Task = {
      id: 'task1',
      briefId: 'brief1',
      title: 'Implement auth routes',
      description: 'Add /login and /signup endpoints with JWT validation',
      dependencies: ['dep1'],
      field: 'functionalRequirements',
      status: 'in_progress',
      createdAt: '2026-08-21T00:15:00Z',
      updatedAt: '2026-08-21T00:20:00Z',
    };

    const formatted = formatTaskDetails(task, [depTask, task]);
    expect(formatted).toContain('task1');
    expect(formatted).toContain('Implement auth routes');
    expect(formatted).toContain('in_progress');
    expect(formatted).toContain('brief1');
    expect(formatted).toContain('functionalRequirements');
    expect(formatted).toContain('Add /login and /signup endpoints with JWT validation');
    expect(formatted).toContain('dep1');
    expect(formatted).toContain('Database schema setup');
    expect(formatted).toContain('2026-08-21T00:15:00Z');
  });

  it('handles task with no dependencies and no field', () => {
    const task: Task = {
      id: 'task2',
      briefId: 'brief2',
      title: 'Write readme',
      description: '',
      dependencies: [],
      field: null,
      status: 'pending',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:00:00Z',
    };

    const formatted = formatTaskDetails(task);
    expect(formatted).toContain('task2');
    expect(formatted).toContain('Write readme');
    expect(formatted).toContain('pending');
    expect(formatted).toContain('(no description provided)');
    expect(formatted).toContain('(none)');
  });
});

describe('formatEventDetails', () => {
  it('handles empty events list gracefully', () => {
    const formatted = formatEventDetails([]);
    expect(formatted).toContain('No execution events recorded yet');
  });

  it('formats execution events list with task mappings and timestamps', () => {
    const task: Task = {
      id: 'task-123',
      briefId: 'brief-abc',
      title: 'Setup Database',
      description: 'Setup SQLite schema',
      dependencies: [],
      field: 'technicalStack',
      status: 'completed',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:05:00Z',
    };

    const events: ExecutionEvent[] = [
      {
        id: 'evt-1',
        briefId: 'brief-abc',
        taskId: 'task-123',
        actor: 'executor',
        type: 'started',
        message: 'Started executing Setup Database',
        createdAt: '2026-08-21T00:01:00Z',
      },
      {
        id: 'evt-2',
        briefId: 'brief-abc',
        taskId: 'task-123',
        actor: 'executor',
        type: 'completed',
        message: 'Finished executing Setup Database',
        createdAt: '2026-08-21T00:05:00Z',
      },
    ];

    const formatted = formatEventDetails(events, [task]);
    expect(formatted).toContain('Total Events Recorded:');
    expect(formatted).toContain('2');
    expect(formatted).toContain('executor');
    expect(formatted).toContain('started');
    expect(formatted).toContain('completed');
    expect(formatted).toContain('Setup Database');
    expect(formatted).toContain('Started executing Setup Database');
    expect(formatted).toContain('Finished executing Setup Database');
  });
});

describe('formatLockDetails', () => {
  it('handles empty locks list gracefully', () => {
    const formatted = formatLockDetails([]);
    expect(formatted).toContain('No active file locks');
  });

  it('formats active file locks list with task mappings', () => {
    const task: Task = {
      id: 'task-auth',
      briefId: 'brief-abc',
      title: 'Implement Auth Handler',
      description: 'Add token auth',
      dependencies: [],
      field: 'functionalRequirements',
      status: 'in_progress',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:05:00Z',
    };

    const locks: FileLock[] = [
      {
        id: 'lock-1',
        taskId: 'task-auth',
        filePath: 'src/routes/auth.ts',
        createdAt: '2026-08-21T00:02:00Z',
      },
    ];

    const formatted = formatLockDetails(locks, [task]);
    expect(formatted).toContain('Active File Locks:');
    expect(formatted).toContain('1');
    expect(formatted).toContain('src/routes/auth.ts');
    expect(formatted).toContain('task-auth');
    expect(formatted).toContain('Implement Auth Handler');
  });
});
