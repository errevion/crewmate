import type { StageDefinition } from '../../../../models/graph.js';
import { frontmanInterviewNode } from '../nodes/frontman-interview.node.js';
import { validateBriefNode } from '../nodes/validate-brief.node.js';

export const discussionStage: StageDefinition = {
  id: 'discussion',
  name: 'Discussion',
  description: 'Requirements elicitation and brief completion with the Frontman agent.',
  graph: {
    id: 'discussion-graph',
    nodes: [frontmanInterviewNode, validateBriefNode],
    edges: [
      {
        from: frontmanInterviewNode.id,
        to: validateBriefNode.id,
        condition: { type: 'on_success' },
      },
    ],
  },
};
