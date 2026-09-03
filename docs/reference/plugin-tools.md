# Plugin Tools & APIs Reference

Crewmate exposes integration tools to AI agents running inside OpenCode via `.opencode/plugins/crewmate.ts`. These tools allow agents (Frontman, Scout, Planner, Executor) to manage specification briefs, coordinate DAG tasks, prevent parallel file collisions via pessimistic locking, record incremental knowledge artifacts, emit workflow events, and drive workflow lifecycles.

All plugin tools return standard OpenCode tool execution payloads:

```typescript
{
  title: string;
  output: string; // JSON string payload
}
```

Unless otherwise noted, the `output` string parses to a JSON object with `{ ok: true, ... }` on success or throws an error on failure.

---

## Tool Categories

| Category | Tools | Primary Agents |
| :--- | :--- | :--- |
| [Brief Tools](#brief-tools) | `crewmate_create_brief`, `crewmate_update_field`, `crewmate_get_field`, `crewmate_show_brief`, `crewmate_check_status`, `crewmate_finish_brief`, `crewmate_reopen_brief`, `crewmate_delete_brief` | Frontman, Scout, Planner |
| [Task Tools](#task-tools) | `crewmate_add_task`, `crewmate_list_tasks`, `crewmate_update_task`, `crewmate_remove_task`, `crewmate_clear_tasks` | Planner, Executor, Frontman |
| [Lock Tools](#lock-tools) | `crewmate_acquire_lock`, `crewmate_release_lock`, `crewmate_list_locks`, `crewmate_clear_locks` | Executor |
| [Artifact Tools](#artifact-tools) | `crewmate_add_artifact`, `crewmate_list_artifacts`, `crewmate_supersede_artifact`, `crewmate_invalidate_artifact` | Scout, Planner, Executor, Frontman |
| [Event & Activity Tools](#event--activity-tools) | `crewmate_add_event`, `crewmate_list_events`, `crewmate_set_activity`, `crewmate_get_activity` | Frontman, Scout, Planner, Executor |
| [Workflow Tools](#workflow-tools) | `crewmate_workflow_start`, `crewmate_workflow_status`, `crewmate_workflow_advance`, `crewmate_workflow_skip`, `crewmate_workflow_cancel` | Frontman, Planner |

---

## Brief Tools

### `crewmate_create_brief`

Initializes a new Crewmate brief in SQLite. Call this before setting any project fields.

- **Description**: Create a new crewmate brief. Call this before updating any fields. Returns the brief ID.
- **Parameters**: None (`{}`).
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "c6078a9f"
  }
  ```

---

### `crewmate_update_field`

Updates or sets a field on the current or targeted brief. Values are base64-encoded over the CLI bridge to preserve arbitrary characters, markdown, or nested JSON structures.

- **Description**: Update a field on the current crewmate brief. Any field name is accepted. Value can be a plain string or JSON string.
- **Parameters**:
  - `field` (string, **required**): Field key name (e.g. `workType`, `goal`, `scope`, `functionalRequirements`, `acceptanceCriteria`).
  - `value` (string, **required**): Plain text string or valid JSON string.
  - `id` (string, *optional*): Target brief ID. Defaults to the latest brief.
- **Sample Input**:
  ```json
  {
    "field": "goal",
    "value": "Build a responsive documentation portal using VitePress."
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "field": "goal",
    "value": "Build a responsive documentation portal using VitePress."
  }
  ```

---

### `crewmate_get_field`

Reads a specific field from the brief.

- **Description**: Get a field value from the current crewmate brief.
- **Parameters**:
  - `field` (string, **required**): Field key name to read.
  - `id` (string, *optional*): Target brief ID. Defaults to the latest brief.
- **Sample Input**:
  ```json
  {
    "field": "workType"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "field": "workType",
    "value": "feature"
  }
  ```

---

### `crewmate_show_brief`

Returns the full brief object with all persistent fields and timestamps.

- **Description**: Show the full crewmate brief as JSON, including all fields and their current values.
- **Parameters**:
  - `id` (string, *optional*): Target brief ID. Defaults to the latest brief.
- **Sample Input**:
  ```json
  {
    "id": "c6078a9f"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "brief": {
      "id": "c6078a9f",
      "status": "draft",
      "fields": {
        "workType": "feature",
        "goal": "Build docs portal",
        "scope": "Reference docs only"
      },
      "createdAt": "2026-09-03 18:15:28",
      "updatedAt": "2026-09-03 18:20:10"
    }
  }
  ```

---

### `crewmate_check_status`

Checks brief readiness by inspecting all mandatory fields required before transition to `complete`.

- **Description**: Check the completeness status of the current crewmate brief. Shows which required fields are set vs missing, and whether the brief can be completed.
- **Parameters**:
  - `id` (string, *optional*): Target brief ID. Defaults to latest.
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "status": "draft",
    "complete": false,
    "required": {
      "workType": "set",
      "goal": "set",
      "scope": "set",
      "functionalRequirements": "missing",
      "acceptanceCriteria": "missing"
    }
  }
  ```

---

### `crewmate_finish_brief`

Marks a brief as `complete`. Fails if any required fields are missing.

- **Description**: Mark the crewmate brief as complete. This will fail if required fields are not all set. Call crewmate_check_status first to verify readiness.
- **Parameters**:
  - `id` (string, *optional*): Target brief ID. Defaults to latest.
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "c6078a9f",
    "status": "complete"
  }
  ```

---

### `crewmate_reopen_brief`

Reverts a previously completed brief back to `draft` status so fields can be updated.

- **Description**: Reopen a completed brief back to draft status so fields can be modified.
- **Parameters**:
  - `id` (string, *optional*): Target brief ID. Defaults to latest.
- **Sample Input**:
  ```json
  {
    "id": "c6078a9f"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "c6078a9f",
    "status": "draft"
  }
  ```

---

### `crewmate_delete_brief`

Deletes a brief and cascade-deletes all associated tasks, file locks, artifacts, events, and workflow runs.

- **Description**: Delete a brief and cascade-delete all associated tasks, locks, artifacts, events, and workflow runs.
- **Parameters**:
  - `id` (string, *optional*): Target brief ID. Defaults to latest.
  - `force` (boolean, *optional*): Force deletion even if workflow runs or locks are active.
- **Sample Input**:
  ```json
  {
    "id": "c6078a9f",
    "force": true
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "deletedId": "c6078a9f"
  }
  ```

---

## Task Tools

### `crewmate_add_task`

Creates a new task in the brief's dependency DAG, specifying description, dependencies, and gating requirements.

- **Description**: Add a new task to a brief. REQUIRED: briefId, title, description. Optional: dependencies, field, artifactRequirements.
- **Parameters**:
  - `briefId` (string, **required**): Associated brief ID.
  - `title` (string, **required**): Concise summary of the task.
  - `description` (string, **required**): Detailed implementation specifications.
  - `dependencies` (array of strings, *optional*): Array of predecessor task IDs.
  - `field` (string, *optional*): Brief field requirement addressed by this task.
  - `artifactRequirements` (array of `fact` | `decision` | `api_contract` | `constraint` | `note` | `log`, *optional*): Mandatory artifact categories required before task completion.
- **Sample Input**:
  ```json
  {
    "briefId": "c6078a9f",
    "title": "Write Reference Documentation",
    "description": "Create cli.md, workflow-schema.md, and plugin-tools.md reference files.",
    "dependencies": [],
    "artifactRequirements": ["fact", "decision"]
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "4e76757b",
    "title": "Write Reference Documentation",
    "artifactRequirements": ["fact", "decision"]
  }
  ```

---

### `crewmate_list_tasks`

Returns all tasks associated with a brief, ordered topologically.

- **Description**: List all tasks for a brief. REQUIRED: briefId.
- **Parameters**:
  - `briefId` (string, **required**): The brief ID to list tasks for.
- **Sample Input**:
  ```json
  {
    "briefId": "c6078a9f"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "tasks": [
      {
        "id": "4e76757b",
        "title": "Write Reference Documentation",
        "description": "Create cli.md, workflow-schema.md, and plugin-tools.md reference files.",
        "dependencies": [],
        "status": "in_progress",
        "field": null,
        "artifactRequirements": ["fact", "decision"]
      }
    ]
  }
  ```

---

### `crewmate_update_task`

Updates status, title, description, dependencies, or artifact requirements. Status transitions to `completed` are gated by `artifactRequirements`.

- **Description**: Update a task's status or details. REQUIRED: taskId. Optional: status (`pending` | `in_progress` | `completed`), title, description, field, dependencies, artifactRequirements.
- **Parameters**:
  - `taskId` (string, **required**): The task ID to update.
  - `status` (`pending` | `in_progress` | `completed`, *optional*): New status.
  - `title` (string, *optional*): Updated title.
  - `description` (string, *optional*): Updated description.
  - `field` (string, *optional*): Target brief field.
  - `dependencies` (array of strings, *optional*): Updated dependency task IDs.
  - `artifactRequirements` (array of strings, *optional*): Updated required artifact types.
- **Sample Input**:
  ```json
  {
    "taskId": "4e76757b",
    "status": "completed"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "4e76757b",
    "status": "completed",
    "title": "Write Reference Documentation"
  }
  ```

---

### `crewmate_remove_task`

Removes a task from the DAG. Fails if other active tasks depend on it.

- **Description**: Remove a task from a brief. REQUIRED: taskId.
- **Parameters**:
  - `taskId` (string, **required**): The task ID to remove.
- **Sample Input**:
  ```json
  {
    "taskId": "4e76757b"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "4e76757b"
  }
  ```

---

### `crewmate_clear_tasks`

Removes all tasks associated with a brief.

- **Description**: Clear all tasks associated with a brief.
- **Parameters**:
  - `briefId` (string, *optional*): Target brief ID. Defaults to latest.
- **Sample Input**:
  ```json
  {
    "briefId": "c6078a9f"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "briefId": "c6078a9f",
    "message": "Cleared 3 task(s)"
  }
  ```

---

## Lock Tools

Lock tools provide pessimistic file concurrency control. OpenCode's plugin intercepts file-modifying tools (`edit`, `write`) to guarantee that only the task owning the lock can modify the file.

### `crewmate_acquire_lock`

Acquires exclusive write locks on one or more files for a task.

- **Description**: Acquire write locks on files for a task to prevent collisions during parallel execution. REQUIRED: taskId, files.
- **Parameters**:
  - `taskId` (string, **required**): The task ID acquiring locks.
  - `files` (array of strings, **required**): Relative file paths to lock.
- **Sample Input**:
  ```json
  {
    "taskId": "4e76757b",
    "files": [
      "src/index.ts",
      "package.json"
    ]
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "taskId": "4e76757b",
    "files": [
      "src/index.ts",
      "package.json"
    ]
  }
  ```

---

### `crewmate_release_lock`

Releases file locks held by a task after completion or error.

- **Description**: Release file locks held by a task after execution completes or on failure. REQUIRED: taskId. Optional: files.
- **Parameters**:
  - `taskId` (string, **required**): The task ID releasing locks.
  - `files` (array of strings, *optional*): Specific paths to release. If omitted, releases all locks for the task.
- **Sample Input**:
  ```json
  {
    "taskId": "4e76757b"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "taskId": "4e76757b",
    "released": 2
  }
  ```

---

### `crewmate_list_locks`

Lists all active file leases and expiration times.

- **Description**: List currently held file locks. Optional: taskId.
- **Parameters**:
  - `taskId` (string, *optional*): Filter locks by specific task ID.
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "locks": [
      {
        "id": "7dcb02e6",
        "taskId": "4e76757b",
        "filePath": "src/index.ts",
        "createdAt": "2026-09-03 18:35:15",
        "expiresAt": "2026-09-03 18:44:15"
      }
    ]
  }
  ```

---

### `crewmate_clear_locks`

Force-releases locks for emergency deadlock breaking or crash recovery.

- **Description**: Force release all file locks, or all locks held by a specific task (for crash recovery or deadlocks).
- **Parameters**:
  - `taskId` (string, *optional*): Release only locks held by this task ID. If omitted, releases all system locks.
- **Sample Input**:
  ```json
  {
    "taskId": "4e76757b"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "released": 1
  }
  ```

---

## Artifact Tools

Artifacts persist incremental architectural discoveries, design decisions, API contracts, and operational constraints across tasks.

### `crewmate_add_artifact`

Records a knowledge artifact. Can be linked to a task or recorded at the brief level.

- **Description**: Add an execution artifact / incremental knowledge fact for a task or brief. REQUIRED: type, content. Optional: taskId, briefId, tags.
- **Parameters**:
  - `type` (`fact` | `decision` | `api_contract` | `constraint` | `note` | `log`, **required**): Artifact category.
  - `content` (string, **required**): Plain text description or structured JSON string.
  - `taskId` (string, *optional*): Associated task ID. Omit for brief-level findings.
  - `briefId` (string, *optional*): Associated brief ID.
  - `tags` (array of strings, *optional*): Categorization labels.
- **Sample Input**:
  ```json
  {
    "type": "api_contract",
    "taskId": "4e76757b",
    "content": "{\"signature\":\"export function getDb(): Database.Database\",\"filePath\":\"src/db/connection.ts\"}",
    "tags": ["database", "sqlite"]
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "a1b2c3d4",
    "taskId": "4e76757b",
    "briefId": "c6078a9f",
    "type": "api_contract",
    "content": "{\"signature\":\"export function getDb(): Database.Database\",\"filePath\":\"src/db/connection.ts\"}",
    "status": "active",
    "supersededBy": null,
    "tags": ["database", "sqlite"]
  }
  ```

---

### `crewmate_list_artifacts`

Queries recorded artifacts with optional smart ancestor DAG filtering.

- **Description**: List incremental knowledge artifacts (facts, decisions, api_contracts, constraints). Optional: briefId, taskId, forTask, type, status.
- **Parameters**:
  - `briefId` (string, *optional*): Filter by brief ID.
  - `taskId` (string, *optional*): Filter by specific task ID.
  - `forTask` (string, *optional*): **Smart DAG filter** &mdash; returns relevant ancestor artifacts and brief-level constraints for a task.
  - `type` (`fact` | `decision` | `api_contract` | `constraint` | `note` | `log`, *optional*): Filter by category.
  - `status` (`active` | `superseded` | `invalidated` | `all`, *optional*): Filter by status (default: `active`).
- **Sample Input**:
  ```json
  {
    "forTask": "4e76757b",
    "status": "active"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "artifacts": [
      {
        "id": "a1b2c3d4",
        "taskId": "3d82f10a",
        "briefId": "c6078a9f",
        "type": "api_contract",
        "content": "{\"signature\":\"export function getDb(): Database.Database\",\"filePath\":\"src/db/connection.ts\"}",
        "status": "active",
        "supersededBy": null,
        "tags": ["database", "sqlite"],
        "createdAt": "2026-09-03 18:22:15"
      }
    ]
  }
  ```

---

### `crewmate_supersede_artifact`

Marks an older artifact as superseded by a newer one.

- **Description**: Mark an older artifact as superseded by a newer one.
- **Parameters**:
  - `oldId` (string, **required**): The ID of the obsolete artifact being replaced.
  - `newId` (string, **required**): The ID of the new artifact replacing it.
- **Sample Input**:
  ```json
  {
    "oldId": "a1b2c3d4",
    "newId": "e5f6g7h8"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "supersededId": "a1b2c3d4",
    "byId": "e5f6g7h8"
  }
  ```

---

### `crewmate_invalidate_artifact`

Marks an artifact as invalidated/obsolete without a direct replacement.

- **Description**: Mark an artifact as invalidated / obsolete.
- **Parameters**:
  - `id` (string, **required**): The artifact ID to invalidate.
- **Sample Input**:
  ```json
  {
    "id": "a1b2c3d4"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "a1b2c3d4",
    "status": "invalidated"
  }
  ```

---

## Event & Activity Tools

These tools pipe live observability events into the interactive terminal dashboard (`crewmate watch`).

### `crewmate_add_event`

Records a lifecycle observability event.

- **Description**: Record a workflow lifecycle event for the live watch dashboard. REQUIRED: actor, type, message. Optional: taskId, briefId.
- **Parameters**:
  - `actor` (`frontman` | `scout` | `planner` | `executor`, **required**): Emitting agent.
  - `type` (`dispatched` | `started` | `locked` | `artifact` | `completed` | `error`, **required**): Event category.
  - `message` (string, **required**): Human-readable event description.
  - `taskId` (string, *optional*): Associated task ID.
  - `briefId` (string, *optional*): Associated brief ID.
- **Sample Input**:
  ```json
  {
    "actor": "executor",
    "type": "locked",
    "message": "Locked 2 files for task 4e76757b",
    "taskId": "4e76757b"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "id": "f9e8d7c6",
    "briefId": "c6078a9f",
    "taskId": "4e76757b",
    "actor": "executor",
    "type": "locked",
    "message": "Locked 2 files for task 4e76757b",
    "createdAt": "2026-09-03 18:35:16"
  }
  ```

---

### `crewmate_list_events`

Retrieves recorded lifecycle events.

- **Description**: List workflow lifecycle events (dispatch, start, lock, artifact, completion, error). Optional: briefId, taskId, actor, type, limit.
- **Parameters**:
  - `briefId` (string, *optional*): Filter by brief ID.
  - `taskId` (string, *optional*): Filter by task ID.
  - `actor` (`frontman` | `scout` | `planner` | `executor`, *optional*): Filter by actor.
  - `type` (`dispatched` | `started` | `locked` | `artifact` | `completed` | `error`, *optional*): Filter by event type.
  - `limit` (string, *optional*): Maximum events to return.
- **Sample Input**:
  ```json
  {
    "limit": "10",
    "type": "error"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "events": [
      {
        "id": "f9e8d7c6",
        "briefId": "c6078a9f",
        "taskId": "4e76757b",
        "actor": "executor",
        "type": "error",
        "message": "Lock conflict on src/index.ts",
        "createdAt": "2026-09-03 18:30:00"
      }
    ]
  }
  ```

---

### `crewmate_set_activity`

Sets Frontman's active state for the live watch header and status indicators.

- **Description**: Set Frontman's active state for the live watch dashboard. REQUIRED: activityType. Optional: message, briefId.
- **Parameters**:
  - `activityType` (`questioning` | `awaiting_response` | `analyzing` | `planning` | `orchestrating` | `reviewing` | `idle`, **required**): Current Frontman activity.
  - `message` (string, *optional*): Context description.
  - `briefId` (string, *optional*): Associated brief ID.
- **Sample Input**:
  ```json
  {
    "activityType": "orchestrating",
    "message": "Supervising parallel execution phase"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "activity": {
      "id": "b1c2d3e4",
      "briefId": "c6078a9f",
      "activityType": "orchestrating",
      "message": "Supervising parallel execution phase",
      "metadata": null,
      "startedAt": "2026-09-03 18:36:00",
      "endedAt": null
    }
  }
  ```

---

### `crewmate_get_activity`

Retrieves Frontman's current active activity record.

- **Description**: Get Frontman's current active state. Optional: briefId.
- **Parameters**:
  - `briefId` (string, *optional*): Target brief ID filter.
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "activity": {
      "id": "b1c2d3e4",
      "briefId": "c6078a9f",
      "activityType": "orchestrating",
      "message": "Supervising parallel execution phase",
      "metadata": null,
      "startedAt": "2026-09-03 18:36:00",
      "endedAt": null
    }
  }
  ```

---

## Workflow Tools

### `crewmate_workflow_start`

Initializes and starts a workflow run bound to the specified or active brief. Automatically passes `--agent-summary` to return an agent-optimized view.

- **Description**: Start a graph-based workflow run. Binds to a brief and loads the default or custom workflow.
- **Parameters**:
  - `briefId` (string, *optional*): Target brief ID. Defaults to active brief.
  - `file` (string, *optional*): Path to a custom workflow JSON definition.
  - `context` (string, *optional*): Initial context JSON string.
- **Sample Input**:
  ```json
  {
    "context": "{\"environment\":\"staging\"}"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": "wfr_7a8b9c0d",
      "briefId": "c6078a9f",
      "status": "running",
      "currentStage": "discussion",
      "stageName": "Discussion",
      "stageDescription": "Requirements elicitation and brief completion with the Frontman agent.",
      "startedAt": "2026-09-03T18:40:00.000Z",
      "completedAt": null,
      "activeNodes": [
        {
          "id": "frontman-interview",
          "name": "Frontman Requirements Interview",
          "type": "agent",
          "prompt": "Interactively interview the user...",
          "allowedTools": ["crewmate_update_field", "crewmate_check_status"],
          "deniedTools": ["bash", "edit", "write"]
        }
      ],
      "stages": [
        { "id": "discussion", "name": "Discussion", "status": "running" },
        { "id": "research", "name": "Research & Discovery", "status": "pending" },
        { "id": "planning", "name": "Planning", "status": "pending" },
        { "id": "execution", "name": "Execution", "status": "pending" },
        { "id": "verification", "name": "Verification", "status": "pending" }
      ]
    }
  }
  ```

---

### `crewmate_workflow_status`

Queries the active workflow run status, active nodes, tool gates, and stage status.

- **Description**: Get the active workflow run status, current stage, stages list, and context.
- **Parameters**:
  - `runId` (string, *optional*): Workflow run ID. Defaults to active run.
  - `briefId` (string, *optional*): Target brief ID filter.
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": "wfr_7a8b9c0d",
      "briefId": "c6078a9f",
      "status": "running",
      "currentStage": "planning",
      "stageName": "Planning",
      "stageDescription": "Planner task decomposition into DAG with artifact requirements.",
      "startedAt": "2026-09-03T18:40:00.000Z",
      "completedAt": null,
      "activeNodes": [
        {
          "id": "planner-decompose",
          "name": "Task Decomposition",
          "type": "agent",
          "allowedTools": ["crewmate_add_task", "crewmate_list_tasks"]
        }
      ],
      "stages": [
        { "id": "discussion", "name": "Discussion", "status": "completed" },
        { "id": "research", "name": "Research & Discovery", "status": "completed" },
        { "id": "planning", "name": "Planning", "status": "running" },
        { "id": "execution", "name": "Execution", "status": "pending" },
        { "id": "verification", "name": "Verification", "status": "pending" }
      ]
    }
  }
  ```

---

### `crewmate_workflow_advance`

Completes the current stage and transitions the workflow run to the next sequential stage, merging outputs into context.

- **Description**: Advance the workflow run to the next stage after completing the current stage's work.
- **Parameters**:
  - `runId` (string, *optional*): Workflow run ID. Defaults to active run.
  - `outputs` (string, *optional*): JSON string of outputs/context to merge into execution context downstream.
- **Sample Input**:
  ```json
  {
    "outputs": "{\"planningApproved\":true}"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": "wfr_7a8b9c0d",
      "briefId": "c6078a9f",
      "status": "running",
      "currentStage": "execution",
      "stageName": "Execution",
      "stageDescription": "Executor agents implementing tasks with locking and knowledge recording.",
      "startedAt": "2026-09-03T18:40:00.000Z",
      "completedAt": null,
      "stages": [
        { "id": "discussion", "name": "Discussion", "status": "completed" },
        { "id": "research", "name": "Research & Discovery", "status": "completed" },
        { "id": "planning", "name": "Planning", "status": "completed" },
        { "id": "execution", "name": "Execution", "status": "running" },
        { "id": "verification", "name": "Verification", "status": "pending" }
      ]
    }
  }
  ```

---

### `crewmate_workflow_skip`

Marks a stage as `skipped` and transitions to the subsequent stage.

- **Description**: Skip a stage in the active workflow run and proceed to the next.
- **Parameters**:
  - `stageId` (string, **required**): Stage ID to skip (e.g., `research`).
  - `runId` (string, *optional*): Workflow run ID. Defaults to active run.
- **Sample Input**:
  ```json
  {
    "stageId": "research"
  }
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": "wfr_7a8b9c0d",
      "briefId": "c6078a9f",
      "status": "running",
      "currentStage": "planning",
      "stages": [
        { "id": "discussion", "name": "Discussion", "status": "completed" },
        { "id": "research", "name": "Research & Discovery", "status": "skipped" },
        { "id": "planning", "name": "Planning", "status": "running" }
      ]
    }
  }
  ```

---

### `crewmate_workflow_cancel`

Cancels an active or paused workflow run.

- **Description**: Cancel an active or paused workflow run.
- **Parameters**:
  - `runId` (string, *optional*): Workflow run ID. Defaults to active run.
- **Sample Input**:
  ```json
  {}
  ```
- **Return Schema (`output` JSON)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": "wfr_7a8b9c0d",
      "briefId": "c6078a9f",
      "status": "cancelled",
      "completedAt": "2026-09-03T18:45:00.000Z"
    }
  }
  ```
