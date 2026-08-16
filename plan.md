# Crewmate — AI Agent Workflow CLI

## Overview

`crewmate` is a CLI tool designed to guide AI agent workflow. It is **not** intended to be run directly by users — instead, an AI agent (running inside OpenCode) invokes `crewmate` commands while conversing with the user to gather structured work information.

The first phase is **briefing**: the agent creates a brief, discusses requirements with the user, fills in structured fields via CLI commands, and marks the brief as complete once all required information is captured.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **CLI framework:** `commander`
- **Storage:** SQLite via `better-sqlite3` (project-local at `.crewmate/crewmate.db`)
- **Build:** `tsup` (bundles to `dist/index.js`)
- **Package manager:** npm

## Project Structure

```
crewmate/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── plan.md
├── src/
│   ├── index.ts              # CLI entry point (bin)
│   ├── commands/
│   │   └── brief.ts          # `crewmate brief` subcommands
│   ├── db/
│   │   ├── connection.ts     # SQLite connection manager
│   │   ├── migrations.ts     # Schema creation
│   │   └── brief-repo.ts     # CRUD for briefs
│   ├── models/
│   │   └── brief.ts          # TypeScript types/interfaces
│   └── utils/
│       └── validation.ts     # Field validation & completeness checks
```

## Data Model

### Brief Schema

| Field                    | Type                | Storage     | Required |
|--------------------------|---------------------|-------------|----------|
| id                       | string              | TEXT PK     | auto     |
| workType                 | enum                | TEXT        | yes      |
| goal                     | string              | TEXT        | yes      |
| scope                    | {included, excluded}| JSON TEXT   | yes      |
| functionalRequirements   | string[]            | JSON TEXT   | yes      |
| technicalStack           | {frontend, backend, database, tools} | JSON TEXT | no |
| constraints              | {exclusions, requirements} | JSON TEXT | no |
| existingCodebase         | string[]            | JSON TEXT   | no       |
| referenceMaterials       | string[]            | JSON TEXT   | no       |
| acceptanceCriteria       | string[]            | JSON TEXT   | yes      |
| qualityStandards         | {performance, security, accessibility} | JSON TEXT | no |
| dependencies             | string[]            | JSON TEXT   | no       |
| risks                    | string[]            | JSON TEXT   | no       |
| deliverables             | {type, format}[]    | JSON TEXT   | no       |
| status                   | "draft" \| "complete" | TEXT      | auto     |
| createdAt                | ISO datetime        | TEXT        | auto     |
| updatedAt                | ISO datetime        | TEXT        | auto     |

### SQLite Table

```sql
CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  work_type TEXT,
  goal TEXT,
  scope TEXT,
  functional_requirements TEXT,
  technical_stack TEXT,
  constraints TEXT,
  existing_codebase TEXT,
  reference_materials TEXT,
  acceptance_criteria TEXT,
  quality_standards TEXT,
  dependencies TEXT,
  risks TEXT,
  deliverables TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## CLI Commands

All commands output JSON to stdout for agent consumption.

### `crewmate brief init`

Create a new brief. Returns the brief ID.

```json
{"ok": true, "id": "a1b2c3d4"}
```

### `crewmate brief set <field> <value> [--id <briefId>]`

Set a field on the brief. `<value>` is a plain string for simple fields, or a JSON string for complex fields.

```bash
crewmate brief set workType software
crewmate brief set goal "Build a real-time chat messaging app"
crewmate brief set scope '{"included": ["messaging", "notifications"], "excluded": ["payments"]}'
crewmate brief set functionalRequirements '["real-time messaging", "file sharing", "read receipts"]'
```

```json
{"ok": true, "field": "goal", "value": "Build a real-time chat messaging app"}
```

### `crewmate brief get <field> [--id <briefId>]`

Get the current value of a single field.

```json
{"ok": true, "field": "goal", "value": "Build a real-time chat messaging app"}
```

### `crewmate brief show [--id <briefId>]`

Show the full brief as JSON.

```json
{
  "ok": true,
  "brief": {
    "id": "a1b2c3d4",
    "workType": "software",
    "goal": "Build a real-time chat messaging app",
    "scope": {"included": ["messaging"], "excluded": ["payments"]},
    "status": "draft",
    ...
  }
}
```

### `crewmate brief status [--id <briefId>]`

Show completeness status — which required fields are set vs missing.

```json
{
  "ok": true,
  "status": "draft",
  "required": {
    "workType": "set",
    "goal": "set",
    "scope": "missing",
    "functionalRequirements": "missing",
    "acceptanceCriteria": "missing"
  },
  "complete": false
}
```

### `crewmate brief complete [--id <briefId>]`

Attempt to mark the brief as complete. Fails if required fields are missing.

Success:
```json
{"ok": true, "id": "a1b2c3d4", "status": "complete"}
```

Failure:
```json
{"ok": false, "error": "Missing required fields", "missing": ["scope", "acceptanceCriteria"]}
```

## Field Name Mapping

The CLI uses camelCase field names. These map to snake_case columns in SQLite:

| CLI Field              | DB Column              |
|------------------------|------------------------|
| workType               | work_type              |
| goal                   | goal                   |
| scope                  | scope                  |
| functionalRequirements | functional_requirements|
| technicalStack         | technical_stack        |
| constraints            | constraints            |
| existingCodebase       | existing_codebase      |
| referenceMaterials     | reference_materials    |
| acceptanceCriteria     | acceptance_criteria    |
| qualityStandards       | quality_standards      |
| dependencies           | dependencies           |
| risks                  | risks                  |
| deliverables           | deliverables           |
| status                 | status                 |
| createdAt              | created_at             |
| updatedAt              | updated_at             |

## Agent Workflow (Briefing Phase)

This is how an AI agent inside OpenCode uses `crewmate` to conduct a briefing:

```
User: "I want to make a chat messaging app"

