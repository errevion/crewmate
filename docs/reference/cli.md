# CLI Commands Reference

The `crewmate` Command-Line Interface (CLI) provides unified orchestration, database persistence, state management, file locking, and workflow inspection for AI agent systems.

All CLI commands return structured machine-readable JSON output on `stdout`. Unless noted otherwise (such as `--json` mode), commands format errors or human-readable summaries before printing the JSON payload, or return direct JSON.

---

## Global Options

The root CLI command accepts the standard version and help flags:

```bash
crewmate --version
crewmate --help
```

- `--version`, `-V`: Output the current version number of Crewmate.
- `--help`, `-h`: Display command overview and usage instructions.

---

## Command Summary

| Command Group | Description |
| :--- | :--- |
| [`crewmate init`](#crewmate-init) | Install harness integration files into a target workspace. |
| [`crewmate update`](#crewmate-update) | Upgrade templates, prompts, agent configs, and plugin tools. |
| [`crewmate brief`](#crewmate-brief) | Manage project specification briefs and lifecycle state. |
| [`crewmate task`](#crewmate-task) | Manage tasks, dependencies (DAG), and completion gates. |
| [`crewmate lock`](#crewmate-lock) | Manage pessimistic file leases and parallel safety locks. |
| [`crewmate artifact`](#crewmate-artifact) | Manage incremental knowledge artifacts and architectural facts. |
| [`crewmate event`](#crewmate-event) | Record and query workflow lifecycle observability events. |
| [`crewmate activity`](#crewmate-activity) | Query and update Frontman live activity states. |
| [`crewmate workflow`](#crewmate-workflow) | Execute, advance, skip, pause, and validate DAG workflows. |
| [`crewmate session`](#crewmate-session) | Maintain harness process liveness and heartbeat tracking. |
| [`crewmate watch`](#crewmate-watch) | Interactive terminal dashboard or single JSON state snapshot. |

---

## `crewmate init`

Installs harness configuration files, subagent prompts, workflow templates, and integration plugins into the workspace.

### Usage

```bash
crewmate init [options]
```

### Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-H, --harness <name>` | Target AI harness (`opencode`). | `opencode` |
| `-d, --dir <path>` | Target directory for scaffolding. | Current working directory |
| `--json` | Output raw JSON only (omits human-readable summary). | `false` |

### JSON Output Example

```json
{
  "ok": true,
  "harness": "opencode",
  "filesWritten": [
    ".opencode/agents/frontman.md",
    ".opencode/agents/scout.md",
    ".opencode/agents/planner.md",
    ".opencode/agents/executor.md",
    ".opencode/plugins/crewmate.ts",
    ".opencode/skills/workflow.md",
    ".crewmate/manifest.json"
  ]
}
```

---

## `crewmate update`

Audits workspace integration files against the installed version of Crewmate, updating prompts, plugins, and dependencies with SHA-256 integrity checks and automatic backups.

### Usage

```bash
crewmate update [options]
```

### Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-H, --harness <name>` | Target AI harness (`opencode`). | `opencode` |
| `-d, --dir <path>` | Workspace root directory. | Current working directory |
| `--dry-run` | Display planned updates without writing files. | `false` |
| `--no-backup` | Skip creating `.bak.<timestamp>` files for modified templates. | `false` |
| `--json` | Output raw JSON only. | `false` |

### JSON Output Example

```json
{
  "ok": true,
  "harness": "opencode",
  "version": "0.3.0",
  "dryRun": false,
  "files": [
    {
      "path": ".opencode/plugins/crewmate.ts",
      "action": "backed_up_and_updated",
      "reason": "Template updated in package; user modifications preserved in backup"
    },
    {
      "path": ".opencode/agents/executor.md",
      "action": "unchanged",
      "reason": "File hash matches current template"
    }
  ],
  "backedUpFiles": [
    ".opencode/plugins/crewmate.ts.bak.1725474629000"
  ],
  "summary": {
    "total": 2,
    "updated": 1,
    "created": 0,
    "unchanged": 1,
    "backedUp": 1
  }
}
```

---

## `crewmate brief`

Manages project briefs, the central anchor entity for tasks, locks, artifacts, and workflow runs.

### Subcommands

#### `brief init`
Create a new brief in `draft` status.

```bash
crewmate brief init
```

```json
{
  "ok": true,
  "id": "c6078a9f"
}
```

#### `brief set <field> <value...>`
Set a key-value field on the brief. Parses string values or JSON structures (objects, arrays, numbers, booleans).

```bash
crewmate brief set goal "Build authentication module" --id c6078a9f
crewmate brief set acceptanceCriteria '["Pass JWT tests", "Emit audit logs"]'
crewmate brief set notes "VGVzdCBzdHJpbmc=" --base64
```

- `<field>`: Field name (e.g., `goal`, `scope`, `functionalRequirements`).
- `<value...>`: Field value string or JSON.
- `--id <briefId>`: Target brief ID (defaults to latest).
- `--base64`: Interpret value as base64-encoded string.

```json
{
  "ok": true,
  "field": "acceptanceCriteria",
  "value": [
    "Pass JWT tests",
    "Emit audit logs"
  ]
}
```

#### `brief get <field>`
Retrieve a single field value from the brief.

```bash
crewmate brief get goal [--id <briefId>]
```

```json
{
  "ok": true,
  "field": "goal",
  "value": "Build authentication module"
}
```

#### `brief show`
Display full brief metadata, timestamp tracking, and all stored fields.

```bash
crewmate brief show [--id <briefId>]
```

```json
{
  "ok": true,
  "brief": {
    "id": "c6078a9f",
    "status": "draft",
    "createdAt": "2026-09-04 10:00:00",
    "updatedAt": "2026-09-04 10:15:00",
    "fields": {
      "workType": "feature",
      "goal": "Build authentication module",
      "scope": "JWT verification and refresh routes"
    }
  }
}
```

#### `brief status`
Evaluate completeness status against required fields.

```bash
crewmate brief status [--id <briefId>] [--required-fields <fields>]
```

- `--required-fields <fields>`: Comma-separated list of required field names.

```json
{
  "ok": true,
  "status": "draft",
  "required": {
    "workType": "set",
    "goal": "set",
    "scope": "set",
    "functionalRequirements": "missing",
    "acceptanceCriteria": "missing"
  },
  "complete": false
}
```

#### `brief complete`
Transition brief status from `draft` to `complete`. Fails if required fields are missing.

```bash
crewmate brief complete [--id <briefId>] [--required-fields <fields>]
```

```json
{
  "ok": true,
  "id": "c6078a9f",
  "status": "complete"
}
```

#### `brief reopen`
Transition brief status from `complete` back to `draft` to permit further updates.

```bash
crewmate brief reopen [--id <briefId>]
```

```json
{
  "ok": true,
  "id": "c6078a9f",
  "status": "draft"
}
```

#### `brief unset <field>`
Delete a specific field from an active draft brief.

```bash
crewmate brief unset <field> [--id <briefId>]
```

```json
{
  "ok": true,
  "id": "c6078a9f",
  "field": "temporaryNotes"
}
```

#### `brief delete [id]`
Delete a brief and cascade-delete all associated tasks, locks, artifacts, events, and workflow runs.

```bash
crewmate brief delete [id] [-f, --force]
```

- `-f, --force`: Delete even if active file locks or uncompleted workflow runs exist.

```json
{
  "ok": true,
  "deletedId": "c6078a9f"
}
```

---

## `crewmate task`

Manages implementation tasks within a brief, defining execution DAG dependencies and gating requirements.

### Subcommands

#### `task add <brief-id>`
Add a new implementation task linked to a brief.

```bash
crewmate task add c6078a9f \
  --title "Implement JWT middleware" \
  --description "Verify Authorization Bearer token header against secret" \
  --dependencies task-1 task-2 \
  --field "functionalRequirements" \
  --artifact-requirements api_contract decision
```

- `<brief-id>`: Target brief identifier.
- `--title <title>`: Required concise summary.
- `--description <description>`: Required detailed implementation steps.
- `--dependencies <deps...>`: Space-delimited task IDs that must complete before this task.
- `--field <field>`: Brief field this task satisfies.
- `--artifact-requirements <reqs...>`: Artifact categories required before completion (`fact`, `decision`, `api_contract`, `constraint`, `note`, `log`).

```json
{
  "ok": true,
  "id": "t7a1f9e2",
  "title": "Implement JWT middleware",
  "artifactRequirements": [
    "api_contract",
    "decision"
  ]
}
```

#### `task list`
List all tasks for a brief.

```bash
crewmate task list --brief <briefId>
```

```json
{
  "ok": true,
  "tasks": [
    {
      "id": "t7a1f9e2",
      "title": "Implement JWT middleware",
      "description": "Verify Authorization Bearer token header against secret",
      "dependencies": [],
      "status": "pending",
      "field": "functionalRequirements",
      "artifactRequirements": [
        "api_contract",
        "decision"
      ]
    }
  ]
}
```

#### `task get <taskId>`
Retrieve detailed task metadata.

```bash
crewmate task get <taskId>
```

```json
{
  "ok": true,
  "task": {
    "id": "t7a1f9e2",
    "briefId": "c6078a9f",
    "title": "Implement JWT middleware",
    "description": "Verify Authorization Bearer token header against secret",
    "dependencies": [],
    "field": "functionalRequirements",
    "artifactRequirements": [
      "api_contract",
      "decision"
    ],
    "status": "pending",
    "createdAt": "2026-09-04 10:20:00",
    "updatedAt": "2026-09-04 10:20:00"
  }
}
```

#### `task update <taskId>`
Update task attributes, lifecycle status, dependencies, or artifact requirements. Transitions to `completed` are gated by artifact compliance checks unless bypassed.

```bash
crewmate task update <taskId> \
  --status in_progress \
  --title "Updated title" \
  --skip-artifact-check
```

- `--status <status>`: `pending`, `in_progress`, or `completed`.
- `--title <title>`: New task title.
- `--description <description>`: New task description.
- `--field <field>`: Brief field addressed.
- `--dependencies <dependencies...>`: New dependency IDs.
- `--artifact-requirements <requirements...>`: Updated requirement types.
- `--skip-artifact-check`: Bypass strict artifact compliance check on completion.

```json
{
  "ok": true,
  "id": "t7a1f9e2",
  "status": "in_progress",
  "title": "Updated title",
  "task": {
    "id": "t7a1f9e2",
    "briefId": "c6078a9f",
    "title": "Updated title",
    "description": "Verify Authorization Bearer token header against secret",
    "dependencies": [],
    "field": "functionalRequirements",
    "artifactRequirements": [
      "api_contract",
      "decision"
    ],
    "status": "in_progress",
    "createdAt": "2026-09-04 10:20:00",
    "updatedAt": "2026-09-04 10:25:00"
  }
}
```

#### `task remove <taskId>`
Delete a single task.

```bash
crewmate task remove <taskId>
```

```json
{
  "ok": true,
  "id": "t7a1f9e2"
}
```

#### `task clear`
Delete all tasks for a brief.

```bash
crewmate task clear [--brief <briefId>]
```

```json
{
  "ok": true,
  "briefId": "c6078a9f",
  "message": "Cleared all tasks for brief c6078a9f"
}
```

---

## `crewmate lock`

Provides atomic, multi-file pessimistic locks to prevent race conditions when multiple executors write to the codebase concurrently.

### Subcommands

#### `lock acquire <task-id>`
Acquire exclusive write locks for a task. Fails atomically if any requested file is currently locked by another task.

```bash
crewmate lock acquire <taskId> --files src/auth.ts src/types.ts
```

- `<task-id>`: Task ID acquiring lock.
- `--files <files...>`: Array of workspace-relative or absolute file paths.

```json
{
  "ok": true,
  "taskId": "t7a1f9e2",
  "files": [
    "src/auth.ts",
    "src/types.ts"
  ]
}
```

*Lock collision error response:*
```json
{
  "ok": false,
  "error": "File already locked by task t1234567: src/auth.ts",
  "conflict": "src/auth.ts",
  "lockedBy": "t1234567"
}
```

#### `lock release <task-id>`
Release locks held by a task upon task completion or failure.

```bash
crewmate lock release <taskId> [--files src/auth.ts]
```

- `<task-id>`: Task ID releasing locks.
- `--files <files...>`: Optional subset of files to release (releases all if omitted).

```json
{
  "ok": true,
  "taskId": "t7a1f9e2",
  "released": 2
}
```

#### `lock list`
List all active file locks across the project.

```bash
crewmate lock list [--task <taskId>]
```

- `--task <taskId>`: Filter locks by specific task ID.

```json
{
  "ok": true,
  "locks": [
    {
      "id": "l9812abc",
      "taskId": "t7a1f9e2",
      "filePath": "src/auth.ts",
      "createdAt": "2026-09-04 10:22:00",
      "expiresAt": "2026-09-04 10:27:00"
    }
  ]
}
```

#### `lock unlock <file-path>`
Force release lock on a specific file path regardless of which task holds it.

```bash
crewmate lock unlock src/auth.ts
```

```json
{
  "ok": true,
  "filePath": "src/auth.ts",
  "released": true
}
```

#### `lock clean-stale`
Purge all expired locks whose 5-minute leases have elapsed without heartbeat renewal.

```bash
crewmate lock clean-stale
```

```json
{
  "ok": true,
  "purged": 1
}
```

#### `lock clear`
Force release all file locks or all locks held by a given task.

```bash
crewmate lock clear [--task <taskId>]
```

```json
{
  "ok": true,
  "released": 4,
  "taskId": "t7a1f9e2"
}
```

---

## `crewmate artifact`

Manages incremental knowledge artifacts, enabling agents to communicate architectural facts, contracts, and constraints across task boundaries.

### Subcommands

#### `artifact add [task-id]`
Record a new knowledge artifact. Can be brief-level (omit `task-id`) or task-specific.

```bash
crewmate artifact add t7a1f9e2 \
  --type api_contract \
  --content '{"signature":"verifyToken(token: string): Claims","filePath":"src/auth.ts"}' \
  --tags auth jwt \
  --brief c6078a9f
```

- `[task-id]`: Optional task ID creating the artifact.
- `--type <type>`: Category (`fact`, `decision`, `api_contract`, `constraint`, `note`, `log`).
- `--content <content>`: Text string or serialized JSON.
- `--base64`: Treat `--content` as base64-encoded string.
- `--brief <briefId>`: Brief ID (defaults to task brief or latest).
- `--tags <tags...>`: Optional tags for indexing.

```json
{
  "ok": true,
  "id": "a451e901",
  "taskId": "t7a1f9e2",
  "briefId": "c6078a9f",
  "type": "api_contract",
  "content": "{\"signature\":\"verifyToken(token: string): Claims\",\"filePath\":\"src/auth.ts\"}",
  "status": "active",
  "supersededBy": null,
  "tags": ["auth", "jwt"]
}
```

#### `artifact list`
Query stored artifacts with filtering. Supports smart DAG ancestry filtering via `--for-task`.

```bash
crewmate artifact list \
  --brief c6078a9f \
  --for-task t7a1f9e2 \
  --type decision \
  --status active
```

- `--brief <briefId>`: Filter by brief ID.
- `--task <taskId>`: Filter by specific author task ID.
- `--for-task <taskId>`: Smart DAG filter: returns upstream ancestor task artifacts and brief-level constraints.
- `--type <type>`: Filter by artifact category.
- `--status <status>`: `active`, `superseded`, `invalidated`, or `all` (default: `active`).

```json
{
  "ok": true,
  "artifacts": [
    {
      "id": "a451e901",
      "taskId": "t7a1f9e2",
      "briefId": "c6078a9f",
      "type": "decision",
      "content": "{\"choice\":\"Use Jose for JWT\",\"rationale\":\"ESM native and zero dependencies\"}",
      "status": "active",
      "supersededBy": null,
      "tags": ["auth"],
      "createdAt": "2026-09-04 10:24:00"
    }
  ]
}
```

#### `artifact get <artifact-id>`
Retrieve a single artifact by its ID.

```bash
crewmate artifact get a451e901
```

```json
{
  "ok": true,
  "artifact": {
    "id": "a451e901",
    "taskId": "t7a1f9e2",
    "briefId": "c6078a9f",
    "type": "decision",
    "content": "{\"choice\":\"Use Jose for JWT\",\"rationale\":\"ESM native and zero dependencies\"}",
    "status": "active",
    "supersededBy": null,
    "tags": ["auth"],
    "createdAt": "2026-09-04 10:24:00"
  }
}
```

#### `artifact supersede <old-id> <new-id>`
Mark an obsolete artifact as superseded by a replacement artifact.

```bash
crewmate artifact supersede a451e901 a8902cd1
```

```json
{
  "ok": true,
  "supersededId": "a451e901",
  "byId": "a8902cd1"
}
```

#### `artifact invalidate <artifact-id>`
Mark an artifact as invalid/obsolete without a direct successor.

```bash
crewmate artifact invalidate a451e901
```

```json
{
  "ok": true,
  "id": "a451e901",
  "status": "invalidated"
}
```

---

## `crewmate event`

Records and lists workflow lifecycle events for live watch visualization and audit logging. Includes automatic semantic deduplication.

### Subcommands

#### `event add`
Emit a lifecycle event.

```bash
crewmate event add \
  --actor executor \
  --type started \
  --message "Executor-1 began task t7a1f9e2" \
  --task t7a1f9e2 \
  --brief c6078a9f
```

- `--actor <actor>`: Emitting agent (`frontman`, `scout`, `planner`, `executor`).
- `--type <type>`: Event category (`dispatched`, `started`, `locked`, `artifact`, `completed`, `error`).
- `--message <message>`: Human-readable description.
- `--task <taskId>`: Task related to event.
- `--brief <briefId>`: Target brief ID.

```json
{
  "ok": true,
  "id": "e7b0291a",
  "briefId": "c6078a9f",
  "taskId": "t7a1f9e2",
  "actor": "executor",
  "type": "started",
  "message": "Executor-1 began task t7a1f9e2",
  "createdAt": "2026-09-04 10:21:00"
}
```

#### `event list`
Query emitted events.

```bash
crewmate event list [--brief <briefId>] [--task <taskId>] [--actor <actor>] [--type <type>] [--limit <n>]
```

```json
{
  "ok": true,
  "events": [
    {
      "id": "e7b0291a",
      "briefId": "c6078a9f",
      "taskId": "t7a1f9e2",
      "actor": "executor",
      "type": "started",
      "message": "Executor-1 began task t7a1f9e2",
      "createdAt": "2026-09-04 10:21:00"
    }
  ]
}
```

---

## `crewmate activity`

Tracks Frontman's real-time interaction states during user interviews, planning, or reviews.

### Subcommands

#### `activity set <type>`
Set Frontman's active state.

```bash
crewmate activity set questioning \
  --message "Asking user for preferred JWT signing algorithm" \
  --metadata '{"options":["HS256","RS256"]}' \
  --brief c6078a9f
```

- `<type>`: `questioning`, `awaiting_response`, `analyzing`, `planning`, `orchestrating`, `reviewing`, or `idle`.
- `--message <message>`: Contextual explanation.
- `--metadata <json>`: JSON metadata payload.
- `--brief <briefId>`: Target brief ID.

```json
{
  "ok": true,
  "activity": {
    "id": "act-101",
    "briefId": "c6078a9f",
    "activityType": "questioning",
    "message": "Asking user for preferred JWT signing algorithm",
    "metadata": {
      "options": ["HS256", "RS256"]
    },
    "startedAt": "2026-09-04 10:10:00",
    "endedAt": null
  }
}
```

#### `activity get`
Retrieve current active activity for a brief.

```bash
crewmate activity get [--brief <briefId>]
```

```json
{
  "ok": true,
  "activity": {
    "id": "act-101",
    "briefId": "c6078a9f",
    "activityType": "questioning",
    "message": "Asking user for preferred JWT signing algorithm",
    "metadata": {
      "options": ["HS256", "RS256"]
    },
    "startedAt": "2026-09-04 10:10:00",
    "endedAt": null
  }
}
```

#### `activity clear`
End the current active activity state.

```bash
crewmate activity clear [--brief <briefId>]
```

```json
{
  "ok": true,
  "cleared": true
}
```

#### `activity list`
List historical activities for a brief.

```bash
crewmate activity list [--brief <briefId>] [--limit <n>]
```

```json
{
  "ok": true,
  "activities": [
    {
      "id": "act-101",
      "briefId": "c6078a9f",
      "activityType": "questioning",
      "message": "Asking user for preferred JWT signing algorithm",
      "metadata": null,
      "startedAt": "2026-09-04 10:10:00",
      "endedAt": "2026-09-04 10:12:00"
    }
  ]
}
```

---

## `crewmate workflow`

Manages graph-based workflow runs, transitions, and definitions.

### Subcommands

#### `workflow validate <filePath>`
Validate a JSON workflow definition (with stages) or graph definition (with nodes & edges).

```bash
crewmate workflow validate .crewmate/workflows/software-development/workflow.json
```

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "type": "workflow"
  }
}
```

#### `workflow start`
Initialize and persist a new workflow run in SQLite.

```bash
crewmate workflow start \
  --brief c6078a9f \
  --file .crewmate/workflows/custom.json \
  --context '{"env":"production"}' \
  --agent-summary
```

- `-f, --file <filePath>`: Custom workflow definition path (loads default if omitted).
- `-c, --context <json>`: Initial global context JSON string.
- `--brief <briefId>`: Brief to bind to.
- `--agent-summary`: Return concise summary formatted for agent consumption.

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "briefId": "c6078a9f",
    "status": "running",
    "currentStage": "discussion",
    "stageName": "Discussion & Requirements",
    "stageDescription": "Frontman gathers requirements and populates the brief.",
    "startedAt": "2026-09-04 10:05:00",
    "completedAt": null,
    "activeNodes": [
      {
        "id": "frontman-interview",
        "name": "Interview User",
        "type": "agent",
        "allowedTools": ["crewmate_show_brief", "crewmate_update_field"],
        "deniedTools": ["write", "edit"]
      }
    ],
    "stages": [
      { "id": "discussion", "name": "Discussion & Requirements", "status": "running" },
      { "id": "research", "name": "Codebase Research", "status": "pending" },
      { "id": "planning", "name": "Task Planning", "status": "pending" },
      { "id": "execution", "name": "Parallel Execution", "status": "pending" },
      { "id": "verification", "name": "Verification", "status": "pending" }
    ]
  }
}
```

#### `workflow status`
Inspect the status of an active or specific workflow run.

```bash
crewmate workflow status [--run <runId>] [--brief <briefId>] [--agent-summary]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "briefId": "c6078a9f",
    "status": "running",
    "currentStage": "discussion",
    "stages": [
      { "id": "discussion", "name": "Discussion", "status": "running" }
    ]
  }
}
```

#### `workflow advance`
Complete current stage and transition to the next sequential stage in the pipeline.

```bash
crewmate workflow advance [--run <runId>] [--outputs '{"scope":"confirmed"}'] [--agent-summary]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "status": "running",
    "currentStage": "research"
  }
}
```

#### `workflow skip <stageId>`
Mark a stage as skipped and advance the run.

```bash
crewmate workflow skip research [--run <runId>] [--agent-summary]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "status": "running",
    "currentStage": "planning"
  }
}
```

#### `workflow set-stage <stageId>`
Jump directly to a specific stage in the workflow run.

```bash
crewmate workflow set-stage execution [--run <runId>] [--agent-summary]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "status": "running",
    "currentStage": "execution"
  }
}
```

#### `workflow pause`
Pause a running workflow.

```bash
crewmate workflow pause [--run <runId>]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "status": "paused"
  }
}
```

#### `workflow resume`
Resume a paused workflow run.

```bash
crewmate workflow resume [--run <runId>]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "status": "running"
  }
}
```

#### `workflow cancel`
Cancel an active or paused workflow run.

```bash
crewmate workflow cancel [--run <runId>]
```

```json
{
  "ok": true,
  "data": {
    "id": "wf-run-88a1",
    "status": "cancelled"
  }
}
```

#### `workflow delete <runId>`
Delete a workflow run record and its stage runs from the database.

```bash
crewmate workflow delete wf-run-88a1
```

```json
{
  "ok": true,
  "data": {
    "deletedId": "wf-run-88a1"
  }
}
```

#### `workflow list-runs`
List all historical and active workflow runs.

```bash
crewmate workflow list-runs [--brief <briefId>]
```

```json
{
  "ok": true,
  "data": [
    {
      "id": "wf-run-88a1",
      "briefId": "c6078a9f",
      "status": "running",
      "currentStage": "execution",
      "startedAt": "2026-09-04 10:05:00",
      "completedAt": null
    }
  ]
}
```

#### `workflow run`
Execute a workflow definition headlessly from start to finish via `GraphEngine`.

```bash
crewmate workflow run [-f <filePath>] [-c <jsonContext>] [--brief <briefId>]
```

```json
{
  "ok": true,
  "data": {
    "workflowId": "software-development",
    "status": "completed",
    "context": {
      "briefId": "c6078a9f"
    },
    "stages": {
      "discussion": { "status": "completed" },
      "research": { "status": "completed" },
      "planning": { "status": "completed" },
      "execution": { "status": "completed" },
      "verification": { "status": "completed" }
    }
  }
}
```

---

## `crewmate session`

Tracks harness background process health, heartbeat liveness, and lock renewals.

### Subcommands

#### `session heartbeat`
Record a session heartbeat and renew active lock leases.

```bash
crewmate session heartbeat \
  --brief c6078a9f \
  --harness opencode \
  --pid 1420 \
  --status active
```

- `--brief <briefId>`: Optional brief ID.
- `--harness <harness>`: Harness name (default: `opencode`).
- `--pid <pid>`: Operating system process ID of the harness.
- `--status <status>`: `active`, `idle`, or `stopped` (default: `active`).

```json
{
  "ok": true,
  "session": {
    "id": "sess-1",
    "briefId": "c6078a9f",
    "harness": "opencode",
    "pid": 1420,
    "status": "active",
    "lastHeartbeat": "2026-09-04 10:30:00"
  }
}
```

#### `session status`
Get the latest session status for a brief.

```bash
crewmate session status [--brief <briefId>]
```

```json
{
  "ok": true,
  "session": {
    "id": "sess-1",
    "briefId": "c6078a9f",
    "harness": "opencode",
    "pid": 1420,
    "status": "active",
    "lastHeartbeat": "2026-09-04 10:30:00"
  }
}
```

#### `session stop`
Mark an active session as stopped.

```bash
crewmate session stop [--brief <briefId>] [--harness <harness>]
```

```json
{
  "ok": true
}
```

---

## `crewmate watch`

Launches the live terminal TUI dashboard or emits a single snapshot of the entire workflow state.

### Usage

```bash
crewmate watch [options]
```

### Options & Flags

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--brief <briefId>` | Target brief ID (defaults to latest brief). | Latest brief |
| `--interval <ms>` | Database poll interval in milliseconds. | `500` |
| `--once` | Print a single workflow snapshot as JSON and exit (non-interactive). | `false` |

### JSON Output Example (`--once`)

```json
{
  "ok": true,
  "snapshot": {
    "brief": {
      "id": "c6078a9f",
      "status": "draft",
      "fields": {
        "goal": "Build authentication module"
      }
    },
    "tasks": [
      {
        "id": "t7a1f9e2",
        "title": "Implement JWT middleware",
        "status": "in_progress",
        "dependencies": []
      }
    ],
    "locks": [
      {
        "taskId": "t7a1f9e2",
        "filePath": "src/auth.ts"
      }
    ],
    "artifacts": [
      {
        "id": "a451e901",
        "type": "api_contract",
        "content": "verifyToken(token: string): Claims"
      }
    ],
    "events": [
      {
        "actor": "executor",
        "type": "started",
        "message": "Executor began task t7a1f9e2"
      }
    ],
    "workflowRun": {
      "id": "wf-run-88a1",
      "currentStage": "execution",
      "status": "running"
    },
    "activity": {
      "activityType": "idle"
    }
  }
}
```
