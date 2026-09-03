import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseJsonOutput, expectSuccess, expectFailure } from './helpers.js';

const TEST_PREFIX = 'crewmate-workflow-e2e-';

describe('E2E: Workflow & Graph CLI Commands', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('validates workflow definition files correctly', async () => {
    const validWorkflow = {
      id: 'custom-wf',
      name: 'Custom Workflow',
      stages: [
        {
          id: 'stage-1',
          name: 'Stage 1',
          graph: {
            nodes: [{ id: 'n1', type: 'passthrough', config: {} }],
            edges: [],
          },
        },
      ],
    };
    const validPath = join(tempDir, 'valid-wf.json');
    writeFileSync(validPath, JSON.stringify(validWorkflow, null, 2));

    const res = await runCli(['workflow', 'validate', validPath], { cwd: tempDir });
    expectSuccess(res);
    const parsed = parseJsonOutput(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.valid).toBe(true);
    expect(parsed.data.type).toBe('workflow');
  });

  it('rejects invalid workflow definitions', async () => {
    const invalidWorkflow = {
      id: 'invalid-wf',
      stages: [],
    };
    const invalidPath = join(tempDir, 'invalid-wf.json');
    writeFileSync(invalidPath, JSON.stringify(invalidWorkflow, null, 2));

    const res = await runCli(['workflow', 'validate', invalidPath], { cwd: tempDir });
    expectFailure(res, /Workflow validation failed/i);
  });

  it('executes a workflow end-to-end with crewmate workflow run', async () => {
    const customWorkflow = {
      id: 'custom-pipeline',
      name: 'Custom Pipeline',
      stages: [
        {
          id: 'build-stage',
          name: 'Build Stage',
          graph: {
            nodes: [
              { id: 'compile', type: 'tool', config: { tool: 'tsc' } },
              { id: 'bundle', type: 'tool', config: { tool: 'esbuild' } },
            ],
            edges: [{ from: 'compile', to: 'bundle', condition: { type: 'on_success' } }],
          },
        },
      ],
    };
    const customPath = join(tempDir, 'custom-wf.json');
    writeFileSync(customPath, JSON.stringify(customWorkflow, null, 2));

    const res = await runCli(['workflow', 'run', '-f', customPath], { cwd: tempDir });
    expectSuccess(res);
    const parsed = parseJsonOutput(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.status).toBe('completed');
    expect(parsed.data.stages['build-stage'].status).toBe('completed');
  });

  it('manages workflow runs at runtime via CLI (start, status, advance, skip, pause, resume)', async () => {
    // 1. Initialize brief
    const initRes = await runCli(['brief', 'init'], { cwd: tempDir });
    expectSuccess(initRes);
    const initJson = parseJsonOutput(initRes.stdout);
    const briefId = initJson.id;

    // 2. Start workflow run
    const startRes = await runCli(['workflow', 'start', '--brief', briefId], { cwd: tempDir });
    expectSuccess(startRes);
    const startJson = parseJsonOutput(startRes.stdout);
    expect(startJson.ok).toBe(true);
    expect(startJson.data.status).toBe('running');
    expect(startJson.data.currentStage).toBe('discussion');
    const runId = startJson.data.id;

    // 3. Check status
    const statusRes = await runCli(['workflow', 'status', '--run', runId], { cwd: tempDir });
    expectSuccess(statusRes);
    const statusJson = parseJsonOutput(statusRes.stdout);
    expect(statusJson.data.currentStage).toBe('discussion');

    // 4. Advance stage: discussion -> research
    const advRes = await runCli(
      ['workflow', 'advance', '--run', runId, '-o', JSON.stringify({ briefCompleted: true })],
      { cwd: tempDir }
    );
    expectSuccess(advRes);
    const advJson = parseJsonOutput(advRes.stdout);
    expect(advJson.data.currentStage).toBe('research');

    // 5. Skip stage: skip research -> planning
    const skipRes = await runCli(['workflow', 'skip', 'research', '--run', runId], {
      cwd: tempDir,
    });
    expectSuccess(skipRes);
    const skipJson = parseJsonOutput(skipRes.stdout);
    expect(skipJson.data.currentStage).toBe('planning');

    // 6. Pause and resume
    const pauseRes = await runCli(['workflow', 'pause', '--run', runId], { cwd: tempDir });
    expectSuccess(pauseRes);
    expect(parseJsonOutput(pauseRes.stdout).data.status).toBe('paused');

    const resumeRes = await runCli(['workflow', 'resume', '--run', runId], { cwd: tempDir });
    expectSuccess(resumeRes);
    expect(parseJsonOutput(resumeRes.stdout).data.status).toBe('running');

    // 7. Jump to specific stage
    const jumpRes = await runCli(['workflow', 'set-stage', 'execution', '--run', runId], {
      cwd: tempDir,
    });
    expectSuccess(jumpRes);
    expect(parseJsonOutput(jumpRes.stdout).data.currentStage).toBe('execution');

    // 8. List runs
    const listRes = await runCli(['workflow', 'list-runs', '--brief', briefId], { cwd: tempDir });
    expectSuccess(listRes);
    const listJson = parseJsonOutput(listRes.stdout);
    expect(listJson.data).toHaveLength(1);
    expect(listJson.data[0].id).toBe(runId);
  });

  it('regenerates .crewmate/workflows/default.json on crewmate workflow start when no workflow detected in workflows/ folder', async () => {
    // 1. Initialize brief
    const initRes = await runCli(['brief', 'init'], { cwd: tempDir });
    expectSuccess(initRes);
    const initJson = parseJsonOutput(initRes.stdout);
    const briefId = initJson.id;

    const defaultWorkflowPath = join(tempDir, '.crewmate', 'workflows', 'default.json');
    const { existsSync, unlinkSync, readFileSync } = await import('node:fs');

    // Ensure default.json does not exist before start
    if (existsSync(defaultWorkflowPath)) {
      unlinkSync(defaultWorkflowPath);
    }
    expect(existsSync(defaultWorkflowPath)).toBe(false);

    // 2. Run workflow start without -f
    const startRes = await runCli(['workflow', 'start', '--brief', briefId], { cwd: tempDir });
    expectSuccess(startRes);

    // 3. Verify default.json and modular stage/node files were automatically regenerated
    expect(existsSync(defaultWorkflowPath)).toBe(true);
    expect(existsSync(join(tempDir, '.crewmate', 'workflows', 'stages', 'discussion.json'))).toBe(
      true
    );
    expect(
      existsSync(join(tempDir, '.crewmate', 'workflows', 'nodes', 'frontman-interview.json'))
    ).toBe(true);
    const parsed = JSON.parse(readFileSync(defaultWorkflowPath, 'utf-8'));
    expect(parsed.id).toBe('software-development');
    expect(parsed.stages).toHaveLength(5);
  });

  it('supports --agent-summary flag on workflow commands', async () => {
    // 1. Initialize brief
    const initRes = await runCli(['brief', 'init'], { cwd: tempDir });
    expectSuccess(initRes);
    const briefId = parseJsonOutput(initRes.stdout).id;

    // 2. Start workflow with --agent-summary
    const startRes = await runCli(['workflow', 'start', '--brief', briefId, '--agent-summary'], {
      cwd: tempDir,
    });
    expectSuccess(startRes);
    const startJson = parseJsonOutput(startRes.stdout);
    expect(startJson.ok).toBe(true);
    expect(startJson.data.workflowDef).toBeUndefined();
    expect(startJson.data.currentStage).toBe('discussion');
    expect(startJson.data.stageName).toBe('Discussion');
    expect(startJson.data.activeNodes).toBeDefined();
    expect(startJson.data.activeNodes.length).toBeGreaterThan(0);
    const interviewNode = startJson.data.activeNodes.find(
      (n: any) => n.id === 'frontman-interview'
    );
    expect(interviewNode).toBeDefined();
    expect(interviewNode.allowedTools).toContain('crewmate_update_field');
    expect(interviewNode.deniedTools).toContain('bash');

    // 3. Status with --agent-summary
    const statusRes = await runCli(
      ['workflow', 'status', '--run', startJson.data.id, '--agent-summary'],
      {
        cwd: tempDir,
      }
    );
    expectSuccess(statusRes);
    const statusJson = parseJsonOutput(statusRes.stdout);
    expect(statusJson.ok).toBe(true);
    expect(statusJson.data.workflowDef).toBeUndefined();
    expect(statusJson.data.currentStage).toBe('discussion');
    expect(statusJson.data.activeNodes).toBeDefined();
  });

  it('should support cancelling and deleting a workflow run', async () => {
    // 1. Create a brief first
    const initRes = await runCli(['brief', 'init'], { cwd: tempDir });
    expectSuccess(initRes);
    const briefId = parseJsonOutput(initRes.stdout).id;

    // 2. Start run bound to brief
    const startRes = await runCli(['workflow', 'start', '--brief', briefId, '--agent-summary'], {
      cwd: tempDir,
    });
    expectSuccess(startRes);
    const runId = parseJsonOutput(startRes.stdout).data.id;

    // 3. Cancel run
    const cancelRes = await runCli(['workflow', 'cancel', '--run', runId], { cwd: tempDir });
    expectSuccess(cancelRes);
    expect(parseJsonOutput(cancelRes.stdout).data.status).toBe('cancelled');

    // 4. Delete run
    const deleteRes = await runCli(['workflow', 'delete', runId], { cwd: tempDir });
    expectSuccess(deleteRes);
    expect(parseJsonOutput(deleteRes.stdout).data.deletedId).toBe(runId);

    // 5. Verify gone
    const listRes = await runCli(['workflow', 'list-runs'], { cwd: tempDir });
    expectSuccess(listRes);
    const runs = parseJsonOutput(listRes.stdout).data;
    expect(runs.find((r: any) => r.id === runId)).toBeUndefined();
  });
});
