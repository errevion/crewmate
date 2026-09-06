import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NodeDefinition } from '../models/graph.js';
import type { DiscoveredNode } from './state.js';

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
            // Even if slightly invalid, we allow discovered nodes if they have at least id and type
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
