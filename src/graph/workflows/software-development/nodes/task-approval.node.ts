import type { NodeDefinition } from '../../../../models/graph.js';

export const taskApprovalNode: NodeDefinition<'agent'> = {
  id: 'task-approval',
  name: 'Task Plan Approval & Persistence',
  type: 'agent',
  config: {
    agent: 'frontman',
    prompt:
      'Present the task plan from the Planner step as a markdown table in the chat feed. Double-check with the user for task approval via the question tool. If the user requests modifications, address their feedback. Once approved by the user, persist every approved task into the database using crewmate_add_task in dependency order (creating prerequisite tasks first, obtaining their task IDs, and passing them to dependent tasks). Verify with crewmate_list_tasks that tasks appear in the database so they are visible in crewmate watch. Advance to execution only after all tasks are approved and persisted.',
    allowedTools: [
      'crewmate_add_task',
      'crewmate_list_tasks',
      'crewmate_update_task',
      'crewmate_remove_task',
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
