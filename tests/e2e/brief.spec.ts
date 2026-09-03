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

    it('should allow setting arbitrary field names in generic KV model', async () => {
      const result = await runCli(['brief', 'set', 'customKey', 'customValue'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.field).toBe('customKey');
      expect(output.value).toBe('customValue');
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

    it('should set scope field with base64 encoded JSON', async () => {
      const scopeObj = {
        included: ['Backend API CRUD with "quotes" and spaces', 'SQLite local persistence'],
        excluded: ['auth', 'cloud & complex/special-chars'],
      };
      const b64 = Buffer.from(JSON.stringify(scopeObj)).toString('base64');
      const result = await runCli(['brief', 'set', 'scope', b64, '--base64'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as {
        ok: boolean;
        field: string;
        value: typeof scopeObj;
      };
      expect(output.ok).toBe(true);
      expect(output.field).toBe('scope');
      expect(output.value).toEqual(scopeObj);

      // Verify reading back the value
      const getResult = await runCli(['brief', 'get', 'scope'], { cwd: tmpDir });
      await expectSuccess(getResult);
      const getOutput = parseJsonOutput(getResult.stdout) as {
        ok: boolean;
        value: typeof scopeObj;
      };
      expect(getOutput.value).toEqual(scopeObj);
    });

    it('should set functionalRequirements field with base64 encoded JSON array', async () => {
      const reqs = ['GitHub OAuth 2.0 login', 'Token storage with "secure" keys'];
      const b64 = Buffer.from(JSON.stringify(reqs)).toString('base64');
      const result = await runCli(['brief', 'set', 'functionalRequirements', b64, '--base64'], {
        cwd: tmpDir,
      });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as {
        ok: boolean;
        field: string;
        value: typeof reqs;
      };
      expect(output.ok).toBe(true);
      expect(output.field).toBe('functionalRequirements');
      expect(output.value).toEqual(reqs);
    });

    it('should handle exact scope payload from CREWMATE_FAILURE_REPORT2 via base64', async () => {
      const failureReportScope = {
        included: [
          'backend REST API with CRUD operations for notes',
          'SQLite local persistence',
          'Notes with tags, search, and tag filtering',
          'Responsive frontend UI (sidebar + main view with markdown editor and live preview)',
          'Tag manager (add/remove tags)',
          'Automated test suite',
          'Initial seed dataset with sample notes',
        ],
        excluded: [
          'user authentication/accounts',
          'multi-user collaboration',
          'mobile app or native desktop app',
          'cloud deployment/hosting',
          'rich text formatting beyond Markdown',
        ],
      };
      const b64 = Buffer.from(JSON.stringify(failureReportScope)).toString('base64');
      const result = await runCli(['brief', 'set', 'scope', b64, '--base64'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout) as {
        ok: boolean;
        field: string;
        value: typeof failureReportScope;
      };
      expect(output.ok).toBe(true);
      expect(output.field).toBe('scope');
      expect(output.value).toEqual(failureReportScope);
    });

    it('should pass through plain string in base64 payload when not valid JSON', async () => {
      const b64 = Buffer.from('plain string content').toString('base64');
      const result = await runCli(['brief', 'set', 'notes', b64, '--base64'], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.value).toBe('plain string content');
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
      expect(output.brief.fields.workType).toBe('software');
      expect(output.brief.fields.goal).toBe('Test goal');
    });

    it('should work with --id flag', async () => {
      await runCli(['brief', 'set', 'workType', 'audit'], { cwd: tmpDir });

      const result = await runCli(['brief', 'show', '--id', briefId], { cwd: tmpDir });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.brief.fields.workType).toBe('audit');
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

    it('should show configured required fields as missing initially', async () => {
      const result = await runCli(['brief', 'status', '--required-fields', 'workType,goal,scope'], {
        cwd: tmpDir,
      });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.complete).toBe(false);
      expect(output.status).toBe('draft');

      const expectedMissing = ['workType', 'goal', 'scope'];
      for (const field of expectedMissing) {
        expect(output.required[field]).toBe('missing');
      }
    });

    it('should update status after setting fields', async () => {
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'goal', 'Test goal'], { cwd: tmpDir });

      const result = await runCli(['brief', 'status', '--required-fields', 'workType,goal,scope'], {
        cwd: tmpDir,
      });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.required.workType).toBe('set');
      expect(output.required.goal).toBe('set');
      expect(output.required.scope).toBe('missing');
      expect(output.complete).toBe(false);
    });
  });

  describe('complete', () => {
    it('should succeed when all required fields are set', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      // Set required fields
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'goal', 'Build something'], { cwd: tmpDir });

      const result = await runCli(['brief', 'complete', '--required-fields', 'workType,goal'], {
        cwd: tmpDir,
      });
      await expectSuccess(result);

      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.status).toBe('complete');
    });

    it('should fail when required fields are missing', async () => {
      await runCli(['brief', 'init'], { cwd: tmpDir });
      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });

      const result = await runCli(['brief', 'complete', '--required-fields', 'workType,goal'], {
        cwd: tmpDir,
      });
      await expectFailure(
        result,
        /Missing required fields/i,
        'Completing brief with missing required fields should fail'
      );

      const output = parseJsonOutput(result.stderr + result.stdout);
      expect(output.missing).toBeDefined();
      expect(Array.isArray(output.missing)).toBe(true);
      expect(output.missing).toContain('goal');
    });

    it('should mark brief as complete', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      await runCli(['brief', 'set', 'goal', 'Test'], { cwd: tmpDir });
      await runCli(['brief', 'complete'], { cwd: tmpDir });

      // Verify status shows complete
      const statusResult = await runCli(['brief', 'status'], { cwd: tmpDir });
      await expectSuccess(statusResult);

      const output = parseJsonOutput(statusResult.stdout);
      expect(output.complete).toBe(true);
      expect(output.status).toBe('complete');
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

      const getResult = await runCli(['brief', 'get', 'qualityStandards'], { cwd: tmpDir });
      const getOutput = parseJsonOutput(getResult.stdout);
      expect(getOutput.value).toEqual({
        performance: { latency: '<100ms' },
        security: { tls: 'required' },
      });
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

    it('should treat unparsable JSON as plain string', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      const result = await runCli(['brief', 'set', 'notes', '{plain text note}'], { cwd: tmpDir });
      await expectSuccess(result);

      const getResult = await runCli(['brief', 'get', 'notes'], { cwd: tmpDir });
      const getOutput = parseJsonOutput(getResult.stdout);
      expect(getOutput.value).toBe('{plain text note}');
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

  describe('reopen and unset', () => {
    it('should allow unsetting a field on a draft brief', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      const getRes1 = await runCli(['brief', 'get', 'workType'], { cwd: tmpDir });
      expect(parseJsonOutput(getRes1.stdout).value).toBe('software');

      const unsetRes = await runCli(['brief', 'unset', 'workType'], { cwd: tmpDir });
      await expectSuccess(unsetRes);

      const getRes2 = await runCli(['brief', 'get', 'workType'], { cwd: tmpDir });
      expect(parseJsonOutput(getRes2.stdout).value).toBeNull();
    });

    it('should reject unsetting fields on a completed brief', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'complete'], { cwd: tmpDir });

      const unsetRes = await runCli(['brief', 'unset', 'workType'], { cwd: tmpDir });
      await expectFailure(unsetRes, /cannot modify a completed brief/i);
    });

    it('should reopen completed brief back to draft status', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);

      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['brief', 'complete'], { cwd: tmpDir });

      const reopenRes = await runCli(['brief', 'reopen'], { cwd: tmpDir });
      await expectSuccess(reopenRes);
      expect(parseJsonOutput(reopenRes.stdout).status).toBe('draft');

      // Modifying after reopening should succeed
      const setRes = await runCli(['brief', 'set', 'workType', 'hardware'], { cwd: tmpDir });
      await expectSuccess(setRes);
      const getRes = await runCli(['brief', 'get', 'workType'], { cwd: tmpDir });
      expect(parseJsonOutput(getRes.stdout).value).toBe('hardware');
    });
  });

  describe('delete', () => {
    it('should delete a brief and cascade all associated data', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefId = (parseJsonOutput(initResult.stdout) as { id: string }).id;

      await runCli(['brief', 'set', 'workType', 'software'], { cwd: tmpDir });
      await runCli(['task', 'add', briefId, '--title', 'Task 1', '--description', 'Test'], {
        cwd: tmpDir,
      });

      const deleteRes = await runCli(['brief', 'delete', briefId], { cwd: tmpDir });
      await expectSuccess(deleteRes);
      expect(parseJsonOutput(deleteRes.stdout).deletedId).toBe(briefId);

      // Brief should no longer exist
      const showRes = await runCli(['brief', 'show', '--id', briefId], { cwd: tmpDir });
      await expectFailure(showRes, /no brief found/i);

      // Tasks should be cascade deleted
      const tasksRes = await runCli(['task', 'list', '--brief', briefId], { cwd: tmpDir });
      await expectFailure(tasksRes, /(no brief found|brief not found)/i);
    });

    it('should prevent deleting brief with active workflow run without --force', async () => {
      const initResult = await runCli(['brief', 'init'], { cwd: tmpDir });
      await expectSuccess(initResult);
      const briefId = (parseJsonOutput(initResult.stdout) as { id: string }).id;

      await runCli(['workflow', 'start', '--brief', briefId], { cwd: tmpDir });

      const deleteRes = await runCli(['brief', 'delete', briefId], { cwd: tmpDir });
      await expectFailure(deleteRes, /active workflow run/i);

      // Should succeed with --force
      const forceDeleteRes = await runCli(['brief', 'delete', briefId, '--force'], {
        cwd: tmpDir,
      });
      await expectSuccess(forceDeleteRes);
    });
  });
});
