import type { NodeDefinition } from '../../../../models/graph.js';

export const validateBriefNode: NodeDefinition<'condition'> = {
  id: 'validate-brief',
  name: 'Validate Brief Completeness',
  type: 'condition',
  config: {
    field: 'isComplete',
    operator: 'truthy',
  },
};
