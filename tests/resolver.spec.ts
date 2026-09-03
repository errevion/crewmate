import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAndResolveWorkflow } from '../src/graph/resolver.js';
import { getModularWorkflowFiles } from '../src/graph/modular-templates.js';

describe('Workflow Resolver', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'crewmate-resolver-test-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('resolves fully modular workflow files (workflow -> stages -> nodes)', () => {
    const files = getModularWorkflowFiles();
    for (const [relPath, content] of Object.entries(files)) {
      const absPath = join(tempDir, relPath);
      mkdirSync(join(absPath, '..'), { recursive: true });
      writeFileSync(absPath, content, 'utf-8');
    }

    const defaultWfPath = join(tempDir, '.crewmate', 'workflows', 'default.json');
    const resolved = loadAndResolveWorkflow(defaultWfPath);

    expect(resolved.id).toBe('software-development');
    expect(resolved.stages).toHaveLength(5);
    expect(resolved.stages[0].id).toBe('discussion');
    expect(resolved.stages[0].graph.nodes).toHaveLength(2);
    expect(resolved.stages[0].graph.nodes[0].id).toBe('frontman-interview');
    expect((resolved.stages[0].graph.nodes[0].config as any).allowedTools).toContain(
      'crewmate_update_field'
    );
  });

  it('resolves inlined workflows directly without modification', () => {
    const inlined = {
      id: 'inlined-wf',
      name: 'Inlined Workflow',
      stages: [
        {
          id: 's1',
          name: 'Stage 1',
          graph: {
            nodes: [{ id: 'n1', type: 'passthrough', config: {} }],
            edges: [],
          },
        },
      ],
    };

    const resolved = loadAndResolveWorkflow(inlined);
    expect(resolved.id).toBe('inlined-wf');
    expect(resolved.stages).toHaveLength(1);
    expect(resolved.stages[0].graph.nodes[0].id).toBe('n1');
  });
});