Agent thinks: I need to create a structured brief. Let me start the briefing process.

1. Agent runs: crewmate brief init
   → Gets brief ID "a1b2c3d4"

2. Agent asks user: "What type of work is this — software, infrastructure, data, documentation, or audit?"
   User: "software"
   Agent runs: crewmate brief set workType software

3. Agent asks user: "Can you describe the goal in more detail?"
   User: "Build a real-time chat app with channels, DMs, and file sharing"
   Agent runs: crewmate brief set goal "Build a real-time chat app with channels, DMs, and file sharing"

4. Agent asks user: "What's in scope and what's out of scope?"
   User: "In scope: messaging, channels, file sharing. Out of scope: video calls, payments"
   Agent runs: crewmate brief set scope '{"included":["messaging","channels","file sharing"],"excluded":["video calls","payments"]}'

5. Agent asks user: "What are the key functional requirements?"
   User: "Real-time messaging, file uploads up to 50MB, message search, typing indicators"
   Agent runs: crewmate brief set functionalRequirements '["Real-time messaging","File uploads up to 50MB","Message search","Typing indicators"]'

6. Agent asks user: "What are the acceptance criteria — how do we know it's done?"
   User: "Users can send and receive messages in real time, files can be uploaded and downloaded, search returns results within 2 seconds"
   Agent runs: crewmate brief set acceptanceCriteria '["Users can send and receive messages in real time","Files can be uploaded and downloaded","Search returns results within 2 seconds"]'

7. Agent runs: crewmate brief status
   → Sees all required fields are "set", complete: true

8. Agent runs: crewmate brief complete
   → Brief marked as complete

9. Agent proceeds to the next phase of work (future feature)
```

## Storage Location

- Database file: `.crewmate/crewmate.db` (relative to CWD)
- The `.crewmate/` directory is created automatically on first use
- Add `.crewmate/` to `.gitignore`

## Error Handling

All errors are returned as JSON:

```json
{"ok": false, "error": "Brief not found", "id": "nonexistent"}
```

The CLI always exits with code 0 for successful operations and code 1 for errors, while still outputting valid JSON in both cases.

## Design Decisions

1. **Subcommands + flags over stdin protocol:** The agent naturally generates shell commands. Each invocation is stateless and inspectable. No risk of broken pipes or orphaned processes.

2. **SQLite over flat files:** Supports future features (multiple briefs, querying, relationships between briefs and tasks). Atomic writes. No file format parsing issues.

3. **JSON output only:** The CLI is agent-facing, not human-facing. JSON is unambiguous and trivially parseable.

4. **ID defaults to latest:** When `--id` is omitted, the CLI operates on the most recently created brief. This simplifies the common single-brief workflow.

5. **camelCase CLI fields, snake_case DB columns:** CLI matches the schema the user/agent thinks in. DB follows SQL conventions. Mapping is internal.

## Valid workType Values

- `software`
- `infrastructure`
- `data`
- `documentation`
- `audit`

## Future Phases (Out of Scope for Now)

- Task breakdown from completed briefs
- Agent assignment and delegation
- Progress tracking
- Multi-agent coordination
- Brief templates
