import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess } from './helpers.js';

const TEST_PREFIX = 'crewmate-e2e-watch-';

describe('crewmate watch CLI', () => {
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

  it('should print a single JSON snapshot with --once', async () => {
    await runCli(
      [
        'event',
        'add',
        '--actor',
        'frontman',
        '--type',
        'dispatched',
        '--message',
        'Dispatched executor for Implement auth',
        '--task',
        taskId,
      ],
      { cwd: tmpDir }
    );

    const result = await runCli(['watch', '--once', '--brief', briefId], { cwd: tmpDir });
    await expectSuccess(result);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(true);
    const snapshot = output.snapshot as {
      briefId: string;
      tasks: unknown[];
      agents: Array<{ actor: string; state: string }>;
      eventCount: number;
      completedCount: number;
      totalCount: number;
    };
    expect(snapshot.briefId).toBe(briefId);
    expect(snapshot.tasks.length).toBe(1);
    expect(snapshot.totalCount).toBe(1);
    expect(snapshot.completedCount).toBe(0);
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.agents.find((a) => a.actor === 'frontman')?.state).toBe('active');
  });

  it('should return empty snapshot with brief (none) when no brief exists in --once mode', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
    const result = await runCli(['watch', '--once'], { cwd: emptyDir });
    await expectSuccess(result);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.snapshot.briefId).toBe('(none)');
    expect(output.snapshot.briefStatus).toBe('none');
    expect(output.snapshot.tasks).toEqual([]);
    expect(output.snapshot.frontmanState).toBe('idle');
    await rm(emptyDir, { recursive: true, force: true });
  });
});
