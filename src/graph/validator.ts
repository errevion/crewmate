import type {
  WorkflowDefinition,
  StageDefinition,
  GraphDefinition,
  NodeDefinition,
  EdgeDefinition,
  NodeType,
} from '../models/graph.js';
import { NODE_TYPES } from '../models/graph.js';

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Result of validating a graph or workflow
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a node definition
 */
export function validateNode(node: unknown, pathPrefix: string = 'node'): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({
      path: pathPrefix,
      message: 'Node must be a non-null object',
      code: 'INVALID_NODE',
    });
    return errors;
  }

  const n = node as Partial<NodeDefinition>;

  if (!n.id || typeof n.id !== 'string' || n.id.trim() === '') {
    errors.push({
      path: `${pathPrefix}.id`,
      message: 'Node must have a non-empty string id',
      code: 'MISSING_NODE_ID',
    });
  }

  if (!n.type || !NODE_TYPES.includes(n.type as NodeType)) {
    errors.push({
      path: `${pathPrefix}.type`,
      message: `Node type must be one of: ${NODE_TYPES.join(', ')}`,
      code: 'INVALID_NODE_TYPE',
    });
  }

  if (n.type === 'agent') {
    const config = n.config as { agent?: string } | undefined;
    if (!config || typeof config.agent !== 'string' || config.agent.trim() === '') {
      errors.push({
        path: `${pathPrefix}.config.agent`,
        message: 'Agent node must specify a non-empty agent name in config.agent',
        code: 'MISSING_AGENT_CONFIG',
      });
    }
  }

  if (n.type === 'task') {
    const config = n.config as { title?: string; description?: string } | undefined;
    if (!config || typeof config.title !== 'string' || config.title.trim() === '') {
      errors.push({
        path: `${pathPrefix}.config.title`,
        message: 'Task node must specify a title in config.title',
        code: 'MISSING_TASK_TITLE',
      });
    }
  }

  if (n.type === 'condition') {
    const config = n.config as
      { expression?: string; field?: string; operator?: string; predicate?: string } | undefined;
    if (
      !config ||
      (!config.expression && !config.predicate && !(config.field && config.operator))
    ) {
      errors.push({
        path: `${pathPrefix}.config`,
        message:
          'Condition node must specify an expression, predicate, or field/operator combination',
        code: 'INVALID_CONDITION_CONFIG',
      });
    }
  }

  if (n.type === 'tool') {
    const config = n.config as { tool?: string; command?: string } | undefined;
    if (
      !config ||
      ((typeof config.tool !== 'string' || config.tool.trim() === '') &&
        (typeof config.command !== 'string' || config.command.trim() === ''))
    ) {
      errors.push({
        path: `${pathPrefix}.config`,
        message: 'Tool node must specify config.tool or config.command',
        code: 'MISSING_TOOL_CONFIG',
      });
    }
  }

  return errors;
}

/**
 * Validates a graph definition
 */
