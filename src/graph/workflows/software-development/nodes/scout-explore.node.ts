import type { NodeDefinition } from '../../../../models/graph.js';

export const scoutExploreNode: NodeDefinition<'agent'> = {
  id: 'scout-explore',
  name: 'Scout Codebase Exploration',
  type: 'agent',
  config: {
    agent: 'scout',
    prompt:
      'Dispatch Scout to explore repository structure, manifests, configs, and existing conventions. Scout records objective discoveries as fact and constraint artifacts via crewmate_add_artifact. This step is complete when Scout returns its report and Frontman presents findings to the user.',
    allowedTools: [
      'read',
      'glob',
      'grep',
      'webfetch',
      'crewmate_add_artifact',
      'crewmate_add_event',
    ],
    deniedTools: ['edit', 'write', 'bash'],
  },
};
