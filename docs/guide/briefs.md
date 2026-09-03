# Managing Briefs

In Crewmate, a **Brief** serves as the central anchor entity and single source of truth for an entire development lifecycle. Every task, file lock, knowledge artifact, lifecycle event, and workflow run belongs to an active brief.

When human developers or AI agents collaborate, the Brief ensures alignment across objectives, constraints, scope boundaries, and acceptance criteria.

---

## What is a Brief?

A Brief is a persistent, schema-validated key-value specification stored in the local SQLite database (`.crewmate/crewmate.db`).

- **Anchor Entity**: All tasks, locks, artifacts, and workflow runs cascade from the Brief's unique 8-character hexadecimal identifier (`briefId`).
- **Single Source of Truth**: Agents (such as Frontman, Scout, Planner, and Executor) query the Brief before planning or executing changes.
- **Living Document**: While starting as a draft during discovery, it can be refined, completed once validated, or reopened when scope expands.

```
                  ┌────────────────────────┐
                  │      Brief (Anchor)    │
                  └───────────┬────────────┘
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Workflow Runs  │  │   Tasks (DAG)   │  │    Artifacts    │
└─────────────────┘  └────────┬────────┘  └─────────────────┘
                              ▼
                     ┌─────────────────┐
                     │   File Locks    │
                     └─────────────────┘
```

---

## Brief Lifecycle

A brief transitions through a clear lifecycle state machine:

```
        ┌─────────────┐             complete             ┌───────────────┐
        │    draft    │ ───────────────────────────────> │   complete    │
        │ (editable)  │ <─────────────────────────────── │  (read-only)  │
        └──────┬──────┘             reopen               └───────┬───────┘
               │                                                 │
               │ (delete)                                        │ (delete)
               ▼                                                 ▼
        ┌────────────────────────────────────────────────────────────────┐
        │            Cascading Deletion via Foreign Keys                 │
        │   (removes associated tasks, locks, artifacts, and runs)       │
        └────────────────────────────────────────────────────────────────┘
```

### 1. `draft` (Default State)
- When initialized (`crewmate brief init`), the brief starts in the `draft` state.
- Fields can be added, updated, or removed freely.
- Subagents (e.g. Frontman interviewing the user, Scout discovering codebase structure) populate requirements and technical details into the draft.

### 2. `complete` (Frozen Specification)
- Once all required fields satisfy validation rules, the brief can be finalized using `crewmate brief complete`.
- Marking a brief complete **freezes** it: any attempt to modify or unset fields on a completed brief will be rejected.
- This protects execution agents from shifting project requirements mid-implementation.

### 3. `reopen` (Scope Adjustment)
- If requirements evolve or verification uncovers missing specifications, the brief can be moved back to `draft` using `crewmate brief reopen`.
- Once reopened, fields can be modified again and re-completed when ready.

### 4. Cascading Deletion
- Deleting a brief (`crewmate brief delete`) permanently removes the brief and automatically cascades deletions across all linked entities via SQLite foreign key rules:
  - Associated tasks
  - Active and expired file locks
  - Discovered knowledge artifacts
  - Lifecycle events
  - Workflow and stage execution records
- **Safety Guards**: Crewmate prevents deletion if active workflow runs (`running` or `paused`) or active file locks are currently held, unless `--force` is explicitly provided.

---

## Field Schema

Crewmate utilizes a generic key-value store where any field name is accepted, but standard workflows enforce a core schema:

### Required Fields (Default Workflow)

The standard software development workflow requires five core fields before a brief can be marked complete:

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `workType` | `string` | The nature of the work being performed. | `"feature"`, `"bugfix"`, `"refactor"`, `"docs"` |
| `goal` | `string` | High-level objective and value proposition. | `"Add OAuth2 social authentication via GitHub"` |
| `scope` | `string` \| `array` | Explicit boundaries of what is included and excluded. | `"Include GitHub provider; exclude Google and SAML"` |
| `functionalRequirements`| `array` \| `string` | Concrete behaviors, endpoints, and user flows. | `["User can log in via GitHub", "Session cookie created"]` |
| `acceptanceCriteria` | `array` \| `string` | Measurable pass/fail criteria for verification. | `["Integration tests pass", "E2E flow verified"]` |

