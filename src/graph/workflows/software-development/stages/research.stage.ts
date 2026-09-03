import type { StageDefinition } from '../../../../models/graph.js';
import { scoutExploreNode } from '../nodes/scout-explore.node.js';

export const researchStage: StageDefinition = {
  id: 'research',
  name: 'Research & Discovery',
  description: 'Scout codebase exploration and architecture discovery.',
  graph: {
    id: 'research-graph',
    nodes: [scoutExploreNode],
    edges: [],
  },
};
