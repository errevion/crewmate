import type { NodeDefinition, NodeExecutionState } from '../../models/graph.js';
import type { EvaluationContext } from '../router.js';

/**
 * Result of running a graph node
 */
export interface NodeRunnerResult {
  status: 'completed' | 'failed' | 'skipped';
  outputs?: Record<string, unknown>;
  error?: string;
}

/**
 * Interface for executing a specific graph node type
 */
export interface NodeRunner {
  run(
    node: NodeDefinition,
    context: EvaluationContext,
    state: NodeExecutionState
  ): Promise<NodeRunnerResult>;
}

/**
 * Runner that passes inputs to outputs
 */
export class PassthroughNodeRunner implements NodeRunner {
  /**
   * Executes passthrough
   */
  async run(
    node: NodeDefinition,
    context: EvaluationContext,
    _state: NodeExecutionState
  ): Promise<NodeRunnerResult> {
    const inputs = resolveNodeInputs(node, context);
    return {
      status: 'completed',
      outputs: {
        ...inputs,
        passthrough: true,
      },
    };
  }
}

/**
 * Runner for evaluating boolean conditions
 */
export class ConditionNodeRunner implements NodeRunner {
  /**
   * Executes condition evaluation
   */
  async run(
    node: NodeDefinition,
    context: EvaluationContext,
    _state: NodeExecutionState
  ): Promise<NodeRunnerResult> {
    const config = node.config as {
      expression?: string;
      field?: string;
      operator?: string;
      value?: unknown;
      cases?: Record<string, string>;
    };

    let result = true;

    if (config.field && config.operator) {
      const actual = context.graphContext[config.field] ?? context.globalContext[config.field];
      switch (config.operator) {
        case 'equals':
          result = actual === config.value;
          break;
        case 'not_equals':
          result = actual !== config.value;
          break;
        case 'contains':
          if (Array.isArray(actual)) {
            result = actual.includes(config.value);
          } else if (typeof actual === 'string') {
            result = actual.includes(String(config.value));
          } else {
            result = false;
          }
          break;
        case 'greater_than':
          result = (actual as number) > (config.value as number);
          break;
        case 'less_than':
          result = (actual as number) < (config.value as number);
          break;
        case 'exists':
          result = actual !== undefined && actual !== null;
          break;
        case 'truthy':
          result = Boolean(actual);
          break;
        case 'falsy':
          result = !actual;
          break;
      }
    }

    return {
      status: 'completed',
      outputs: {
        result,
        branch: result ? 'true' : 'false',
      },
    };
  }
}

/**
 * Runner for transforming node inputs and context
 */
export class TransformNodeRunner implements NodeRunner {
  /**
   * Executes transformation
   */
  async run(
    node: NodeDefinition,
    context: EvaluationContext,
    _state: NodeExecutionState
  ): Promise<NodeRunnerResult> {
    const config = node.config as {
      transformType?: string;
      mapping?: Record<string, string>;
    };

    const inputs = resolveNodeInputs(node, context);
    const outputs: Record<string, unknown> = {};

    if (config.mapping) {
      for (const [outKey, inKey] of Object.entries(config.mapping)) {
        outputs[outKey] = inputs[inKey] ?? context.graphContext[inKey];
      }
    } else {
      Object.assign(outputs, inputs);
    }

    return {
      status: 'completed',
      outputs,
    };
  }
}

/**
 * Runner for invoking CLI or API tools
 */
export class ToolNodeRunner implements NodeRunner {
  /**
   * Executes tool node
   */
  async run(
    node: NodeDefinition,
    _context: EvaluationContext,
    _state: NodeExecutionState
  ): Promise<NodeRunnerResult> {
    const config = node.config as {
      tool?: string;
      command?: string;
      args?: Record<string, unknown>;
    };

    // Lightweight mockable / generic runner
    return {
      status: 'completed',
      outputs: {
        tool: config.tool || config.command,
        executed: true,
        args: config.args,
      },
    };
  }
}

/**
 * Resolves static or dynamic inputs for a node before execution
 */
export function resolveNodeInputs(
  node: NodeDefinition,
  context: EvaluationContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!node.inputs) {
    return result;
  }

  if (Array.isArray(node.inputs)) {
    // Array of NodePortMapping
    for (const mapping of node.inputs) {
      let val = mapping.defaultValue;
      if (mapping.sourceNodeId && mapping.fromPort) {
        val = context.nodeOutputs[mapping.sourceNodeId]?.[mapping.fromPort] ?? val;
      }
      result[mapping.toPort] = val;
    }
  } else if (typeof node.inputs === 'object') {
    // Record<string, unknown>
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v === 'string' && v.startsWith('$')) {
        const refPath = v.slice(1);
        result[k] =
          context.graphContext[refPath] ??
          context.stageContext[refPath] ??
          context.globalContext[refPath];
      } else {
        result[k] = v;
      }
    }
  }

  return result;
}
