# Task Management

Crewmate treats development workflows as Directed Acyclic Graphs (DAGs) of discrete, executable units called **Tasks**. Each task maintains clear dependencies, scope constraints, and artifact requirements to enable safe parallel execution across multi-agent systems.

---

## Task Model

Tasks in Crewmate are stored within the project SQLite database (`.crewmate/crewmate.db`) and are anchored to a specific Brief.

```typescript
interface Task {
  id: string;                    // Unique 8-character hex ID (e.g. "a1b2c3d4")
  briefId: string;               // Owning brief identifier
  title: string;                 // Concise summary of work to perform
  description: string;           // Detailed implementation requirements and instructions
  dependencies: string[];        // Array of prerequisite task IDs (DAG edges)
  field: string | null;          // Optional brief field this task fulfills
  artifactRequirements: ArtifactType[]; // Required artifact types before completion
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;             // ISO-8601 timestamp
  updatedAt: string;             // ISO-8601 timestamp
}
```

### Key Attributes

| Field | Description | Example |
| :--- | :--- | :--- |
| `id` | Unique 8-character hexadecimal identifier generated upon creation. | `e4f1a09b` |
| `briefId` | Parent brief ID linking this task to the active specification. | `brief_01` |
| `title` | One-line overview of the implementation objective. | `"Build auth middleware"` |
| `description` | In-depth context, expected behavior, and acceptance criteria. | `"Implement JWT validation with RS256..."` |
| `dependencies` | Array of prerequisite task IDs that must complete first. | `["c2d3e4f5"]` |
| `field` | (Optional) Links the task to a specific brief attribute (e.g., `api_spec`). | `"auth_service"` |
| `artifactRequirements` | (Optional) Enforced artifact categories required prior to completion. | `["api_contract", "decision"]` |
| `status` | State machine state (`pending`, `in_progress`, or `completed`). | `"pending"` |

---

## Dependency Graph & Cycle Detection

Crewmate models tasks as a **Directed Acyclic Graph (DAG)**. A task can only proceed once all prerequisite tasks defined in its `dependencies` array have reached the `completed` status.

### DFS-Based Cycle Validation

Whenever tasks are created (`task add`) or their dependencies are updated (`task update --dependencies ...`), Crewmate runs an in-memory Depth-First Search (DFS) traversal across the task network before writing to SQLite:

1. **Existence Verification**: Ensures each dependency ID belongs to the same `briefId`.
2. **Self-Reference Guard**: Rejects tasks that list themselves as dependencies.
3. **Graph Coloring (Recursion Stack)**:
   - Tracks traversed nodes via a `visited` set and an `inStack` recursion set.
   - If a traversal reaches a node already present in `inStack`, the entire transaction aborts with an error:
     ```json
     {"ok": false, "error": "Dependency cycle detected"}
     ```

This guarantees that deadlocks caused by circular dependencies (`Task A -> Task B -> Task A`) cannot be committed to the database.

---

## Status Transitions & Lifecycle

Crewmate enforces strict state machine transitions to ensure work integrity:

```
          ┌─────────────┐
          │   pending   │◄──────────────────┐
          └──────┬──────┘                   │
                 │                          │
                 │ (dispatch / pickup)      │
                 ▼                          │
          ┌─────────────┐                   │ (rework / reset)
   ┌─────►│ in_progress │                   │
   │      └──────┬──────┘                   │
   │             │                          │
   │             │ (compliance gate passed) │
   │ (reopened)  ▼                          │
   │      ┌─────────────┐                   │
   └──────┤  completed  ├───────────────────┘
          └─────────────┘
```

### Valid Transitions

- `pending` &rarr; `in_progress`: Task is picked up by an agent or developer.
- `in_progress` &rarr; `completed`: Work is finished and artifact compliance passes.
- `in_progress` &rarr; `pending`: Task execution was cancelled, interrupted, or reset.
- `completed` &rarr; `in_progress` or `pending`: Allows **rework** if subsequent reviews or tests fail.

Direct jumps like `pending` &rarr; `completed` are rejected to ensure tasks are actively claimed and tracked.

---

## Artifact Compliance Gates

Task completion is strictly gated by Crewmate's incremental knowledge system. Agents cannot silently mark tasks as finished without recording their findings, architecture decisions, or API contracts.

### 1. Default Rule (Baseline Gate)

If no explicit `artifactRequirements` are specified on a task, Crewmate applies the **default gate**:
- The task must have recorded **at least 1 active artifact of any type** (`fact`, `decision`, `api_contract`, `constraint`, `note`, `log`).
- If no active artifacts exist when updating to `completed`, Crewmate rejects the transition:
  ```json
  {
    "ok": false,
    "error": "Cannot complete task — no active knowledge artifacts recorded. Record at least one decision, api_contract, fact, or constraint before completing."
  }
  ```

### 2. Explicit Rules

When a task defines explicit artifact requirements (e.g. `artifactRequirements: ["api_contract", "decision"]`), Crewmate verifies that **every** required type exists in the active artifact registry for that task:

```bash
# If only a "note" was recorded, completing will fail:
crewmate task update e4f1a09b --status completed
# Output:
# {"ok":false,"error":"Cannot complete task — missing required artifact types: api_contract, decision. Required: [api_contract, decision]."}
```

