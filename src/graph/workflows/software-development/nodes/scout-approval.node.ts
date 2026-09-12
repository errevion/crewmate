import type { NodeDefinition } from '../../../../models/graph.js';

export const scoutApprovalNode: NodeDefinition<'agent'> = {
  id: 'scout-approval',
  name: 'Scout Exploration Approval',
  type: 'agent',
  config: {
    agent: 'frontman',
    prompt:
      'Ask the user with the question tool whether Scout exploration is needed to gather codebase context and architectural conventions. If approved (e.g. for existing repositories), advance to the next node with output { "approved": true }. If the user declines (e.g. for greenfield or brand new projects), advance with output { "approved": false } to skip codebase exploration and proceed to planning.',
    allowedTools: [
      'question',
      'crewmate_set_activity',
      'crewmate_get_activity',
      'crewmate_workflow_status',
      'crewmate_workflow_advance_node',
      'crewmate_show_brief',
      'crewmate_get_field',
      'crewmate_list_artifacts',
      'crewmate_add_event',
      'crewmate_list_events',
    ],
    deniedTools: ['bash', 'edit', 'write', 'crewmate_acquire_lock'],
  },
};
