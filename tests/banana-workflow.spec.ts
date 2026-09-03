import { describe, it, expect } from 'vitest';
import { GraphEngine } from '../src/graph/engine.js';
import { loadAndResolveWorkflow } from '../src/graph/resolver.js';
import { validateWorkflow } from '../src/graph/validator.js';
import { resolve } from 'node:path';

describe('Banana Loop & Binary Conversion Workflow', () => {
  const workflowPath = resolve(process.cwd(), 'workflows/banana-loop.workflow.json');

  it('validates the workflow structure without schema or DAG errors', () => {
    const workflow = loadAndResolveWorkflow(workflowPath);
    const result = validateWorkflow(workflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('bypasses the loop when prompt does not contain BANANA and converts to binary', async () => {
    const workflow = loadAndResolveWorkflow(workflowPath);
    const engine = new GraphEngine();
    let loopCount = 0;

    engine.registerRunner('agent', {
      run: async (node, context) => {
        const prompt = (context.graphContext.prompt as string) || '';

        if (node.id === 'strip-banana') {
          loopCount++;
          const updatedPrompt = prompt.replace('BANANA', '').trim();
          return {
            status: 'completed',
            outputs: { prompt: updatedPrompt },
          };
        }

        if (node.id === 'to-binary') {
          const binary = prompt
            .split('')
            .map((char) => char.charCodeAt(0).toString(2).padStart(8, '0'))
            .join(' ');
          return {
            status: 'completed',
            outputs: { binaryResult: binary },
          };
        }

        return { status: 'completed' };
      },
    });

    const res = await engine.executeWorkflow(workflow, { prompt: 'HELLO' });
    expect(res.status).toBe('completed');
    expect(loopCount).toBe(0);

    // 'H' (72) -> 01001000, 'E' (69) -> 01000101, 'L' (76) -> 01001100, 'O' (79) -> 01001111
    expect(res.globalContext.binaryResult).toBe('01001000 01000101 01001100 01001100 01001111');
  });

  it('loops and strips multiple BANANA occurrences before converting to binary', async () => {
    const workflow = loadAndResolveWorkflow(workflowPath);
    const engine = new GraphEngine();
    let loopCount = 0;

    engine.registerRunner('agent', {
      run: async (node, context) => {
        const prompt = (context.graphContext.prompt as string) || '';

        if (node.id === 'strip-banana') {
          loopCount++;
          const updatedPrompt = prompt.replace('BANANA', '').trim();
          return {
            status: 'completed',
            outputs: { prompt: updatedPrompt },
          };
        }

        if (node.id === 'to-binary') {
          const binary = prompt
            .split('')
            .map((char) => char.charCodeAt(0).toString(2).padStart(8, '0'))
            .join(' ');
          return {
            status: 'completed',
            outputs: { binaryResult: binary },
          };
        }

        return { status: 'completed' };
      },
    });

    const res = await engine.executeWorkflow(workflow, { prompt: 'BANANA BANANA HI' });
    expect(res.status).toBe('completed');
    expect(loopCount).toBe(2);

    // 'H' (72) -> 01001000, 'I' (73) -> 01001001
    expect(res.globalContext.binaryResult).toBe('01001000 01001001');
  });

  it('safely aborts when loop exceeds maxIterations', async () => {
    const workflow = loadAndResolveWorkflow(workflowPath);
    const engine = new GraphEngine();

    // Runner that intentionally never removes BANANA
    engine.registerRunner('agent', {
      run: async (node) => {
        if (node.id === 'strip-banana') {
          return { status: 'completed', outputs: { prompt: 'BANANA' } };
        }
        return { status: 'completed' };
      },
    });

    const res = await engine.executeWorkflow(workflow, { prompt: 'BANANA' });
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/maximum iteration limit/i);
  });
});
