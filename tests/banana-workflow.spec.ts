import { describe, it, expect } from 'vitest';
import { GraphEngine } from '../src/graph/engine.js';
import { validateWorkflow } from '../src/graph/validator.js';
import type { WorkflowDefinition } from '../src/models/graph.js';

const bananaWorkflow: WorkflowDefinition = {
  id: 'banana-loop-workflow',
  name: 'Banana Loop & Binary Conversion Workflow',
  description:
    'Demonstrates workflow looping: loops to strip occurrences of BANANA from the prompt, then converts the final text to binary representation.',
  version: '1.0.0',
  stages: [
    {
      id: 'banana-processing-stage',
      name: 'Banana Loop & Binary Conversion',
      description:
        'Iteratively detects and removes BANANA, then converts the remaining text into binary code.',
      graph: {
        id: 'banana-graph',
        maxIterations: 10,
        entryNodeIds: ['intake-prompt'],
        nodes: [
          {
            id: 'intake-prompt',
            name: 'Intake Prompt',
            type: 'passthrough',
            config: {},
          },
          {
            id: 'check-banana',
            name: 'Check For Banana',
            type: 'condition',
            config: {
              field: 'prompt',
              operator: 'contains',
              value: 'BANANA',
            },
          },
          {
            id: 'strip-banana',
            name: 'Strip Banana',
            type: 'agent',
            config: {
              agent: 'frontman',
              prompt:
                "Remove the first occurrence of the word 'BANANA' from the prompt string. Output the updated string as { prompt: '<updated>' }.",
              allowedTools: ['question'],
            },
          },
          {
            id: 'to-binary',
            name: 'Convert To Binary',
            type: 'agent',
            config: {
              agent: 'frontman',
              prompt:
                "Convert the final prompt string character-by-character into an 8-bit ASCII binary string (space-separated, e.g. 'A' -> '01000001'). Output the result as { binaryResult: '<binary_string>' }.",
              allowedTools: ['question'],
            },
          },
          {
            id: 'output-final',
            name: 'Output Final Binary',
            type: 'passthrough',
            config: {},
          },
        ],
        edges: [
          {
            from: 'intake-prompt',
            to: 'check-banana',
          },
          {
            from: 'check-banana',
            to: 'strip-banana',
            label: 'loop-if-banana',
            condition: {
              type: 'expression',
              expression: 'node.check-banana.result == true',
            },
          },
          {
            from: 'strip-banana',
            to: 'check-banana',
            label: 'repeat-check',
          },
          {
            from: 'check-banana',
            to: 'to-binary',
            label: 'breakout-to-binary',
            condition: {
              type: 'expression',
              expression: 'node.check-banana.result == false',
            },
          },
          {
            from: 'to-binary',
            to: 'output-final',
          },
        ],
      },
    },
  ],
};

describe('Banana Loop & Binary Conversion Workflow', () => {
  it('validates the workflow structure without schema or DAG errors', () => {
    const result = validateWorkflow(bananaWorkflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('bypasses the loop when prompt does not contain BANANA and converts to binary', async () => {
    const workflow = bananaWorkflow;
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
    const workflow = bananaWorkflow;
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
    const workflow = bananaWorkflow;
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
