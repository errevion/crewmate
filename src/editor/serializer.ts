import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WorkflowDefinition } from '../models/graph.js';
import { validateWorkflow } from '../graph/validator.js';

/**
 *
 */
export interface SerializationResult {
  success: boolean;
  filesWritten: string[];
  error?: string;
}

/**
 * Serializes the current workflow into modular JSON files
 * matching the standard Crewmate architecture:
 * .crewmate/workflows/
 *   ├── default.json (or workflow-name.json)
 *   ├── stages/
 *   │     ├── stage1.json
 *   │     └── stage2.json
 *   └── nodes/
 *         ├── nodeA.json
 *         └── nodeB.json
 */
export function serializeWorkflowToModularFiles(
  workflow: WorkflowDefinition,
  targetDir: string = resolve(process.cwd(), '.crewmate/workflows')
): SerializationResult {
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    const errorMsgs = validation.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
    return {
      success: false,
      filesWritten: [],
      error: `Workflow validation failed:\n${errorMsgs}`,
    };
  }

  const filesWritten: string[] = [];
  const stagesDir = join(targetDir, 'stages');
  const nodesDir = join(targetDir, 'nodes');

  try {
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(stagesDir, { recursive: true });
    mkdirSync(nodesDir, { recursive: true });

    const stageFilePaths: string[] = [];

    for (const stage of workflow.stages) {
      const stageGraph = stage.graph || { nodes: [], edges: [] };
      const nodeFilePaths: string[] = [];

      // Write each node as modular JSON
      for (const node of stageGraph.nodes) {
        const nodeFilename = `${node.id}.json`;
        const nodeFilePath = join(nodesDir, nodeFilename);
        writeFileSync(nodeFilePath, JSON.stringify(node, null, 2) + '\n', 'utf-8');
        filesWritten.push(nodeFilePath);
        nodeFilePaths.push(`../nodes/${nodeFilename}`);
      }

      // Write stage JSON referencing relative node paths
      const stageDefToSave = {
        id: stage.id,
        name: stage.name,
        description: stage.description,
        graph: {
          id: stageGraph.id || `${stage.id}-graph`,
          nodes: nodeFilePaths,
          edges: stageGraph.edges || [],
        },
      };

      const stageFilename = `${stage.id}.json`;
      const stageFilePath = join(stagesDir, stageFilename);
      writeFileSync(stageFilePath, JSON.stringify(stageDefToSave, null, 2) + '\n', 'utf-8');
      filesWritten.push(stageFilePath);
      stageFilePaths.push(`./stages/${stageFilename}`);
    }

    // Write root workflow JSON
    const rootDef = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version || '1.0.0',
      metadata: workflow.metadata || {},
      stages: stageFilePaths,
    };

    const rootFilePath = join(targetDir, 'default.json');
    writeFileSync(rootFilePath, JSON.stringify(rootDef, null, 2) + '\n', 'utf-8');
    filesWritten.push(rootFilePath);

    return {
      success: true,
      filesWritten,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      filesWritten,
      error: `Failed to write files: ${message}`,
    };
  }
}
