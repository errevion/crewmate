import type { NodeDefinition } from '../../../../models/graph.js';

export const verifyArtifactsNode: NodeDefinition<'tool'> = {
  id: 'verify-artifacts',
  name: 'Artifact Compliance Verification',
  type: 'tool',
  config: {
    tool: 'verifyArtifacts',
    args: {},
  },
};