### Common Optional Fields

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `technicalStack` | `array` \| `object` | Languages, libraries, frameworks, or database engines. | `["TypeScript", "Fastify", "better-sqlite3"]` |
| `constraints` | `array` \| `string` | Performance, security, or architectural boundaries. | `["Zero external network calls during unit tests"]` |
| `existingCodebase` | `string` \| `object` | Key files, conventions, or existing patterns found by Scout. | `"Uses repository pattern in src/db/"` |
| `dependencies` | `array` | External packages or system requirements needed. | `["@octokit/rest", "jsonwebtoken"]` |
| `nonFunctionalRequirements` | `array` | Latency, throughput, security standards, etc. | `["Response time under 50ms for cached routes"]` |

---

## Setting Fields & Data Types

Crewmate supports flexible input parsing for brief fields:

### 1. Plain Strings
Simple text values can be set directly:
```bash
crewmate brief set workType feature
crewmate brief set goal "Refactor database migrations to support zero downtime"
```

### 2. JSON Values
Any valid JSON string (arrays, numbers, booleans, objects) is automatically parsed and stored in structured form:
```bash
# Array of strings
crewmate brief set functionalRequirements '["Support Postgres", "Support SQLite"]'

# Nested JSON object
crewmate brief set technicalStack '{"backend": "Node.js", "database": "SQLite", "orm": "Drizzle"}'
```

### 3. Base64 Support
For multiline markdown specifications, shell scripts, or values containing complex quotes, use the `--base64` flag:
```bash
# Encode multiline content and store safely
ENCODED=$(echo -n "Line 1\nLine 2\n\"Quoted\"" | base64)
crewmate brief set scope "$ENCODED" --base64
```

---

## Validation Rules

When checking readiness (`crewmate brief status`) or finalizing (`crewmate brief complete`), Crewmate enforces strict completeness validation:

1. **Existence**: The field key must exist in `brief_fields`.
2. **Non-Null / Non-Undefined**: Fields set to `null` or `undefined` fail validation.
3. **Non-Empty Strings**: Empty strings (`""`) or whitespace-only strings (`"   "`) are rejected.
4. **Non-Empty Arrays**: Array fields (e.g. `functionalRequirements: []`) must contain at least one element. Empty arrays are flagged as missing.

If any required field violates these rules, completion is blocked:
```json
{
  "ok": false,
  "error": "Missing required fields",
  "missing": ["acceptanceCriteria"]
}
```

---

## CLI Reference & Examples

All brief CLI commands output structured JSON, making them easy to integrate into scripts and automated pipelines.

### Initialize a Brief
Create a new brief in draft status:
```bash
crewmate brief init
```
```json
{
  "ok": true,
  "id": "c6078a9f"
}
```

### Set Fields
Set fields on the active brief (or target a specific one with `--id`):
```bash
# Set required fields
crewmate brief set workType feature
crewmate brief set goal "Build real-time notification service"
crewmate brief set scope '["In-app WebSocket notifications", "Postgres persistence"]'
crewmate brief set functionalRequirements '["Client connects via WS", "Broadcast to active sessions"]'
crewmate brief set acceptanceCriteria '["Unit tests pass with >90% coverage", "Zero dropped messages in stress test"]'

# Set optional fields
crewmate brief set technicalStack '["TypeScript", "ws", "Redis"]'
```
```json
{
  "ok": true,
  "field": "workType",
  "value": "feature"
}
```

### Inspect a Field or Full Brief
Fetch an individual field value:
```bash
crewmate brief get goal
```
```json
{
  "ok": true,
  "field": "goal",
  "value": "Build real-time notification service"
}
```

