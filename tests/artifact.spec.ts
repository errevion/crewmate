import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import {
  createArtifact,
  listArtifacts,
  getArtifactById,
  checkTaskArtifactCompliance,
} from '../src/db/artifact-repo.js';
import { createTask } from '../src/db/task-repo.js';

describe('execution artifacts repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`INSERT INTO briefs (id) VALUES ('brief-1')`).run();
    db.prepare(`INSERT INTO briefs (id) VALUES ('brief-2')`).run();
    createTask(db, 'brief-1', 'Task 1', 'Desc 1');
    createTask(db, 'brief-1', 'Task 2', 'Desc 2', { dependencies: [] });
  });

  it('should create an execution artifact with structured wrapping', () => {
    const artifact = createArtifact(
      db,
      null,
      'brief-1',
      'decision',
      'Use fast-glob for file discovery'
    );

    expect(artifact).toBeDefined();
    expect(artifact.id).toHaveLength(8);
    expect(artifact.taskId).toBeNull();
    expect(artifact.briefId).toBe('brief-1');
    expect(artifact.type).toBe('decision');
    expect(artifact.status).toBe('active');
    expect(artifact.supersededBy).toBeNull();

    const parsed = JSON.parse(artifact.content);
    expect(parsed.choice).toBe('Use fast-glob for file discovery');
  });

  it('should create a structured api_contract artifact', () => {
    const payload = JSON.stringify({
      signature: 'export function parse(input: string): boolean',
      filePath: 'src/utils/parser.ts',
      exportName: 'parse',
    });

    const artifact = createArtifact(db, null, 'brief-1', 'api_contract', payload);
    expect(artifact.type).toBe('api_contract');

    const parsed = JSON.parse(artifact.content);
    expect(parsed.signature).toBe('export function parse(input: string): boolean');
    expect(parsed.filePath).toBe('src/utils/parser.ts');
  });

  it('should auto-supersede previous api_contract targeting the same file and export', () => {
    const firstPayload = JSON.stringify({
      signature: 'export function findUser(id: string): User',
      filePath: 'src/api/user.ts',
      exportName: 'findUser',
    });

    const first = createArtifact(db, null, 'brief-1', 'api_contract', firstPayload);
    expect(first.status).toBe('active');

    const secondPayload = JSON.stringify({
      signature: 'export function findUser(id: string): Promise<User>',
      filePath: 'src/api/user.ts',
      exportName: 'findUser',
    });

    const second = createArtifact(db, null, 'brief-1', 'api_contract', secondPayload);
    expect(second.status).toBe('active');

    // First artifact should now be superseded
    const updatedFirst = getArtifactById(db, first.id);
    expect(updatedFirst?.status).toBe('superseded');
    expect(updatedFirst?.supersededBy).toBe(second.id);
  });

  it('should filter artifacts by status (default active vs all)', () => {
    const first = createArtifact(
      db,
      null,
      'brief-1',
      'api_contract',
      JSON.stringify({ signature: 'v1', filePath: 'a.ts' })
    );
    const second = createArtifact(
      db,
      null,
      'brief-1',
      'api_contract',
      JSON.stringify({ signature: 'v2', filePath: 'a.ts' })
    );

    const activeOnly = listArtifacts(db, { briefId: 'brief-1' });
    expect(activeOnly.length).toBe(1);
    expect(activeOnly[0].id).toBe(second.id);

    const all = listArtifacts(db, { briefId: 'brief-1', status: 'all' });
    expect(all.length).toBe(2);
  });

  it('should filter upstream artifacts for a task in the DAG (forTask)', () => {
    const t1 = createTask(db, 'brief-1', 'T1', 'Base setup');
    const t2 = createTask(db, 'brief-1', 'T2', 'Auth logic', { dependencies: [t1.id] });
    const t3 = createTask(db, 'brief-1', 'T3', 'Unrelated task');
    const t4 = createTask(db, 'brief-1', 'T4', 'Endpoint using auth', { dependencies: [t2.id] });

    // Brief-level artifact (e.g. from Scout)
    const scoutFact = createArtifact(db, null, 'brief-1', 'fact', 'Node 20 ESM');
    // Task 1 artifact
    createArtifact(db, t1.id, 'brief-1', 'decision', 'Use SQLite WAL');
    // Task 2 artifact
    const authContract = createArtifact(
      db,
      t2.id,
      'brief-1',
      'api_contract',
      JSON.stringify({ signature: 'auth()', filePath: 'auth.ts' })
    );
    // Task 3 artifact (unrelated)
    createArtifact(db, t3.id, 'brief-1', 'decision', 'Unrelated decision');

    // Query artifacts relevant for T4 (should include brief-level, T1, and T2, but NOT T3)
    const forT4 = listArtifacts(db, { forTask: t4.id });
    const ids = forT4.map((a) => a.id);

    expect(ids).toContain(scoutFact.id);
    expect(ids).toContain(authContract.id);
    expect(forT4.some((a) => a.taskId === t3.id)).toBe(false);
  });

  it('should check artifact compliance for task completion', () => {
    const t1 = createTask(db, 'brief-1', 'T1', 'Simple task');
    const t2 = createTask(db, 'brief-1', 'T2', 'Strict task', {
      artifactRequirements: ['api_contract', 'decision'],
    });

    // t1 initially has 0 artifacts -> non-compliant
    const comp1Initial = checkTaskArtifactCompliance(db, t1.id);
    expect(comp1Initial.compliant).toBe(false);

    // add decision to t1 -> compliant
    createArtifact(db, t1.id, 'brief-1', 'decision', 'Done setup');
    const comp1After = checkTaskArtifactCompliance(db, t1.id);
    expect(comp1After.compliant).toBe(true);

    // t2 requires api_contract and decision. Add only decision -> non-compliant
    createArtifact(db, t2.id, 'brief-1', 'decision', 'Chose JWT');
    const comp2Partial = checkTaskArtifactCompliance(db, t2.id);
    expect(comp2Partial.compliant).toBe(false);
    expect(comp2Partial.missing).toEqual(['api_contract']);

    // Add api_contract to t2 -> compliant
    createArtifact(
      db,
      t2.id,
      'brief-1',
      'api_contract',
      JSON.stringify({ signature: 'jwtVerify()', filePath: 'jwt.ts' })
    );
    const comp2Full = checkTaskArtifactCompliance(db, t2.id);
    expect(comp2Full.compliant).toBe(true);
    expect(comp2Full.missing).toEqual([]);
  });
});
