---
description: Execute approved implementation tasks with parallel safety
agent: frontman
---

The user wants to execute approved implementation tasks for the project brief. Use the crewmate tools and Executor subagents to implement tasks with dependency ordering and parallel safety.

## Execution Instructions

1. Retrieve the latest brief and its tasks using `crewmate_list_tasks` (and `crewmate_show_brief` if needed).
   - If no tasks exist or all tasks are already `completed`, inform the user and show status.
2. Execute continuously across batches without asking for user confirmation per task batch:
   - Identify all `pending` tasks whose dependencies are already `completed` (or tasks with no dependencies).
   - Check active file locks via `crewmate_list_locks` to ensure no conflicting resources.
   - Dispatch **Executor** subagent(s) via the `task` tool with task details, ID, and brief context.
   - Independent tasks (different dependencies and non-overlapping target files) can be dispatched concurrently in parallel.
3. Handle problems and progress:
   - **Errors / Test Failures**: If an Executor reports an error or test failure, immediately stop/pause that task, inform the user, and ask how to proceed using the `question` tool.
   - **Lock Conflicts**: If an Executor reports a temporary file lock conflict, leave that task `pending` and re-dispatch it once the conflicting task finishes and releases its lock. If a conflict cannot be resolved automatically, escalate to the user.
   - **Success**: When an Executor completes, log its artifacts via `crewmate_list_artifacts` and proceed directly to dispatch newly unblocked tasks.
4. Continue the loop automatically until all tasks in the brief reach `completed` status (or until blocked by an unresolved error).
5. Present a final execution summary once all tasks are completed:
   - List of all completed tasks.
   - Key architectural decisions, API contracts, and constraints recorded during execution (`crewmate_list_artifacts`).
   - Any manual verification instructions for the user.

The user execution arguments/options: $ARGUMENTS
