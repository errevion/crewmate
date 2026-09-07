import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { NodeDefinition, StageDefinition } from '../models/graph.js';
import type { DiscoveredNode, DiscoveredStage } from './state.js';

/**
 * Searches directories for existing node JSON definitions.
 * Looks in:
 * 1. .crewmate/workflows/nodes/
 * 2. Any additional custom paths provided
 */
export function discoverNodesInDirectory(
  baseDir: string = process.cwd(),
  searchSubdirs: string[] = ['.crewmate/workflows/nodes', 'workflows/nodes']
): DiscoveredNode[] {
  const discovered: DiscoveredNode[] = [];
  const visitedPaths = new Set<string>();

  for (const subdir of searchSubdirs) {
    const fullPath = resolve(baseDir, subdir);
    if (!existsSync(fullPath)) {
      continue;
    }

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const filePath = join(fullPath, entry.name);
          if (visitedPaths.has(filePath)) {
            continue;
          }
          visitedPaths.add(filePath);

          try {
            const content = readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object' && parsed.id && parsed.type) {
              discovered.push({
                filePath,
                fileName: entry.name,
                node: parsed as NodeDefinition,
              });
            }
          } catch {
            // Ignore unparseable files
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  return discovered;
}

/**
 * Searches directories for existing stage JSON definitions.
 * Looks in:
 * 1. .crewmate/workflows/stages/
 * 2. Any additional custom paths provided
 */
export function discoverStagesInDirectory(
  baseDir: string = process.cwd(),
  searchSubdirs: string[] = ['.crewmate/workflows/stages', 'workflows/stages']
): DiscoveredStage[] {
  const discovered: DiscoveredStage[] = [];
  const visitedPaths = new Set<string>();

  for (const subdir of searchSubdirs) {
    const fullPath = resolve(baseDir, subdir);
    if (!existsSync(fullPath)) {
      continue;
    }

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const filePath = join(fullPath, entry.name);
          if (visitedPaths.has(filePath)) {
            continue;
          }
          visitedPaths.add(filePath);

          try {
            const content = readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content) as Record<string, unknown>;

            if (parsed && typeof parsed === 'object' && parsed.id && parsed.name) {
              const stageDir = dirname(filePath);
              const graphRaw = (
                parsed.graph && typeof parsed.graph === 'object' ? parsed.graph : {}
              ) as Record<string, unknown>;

              // Resolve relative node file paths if present
              const nodesRaw = Array.isArray(graphRaw.nodes) ? graphRaw.nodes : [];
              const resolvedNodes: NodeDefinition[] = [];

              for (const nodeItem of nodesRaw) {
                if (typeof nodeItem === 'string') {
                  const nodePath = resolve(stageDir, nodeItem);
                  if (existsSync(nodePath)) {
                    try {
                      const nodeParsed = JSON.parse(readFileSync(nodePath, 'utf-8'));
                      if (nodeParsed && typeof nodeParsed === 'object' && nodeParsed.id) {
                        resolvedNodes.push(nodeParsed as NodeDefinition);
                      }
                    } catch {
                      // Ignore unparseable node
                    }
                  }
                } else if (
                  nodeItem &&
                  typeof nodeItem === 'object' &&
                  (nodeItem as NodeDefinition).id
                ) {
                  resolvedNodes.push(nodeItem as NodeDefinition);
                }
              }

              const resolvedStage: StageDefinition = {
                id: String(parsed.id),
                name: String(parsed.name),
                description: parsed.description ? String(parsed.description) : undefined,
                graph: {
                  id: graphRaw.id ? String(graphRaw.id) : `${String(parsed.id)}-graph`,
                  nodes: resolvedNodes,
                  edges: Array.isArray(graphRaw.edges)
                    ? (graphRaw.edges as StageDefinition['graph']['edges'])
                    : [],
                },
              };

              discovered.push({
                filePath,
                fileName: entry.name,
                stage: resolvedStage,
              });
            }
          } catch {
            // Ignore unparseable stage files
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  return discovered;
}
