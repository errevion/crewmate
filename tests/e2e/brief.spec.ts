//go:build e2e

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-e2e-';

describe('crewmate brief', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should create a new brief and return an ID', async () => {
      const result = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(output.ok).toBe(true);
      expect(output.id).toBeDefined();
      expect(typeof output.id).toBe('string');
      expect(output.id.length).toBeGreaterThan(0);
    });

    it('should store brief in .crewmate directory', async () => {
      await runCli(['brief', 'init'], { cwd: tmpDir });

      // The CLI creates .crewmate/crewmate.db in the working directory
      // We can verify by running status command which would fail if no brief exists
      const statusResult = await runCli(['brief', 'status'], { cwd: tmpDir });
      await expectSuccess(statusResult);

      const output = parseJsonOutput(statusResult.stdout);
      expect(output).toHaveProperty('ok', true);
      expect(output).toHaveProperty('complete');
    });

    it('should reject --json flag on brief init (as brief subcommands do not accept it)', async () => {
      const result = await runCli(['brief', 'init', '--json'], { cwd: tmpDir });
      await expectFailure(
        result,
        /unknown option '--json'/i,
        'brief init --json should fail because brief subcommands output JSON unconditionally'
      );
    });
  });

  describe('set', () => {
    let briefId: string;

    beforeEach(async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const output = parseJsonOutput(initResult.stdout) as { ok: boolean; id: string };
      briefId = output.id;
    });

    it('should set workType field', async () => {
      const result = await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.field).toBe('workType');
    });

    it('should validate workType enum values', async () => {
      const validTypes = ['software', 'infrastructure', 'data', 'documentation', 'audit'];

      for (const type of validTypes) {
        const result = await runCli(['brief', 'set', 'workType', type], { cwd: tmpDir });
        await expectSuccess(result, `Setting workType to ${type}`);
      }
    });

    it('should reject invalid workType value', async () => {
      const result = await runCli(['brief', 'set', 'workType', 'invalid-type'], { cwd: tmpDir });
      await expectFailure(
        result,
        /Invalid workType|must be one of/i,
        'Invalid workType should fail'
      );
    });

    it('should set goal field', async () => {
      const result = await runCli(['brief', 'set', 'goal', 'Build a real-time chat app'], {
        cwd: tmpDir,
      });
      await expectSuccess(result);
    });

    it('should set scope field with JSON', async () => {
      const result = await runCli(
        ['brief', 'set', 'scope', '{"included": ["messaging"], "excluded": ["payments"]}'],
        { cwd: tmpDir }
      );
      await expectSuccess(result);
    });

    it('should set functionalRequirements field with JSON array', async () => {
      const result = await runCli(
        ['brief', 'set', 'functionalRequirements', '["real-time messaging", "file sharing"]'],
        { cwd: tmpDir }
      );
      await expectSuccess(result);
    });

    it('should set acceptanceCriteria field with JSON array', async () => {
      const result = await runCli(
        ['brief', 'set', 'acceptanceCriteria', '["Users can send messages", "Files upload works"]'],
        { cwd: tmpDir }
      );
      await expectSuccess(result);
    });

    it('should set non-required fields like technicalStack', async () => {
      const result = await runCli(
        [
          'brief',
          'set',
          'technicalStack',
          '{"frontend": ["react"], "backend": ["node"], "database": [], "tools": []}',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(result);
    });
  });

  describe('get', () => {
    let briefId: string;

    beforeEach(async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const output = parseJsonOutput(initResult.stdout) as { ok: boolean; id: string };
      briefId = output.id;
    });

    it('should get workType after setting it', async () => {
      await runCli(['brief', 'set', 'workType', 'data'], { cwd: tmpDir });

      const result = await runCli(['brief', 'get', 'workType'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.value).toBe('data');
    });

    it('should return null for unset field', async () => {
      const result = await runCli(['brief', 'get', 'goal'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.value).toBeNull();
    });

    it('should work with --id flag', async () => {
      await runCli(['brief', 'set', 'workType', 'infrastructure'], { cwd: tmpDir });

      const result = await runCli(['brief', 'get', 'workType', '--id', briefId], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.value).toBe('infrastructure');
    });

    it('should error when brief ID does not exist', async () => {
      const result = await runCli(['brief', 'get', 'goal', '--id', 'nonexistent-id'], {
        cwd: tmpDir,
      });
      await expectFailure(result, /No brief found/i, 'Nonexistent brief ID should fail');
    });
  });

  describe('show', () => {
    let briefId: string;

    beforeEach(async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const output = parseJsonOutput(initResult.stdout) as { ok: boolean; id: string };
      briefId = output.id;
    });

    it('should show full brief structure', async () => {
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'goal', 'Test goal'], { cwd: tmpDir });

      const result = await runCli(['brief', 'show'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.brief).toBeDefined();
      expect(output.brief.workType).toBe('software');
      expect(output.brief.goal).toBe('Test goal');
    });

    it('should work with --id flag', async () => {
      await runCli(['brief', 'set', 'workType', 'audit'], { cwd: tmpDir });

      const result = await runCli(['brief', 'show', '--id', briefId], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.brief.workType).toBe('audit');
    });
  });

  describe('status', () => {
    let briefId: string;

    beforeEach(async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const output = parseJsonOutput(initResult.stdout) as { ok: boolean; id: string };
      briefId = output.id;
    });

    it('should show all required fields as missing initially', async () => {
      const result = await runCli(['brief', 'status'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.complete).toBe(false);
      expect(output.status).toBe('draft');

      const expectedMissing = [
        'workType',
        'goal',
        'scope',
        'functionalRequirements',
        'acceptanceCriteria',
      ];

      for (const field of expectedMissing) {
        expect(output.required[field]).toBe('missing');
      }
    });

    it('should update status after setting fields', async () => {
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'goal', 'Test goal'], { cwd: tmpDir });

      const result = await runCli(['brief', 'status'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.required.workType).toBe('set');
      expect(output.required.goal).toBe('set');
      expect(output.complete).toBe(false);
    });
  });

  describe('complete', () => {
    it('should succeed when all required fields are set', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      // Set all required fields
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'goal', 'Build something'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'scope', '{"included":[],"excluded":[]}'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'functionalRequirements', '["feat1"]'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'acceptanceCriteria', '["criterion1"]'], { cwd: tmpDir });

      const result = await runCli(['brief', 'complete'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.status).toBe('complete');
    });

    it('should fail when required fields are missing', async () => {
      await runCli(['brief', 'init'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });

      const result = await runCli(['brief', 'complete'], { cwd: tmpDir });
      await expectFailure(
        result,
        /Missing required fields/i,
        'Completing brief with missing required fields should fail'
      );

      const output = parseJsonOutput(result.stderr + result.stdout);
      expect(output.missing).toBeDefined();
      expect(Array.isArray(output.missing)).toBe(true);
    });

    it('should mark brief as complete', async () => {
      // Set all required fields first
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'goal', 'Test'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'scope', '{"included":[],"excluded":[]}'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'functionalRequirements', '[]'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'acceptanceCriteria', '[]'], { cwd: tmpDir });

      await runCli(['brief', 'complete'], { cwd: tmpDir });

      // Verify status shows complete
      const statusResult = await runCli(['brief', 'status'], { cwd: tmpDir });
      await expectSuccess(statusResult);

      const output = parseJsonOutput(statusResult.stdout);
      expect(output.complete).toBe(true);
      expect(output.status).toBe('complete');
    });
  });

  describe('field name validation', () => {
    it('should reject unknown field names', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      const result = await runCli(['brief', 'set', 'unknownField', 'value'], { cwd: tmpDir });
      await expectFailure(result, /Unknown field|validFields/i, 'Unknown field should fail');
    });

    it('should list valid fields in error message', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      const result = await runCli(['brief', 'set', 'invalid', 'value'], { cwd: tmpDir });
      await expectFailure(result, /validFields/i);

      // Error messages are in stdout as JSON
      const output = result.stdout + result.stderr;
      expect(output).toContain('workType');
      expect(output).toContain('goal');
      expect(output).toContain('scope');
    });
  });

  describe('JSON parsing', () => {
    it('should handle complex JSON objects', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      const result = await runCli(
        [
          'brief',
          'set',
          'qualityStandards',
          '{"performance":{"latency":"<100ms"},"security":{"tls":"required"}}',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(result);
    });

    it('should handle nested JSON structures', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      const result = await runCli(
        [
          'brief',
          'set',
          'constraints',
          '{"exclusions":["auth system"],"requirements":["10k connections"]}',
        ],
        { cwd: tmpDir }
      );
      await expectSuccess(result);
    });

    it('should reject invalid JSON', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      const result = await runCli(['brief', 'set', 'scope', '{invalid json}'], { cwd: tmpDir });
      await expectFailure(result, /Invalid JSON/i, 'Invalid JSON should fail');
    });
  });

  describe('concurrent briefs', () => {
    it('should allow multiple briefs via --id flag', async () => {
      const init1 = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(init1);
      const id1 = parseJsonOutput(init1.stdout) as { id: string };

      const init2 = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(init2);
      const id2 = parseJsonOutput(init2.stdout) as { id: string };

      expect(id1.id).not.toBe(id2.id);

      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'workType', 'data', '--id', id2.id], { cwd: tmpDir });
    });
  });
});
