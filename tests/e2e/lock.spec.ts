import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-e2e-lock-';

describe('crewmate lock & artifact CLI', () => {
  let tmpDir: string;
  let briefId: string;
  let taskId1: string;
  let taskId2: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));

    // Create brief and 2 tasks
    const briefResult = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(briefResult);
    briefId = parseJsonOutput(briefResult.stdout).id;

    const task1Result = await runCli(
      ['task', 'add', briefId, '--title', 'Task 1', '--description', 'First'],
      { cwd: tmpDir }
    );
    await expectSuccess(task1Result);
    taskId1 = parseJsonOutput(task1Result.stdout).id;

    const task2Result = await runCli(
      ['task', 'add', briefId, '--title', 'Task 2', '--description', 'Second'],
      { cwd: tmpDir }
    );
    await expectSuccess(task2Result);
    taskId2 = parseJsonOutput(task2Result.stdout).id;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('lock command', () => {
    it('should acquire file locks for a task', async () => {
      const lockResult = await runCli(
        ['lock', 'acquire', taskId1, '--files', 'src/foo.ts', 'src/bar.ts'],
        { cwd: tmpDir }
      );
      await expectSuccess(lockResult);
      const output = parseJsonOutput(lockResult.stdout);
      expect(output.ok).toBe(true);
      expect(output.taskId).toBe(taskId1);
      expect(output.files).toEqual(['src/foo.ts', 'src/bar.ts']);

      const listResult = await runCli(['lock', 'list'], { cwd: tmpDir });
      await expectSuccess(listResult);
      const listOutput = parseJsonOutput(listResult.stdout);
      expect(listOutput.ok).toBe(true);
      expect(listOutput.locks.length).toBe(2);
    });

    it('should prevent another task from acquiring the same file and return conflict', async () => {
      const lock1Result = await runCli(['lock', 'acquire', taskId1, '--files', 'src/shared.ts'], {
        cwd: tmpDir,
      });
      await expectSuccess(lock1Result);

      const lock2Result = await runCli(
        ['lock', 'acquire', taskId2, '--files', 'src/other.ts', 'src/shared.ts'],
        { cwd: tmpDir }
      );
      await expectFailure(lock2Result, /already locked by task/i);
      const output = parseJsonOutput(lock2Result.stdout);
      expect(output.ok).toBe(false);
      expect(output.conflict).toBe('src/shared.ts');
      expect(output.lockedBy).toBe(taskId1);
    });

    it('should release locks cleanly', async () => {
      await runCli(['lock', 'acquire', taskId1, '--files', 'src/foo.ts'], { cwd: tmpDir });

      const releaseResult = await runCli(['lock', 'release', taskId1], { cwd: tmpDir });
      await expectSuccess(releaseResult);
      const releaseOutput = parseJsonOutput(releaseResult.stdout);
      expect(releaseOutput.ok).toBe(true);
      expect(releaseOutput.released).toBe(1);

      // Now task 2 should be able to lock src/foo.ts
      const lock2Result = await runCli(['lock', 'acquire', taskId2, '--files', 'src/foo.ts'], {
        cwd: tmpDir,
      });
      await expectSuccess(lock2Result);
    });
  });

  describe('artifact command', () => {
    it('should add and list execution artifacts', async () => {
      const addResult = await runCli(
        [
          'artifact',
          'add',
          taskId1,
          '--type',
          'decision',
          '--content',
          'Chose SQLite for metadata storage',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const addOutput = parseJsonOutput(addResult.stdout);
      expect(addOutput.ok).toBe(true);
      expect(addOutput.type).toBe('decision');
      expect(addOutput.content).toContain('Chose SQLite for metadata storage');
      expect(addOutput.briefId).toBe(briefId);

      const listResult = await runCli(['artifact', 'list', '--brief', briefId], { cwd: tmpDir });
      await expectSuccess(listResult);
      const listOutput = parseJsonOutput(listResult.stdout);
      expect(listOutput.ok).toBe(true);
      expect(listOutput.artifacts.length).toBe(1);
      expect(listOutput.artifacts[0].content).toContain('Chose SQLite for metadata storage');
    });

    it('should support brief-level artifacts without taskId (e.g. from Scout)', async () => {
      const scoutResult = await runCli(
        [
          'artifact',
          'add',
          '--brief',
          briefId,
          '--type',
          'fact',
          '--content',
          JSON.stringify({ statement: 'Project uses TypeScript 5.4 with ESM', scope: 'project' }),
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(scoutResult);
      const scoutOutput = parseJsonOutput(scoutResult.stdout);
      expect(scoutOutput.ok).toBe(true);
      expect(scoutOutput.taskId).toBeNull();
      expect(scoutOutput.type).toBe('fact');
    });

    it('should validate artifact types', async () => {
      const invalidResult = await runCli(
        ['artifact', 'add', taskId1, '--type', 'invalid_type', '--content', 'Some content'],
        { cwd: tmpDir }
      );
      await expectFailure(invalidResult, /Invalid artifact type/i);
    });

    it('should support artifact supersession', async () => {
      const art1Res = await runCli(
        ['artifact', 'add', taskId1, '--type', 'decision', '--content', 'Decision V1'],
        { cwd: tmpDir }
      );
      await expectSuccess(art1Res);
      const id1 = parseJsonOutput(art1Res.stdout).id;

      const art2Res = await runCli(
        ['artifact', 'add', taskId1, '--type', 'decision', '--content', 'Decision V2'],
        { cwd: tmpDir }
      );
      await expectSuccess(art2Res);
      const id2 = parseJsonOutput(art2Res.stdout).id;

      const supersedeRes = await runCli(['artifact', 'supersede', id1, id2], { cwd: tmpDir });
      await expectSuccess(supersedeRes);

      const getRes = await runCli(['artifact', 'get', id1], { cwd: tmpDir });
      const art = parseJsonOutput(getRes.stdout).artifact;
      expect(art.status).toBe('superseded');
      expect(art.supersededBy).toBe(id2);
    });
  });

  describe('lock management: unlock, clear, and clean-stale', () => {
    it('should unlock a specific file path', async () => {
      await runCli(['lock', 'acquire', taskId1, '--files', 'src/shared.ts'], { cwd: tmpDir });
      const unlockRes = await runCli(['lock', 'unlock', 'src/shared.ts'], { cwd: tmpDir });
      await expectSuccess(unlockRes);

      const listRes = await runCli(['lock', 'list'], { cwd: tmpDir });
      const locks = parseJsonOutput(listRes.stdout).locks;
      expect(locks).toHaveLength(0);
    });

    it('should clear all locks', async () => {
      await runCli(['lock', 'acquire', taskId1, '--files', 'src/a.ts', 'src/b.ts'], {
        cwd: tmpDir,
      });
      const clearRes = await runCli(['lock', 'clear'], { cwd: tmpDir });
      await expectSuccess(clearRes);
      expect(parseJsonOutput(clearRes.stdout).released).toBe(2);

      const listRes = await runCli(['lock', 'list'], { cwd: tmpDir });
      const locks = parseJsonOutput(listRes.stdout).locks;
      expect(locks).toHaveLength(0);
    });

    it('should clean stale locks', async () => {
      const cleanRes = await runCli(['lock', 'clean-stale'], { cwd: tmpDir });
      await expectSuccess(cleanRes);
      expect(parseJsonOutput(cleanRes.stdout).ok).toBe(true);
    });
  });
});