Inspect the entire brief and all stored fields:
```bash
crewmate brief show
```
```json
{
  "ok": true,
  "brief": {
    "id": "c6078a9f",
    "status": "draft",
    "fields": {
      "workType": "feature",
      "goal": "Build real-time notification service",
      "scope": ["In-app WebSocket notifications", "Postgres persistence"],
      "functionalRequirements": ["Client connects via WS", "Broadcast to active sessions"],
      "acceptanceCriteria": ["Unit tests pass with >90% coverage", "Zero dropped messages in stress test"],
      "technicalStack": ["TypeScript", "ws", "Redis"]
    },
    "createdAt": "2026-09-04 10:00:00",
    "updatedAt": "2026-09-04 10:05:32"
  }
}
```

### Check Completeness Status
Evaluate whether required fields are fulfilled:
```bash
crewmate brief status --required-fields "workType,goal,scope,functionalRequirements,acceptanceCriteria"
```
```json
{
  "ok": true,
  "status": "draft",
  "required": {
    "workType": "set",
    "goal": "set",
    "scope": "set",
    "functionalRequirements": "set",
    "acceptanceCriteria": "set"
  },
  "complete": true
}
```

### Complete a Brief
Lock and freeze the brief once requirements are final:
```bash
crewmate brief complete --required-fields "workType,goal,scope,functionalRequirements,acceptanceCriteria"
```
```json
{
  "ok": true,
  "id": "c6078a9f",
  "status": "complete"
}
```

### Reopen a Completed Brief
Reopen a completed brief to make modifications:
```bash
crewmate brief reopen
```
```json
{
  "ok": true,
  "id": "c6078a9f",
  "status": "draft"
}
```

### Remove a Field
Remove a field from a draft brief:
```bash
crewmate brief unset technicalStack
```
```json
{
  "ok": true,
  "id": "c6078a9f",
  "field": "technicalStack"
}
```

### Delete a Brief
Delete the brief and cascade-delete all linked tasks, locks, and artifacts:
```bash
# Standard deletion (fails if active runs or locks exist)
crewmate brief delete c6078a9f

# Force deletion bypassing active run/lock checks
crewmate brief delete c6078a9f --force
```
```json
{
  "ok": true,
  "deletedId": "c6078a9f"
}
```

---

## Tool / Agent API Examples

When operating inside AI harnesses like OpenCode or Claude Code, agents invoke Crewmate tools directly.

### Brief Tools Summary

| Tool Name | Purpose | Key Arguments |
| :--- | :--- | :--- |
| `crewmate_create_brief` | Initialize a new brief | *(none)* |
| `crewmate_update_field` | Set or update a brief field | `field`, `value` (string or JSON), `id?` |
| `crewmate_get_field` | Retrieve a single field value | `field`, `id?` |
| `crewmate_show_brief` | Retrieve full brief JSON | `id?` |
| `crewmate_check_status` | Check completeness & required fields | `id?` |
| `crewmate_finish_brief` | Finalize brief into `complete` status | `id?` |
| `crewmate_reopen_brief` | Revert brief to `draft` status | `id?` |
| `crewmate_unset_field` | Remove a specific field | `field`, `id?` |
| `crewmate_delete_brief` | Cascade delete brief and child records | `id?`, `force?` |

### Harness Usage Example

Below is an interaction flow showing an orchestrator agent (Frontman) gathering requirements, populating the brief, and locking it:

```json
// 1. Initialize a new brief
{
  "tool": "crewmate_create_brief",
  "parameters": {}
}
// Response: {"ok": true, "id": "c6078a9f"}

// 2. Set goal and requirements
{
  "tool": "crewmate_update_field",
  "parameters": {
    "field": "goal",
    "value": "Implement user password reset via email token"
  }
}

{
  "tool": "crewmate_update_field",
  "parameters": {
    "field": "functionalRequirements",
    "value": "[\"POST /auth/forgot-password generates expiring token\", \"POST /auth/reset-password updates password hash\"]"
  }
}

// 3. Verify completeness before completion
{
  "tool": "crewmate_check_status",
  "parameters": {}
}

// 4. Mark brief completed once validated
{
  "tool": "crewmate_finish_brief",
  "parameters": {}
}
// Response: {"ok": true, "id": "c6078a9f", "status": "complete"}
```
