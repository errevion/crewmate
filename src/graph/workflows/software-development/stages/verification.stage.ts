import type { StageDefinition } from '../../../../models/graph.js';
import { verifyArtifactsNode } from '../nodes/verify-artifacts.node.js';

export const verificationStage: StageDefinition = {
  id: 'verification',
  name: 'Verification',
  description: 'Final quality checks, test verification, and artifact review.',
  graph: {
    id: 'verification-graph',
    nodes: [verifyArtifactsNode],
    edges: [],
  },
};
