import type { NodeDefinition } from '../../../../models/graph.js';

export const frontmanInterviewNode: NodeDefinition<'agent'> = {
  id: 'frontman-interview',
  name: 'Frontman Requirements Interview',
  type: 'agent',
  config: {
    agent: 'frontman',
    prompt:
      'Interactively interview the user to elicit and persist brief fields (workType, goal, scope, functionalRequirements, acceptanceCriteria). Use the question tool for decisions and persist fields via crewmate_update_field. This step is complete when crewmate_check_status reports complete and the brief is finalized with crewmate_finish_brief.',
    allowedTools: [
      'crewmate_create_brief',
      'crewmate_update_field',
      'crewmate_unset_field',
      'crewmate_get_field',
      'crewmate_show_brief',
      'crewmate_check_status',
      'crewmate_finish_brief',
      'crewmate_reopen_brief',
      'crewmate_delete_brief',
      'crewmate_set_activity',
      'crewmate_get_activity',
      'crewmate_workflow_status',
      'crewmate_workflow_advance',
      'crewmate_add_task',
      'crewmate_list_tasks',
      'crewmate_remove_task',
      'crewmate_list_artifacts',
      'crewmate_add_event',
      'crewmate_list_events',
      'question',
      'task',
    ],
    deniedTools: ['bash', 'edit', 'write', 'crewmate_acquire_lock'],
  },
};
