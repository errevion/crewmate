import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { WorkflowDefinition, StageDefinition, NodeDefinition } from '../models/graph.js';

/**
 * Resolves a workflow definition from a file or object, automatically expanding
 * any file path references for stages and nodes relative to the referencing file.
 */
export function loadAndResolveWorkflow(
  entry: string | Record<string, unknown>,
  baseDir: string = process.cwd()
): WorkflowDefinition {
  let rawDef: Record<string, unknown>;
  let currentDir = baseDir;

  if (typeof entry === 'string') {
    const fullPath = resolve(baseDir, entry);
    if (!existsSync(fullPath)) {
      throw new Error(`Workflow file not found: ${fullPath}`);
    }
    currentDir = dirname(fullPath);
    rawDef = JSON.parse(readFileSync(fullPath, 'utf-8'));
  } else {
    rawDef = entry;
  }

  const stagesRaw = Array.isArray(rawDef.stages) ? rawDef.stages : [];
  const resolvedStages: StageDefinition[] = stagesRaw.map((stageItem: unknown) => {
    let stageObj: Record<string, unknown>;
    let stageDir = currentDir;

    if (typeof stageItem === 'string') {
      const stagePath = resolve(currentDir, stageItem);
      if (!existsSync(stagePath)) {
        throw new Error(`Stage file not found: ${stagePath}`);
      }
      stageDir = dirname(stagePath);
      stageObj = JSON.parse(readFileSync(stagePath, 'utf-8'));
    } else if (stageItem && typeof stageItem === 'object') {
      stageObj = stageItem as Record<string, unknown>;
    } else {
      throw new Error('Invalid stage entry: expected a file path string or stage object');
    }

    const graphRaw = (
      stageObj.graph && typeof stageObj.graph === 'object' ? stageObj.graph : {}
    ) as Record<string, unknown>;

    const nodesRaw = Array.isArray(graphRaw.nodes) ? graphRaw.nodes : [];
    const resolvedNodes: NodeDefinition[] = nodesRaw.map((nodeItem: unknown) => {
      if (typeof nodeItem === 'string') {
        const nodePath = resolve(stageDir, nodeItem);
        if (!existsSync(nodePath)) {
          throw new Error(`Node file not found: ${nodePath}`);
        }
        return JSON.parse(readFileSync(nodePath, 'utf-8')) as NodeDefinition;
      }
      if (nodeItem && typeof nodeItem === 'object') {
        return nodeItem as NodeDefinition;
      }
      throw new Error('Invalid node entry: expected a file path string or node object');
    });

    return {
      ...stageObj,
      graph: {
        ...graphRaw,
        nodes: resolvedNodes,
        edges: Array.isArray(graphRaw.edges) ? graphRaw.edges : [],
      },
    } as StageDefinition;
  });

  return {
    ...rawDef,
    stages: resolvedStages,
  } as WorkflowDefinition;
}
