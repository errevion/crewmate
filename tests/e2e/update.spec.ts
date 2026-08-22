//go:build e2e

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-update-e2e-';

describe('crewmate update', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should fail if project is not initialized', async () => {
    const result = await runCli(['update'], { cwd: tmpDir });
    await expectFailure(result, /not initialized/i);
  });

  it('should update an initialized project and report unchanged files', async () => {
    const initRes = await runCli(['init'], { cwd: tmpDir });
    await expectSuccess(initRes);

    const updateRes = await runCli(['update'], { cwd: tmpDir });
    await expectSuccess(updateRes);

    expect(updateRes.stdout).toContain('Updated crewmate integration');
    expect(updateRes.stdout).toContain('[UNCHANGED]');

    const json = parseJsonOutput(updateRes.stdout);
    expect(json.ok).toBe(true);
    expect(json.summary.unchanged).toBe(json.files.length);
  });

  it('should create backups and update modified files', async () => {
    await runCli(['init'], { cwd: tmpDir });

    const plannerPath = join(tmpDir, '.opencode', 'agents', 'planner.md');
    await writeFile(plannerPath, '# Custom Planner\n', 'utf-8');

    const updateRes = await runCli(['update'], { cwd: tmpDir });
    await expectSuccess(updateRes);

    expect(updateRes.stdout).toContain('[BACKUP & UPDATE]');
    expect(updateRes.stdout).toContain('Backups created:');

    const updatedContent = await readFile(plannerPath, 'utf-8');
    expect(updatedContent).toContain('description:');

    const json = parseJsonOutput(updateRes.stdout);
    expect(json.backedUpFiles.length).toBe(1);
    expect(existsSync(join(tmpDir, json.backedUpFiles[0]))).toBe(true);
  });

  it('should support --json output flag', async () => {
    await runCli(['init'], { cwd: tmpDir });

    const updateRes = await runCli(['update', '--json'], { cwd: tmpDir });
    await expectSuccess(updateRes);

    expect(updateRes.stdout.trim()).toMatch(/^\{.*\}$/);
    const json = parseJsonOutput(updateRes.stdout);
    expect(json.ok).toBe(true);
    expect(json.harness).toBe('opencode');
  });

  it('should support --dry-run flag', async () => {
    await runCli(['init'], { cwd: tmpDir });

    const frontmanPath = join(tmpDir, '.opencode', 'agents', 'frontman.md');
    await writeFile(frontmanPath, '# Modified Frontman\n', 'utf-8');

    const updateRes = await runCli(['update', '--dry-run'], { cwd: tmpDir });
    await expectSuccess(updateRes);
    expect(updateRes.stdout).toContain('[DRY RUN]');

    const content = await readFile(frontmanPath, 'utf-8');
    expect(content).toBe('# Modified Frontman\n');
  });
});
