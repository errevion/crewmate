import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import {
  createBrief,
  setField,
  markComplete,
  listBriefs,
  getLatestBrief,
} from '../src/db/brief-repo.js';
import { createTask, updateTaskStatus } from '../src/db/task-repo.js';
import { setActivity } from '../src/db/activity-repo.js';
import { recordHeartbeat } from '../src/db/session-repo.js';
import { buildSnapshot } from '../src/utils/snapshot.js';
import {
  formatBriefDetails,
  formatBriefListItem,
  formatTaskDetails,
  formatEventDetails,
  formatEventListItem,
  formatSingleEventDetail,
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

describe('Frontman agent prompt rule adherence', () => {
  it('verifies that .opencode/agents/frontman.md contains immediate state transition rules', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const frontmanPath = resolve(process.cwd(), '../.opencode/agents/frontman.md');
    const content = await readFile(frontmanPath, 'utf-8');

    // Rule: Transition away from questioning / awaiting_response immediately on receiving input
    expect(content).toMatch(/Immediately/i);
    expect(content).toContain('questioning');
    expect(content).toContain('awaiting_response');
    expect(content).toContain('analyzing');
    expect(content).toContain('planning');
    expect(content).toContain('orchestrating');
    expect(content).toContain('reviewing');
    expect(content).toContain('idle');
    expect(content).toMatch(/Do not linger in `questioning` \/ `awaiting_response`/);
  });

  it('verifies that .opencode/agents/frontman.md enforces streaming markdown tables before concise question prompts', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const frontmanPath = resolve(process.cwd(), '../.opencode/agents/frontman.md');
    const content = await readFile(frontmanPath, 'utf-8');

    // Rule: Question UX Formatting & chat stream
    expect(content).toContain('Question UX Formatting');
    expect(content).toMatch(/Stream all main markdown tables/);
    expect(content).toMatch(/chat feed first/);
    expect(content).toMatch(
      /concise questions and selectable options inside the `question` tool prompt/
    );
    expect(content).toMatch(
      /Never dump large markdown tables or lengthy content directly into the `question` tool prompt/
    );
  });
});

describe('listBriefs and getLatestBrief ordering', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('listBriefs returns all briefs ordered by updated_at or created_at descending', () => {
    const brief1 = createBrief(db);
    const brief2 = createBrief(db);
    const brief3 = createBrief(db);

    // Explicitly update timestamps to test ordering deterministically
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 10:00:00',
      '2026-08-30 10:00:00',
      brief1.id
    );
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 10:01:00',
      '2026-08-30 10:01:00',
      brief2.id
    );
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 10:02:00',
      '2026-08-30 10:02:00',
      brief3.id
    );

    // Update brief1 to make it the most recently updated
    db.prepare('UPDATE briefs SET updated_at = ? WHERE id = ?').run(
      '2026-08-30 10:05:00',
      brief1.id
    );

    const briefs = listBriefs(db);
    expect(briefs).toHaveLength(3);
    expect(briefs[0].id).toBe(brief1.id);
    expect(briefs[1].id).toBe(brief3.id);
    expect(briefs[2].id).toBe(brief2.id);

    const latest = getLatestBrief(db);
    expect(latest?.id).toBe(brief1.id);
  });

  it('returns empty array / null when no briefs exist', () => {
    expect(listBriefs(db)).toEqual([]);
    expect(getLatestBrief(db)).toBeNull();
  });

  it('orders by COALESCE(updated_at, created_at) DESC and breaks ties with rowid DESC', () => {
    const b1 = createBrief(db);
    const b2 = createBrief(db);
    const b3 = createBrief(db);

    // Set identical timestamps
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 12:00:00',
      '2026-08-30 12:00:00',
      b1.id
    );
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 12:00:00',
      '2026-08-30 12:00:00',
      b2.id
    );
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 12:00:00',
      '2026-08-30 12:00:00',
      b3.id
    );

    const briefs = listBriefs(db);
    expect(briefs[0].id).toBe(b3.id);
    expect(briefs[1].id).toBe(b2.id);
    expect(briefs[2].id).toBe(b1.id);
    expect(getLatestBrief(db)?.id).toBe(b3.id);
  });

  it('falls back to created_at when updated_at matches or across multiple briefs', () => {
    const b1 = createBrief(db);
    const b2 = createBrief(db);
    const b3 = createBrief(db);

    // b1 has older created_at with updated_at equal to created_at
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 08:00:00',
      '2026-08-30 08:00:00',
      b1.id
    );
    // b2 has newer created_at with updated_at equal to created_at
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 09:00:00',
      '2026-08-30 09:00:00',
      b2.id
    );
    // b3 has oldest created_at but newer updated_at
    db.prepare('UPDATE briefs SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2026-08-30 07:00:00',
      '2026-08-30 10:00:00',
      b3.id
    );

    const briefs = listBriefs(db);
    expect(briefs[0].id).toBe(b3.id); // 10:00:00 (updated_at)
    expect(briefs[1].id).toBe(b2.id); // 09:00:00 (created_at fallback/equality)
    expect(briefs[2].id).toBe(b1.id); // 08:00:00 (created_at fallback/equality)
    expect(getLatestBrief(db)?.id).toBe(b3.id);
  });
});

