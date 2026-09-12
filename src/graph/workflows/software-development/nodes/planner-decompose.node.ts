import type { NodeDefinition } from '../../../../models/graph.js';

export const plannerDecomposeNode: NodeDefinition<'agent'> = {
  id: 'planner-decompose',
  name: 'Planner Task Decomposition',
  type: 'agent',
  config: {
    agent: 'planner',
    prompt:
      'Dispatch Planner to analyze the completed brief and artifacts, decomposing the work into dependency-ordered tasks with artifact requirements. Planner outputs a structured task breakdown for user review and persistence in the next step.',
    allowedTools: [
      'read',
      'glob',
      'grep',
      'crewmate_show_brief',
      'crewmate_get_field',
      'crewmate_list_artifacts',
      'crewmate_add_artifact',
      'crewmate_add_event',
    ],
    deniedTools: ['edit', 'write', 'bash'],
  },
};
