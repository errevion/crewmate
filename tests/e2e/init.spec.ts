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
