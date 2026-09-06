import type { GraphDefinition } from '../models/graph.js';
import type { EditorPosition, NodeLayout } from './state.js';

/**
 *
 */
export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalSpacing?: number;
  verticalSpacing?: number;
  startX?: number;
  startY?: number;
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  nodeWidth: 26,
  nodeHeight: 4,
  horizontalSpacing: 10,
  verticalSpacing: 3,
  startX: 4,
  startY: 6, // Provide room at the top for back-edge routing tracks
};

/**
 * Computes 2D grid coordinates for every node in a graph.
 * Uses topological layering for nodes without explicit manual positions,
 * and preserves manual user overrides if provided.
 */
export function computeGraphLayout(
  graph: GraphDefinition,
  manualPositions: Map<string, EditorPosition> = new Map(),
  customOptions?: LayoutOptions
): {
  layouts: Map<string, NodeLayout>;
  canvasWidth: number;
  canvasHeight: number;
} {
  const opts = { ...DEFAULT_OPTIONS, ...customOptions };
  const layouts = new Map<string, NodeLayout>();
  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length === 0) {
    return { layouts, canvasWidth: 80, canvasHeight: 25 };
  }

  // 1. Build adjacency graph
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }

  for (const e of edges) {
    const outList = outgoing.get(e.from);
    if (outList) {
      outList.push(e.to);
    }
    const inList = incoming.get(e.to);
    if (inList) {
      inList.push(e.from);
    }
  }

  // 2. Identify layers via BFS / longest path from roots
  const layers = new Map<string, number>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    inDegree.set(n.id, incoming.get(n.id)?.length || 0);
  }

  // Nodes with no incoming edges are layer 0
  const roots = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id);
  const queue: string[] = roots.length > 0 ? [...roots] : [nodes[0].id];

  for (const r of queue) {
    layers.set(r, 0);
  }

  // Topological assignment of layer numbers (handles DAGs, breaks cycles safely)
  const visited = new Set<string>();
  const cycleSafeLimit = nodes.length * 3;
  let iterations = 0;

  while (queue.length > 0 && iterations < cycleSafeLimit) {
    iterations++;
    const curr = queue.shift();
    if (!curr) {
      continue;
    }
    const currLayer = layers.get(curr) || 0;
    const nextNodes = outgoing.get(curr) || [];

    for (const next of nextNodes) {
      const existingLayer = layers.get(next) ?? -1;
      const targetLayer = Math.max(existingLayer, currLayer + 1);
      layers.set(next, targetLayer);

      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  // Assign layer 0 to any remaining disconnected nodes
  for (const n of nodes) {
    if (!layers.has(n.id)) {
      layers.set(n.id, 0);
    }
  }

  // 3. Group nodes by layer
  const layerBuckets = new Map<number, string[]>();
  for (const [id, layer] of layers.entries()) {
    const bucket = layerBuckets.get(layer) || [];
    bucket.push(id);
    layerBuckets.set(layer, bucket);
  }

  // 4. Calculate coordinates
  let maxX = 0;
  let maxY = 0;

  const sortedLayerKeys = Array.from(layerBuckets.keys()).sort((a, b) => a - b);

  for (const layer of sortedLayerKeys) {
    const nodeIds = layerBuckets.get(layer) || [];
    for (let row = 0; row < nodeIds.length; row++) {
      const id = nodeIds[row];

      // Check if user manually dragged / positioned this node
      const manual = manualPositions.get(id);

      let x: number;
      let y: number;

      if (manual) {
        x = manual.x;
        y = manual.y;
      } else {
        x = opts.startX + layer * (opts.nodeWidth + opts.horizontalSpacing);
        y = opts.startY + row * (opts.nodeHeight + opts.verticalSpacing);
      }

      layouts.set(id, {
        id,
        x,
        y,
        width: opts.nodeWidth,
        height: opts.nodeHeight,
      });

      maxX = Math.max(maxX, x + opts.nodeWidth);
      maxY = Math.max(maxY, y + opts.nodeHeight);
    }
  }

  return {
    layouts,
    canvasWidth: Math.max(80, maxX + 10),
    canvasHeight: Math.max(25, maxY + 8),
  };
}
