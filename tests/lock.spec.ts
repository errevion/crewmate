import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { acquireLocks, releaseLocks, listLocks, normalizeFilePath } from '../src/db/lock-repo.js';

describe('file locks repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    // Create a dummy brief and tasks for foreign key constraints
    db.prepare(`INSERT INTO briefs (id) VALUES ('brief-1')`).run();
    db.prepare(
      `INSERT INTO tasks (id, brief_id, title, description) VALUES ('task-1', 'brief-1', 'Task 1', 'Desc 1')`
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, brief_id, title, description) VALUES ('task-2', 'brief-1', 'Task 2', 'Desc 2')`
    ).run();
  });

  describe('normalizeFilePath', () => {
    it('should normalize backslashes to forward slashes and trim whitespace', () => {
      expect(normalizeFilePath('  src\\models\\task.ts  ')).toBe('src/models/task.ts');
      expect(normalizeFilePath('src/models/task.ts')).toBe('src/models/task.ts');
    });
  });

  describe('acquireLocks', () => {
    it('should successfully acquire locks on available files', () => {
      const result = acquireLocks(db, 'task-1', ['src/a.ts', 'src/b.ts']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locked).toEqual(['src/a.ts', 'src/b.ts']);
      }

      const locks = listLocks(db);
      expect(locks.length).toBe(2);
      expect(locks.map((l) => l.filePath)).toContain('src/a.ts');
      expect(locks.map((l) => l.filePath)).toContain('src/b.ts');
    });

    it('should allow the same task to re-acquire or expand its locks idempotently', () => {
      acquireLocks(db, 'task-1', ['src/a.ts']);
      const result = acquireLocks(db, 'task-1', ['src/a.ts', 'src/b.ts']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locked).toEqual(['src/a.ts', 'src/b.ts']);
      }

      const locks = listLocks(db, 'task-1');
      expect(locks.length).toBe(2);
    });

    it('should detect file conflicts when another task already holds the lock and reject atomically', () => {
      // task-1 locks src/a.ts
      acquireLocks(db, 'task-1', ['src/a.ts']);

      // task-2 attempts to lock src/a.ts and src/c.ts
      const result = acquireLocks(db, 'task-2', ['src/c.ts', 'src/a.ts']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.conflict).toBe('src/a.ts');
        expect(result.lockedBy).toBe('task-1');
      }

      // Ensure atomicity: src/c.ts should NOT be locked because transaction aborted
      const task2Locks = listLocks(db, 'task-2');
      expect(task2Locks.length).toBe(0);
    });

    it('should handle empty file list gracefully', () => {
      const result = acquireLocks(db, 'task-1', []);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.locked).toEqual([]);
      }
    });
  });

  describe('releaseLocks', () => {
    it('should release all locks for a task', () => {
      acquireLocks(db, 'task-1', ['src/a.ts', 'src/b.ts']);
      acquireLocks(db, 'task-2', ['src/c.ts']);

      const releaseResult = releaseLocks(db, 'task-1');
      expect(releaseResult.ok).toBe(true);
      expect(releaseResult.released).toBe(2);

      const task1Locks = listLocks(db, 'task-1');
      expect(task1Locks.length).toBe(0);

      const task2Locks = listLocks(db, 'task-2');
      expect(task2Locks.length).toBe(1);
    });

    it('should release specific files for a task', () => {
      acquireLocks(db, 'task-1', ['src/a.ts', 'src/b.ts']);

      const releaseResult = releaseLocks(db, 'task-1', ['src/a.ts']);
      expect(releaseResult.ok).toBe(true);
      expect(releaseResult.released).toBe(1);

      const remaining = listLocks(db, 'task-1');
      expect(remaining.length).toBe(1);
      expect(remaining[0].filePath).toBe('src/b.ts');
    });
  });

  describe('listLocks', () => {
    it('should list locks filtered by taskId or unfiltered', () => {
      acquireLocks(db, 'task-1', ['src/a.ts']);
      acquireLocks(db, 'task-2', ['src/b.ts']);

      expect(listLocks(db).length).toBe(2);
      expect(listLocks(db, 'task-1').length).toBe(1);
      expect(listLocks(db, 'task-2').length).toBe(1);
      expect(listLocks(db, 'task-3').length).toBe(0);
    });
  });
});
