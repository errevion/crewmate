import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createArtifact, listArtifacts } from '../src/db/artifact-repo.js';

describe('execution artifacts repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`INSERT INTO briefs (id) VALUES ('brief-1')`).run();
    db.prepare(`INSERT INTO briefs (id) VALUES ('brief-2')`).run();
    db.prepare(
      `INSERT INTO tasks (id, brief_id, title, description) VALUES ('task-1', 'brief-1', 'Task 1', 'Desc 1')`
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, brief_id, title, description) VALUES ('task-2', 'brief-1', 'Task 2', 'Desc 2')`
    ).run();
  });

  it('should create an execution artifact', () => {
    const artifact = createArtifact(
      db,
      'task-1',
      'brief-1',
      'decision',
      'Use fast-glob for file discovery'
    );

    expect(artifact).toBeDefined();
    expect(artifact.id).toHaveLength(8);
    expect(artifact.taskId).toBe('task-1');
    expect(artifact.briefId).toBe('brief-1');
    expect(artifact.type).toBe('decision');
    expect(artifact.content).toBe('Use fast-glob for file discovery');
    expect(artifact.createdAt).toBeDefined();
  });

  it('should list artifacts filtered by briefId, taskId, or type', () => {
    createArtifact(db, 'task-1', 'brief-1', 'decision', 'Decision 1');
    createArtifact(db, 'task-1', 'brief-1', 'api_contract', 'GET /api/v1/users');
    createArtifact(db, 'task-2', 'brief-1', 'fact', 'Fact 1');

    const all = listArtifacts(db);
    expect(all.length).toBe(3);

    const task1Only = listArtifacts(db, { taskId: 'task-1' });
    expect(task1Only.length).toBe(2);

    const apiContracts = listArtifacts(db, { type: 'api_contract' });
    expect(apiContracts.length).toBe(1);
    expect(apiContracts[0].content).toBe('GET /api/v1/users');

    const brief2 = listArtifacts(db, { briefId: 'brief-2' });
    expect(brief2.length).toBe(0);
  });
});
