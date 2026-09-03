import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-e2e-task-';

describe('crewmate task', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('task add', () => {
    it('should create a task linked to a brief', async () => {
      const result = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(result);
      const briefOut = parseJsonOutput(result.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const taskResult = await runCli(
        ['task', 'add', briefId, '--title', 'Test Task', '--description', 'A test description'],
        { cwd: tmpDir }
      );

      await expectSuccess(taskResult);
      const output = parseJsonOutput(taskResult.stdout);
      expect(output.ok).toBe(true);
      expect(typeof output.id).toBe('string');
      expect(output.title).toBe('Test Task');
    });

    it('should fail if brief does not exist', async () => {
      const taskResult = await runCli(
        ['task', 'add', 'invalid-brief-id', '--title', 'Test', '--description', 'Test'],
        { cwd: tmpDir }
      );

      await expectFailure(taskResult, /Brief not found/i, 'Invalid brief should fail');
      const output = parseJsonOutput(taskResult.stdout);
      expect(output.ok).toBe(false);
      expect(output.error).toContain('Brief not found');
    });

    it('should accept optional dependencies and field arguments', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const task1Result = await runCli(
        ['task', 'add', briefId, '--title', 'Task 1', '--description', 'First task'],
        { cwd: tmpDir }
      );
      await expectSuccess(task1Result);
      const taskId1 = parseJsonOutput(task1Result.stdout).id;

      const task2Result = await runCli(
        [
          'task',
          'add',
          briefId,
          '--title',
          'Task 2',
          '--description',
          'Second task',
          '--dependencies',
          taskId1 as string,
          '--field',
          'functionalRequirements',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(task2Result);
      const output = parseJsonOutput(task2Result.stdout);
      expect(output.ok).toBe(true);
    });

    it('should require --title and --description', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const taskResult = await runCli(['task', 'add', briefId], { cwd: tmpDir });

      await expectFailure(taskResult, /--title and --description are required/i);
      const output = parseJsonOutput(taskResult.stdout);
      expect(output.ok).toBe(false);
    });
  });

  describe('task list', () => {
    it('should list all tasks for a brief', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      // Add two tasks
      await runCli(['task', 'add', briefId, '--title', 'Task A', '--description', 'First'], {
        cwd: tmpDir,
      });
      await runCli(['task', 'add', briefId, '--title', 'Task B', '--description', 'Second'], {
        cwd: tmpDir,
      });

      const listResult = await runCli(['task', 'list', '--brief', briefId], { cwd: tmpDir });
      await expectSuccess(listResult);
      const output = parseJsonOutput(listResult.stdout);
      expect(output.ok).toBe(true);
      expect(Array.isArray(output.tasks)).toBe(true);
      expect(output.tasks.length).toBe(2);
    });

    it('should require --brief argument', async () => {
      const listResult = await runCli(['task', 'list'], { cwd: tmpDir });
      await expectFailure(listResult, /--brief is required/i);
      const output = parseJsonOutput(listResult.stdout);
      expect(output.ok).toBe(false);
    });
  });

  describe('task get', () => {
    it('should retrieve a single task by ID', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        ['task', 'add', briefId, '--title', 'My Task', '--description', 'Details'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      const getResult = await runCli(['task', 'get', taskId], { cwd: tmpDir });
      await expectSuccess(getResult);
      const output = parseJsonOutput(getResult.stdout);
      expect(output.ok).toBe(true);
      expect(output.task.title).toBe('My Task');
      expect(output.task.description).toBe('Details');
      expect(typeof output.task.id).toBe('string');
      expect(output.task.briefId).toBe(briefId);
      expect(Array.isArray(output.task.dependencies)).toBe(true);
      expect(output.task.status).toBe('pending');
    });

    it('should fail if task does not exist', async () => {
      const getResult = await runCli(['task', 'get', 'nonexistent-task-id'], {
        cwd: tmpDir,
      });
      await expectFailure(getResult, /Task not found/i);
      const output = parseJsonOutput(getResult.stdout);
      expect(output.ok).toBe(false);
    });
  });

  describe('task update', () => {
    it('should update task status', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        ['task', 'add', briefId, '--title', 'Status Test', '--description', 'Testing'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      const updateResult = await runCli(['task', 'update', taskId, '--status', 'in_progress'], {
        cwd: tmpDir,
      });
      await expectSuccess(updateResult);
      const output = parseJsonOutput(updateResult.stdout);
      expect(output.ok).toBe(true);
      expect(output.status).toBe('in_progress');
    });

    it('should validate status enum', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        ['task', 'add', briefId, '--title', 'Title', '--description', 'Desc'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      const invalidResult = await runCli(['task', 'update', taskId, '--status', 'invalid_status'], {
        cwd: tmpDir,
      });
      await expectFailure(invalidResult, /Invalid status/i);
      const output = parseJsonOutput(invalidResult.stdout);
      expect(output.ok).toBe(false);
      expect(output.error).toContain('pending');
      expect(output.error).toContain('in_progress');
      expect(output.error).toContain('completed');
    });

    it('should require --status argument', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        ['task', 'add', briefId, '--title', 'T', '--description', 'D'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      const noStatusResult = await runCli(['task', 'update', taskId], { cwd: tmpDir });
      await expectFailure(noStatusResult, /At least one update option must be provided/i);
    });

    it('should fail if task does not exist', async () => {
      const updateResult = await runCli(
        ['task', 'update', 'nonexistent', '--status', 'completed'],
        { cwd: tmpDir }
      );
      await expectFailure(updateResult, /Task not found/i);
    });

    it('should reject completed status if no artifacts recorded (Hard Gate)', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        ['task', 'add', briefId, '--title', 'Gate Test', '--description', 'Testing gate'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      await runCli(['task', 'update', taskId, '--status', 'in_progress'], { cwd: tmpDir });

      // Attempt to mark completed without recording artifacts -> must fail
      const completeFail = await runCli(['task', 'update', taskId, '--status', 'completed'], {
        cwd: tmpDir,
      });
      await expectFailure(completeFail, /no active knowledge artifacts recorded/i);

      // Record an artifact -> now completion should succeed
      const artResult = await runCli(
        [
          'artifact',
          'add',
          taskId,
          '--type',
          'decision',
          '--content',
          'Recorded architectural decision',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(artResult);

      const completeSuccess = await runCli(['task', 'update', taskId, '--status', 'completed'], {
        cwd: tmpDir,
      });
      await expectSuccess(completeSuccess);
      const output = parseJsonOutput(completeSuccess.stdout);
      expect(output.ok).toBe(true);
      expect(output.status).toBe('completed');
    });

    it('should enforce specific artifact-requirements if configured', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        [
          'task',
          'add',
          briefId,
          '--title',
          'Contract Task',
          '--description',
          'Must have contract',
          '--artifact-requirements',
          'api_contract',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      await runCli(['task', 'update', taskId, '--status', 'in_progress'], { cwd: tmpDir });

      // Add only a 'decision' artifact -> should fail because api_contract is required
      await runCli(
        ['artifact', 'add', taskId, '--type', 'decision', '--content', 'Some decision'],
        { cwd: tmpDir }
      );

      const failResult = await runCli(['task', 'update', taskId, '--status', 'completed'], {
        cwd: tmpDir,
      });
      await expectFailure(failResult, /missing required artifact types: api_contract/i);

      // Add required api_contract artifact
      await runCli(
        [
          'artifact',
          'add',
          taskId,
          '--type',
          'api_contract',
          '--content',
          JSON.stringify({ signature: 'getUser()', filePath: 'user.ts' }),
        ],
        { cwd: tmpDir }
      );

      const passResult = await runCli(['task', 'update', taskId, '--status', 'completed'], {
        cwd: tmpDir,
      });
      await expectSuccess(passResult);
      expect(parseJsonOutput(passResult.stdout).status).toBe('completed');
    });
  });

  describe('task remove', () => {
    it('should delete a task', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefOut = parseJsonOutput(initResult.stdout) as Record<string, unknown>;
      const briefId = briefOut.id;

      const addResult = await runCli(
        ['task', 'add', briefId, '--title', 'To Delete', '--description', 'Will be deleted'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      const removeResult = await runCli(['task', 'remove', taskId], { cwd: tmpDir });
      await expectSuccess(removeResult);
      const output = parseJsonOutput(removeResult.stdout);
      expect(output.ok).toBe(true);
      expect(output.id).toBe(taskId);

      // Verify task is gone
      const verifyResult = await runCli(['task', 'get', taskId], { cwd: tmpDir });
      const verifyOutput = parseJsonOutput(verifyResult.stdout);
      expect(verifyOutput.ok).toBe(false);
    });

    it('should fail if task does not exist', async () => {
      const removeResult = await runCli(['task', 'remove', 'nonexistent'], { cwd: tmpDir });
      await expectFailure(removeResult, /Task not found/i);
      const output = parseJsonOutput(removeResult.stdout);
      expect(output.ok).toBe(false);
    });
  });

  describe('task update (fields & reopen) and task clear', () => {
    let testBriefId: string;

    beforeEach(async () => {
      const bRes = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(bRes);
      testBriefId = parseJsonOutput(bRes.stdout).id;
    });

    it('should update task title, description, and reopen completed task', async () => {
      const addResult = await runCli(
        ['task', 'add', testBriefId, '--title', 'Original', '--description', 'Original desc'],
        { cwd: tmpDir }
      );
      await expectSuccess(addResult);
      const taskId = parseJsonOutput(addResult.stdout).id;

      // Update title and description
      const updateRes = await runCli(
        ['task', 'update', taskId, '--title', 'Renamed', '--description', 'New desc'],
        { cwd: tmpDir }
      );
      await expectSuccess(updateRes);
      const updated = parseJsonOutput(updateRes.stdout);
      expect(updated.title).toBe('Renamed');

      // Complete the task
      await runCli(['task', 'update', taskId, '--status', 'in_progress'], { cwd: tmpDir });
      await runCli(['task', 'update', taskId, '--status', 'completed', '--skip-artifact-check'], {
        cwd: tmpDir,
      });

      // Reopen the completed task back to in_progress
      const reopenRes = await runCli(['task', 'update', taskId, '--status', 'in_progress'], {
        cwd: tmpDir,
      });
      await expectSuccess(reopenRes);
      expect(parseJsonOutput(reopenRes.stdout).status).toBe('in_progress');
    });

    it('should clear all tasks for a brief', async () => {
      await runCli(['task', 'add', testBriefId, '--title', 'T1', '--description', 'D1'], {
        cwd: tmpDir,
      });
      await runCli(['task', 'add', testBriefId, '--title', 'T2', '--description', 'D2'], {
        cwd: tmpDir,
      });

      const clearRes = await runCli(['task', 'clear', '--brief', testBriefId], { cwd: tmpDir });
      await expectSuccess(clearRes);

      const listRes = await runCli(['task', 'list', '--brief', testBriefId], { cwd: tmpDir });
      const tasks = parseJsonOutput(listRes.stdout).tasks;
      expect(tasks).toHaveLength(0);
    });
  });
});
