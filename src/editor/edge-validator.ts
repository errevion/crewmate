import type { GraphDefinition, EdgeCondition } from '../models/graph.js';

/**
 *
 */
export interface ConnectionValidationResult {
  valid: boolean;
  message?: string;
  isLoop?: boolean;
}

/**
 * Real-time connection and graph validation for the editor.
 * Ensures:
 * 1. Self-loops are prevented unless explicitly intended and configured with loop policy.
 * 2. Dangling connections cannot be created.
 * 3. Duplicate identical edges are rejected.
 * 4. Condition nodes have valid outgoing edge configurations (preventing illogical branches).
 * 5. Cycle detection: flags back-edges so user is alerted of loops.
 */
export function validateConnection(
  graph: GraphDefinition,
  fromId: string,
  toId: string,
  condition?: EdgeCondition
): ConnectionValidationResult {
  // 1. Cannot connect to self unless loop policy explicitly permitted
  if (fromId === toId) {
    return {
      valid: false,
      message:
        'Direct self-loops on a single node are not allowed. Use an intermediate node or loop back-edge.',
    };
  }

  // 2. Both nodes must exist
  const fromNode = graph.nodes.find((n) => n.id === fromId);
  const toNode = graph.nodes.find((n) => n.id === toId);

  if (!fromNode) {
    return { valid: false, message: `Source node "${fromId}" not found in current stage.` };
  }
  if (!toNode) {
    return { valid: false, message: `Target node "${toId}" not found in current stage.` };
  }

  // 3. Duplicate edge check
  const duplicate = graph.edges.some((e) => e.from === fromId && e.to === toId);
  if (duplicate) {
    return { valid: false, message: `An edge between "${fromId}" and "${toId}" already exists.` };
  }

  // 4. Branching & condition checks
  if (fromNode.type === 'condition') {
    // If the source is a condition node, outgoing edges should specify which case/condition they handle
    const outgoingFromCond = graph.edges.filter((e) => e.from === fromId);
    if (outgoingFromCond.length >= 2 && (!condition || condition.type === 'always')) {
      return {
        valid: false,
        message:
          'Condition nodes with multiple branches must use specific conditions (e.g. on_success, on_failure, or expressions), not "always".',
      };
    }
  }

  // 5. Cycle detection (BFS from 'toId' to check if 'fromId' is reachable)
  const isCycle = checkReachable(graph, toId, fromId);

  return {
    valid: true,
    isLoop: isCycle,
    message: isCycle
      ? 'Notice: This connection creates a loop/cycle. Ensure maxIterations is set.'
      : undefined,
  };
}

/**
 * Checks if targetId is reachable from startId in the directed graph
 */
export function checkReachable(graph: GraphDefinition, startId: string, targetId: string): boolean {
  if (startId === targetId) {
    return true;
  }

  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const curr = queue.shift();
    if (!curr) {
      continue;
    }
    if (curr === targetId) {
      return true;
    }

    const outgoing = graph.edges.filter((e) => e.from === curr).map((e) => e.to);
    for (const next of outgoing) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}
