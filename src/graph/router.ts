import type {
  EdgeCondition,
  EdgeDefinition,
  GraphDefinition,
  NodeExecutionState,
} from '../models/graph.js';

/**
 * Context passed to condition evaluators and expressions
 */
export interface EvaluationContext {
  globalContext: Record<string, unknown>;
  stageContext: Record<string, unknown>;
  graphContext: Record<string, unknown>;
  nodeOutputs: Record<string, Record<string, unknown>>;
  nodeStates: Record<string, NodeExecutionState>;
  currentNodeId?: string;
  previousNodeId?: string;
}

/**
 * Resolves a dotted path or variable from the context
 */
export function resolveValue(path: string, context: EvaluationContext): unknown {
  if (!path) {
    return undefined;
  }

  // Direct lookup keys
  if (path.startsWith('node.')) {
    const parts = path.split('.');
    const nodeId = parts[1];
    const key = parts.slice(2).join('.');
    const outputs = context.nodeOutputs[nodeId];
    if (!outputs) {
      return undefined;
    }
    return getNestedValue(outputs, key);
  }

  if (path.startsWith('output.')) {
    const key = path.slice(7);
    const prevNode = context.previousNodeId || context.currentNodeId;
    if (!prevNode) {
      return undefined;
    }
    const outputs = context.nodeOutputs[prevNode];
    if (!outputs) {
      return undefined;
    }
    return getNestedValue(outputs, key);
  }

  if (path.startsWith('global.')) {
    return getNestedValue(context.globalContext, path.slice(7));
  }

  if (path.startsWith('stage.')) {
    return getNestedValue(context.stageContext, path.slice(6));
  }

  if (path.startsWith('graph.')) {
    return getNestedValue(context.graphContext, path.slice(6));
  }

  // Fallback search order: graph -> stage -> global -> prev node outputs
  if (context.graphContext[path] !== undefined) {
    return context.graphContext[path];
  }
  if (context.stageContext[path] !== undefined) {
    return context.stageContext[path];
  }
  if (context.globalContext[path] !== undefined) {
    return context.globalContext[path];
  }

  const prevNode = context.previousNodeId || context.currentNodeId;
  if (prevNode && context.nodeOutputs[prevNode]?.[path] !== undefined) {
    return context.nodeOutputs[prevNode][path];
  }

  return undefined;
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  if (!path) {
    return obj;
  }

  const parts = path.split('.');
  let current: Record<string, unknown> | undefined = obj as Record<string, unknown>;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part] as Record<string, unknown> | undefined;
  }
  return current;
}

/**
 * Evaluates an edge condition against the execution context
 */
export function evaluateCondition(
  condition: EdgeCondition | undefined,
  sourceNodeState: NodeExecutionState | undefined,
  context: EvaluationContext
): boolean {
  if (!condition || condition.type === 'always') {
    return true;
  }

  if (condition.type === 'on_success') {
    return sourceNodeState ? sourceNodeState.status === 'completed' : true;
  }

  if (condition.type === 'on_failure') {
    return sourceNodeState ? sourceNodeState.status === 'failed' : false;
  }

  if (condition.type === 'predicate' || condition.type === 'expression') {
    if (condition.customFn && typeof condition.customFn === 'function') {
      try {
        return Boolean(condition.customFn(context));
      } catch {
        return false;
      }
    }

    if (condition.field && condition.operator) {
      const actualValue = resolveValue(condition.field, context);
      const expectedValue = condition.value;

      switch (condition.operator) {
        case 'equals':
          return actualValue === expectedValue;
        case 'not_equals':
          return actualValue !== expectedValue;
        case 'contains':
          if (Array.isArray(actualValue)) {
            return actualValue.includes(expectedValue);
          }
          if (typeof actualValue === 'string') {
            return actualValue.includes(String(expectedValue));
          }
          return false;
        case 'greater_than':
          return (
            typeof actualValue === 'number' &&
            typeof expectedValue === 'number' &&
            actualValue > expectedValue
          );
        case 'less_than':
          return (
            typeof actualValue === 'number' &&
            typeof expectedValue === 'number' &&
            actualValue < expectedValue
          );
        case 'exists':
          return actualValue !== undefined && actualValue !== null;
        case 'truthy':
          return Boolean(actualValue);
        case 'falsy':
          return !actualValue;
        default:
          return false;
      }
    }

    // Basic safe string expression evaluator (e.g. "status == 'completed'", "score >= 80")
    if (condition.expression) {
      return evaluateSimpleExpression(condition.expression, context);
    }
  }

  return true;
}

/**
 * Evaluates basic expression strings safely without using arbitrary eval()
 */
export function evaluateSimpleExpression(expression: string, context: EvaluationContext): boolean {
  const trimmed = expression.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }

  // Comparison operators: ==, !=, >=, <=, >, <
  const compRegex = /^([a-zA-Z0-9_$.\-_]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
  const match = trimmed.match(compRegex);
  if (match) {
    const leftPath = match[1];
    const op = match[2];
    const rightRaw = match[3].trim();

    const leftVal = resolveValue(leftPath, context);
    let rightVal: unknown;

    if (rightRaw === 'true') {
      rightVal = true;
    } else if (rightRaw === 'false') {
      rightVal = false;
    } else if (rightRaw === 'null') {
      rightVal = null;
    } else if (rightRaw === 'undefined') {
      rightVal = undefined;
    } else if (
      (rightRaw.startsWith("'") && rightRaw.endsWith("'")) ||
      (rightRaw.startsWith('"') && rightRaw.endsWith('"'))
    ) {
      rightVal = rightRaw.slice(1, -1);
    } else if (!isNaN(Number(rightRaw))) {
      rightVal = Number(rightRaw);
    } else {
      rightVal = resolveValue(rightRaw, context);
    }

    switch (op) {
      case '==':
        return String(leftVal) === String(rightVal);
      case '!=':
        return String(leftVal) !== String(rightVal);
      case '>=':
        return Number(leftVal) >= Number(rightVal);
      case '<=':
        return Number(leftVal) <= Number(rightVal);
      case '>':
        return Number(leftVal) > Number(rightVal);
      case '<':
        return Number(leftVal) < Number(rightVal);
    }
  }

  // Boolean variable presence check
  const val = resolveValue(trimmed, context);
  return Boolean(val);
}

/**
 * Given a completed source node, returns the list of outgoing edges whose conditions evaluate to true.
 */
export function getActiveOutgoingEdges(
  graph: GraphDefinition,
  sourceNodeId: string,
  context: EvaluationContext
): EdgeDefinition[] {
  const outgoingEdges = graph.edges.filter((e) => e.from === sourceNodeId);
  const sourceState = context.nodeStates[sourceNodeId];

  return outgoingEdges.filter((edge) => {
    return evaluateCondition(edge.condition, sourceState, {
      ...context,
      previousNodeId: sourceNodeId,
      currentNodeId: edge.to,
    });
  });
}
