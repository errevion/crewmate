import type { StageDefinition } from '../../../../models/graph.js';
import { executorRunNode } from '../nodes/executor-run.node.js';

export const executionStage: StageDefinition = {
  id: 'execution',
  name: 'Execution',
  description: 'Executor agents implementing tasks with locking and knowledge recording.',
  graph: {
    id: 'execution-graph',
    nodes: [executorRunNode],
    edges: [],
  },
};
