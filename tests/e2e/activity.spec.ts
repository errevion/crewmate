import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-e2e-activity-';

describe('crewmate activity CLI', () => {
  let tmpDir: string;
  let briefId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));

    const briefResult = await runCli(['brief', 'init'], { cwd: tmpDir });
    await expectSuccess(briefResult);
    briefId = parseJsonOutput(briefResult.stdout).id as string;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should set, get, list and clear activity', async () => {
    // 1. Initially get should return null activity
    const initialGet = await runCli(['activity', 'get'], { cwd: tmpDir });
    await expectSuccess(initialGet);
    const initialOut = parseJsonOutput(initialGet.stdout);
    expect(initialOut.ok).toBe(true);
    expect(initialOut.activity).toBeNull();

    // 2. Set activity to questioning
    const setResult = await runCli(
      ['activity', 'set', 'questioning', '--message', 'Select auth provider'],
      { cwd: tmpDir }
    );
    await expectSuccess(setResult);
    const setOut = parseJsonOutput(setResult.stdout);
    expect(setOut.ok).toBe(true);
    expect(setOut.activity.activityType).toBe('questioning');
    expect(setOut.activity.message).toBe('Select auth provider');
    expect(setOut.activity.briefId).toBe(briefId);

    // 3. Get should return the set activity
    const getResult = await runCli(['activity', 'get'], { cwd: tmpDir });
    await expectSuccess(getResult);
    const getOut = parseJsonOutput(getResult.stdout);
    expect(getOut.ok).toBe(true);
    expect(getOut.activity.activityType).toBe('questioning');

    // 4. Set new activity (transitions automatically)
    const set2Result = await runCli(
      ['activity', 'set', 'analyzing', '--message', 'Processing answer'],
      { cwd: tmpDir }
    );
    await expectSuccess(set2Result);

    // 5. List activities
    const listResult = await runCli(['activity', 'list'], { cwd: tmpDir });
    await expectSuccess(listResult);
    const listOut = parseJsonOutput(listResult.stdout);
    expect(listOut.ok).toBe(true);
    expect(listOut.activities.length).toBe(2);
    expect(listOut.activities[0].activityType).toBe('analyzing');
    expect(listOut.activities[1].activityType).toBe('questioning');
    expect(listOut.activities[1].endedAt).not.toBeNull();

    // 6. Clear activity
    const clearResult = await runCli(['activity', 'clear'], { cwd: tmpDir });
    await expectSuccess(clearResult);
    const clearOut = parseJsonOutput(clearResult.stdout);
    expect(clearOut.ok).toBe(true);
    expect(clearOut.cleared).toBe(true);

    // 7. Get after clear should be null
    const getAfterClear = await runCli(['activity', 'get'], { cwd: tmpDir });
    await expectSuccess(getAfterClear);
    expect(parseJsonOutput(getAfterClear.stdout).activity).toBeNull();
  });

  it('should validate activity type', async () => {
    const badType = await runCli(['activity', 'set', 'dancing'], { cwd: tmpDir });
    await expectFailure(badType, /Invalid activity type/i);
  });
});