describe('formatBriefListItem', () => {
  it('formats completed brief with goal truncation, tags, and formatted timestamp', () => {
    const brief: Brief = {
      id: 'brief123',
      status: 'complete',
      workType: 'software',
      goal: 'Build an ultra comprehensive real-time dashboard for AI agent execution workflows with interactive modals',
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
      createdAt: '2026-08-30T10:00:00Z',
      updatedAt: '2026-08-30T15:30:45Z',
    };

    const formatted = formatBriefListItem(brief);
    expect(formatted).toContain('{green-fg}[complete]{/green-fg}');
    expect(formatted).toContain('{bold}brief123{/bold}');
    expect(formatted).toContain('…');
    expect(formatted).toContain(formatTime('2026-08-30T15:30:45Z'));
    expect(formatted).not.toContain('interactive modals');
  });

  it('formats draft brief with empty goal gracefully', () => {
    const brief: Brief = {
      id: 'draft456',
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
      createdAt: '2026-08-30T09:15:00Z',
      updatedAt: '2026-08-30T09:15:00Z',
    };

    const formatted = formatBriefListItem(brief);
    expect(formatted).toContain('{yellow-fg}[draft]{/yellow-fg}');
    expect(formatted).toContain('{bold}draft456{/bold}');
    expect(formatted).toContain('(no goal)');
    expect(formatted).toContain(formatTime('2026-08-30T09:15:00Z'));
  });

  it('collapses multiple whitespace in goal and uses createdAt if updatedAt is null', () => {
    const brief: Brief = {
      id: 'ws789',
      status: 'draft',
      workType: null,
      goal: '   multi \n\n line   and \t spaced   goal   ',
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
      createdAt: '2026-08-30T08:00:00Z',
      updatedAt: '',
    };

    const formatted = formatBriefListItem(brief);
    expect(formatted).toContain('multi line and spaced goal');
    expect(formatted).toContain(formatTime('2026-08-30T08:00:00Z'));
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

describe('formatEventListItem', () => {
  it('formats event with task metadata correctly', () => {
    const task: Task = {
      id: 'task-100',
      briefId: 'brief-abc',
      title: 'Run database migrations and seed default records',
      description: 'setup db',
      dependencies: [],
      field: 'technicalStack',
      status: 'in_progress',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:01:00Z',
    };

    const evt: ExecutionEvent = {
      id: 'evt-101',
      briefId: 'brief-abc',
      taskId: 'task-100',
      actor: 'executor',
      type: 'started',
      message: 'Started executing migration task now',
      createdAt: '2026-08-21T12:30:00Z',
    };

    const formatted = formatEventListItem(evt, [task]);
    expect(formatted).toContain('executor');
    expect(formatted).toContain('[STARTED]');
    expect(formatted).toContain('Started executing migration task now');
    expect(formatted).toContain('task:');
    expect(formatted).toContain('Run database migrations');
  });

  it('formats brief-level event without task metadata', () => {
    const evt: ExecutionEvent = {
      id: 'evt-brief-1',
      briefId: 'brief-abc',
      taskId: null,
      actor: 'frontman',
      type: 'dispatched',
      message: 'Brief planning completed and ready for execution',
      createdAt: '2026-08-21T12:00:00Z',
    };

    const formatted = formatEventListItem(evt);
    expect(formatted).toContain('frontman');
    expect(formatted).toContain('[DISPATCHED]');
    expect(formatted).toContain('Brief planning completed and ready for execution');
    expect(formatted).toContain('scope:');
    expect(formatted).toContain('brief');
  });

  it('handles empty / minimal event message and normalizes whitespace', () => {
    const evt: ExecutionEvent = {
      id: 'evt-min',
      briefId: 'brief-abc',
      taskId: null,
      actor: 'scout',
      type: 'started',
      message: '   multiple    spaces    and \n newlines   ',
      createdAt: '2026-08-21T12:00:00Z',
    };

    const formatted = formatEventListItem(evt);
    expect(formatted).toContain('scout');
    expect(formatted).toContain('[STARTED]');
    expect(formatted).toContain('multiple spaces and newlines');
  });

  it('truncates long message preview in list view', () => {
    const veryLongMessage =
      'This is an extremely long message detailing the complete execution log of compiling typescript source files and verifying all output artifacts and snapshots in the pipeline';
    const evt: ExecutionEvent = {
      id: 'evt-long',
      briefId: 'brief-abc',
      taskId: null,
      actor: 'executor',
      type: 'completed',
      message: veryLongMessage,
      createdAt: '2026-08-21T12:00:00Z',
    };

    const formatted = formatEventListItem(evt);
    expect(formatted).toContain('…');
    expect(formatted).not.toContain('snapshots in the pipeline');
    expect(formatted.length).toBeLessThan(veryLongMessage.length + 50);
  });
});

describe('formatSingleEventDetail', () => {
  it('handles null event gracefully', () => {
    const formatted = formatSingleEventDetail(null);
    expect(formatted).toContain('No event selected');
  });

  it('renders full untruncated message and all metadata for task-scoped event', () => {
    const task: Task = {
      id: 'task-abc',
      briefId: 'brief-xyz',
      title: 'Very Long Task Title For Testing Detail Rendering',
      description: 'Desc',
      dependencies: [],
      field: 'functionalRequirements',
      status: 'in_progress',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:01:00Z',
    };

    const fullMessage =
      'First line of detailed log output\nSecond line with special symbols: {foo: "bar"}\nThird line preserving full untruncated diagnostics without any clipping or ellipses.';

    const evt: ExecutionEvent = {
      id: 'evt-detail-12345',
      briefId: 'brief-xyz',
      taskId: 'task-abc',
      actor: 'executor',
      type: 'completed',
      message: fullMessage,
      createdAt: '2026-08-21T15:45:00Z',
    };

    const formatted = formatSingleEventDetail(evt, [task]);
    expect(formatted).toContain('Event ID:');
    expect(formatted).toContain('evt-detail-12345');
    expect(formatted).toContain('Actor:');
    expect(formatted).toContain('executor');
    expect(formatted).toContain('COMPLETED');
    expect(formatted).toContain('Brief ID:');
    expect(formatted).toContain('brief-xyz');
    expect(formatted).toContain('Task:');
    expect(formatted).toContain('task-abc');
    expect(formatted).toContain('Very Long Task Title For Testing Detail Rendering');
    expect(formatted).toContain('Timestamp:');
    expect(formatted).toContain('2026-08-21T15:45:00Z');
    expect(formatted).toContain('local:');
    expect(formatted).toContain('── Message & Details ─────────────────────────────');
    expect(formatted).toContain('First line of detailed log output');
    expect(formatted).toContain('Second line with special symbols: {foo: "bar"}');
    expect(formatted).toContain(
      'Third line preserving full untruncated diagnostics without any clipping or ellipses.'
    );
    expect(formatted).not.toContain('…');
  });

  it('renders brief-level event scope and empty message placeholder', () => {
    const evt: ExecutionEvent = {
      id: 'evt-detail-brief',
      briefId: 'brief-xyz',
      taskId: null,
      actor: 'planner',
      type: 'error',
      message: '',
      createdAt: '2026-08-21T16:00:00Z',
    };

    const formatted = formatSingleEventDetail(evt);
    expect(formatted).toContain('Event ID:');
    expect(formatted).toContain('evt-detail-brief');
    expect(formatted).toContain('Actor:');
    expect(formatted).toContain('planner');
    expect(formatted).toContain('ERROR');
    expect(formatted).toContain('Scope:');
    expect(formatted).toContain('{bold}brief-level{/bold} (workflow level event)');
    expect(formatted).toContain('(no message content)');
  });

  it('applies color tags according to event types', () => {
    const types: Array<ExecutionEvent['type']> = ['completed', 'error', 'dispatched', 'started'];
    for (const type of types) {
      const evt: ExecutionEvent = {
        id: `evt-${type}`,
        briefId: 'b1',
        taskId: null,
        actor: 'executor',
        type,
        message: `Testing ${type}`,
        createdAt: '2026-08-21T00:00:00Z',
      };
      const formatted = formatSingleEventDetail(evt);
      expect(formatted).toContain(type.toUpperCase());
    }
  });

  it('verifies event viewer detail modal formatting includes full messages, local and ISO timestamps, actor tags, type badges, and brief/task IDs', () => {
    const task: Task = {
      id: 'task-test-42',
      briefId: 'brief-root-99',
      title: 'Database Schema Migration Engine',
      description: 'Run migrations safely',
      dependencies: [],
      field: 'technicalStack',
      status: 'completed',
      createdAt: '2026-08-30T10:00:00Z',
      updatedAt: '2026-08-30T10:05:00Z',
    };

    const multiLineMessage = `Migration batch 001 started.\nTable 'frontman_activities' created successfully.\nIndexes applied on brief_id and started_at.`;

    const evt: ExecutionEvent = {
      id: 'evt-full-meta-001',
      briefId: 'brief-root-99',
      taskId: 'task-test-42',
      actor: 'executor',
      type: 'completed',
      message: multiLineMessage,
      createdAt: '2026-08-30T10:05:30.123Z',
    };

    const formatted = formatSingleEventDetail(evt, [task]);

    // Full untruncated message
    expect(formatted).toContain('Migration batch 001 started.');
    expect(formatted).toContain("Table 'frontman_activities' created successfully.");
    expect(formatted).toContain('Indexes applied on brief_id and started_at.');
    expect(formatted).not.toContain('…');

    // ISO timestamp
    expect(formatted).toContain('2026-08-30T10:05:30.123Z');

    // Local timestamp
    const expectedLocalTime = formatTime('2026-08-30T10:05:30.123Z');
    expect(formatted).toContain(`(local: ${expectedLocalTime})`);

    // Actor tag
    expect(formatted).toContain('{bold}executor{/bold}');

    // Type badge with green color tag
    expect(formatted).toContain('{bold}{green-fg}COMPLETED{/green-fg}{/bold}');

    // Brief and Task IDs
    expect(formatted).toContain('brief-root-99');
    expect(formatted).toContain('task-test-42');
    expect(formatted).toContain('Database Schema Migration Engine');
  });
});
