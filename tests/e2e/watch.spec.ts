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

  it('should automatically select the latest brief when multiple briefs exist and --brief is omitted', async () => {
    // Current tmpDir has briefId. Let's create a second brief.
    const brief2Result = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(brief2Result);
    const brief2Id = parseJsonOutput(brief2Result.stdout).id as string;

    // By default brief2 is created after briefId, so watch --once should target brief2Id
    const watchResult1 = await runCli(['watch', '--once'], { cwd: tmpDir });
    await expectSuccess(watchResult1);
    const output1 = parseJsonOutput(watchResult1.stdout);
    expect(output1.ok).toBe(true);
    expect(output1.snapshot.briefId).toBe(brief2Id);

    // Now update briefId by adding a field or updating it, making briefId newer
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const updateResult = await runCli(
      ['brief', 'set', 'goal', 'Updated latest goal for brief 1', '--id', briefId],
      { cwd: tmpDir }
    );
    await expectSuccess(updateResult);

    // watch --once should now target briefId as the latest brief
    const watchResult2 = await runCli(['watch', '--once'], { cwd: tmpDir });
    await expectSuccess(watchResult2);
    const output2 = parseJsonOutput(watchResult2.stdout);
    expect(output2.ok).toBe(true);
    expect(output2.snapshot.briefId).toBe(briefId);
    expect(output2.snapshot.goal).toBe('Updated latest goal for brief 1');
  });

  it('should auto-select the brief with the latest updated_at falling back to created_at when multiple briefs exist', async () => {
    // Create three separate briefs
    const b1Result = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(b1Result);
    const b1Id = parseJsonOutput(b1Result.stdout).id as string;

    const b2Result = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(b2Result);
    const b2Id = parseJsonOutput(b2Result.stdout).id as string;

    const b3Result = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(b3Result);
    const b3Id = parseJsonOutput(b3Result.stdout).id as string;

    // Immediately after creation, b3 has newest created_at and is chosen
    const resB3 = await runCli(['watch', '--once'], { cwd: tmpDir });
    await expectSuccess(resB3);
    expect(parseJsonOutput(resB3.stdout).snapshot.briefId).toBe(b3Id);

    // Update b1 so b1 has the latest updated_at (sleep briefly to guarantee next second timestamp in SQLite datetime('now'))
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const updateB1 = await runCli(
      ['brief', 'set', 'goal', 'Goal for B1 newest update', '--id', b1Id],
      { cwd: tmpDir }
    );
    await expectSuccess(updateB1);

    const resB1 = await runCli(['watch', '--once'], { cwd: tmpDir });
    await expectSuccess(resB1);
    expect(parseJsonOutput(resB1.stdout).snapshot.briefId).toBe(b1Id);

    // Update b2 so b2 becomes the newest
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const updateB2 = await runCli(
      ['brief', 'set', 'goal', 'Goal for B2 newest update', '--id', b2Id],
      { cwd: tmpDir }
    );
    await expectSuccess(updateB2);

    const resB2 = await runCli(['watch', '--once'], { cwd: tmpDir });
    await expectSuccess(resB2);
    expect(parseJsonOutput(resB2.stdout).snapshot.briefId).toBe(b2Id);
  });
});