export function validateGraph(graph: unknown, pathPrefix: string = 'graph'): ValidationResult {
  const errors: ValidationError[] = [];

  if (!graph || typeof graph !== 'object') {
    return {
      valid: false,
      errors: [
        {
          path: pathPrefix,
          message: 'Graph must be a non-null object',
          code: 'INVALID_GRAPH',
        },
      ],
    };
  }

  const g = graph as Partial<GraphDefinition>;

  if (!Array.isArray(g.nodes)) {
    errors.push({
      path: `${pathPrefix}.nodes`,
      message: 'Graph must have a nodes array',
      code: 'MISSING_NODES',
    });
  }

  if (!Array.isArray(g.edges)) {
    errors.push({
      path: `${pathPrefix}.edges`,
      message: 'Graph must have an edges array',
      code: 'MISSING_EDGES',
    });
  }

  if (errors.length > 0 || !g.nodes || !g.edges) {
    return { valid: false, errors };
  }

  const nodeIds = new Set<string>();

  for (let i = 0; i < g.nodes.length; i++) {
    const node = g.nodes[i];
    const nodePath = `${pathPrefix}.nodes[${i}]`;
    const nodeErrors = validateNode(node, nodePath);
    errors.push(...nodeErrors);

    if (node && typeof node === 'object' && typeof (node as NodeDefinition).id === 'string') {
      const id = (node as NodeDefinition).id;
      if (nodeIds.has(id)) {
        errors.push({
          path: `${nodePath}.id`,
          message: `Duplicate node ID "${id}" detected in graph`,
          code: 'DUPLICATE_NODE_ID',
        });
      } else {
        nodeIds.add(id);
      }
    }
  }

  for (let i = 0; i < g.edges.length; i++) {
    const edge = g.edges[i] as Partial<EdgeDefinition>;
    const edgePath = `${pathPrefix}.edges[${i}]`;

    if (!edge || typeof edge !== 'object') {
      errors.push({
        path: edgePath,
        message: 'Edge must be a non-null object',
        code: 'INVALID_EDGE',
      });
      continue;
    }

    if (!edge.from || typeof edge.from !== 'string') {
      errors.push({
        path: `${edgePath}.from`,
        message: 'Edge must specify a string "from" node ID',
        code: 'MISSING_EDGE_FROM',
      });
    } else if (!nodeIds.has(edge.from)) {
      errors.push({
        path: `${edgePath}.from`,
        message: `Edge references non-existent "from" node ID "${edge.from}"`,
        code: 'DANGLING_EDGE_FROM',
      });
    }

    if (!edge.to || typeof edge.to !== 'string') {
      errors.push({
        path: `${edgePath}.to`,
        message: 'Edge must specify a string "to" node ID',
        code: 'MISSING_EDGE_TO',
      });
    } else if (!nodeIds.has(edge.to)) {
      errors.push({
        path: `${edgePath}.to`,
        message: `Edge references non-existent "to" node ID "${edge.to}"`,
        code: 'DANGLING_EDGE_TO',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a workflow definition
 */
export function validateWorkflow(workflow: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!workflow || typeof workflow !== 'object') {
    return {
      valid: false,
      errors: [
        {
          path: 'workflow',
          message: 'Workflow must be a non-null object',
          code: 'INVALID_WORKFLOW',
        },
      ],
    };
  }

  const w = workflow as Partial<WorkflowDefinition>;

  if (!w.id || typeof w.id !== 'string' || w.id.trim() === '') {
    errors.push({
      path: 'workflow.id',
      message: 'Workflow must have a non-empty string id',
      code: 'MISSING_WORKFLOW_ID',
    });
  }

  if (!w.name || typeof w.name !== 'string' || w.name.trim() === '') {
    errors.push({
      path: 'workflow.name',
      message: 'Workflow must have a non-empty string name',
      code: 'MISSING_WORKFLOW_NAME',
    });
  }

  if (!Array.isArray(w.stages) || w.stages.length === 0) {
    errors.push({
      path: 'workflow.stages',
      message: 'Workflow must have at least one stage in stages array',
      code: 'MISSING_WORKFLOW_STAGES',
    });
    return { valid: false, errors };
  }

  const stageIds = new Set<string>();

  for (let i = 0; i < w.stages.length; i++) {
    const stage = w.stages[i] as Partial<StageDefinition>;
    const stagePath = `workflow.stages[${i}]`;

    if (!stage || typeof stage !== 'object') {
      errors.push({
        path: stagePath,
        message: 'Stage must be a non-null object',
        code: 'INVALID_STAGE',
      });
      continue;
    }

    if (!stage.id || typeof stage.id !== 'string' || stage.id.trim() === '') {
      errors.push({
        path: `${stagePath}.id`,
        message: 'Stage must have a non-empty string id',
        code: 'MISSING_STAGE_ID',
      });
    } else if (stageIds.has(stage.id)) {
      errors.push({
        path: `${stagePath}.id`,
        message: `Duplicate stage ID "${stage.id}" detected in workflow`,
        code: 'DUPLICATE_STAGE_ID',
      });
    } else {
      stageIds.add(stage.id);
    }

    if (!stage.name || typeof stage.name !== 'string' || stage.name.trim() === '') {
      errors.push({
        path: `${stagePath}.name`,
        message: 'Stage must have a non-empty string name',
        code: 'MISSING_STAGE_NAME',
      });
    }

    const graphResult = validateGraph(stage.graph, `${stagePath}.graph`);
    if (!graphResult.valid) {
      errors.push(...graphResult.errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
