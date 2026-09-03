import type { NodeDefinition } from '../../../../models/graph.js';

export const executorRunNode: NodeDefinition<'agent'> = {
  id: 'executor-run',
  name: 'Executor Implementation',
  type: 'agent',
  config: {
    agent: 'executor',
    prompt:
      'Coordinate Executor subagents across the task DAG. Query crewmate_list_tasks to dispatch unblocked pending tasks in parallel under file locks. Monitor execution, verify tests pass, and confirm artifact compliance before tasks complete. This step is complete when all tasks reach completed status.',
    allowedTools: [
      'read',
      'glob',
      'grep',
      'edit',
      'write',
      'bash',
      'crewmate_update_task',
      'crewmate_show_brief',
      'crewmate_get_field',
      'crewmate_acquire_lock',
      'crewmate_release_lock',
      'crewmate_list_locks',
      'crewmate_add_artifact',
      'crewmate_list_artifacts',
      'crewmate_list_tasks',
      'crewmate_add_event',
      'crewmate_list_events',
    ],
  },
};