Once the required artifacts are added:
```bash
crewmate artifact add e4f1a09b --type api_contract --content "POST /api/v1/auth"
crewmate artifact add e4f1a09b --type decision --content "Use RS256 JWT tokens"
crewmate task update e4f1a09b --status completed
# Output:
# {"ok":true,"id":"e4f1a09b","status":"completed",...}
```

### 3. Emergency Bypass (`--skip-artifact-check`)

For automated administrative resets, human overrides, or non-code operational tasks, the gate can be explicitly bypassed using the `--skip-artifact-check` flag:

```bash
crewmate task update e4f1a09b --status completed --skip-artifact-check
```

::: warning Use Bypass Sparingly
Bypassing artifact checks degrades context for downstream agents. Successor tasks depend on ancestor artifacts injected into their prompts.
:::

---

## CLI Reference & Examples

### Add a Task

Create a task under an active brief with dependencies and artifact requirements:

```bash
crewmate task add b018ac92 \
  --title "Implement Auth Middleware" \
  --description "Verify Bearer tokens and attach user context to express request" \
  --dependencies a1b2c3d4 \
  --artifact-requirements api_contract decision
```

Output:
```json
{
  "ok": true,
  "id": "e4f1a09b",
  "title": "Implement Auth Middleware",
  "artifactRequirements": ["api_contract", "decision"]
}
```

### List Tasks

List all tasks associated with a specific brief:

```bash
crewmate task list --brief b018ac92
```

Output:
```json
{
  "ok": true,
  "tasks": [
    {
      "id": "a1b2c3d4",
      "title": "Define User Schema",
      "description": "Create SQLite schema for user entities",
      "dependencies": [],
      "status": "completed",
      "field": "database",
      "artifactRequirements": ["api_contract"]
    },
    {
      "id": "e4f1a09b",
      "title": "Implement Auth Middleware",
      "description": "Verify Bearer tokens and attach user context",
      "dependencies": ["a1b2c3d4"],
      "status": "pending",
      "field": null,
      "artifactRequirements": ["api_contract", "decision"]
    }
  ]
}
```

### Get Task Details

Inspect full details of a specific task by its ID:

```bash
crewmate task get e4f1a09b
```

Output:
```json
{
  "ok": true,
  "task": {
    "id": "e4f1a09b",
    "briefId": "b018ac92",
    "title": "Implement Auth Middleware",
    "description": "Verify Bearer tokens and attach user context",
    "dependencies": ["a1b2c3d4"],
    "field": null,
    "artifactRequirements": ["api_contract", "decision"],
    "status": "pending",
    "createdAt": "2026-09-04T12:00:00.000Z",
    "updatedAt": "2026-09-04T12:00:00.000Z"
  }
}
```

### Update a Task

Update task details, modify dependencies, or transition status:

```bash
# Claim the task
crewmate task update e4f1a09b --status in_progress

# Update description and add a field tag
crewmate task update e4f1a09b --description "Support both RS256 and HS256 tokens" --field "security"

# Mark completed (verifies artifact compliance)
crewmate task update e4f1a09b --status completed
```

Output:
```json
{
  "ok": true,
  "id": "e4f1a09b",
  "status": "completed",
  "title": "Implement Auth Middleware"
}
```

### Remove a Task

Remove an individual task. Any other tasks in the brief that depended on this task will automatically have the removed ID pruned from their dependency lists:

```bash
crewmate task remove e4f1a09b
```

Output:
```json
{
  "ok": true,
  "id": "e4f1a09b"
}
```

### Clear Tasks

Remove all tasks linked to a brief:

```bash
crewmate task clear --brief b018ac92
```

Output:
```json
{
  "ok": true,
  "briefId": "b018ac92",
  "message": "Cleared all tasks for brief b018ac92"
}
```

---

## Harness Tool Counterparts

When operating inside multi-agent harnesses (such as OpenCode or Claude Code), agents interact with tasks directly using tool abstractions rather than invoking the terminal CLI:

| Harness Tool | CLI Equivalent | Description |
| :--- | :--- | :--- |
| `crewmate_add_task` | `crewmate task add` | Create a new task in a brief with dependencies and requirements. |
| `crewmate_list_tasks` | `crewmate task list` | Fetch all tasks for a brief to assess progress and readiness. |
| `crewmate_update_task` | `crewmate task update` | Modify status (`in_progress`, `completed`), dependencies, or details. |
| `crewmate_remove_task` | `crewmate task remove` | Delete a single task and clean up dependencies. |
| `crewmate_clear_tasks` | `crewmate task clear` | Clear all tasks for a brief. |

### Harness Usage Example

Below is an example of an autonomous agent claiming and completing a task via tool calls:

```json
// 1. Move to in_progress
{
  "tool": "crewmate_update_task",
  "parameters": {
    "taskId": "e4f1a09b",
    "status": "in_progress"
  }
}

// 2. Implement code & record mandatory artifact
{
  "tool": "crewmate_add_artifact",
  "parameters": {
    "taskId": "e4f1a09b",
    "type": "api_contract",
    "content": "export function authenticateUser(req: Request, res: Response, next: NextFunction): void"
  }
}

// 3. Mark task completed (gate will verify the artifact exists)
{
  "tool": "crewmate_update_task",
  "parameters": {
    "taskId": "e4f1a09b",
    "status": "completed"
  }
}
```
