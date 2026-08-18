//go:build e2e

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-init-e2e-';

describe('crewmate init', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('opencode harness', () => {
    it('should create .opencode/plugins/crewmate.ts', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(output.ok).toBe(true);
      expect(output.harness).toBe('opencode');
      expect(Array.isArray(output.filesWritten)).toBe(true);
      expect(output.filesWritten).toContain('.opencode/plugins/crewmate.ts');
    });

    it('should print human-readable output by default', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      // Should contain both visual messages and JSON
      expect(result.stdout).toContain('Initialized crewmate integration');
      expect(result.stdout).toContain('.opencode/plugins/crewmate.ts');
      expect(result.stdout).toContain('"ok":true');
    });

    it('should create .opencode/commands/brief.md', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.filesWritten).toContain('.opencode/commands/brief.md');
    });

    it('should create/update .opencode/package.json', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.filesWritten).toContain('.opencode/package.json');
    });

    it('should merge package.json dependencies', async () => {
      // First initialization
      const result1 = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result1);

      // Second initialization should not break existing deps
      const result2 = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result2);
    });

    it('should use current directory by default', async () => {
      const result = await runCli(['init']);
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.filesWritten).toContain('.opencode/plugins/crewmate.ts');
    });

    it('should work with explicit --dir flag', async () => {
      const targetDir = join(tmpDir, 'target-project');
      const result = await runCli(['init', '--harness', 'opencode', '--dir', targetDir]);
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
    });

    it('should output pure JSON with --json flag', async () => {
      const result = await runCli(['init', '--harness', 'opencode', '--json'], { cwd: tmpDir });
      await expectSuccess(result);

      // Should be valid JSON on a single line
      expect(result.stdout.trim()).toMatch(/^\{.*\}$/);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
    });
  });

  describe('opencode harness agents', () => {
    it('should create .opencode/agents/frontman.md', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(output.filesWritten).toContain('.opencode/agents/frontman.md');
    });

    it('should create .opencode/agents/scout.md', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(output.filesWritten).toContain('.opencode/agents/scout.md');
    });

    it('should create .opencode/agents/planner.md', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(output.filesWritten).toContain('.opencode/agents/planner.md');
    });

    it('should write well-formed agent files', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const { readFileSync } = await import('node:fs');

      const frontmanContent = readFileSync(
        join(tmpDir, '.opencode', 'agents', 'frontman.md'),
        'utf-8'
      );
      expect(frontmanContent.length).toBeGreaterThan(100);
      expect(frontmanContent).toContain('description:');
      expect(frontmanContent).toContain('mode: primary');
      expect(frontmanContent).toContain('permission:');

      const scoutContent = readFileSync(join(tmpDir, '.opencode', 'agents', 'scout.md'), 'utf-8');
      expect(scoutContent.length).toBeGreaterThan(100);
      expect(scoutContent).toContain('description:');
      expect(scoutContent).toContain('mode: subagent');
      expect(scoutContent).toContain('permission:');
      expect(scoutContent).toContain('crewmate_*: deny');

      const plannerContent = readFileSync(
        join(tmpDir, '.opencode', 'agents', 'planner.md'),
        'utf-8'
      );
      expect(plannerContent.length).toBeGreaterThan(100);
      expect(plannerContent).toContain('description:');
      expect(plannerContent).toContain('mode: subagent');
      expect(plannerContent).toContain('permission:');
      expect(plannerContent).toContain('crewmate_*: deny');
      expect(plannerContent).toContain('crewmate_show_brief: allow');
      expect(plannerContent).toContain('crewmate_get_field: allow');
    });

    it('should route brief.md to the frontman agent', async () => {
      const result = await runCli(['init', '--harness', 'opencode'], { cwd: tmpDir });
      await expectSuccess(result);

      const { readFileSync } = await import('node:fs');
      const briefContent = readFileSync(join(tmpDir, '.opencode', 'commands', 'brief.md'), 'utf-8');
      expect(briefContent).toContain('agent: frontman');
    });
  });

  describe('invalid harness', () => {
    it('should fail with unknown harness', async () => {
      const result = await runCli(['init', '--harness', 'nonexistent'], { cwd: tmpDir });
      await expectFailure(result, /Unknown harness|available/i, 'Invalid harness should fail');
    });

    it('should provide list of available harnesses in error', async () => {
      const result = await runCli(['init', '--harness', 'unknown'], { cwd: tmpDir });
      await expectFailure(result, /available/i);

      const output = result.stdout + result.stderr;
      expect(output).toContain('opencode');
    });
  });
});
