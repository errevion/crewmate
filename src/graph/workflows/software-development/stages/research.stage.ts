import type { StageDefinition } from '../../../../models/graph.js';
import { scoutApprovalNode } from '../nodes/scout-approval.node.js';
import { scoutExploreNode } from '../nodes/scout-explore.node.js';

export const researchStage: StageDefinition = {
  id: 'research',
  name: 'Research & Discovery',
  description: 'Scout codebase exploration and architecture discovery.',
  graph: {
    id: 'research-graph',
    nodes: [scoutApprovalNode, scoutExploreNode],
    edges: [
      {
        from: scoutApprovalNode.id,
        to: scoutExploreNode.id,
        condition: { type: 'predicate', field: 'approved', operator: 'truthy' },
      },
    ],
  },
};
