import type { StageDefinition } from '../../../../models/graph.js';
import { plannerDecomposeNode } from '../nodes/planner-decompose.node.js';
import { taskApprovalNode } from '../nodes/task-approval.node.js';

export const planningStage: StageDefinition = {
  id: 'planning',
  name: 'Planning',
  description: 'Planner task decomposition into DAG with artifact requirements.',
  graph: {
    id: 'planning-graph',
    nodes: [plannerDecomposeNode, taskApprovalNode],
    edges: [
      {
        from: plannerDecomposeNode.id,
        to: taskApprovalNode.id,
        condition: { type: 'on_success' },
      },
    ],
  },
};
