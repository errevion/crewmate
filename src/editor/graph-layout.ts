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
  horizontalSpacing: 16,
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

  // 2. Identify layers via multi-component BFS
  const layers = new Map<string, number>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    inDegree.set(n.id, incoming.get(n.id)?.length || 0);
  }

  const visited = new Set<string>();

  // Helper to run BFS from a set of starting nodes
  function runBFS(startNodes: string[], startLayer: number): void {
    const queue: string[] = [];
    for (const id of startNodes) {
      if (!layers.has(id)) {
        layers.set(id, startLayer);
        queue.push(id);
      }
    }

    const cycleSafeLimit = nodes.length * 4;
    let iterations = 0;

    while (queue.length > 0 && iterations < cycleSafeLimit) {
      iterations++;
      const curr = queue.shift();
      if (!curr) {
        continue;
      }
      visited.add(curr);
      const currLayer = layers.get(curr) || 0;
      const nextNodes = outgoing.get(curr) || [];

      for (const next of nextNodes) {
        if (visited.has(next)) {
          continue; // Back-edge in a cycle: do not push already-layered ancestor forward
        }
        const existingLayer = layers.get(next) ?? -1;
        const targetLayer = Math.max(existingLayer, currLayer + 1);
        layers.set(next, targetLayer);

        visited.add(next);
        queue.push(next);
      }
    }
  }

  // Priority 1: Explicit entryNodeIds if specified
  if (graph.entryNodeIds && graph.entryNodeIds.length > 0) {
    const validEntries = graph.entryNodeIds.filter((id) => nodes.some((n) => n.id === id));
    if (validEntries.length > 0) {
      runBFS(validEntries, 0);
    }
  }

  // Priority 2: True workflow roots (nodes with 0 incoming edges that DO have outgoing edges)
  const trueRoots = nodes
    .filter((n) => (inDegree.get(n.id) || 0) === 0 && (outgoing.get(n.id)?.length || 0) > 0)
    .map((n) => n.id);
  if (trueRoots.length > 0) {
    runBFS(trueRoots, 0);
  }

  // Priority 3: Any unvisited connected components (e.g. cycles where all nodes have inDegree > 0)
  while (true) {
    const unvisitedWithEdges = nodes.filter(
      (n) =>
        !visited.has(n.id) &&
        ((incoming.get(n.id)?.length || 0) > 0 || (outgoing.get(n.id)?.length || 0) > 0)
    );
    if (unvisitedWithEdges.length === 0) {
      break;
    }

    // Pick best candidate root for this component: prefer node with least incoming edges, then most outgoing, then original node index
    unvisitedWithEdges.sort((a, b) => {
      const aIn = incoming.get(a.id)?.length || 0;
      const bIn = incoming.get(b.id)?.length || 0;
      if (aIn !== bIn) {
        return aIn - bIn;
      }
      const aOut = outgoing.get(a.id)?.length || 0;
      const bOut = outgoing.get(b.id)?.length || 0;
      if (aOut !== bOut) {
        return bOut - aOut;
      }
      return nodes.indexOf(a) - nodes.indexOf(b);
    });

    runBFS([unvisitedWithEdges[0].id], 0);
  }

  // Priority 4: Completely orphaned nodes (0 incoming AND 0 outgoing edges)
  // Assign them to layer 0, but they will be sorted after connected nodes
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

  // Sort nodes within each layer so connected workflow nodes appear in top rows,
  // and orphaned nodes appear below them in lower rows
  for (const layer of layerBuckets.keys()) {
    const bucket = layerBuckets.get(layer) || [];
    bucket.sort((a, b) => {
      const aHasEdges = (incoming.get(a)?.length || 0) > 0 || (outgoing.get(a)?.length || 0) > 0;
      const bHasEdges = (incoming.get(b)?.length || 0) > 0 || (outgoing.get(b)?.length || 0) > 0;
      if (aHasEdges && !bHasEdges) {
        return -1;
      }
      if (!aHasEdges && bHasEdges) {
        return 1;
      }
      return 0;
    });
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
