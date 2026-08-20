import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-e2e-event-';

describe('crewmate event CLI', () => {
  let tmpDir: string;
  let briefId: string;
  let taskId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));

    const briefResult = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(briefResult);
    briefId = parseJsonOutput(briefResult.stdout).id as string;

    const taskResult = await runCli(
      ['task', 'add', briefId, '--title', 'Implement auth', '--description', 'Build login'],
      { cwd: tmpDir }
    );
    await expectSuccess(taskResult);
    taskId = parseJsonOutput(taskResult.stdout).id as string;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should add an event linked to a task', async () => {
    const addResult = await runCli(
      [
        'event',
        'add',
        '--actor',
        'executor',
        '--type',
        'started',
        '--message',
        'Started Implement auth',
        '--task',
        taskId,
      ],
      { cwd: tmpDir }
    );
    await expectSuccess(addResult);
    const output = parseJsonOutput(addResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.actor).toBe('executor');
    expect(output.type).toBe('started');
    expect(output.taskId).toBe(taskId);
    expect(output.briefId).toBe(briefId);
  });

  it('should list events filtered by actor and type', async () => {
    await runCli(
      [
        'event',
        'add',
        '--actor',
        'frontman',
        '--type',
        'dispatched',
        '--message',
        'Dispatched executor',
        '--task',
        taskId,
      ],
      { cwd: tmpDir }
    );
    await runCli(
      [
        'event',
        'add',
        '--actor',
        'executor',
        '--type',
        'completed',
        '--message',
        'Completed task',
        '--task',
        taskId,
      ],
      { cwd: tmpDir }
    );

    const listResult = await runCli(['event', 'list', '--actor', 'executor'], { cwd: tmpDir });
    await expectSuccess(listResult);
    const output = parseJsonOutput(listResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.events.length).toBe(1);
    expect(output.events[0].actor).toBe('executor');
    expect(output.events[0].type).toBe('completed');
  });

  it('should validate actor and type enums', async () => {
    const badActor = await runCli(
      [
        'event',
        'add',
        '--actor',
        'drone',
        '--type',
        'started',
        '--message',
        'nope',
        '--task',
        taskId,
      ],
      { cwd: tmpDir }
    );
    await expectFailure(badActor, /Invalid actor/i);

    const badType = await runCli(
      [
        'event',
        'add',
        '--actor',
        'executor',
        '--type',
        'exploded',
        '--message',
        'nope',
        '--task',
        taskId,
      ],
      { cwd: tmpDir }
    );
    await expectFailure(badType, /Invalid event type/i);
  });

  it('should fail when no brief and no task are given and none exists', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
    const addResult = await runCli(
      ['event', 'add', '--actor', 'scout', '--type', 'started', '--message', 'hi'],
      { cwd: emptyDir }
    );
    await expectFailure(addResult, /No brief found/i);
    await rm(emptyDir, { recursive: true, force: true });
  });
});
