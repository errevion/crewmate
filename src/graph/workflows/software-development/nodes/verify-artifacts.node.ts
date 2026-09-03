import type { NodeDefinition } from '../../../../models/graph.js';

export const verifyArtifactsNode: NodeDefinition<'condition'> = {
  id: 'verify-artifacts',
  name: 'Artifact Compliance Verification',
  type: 'condition',
  config: {
    field: 'compliancePassed',
    operator: 'truthy',
  },
};
