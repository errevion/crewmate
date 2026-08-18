# Crewmate

Structured project briefing and task decomposition for AI coding agents.

Crewmate is a CLI tool and agent orchestration system that helps AI coding agents gather project requirements through a structured briefing workflow. Instead of dumping unstructured context at an agent, Crewmate walks through a defined set of fields — work type, goals, scope, requirements, acceptance criteria — and stores them in a local SQLite database (`.crewmate/crewmate.db`). Once a brief is completed, Crewmate enables decomposing the brief into actionable implementation tasks with dependency tracking.

## How it works

```
You (or your AI agent)
  |
  v
crewmate brief init                         # create a new brief
crewmate brief set goal ...                  # fill in fields one by one
crewmate brief status                        # check what's missing
crewmate brief complete                      # finalize when ready
crewmate task add <brief-id> --title ...     # decompose into implementation tasks
```

Crewmate integrates with AI coding assistants through a harness adapter system. Running `crewmate init` in a project scaffolds the necessary plugin, agent definitions, and command files so your AI assistant can coordinate directly.

Currently supported harnesses:

- **OpenCode** — scaffolds plugin tools (`crewmate_create_brief`, `crewmate_update_field`, `crewmate_get_field`, `crewmate_show_brief`, `crewmate_check_status`, `crewmate_finish_brief`, `crewmate_add_task`, `crewmate_list_tasks`, `crewmate_update_task`, `crewmate_remove_task`), dedicated agent roles (`Frontman`, `Scout`, `Planner`), and a `/brief` slash command.

## Quick start

### Prerequisites

- Node.js >= 20

### Install & Link CLI

Clone and link the binary so `crewmate` is globally accessible in your system PATH (required for AI harness plugin executions):

```bash
git clone https://github.com/your-username/crewmate.git
cd crewmate
npm install
npm run build
npm link
```

### Initialize in a project

```bash
crewmate init --harness opencode --dir /path/to/your/project
```

This creates integration files in your project's `.opencode/` directory:

- `.opencode/plugins/crewmate.ts` — plugin exposing crewmate tools to OpenCode agents
- `.opencode/commands/brief.md` — `/brief` slash command that kicks off the briefing flow
- `.opencode/agents/frontman.md` — Frontman orchestrator agent prompt
- `.opencode/agents/scout.md` — Scout read-only codebase explorer agent prompt
- `.opencode/agents/planner.md` — Planner task decomposition agent prompt
- `.opencode/package.json` — dependency on `@opencode-ai/plugin`

> **Note**: Add `.crewmate/` to your target project's `.gitignore` to avoid committing local SQLite database state.

### Briefing & Task Flow Example

```bash
# 1. Initialize brief
crewmate brief init

# 2. Populate required fields
crewmate brief set workType software
crewmate brief set goal "Build a REST API for user management"
crewmate brief set scope '{"included":["auth","users"],"excluded":["billing"]}'
crewmate brief set functionalRequirements '["CRUD operations","JWT auth"]'
crewmate brief set acceptanceCriteria '["All endpoints return JSON","Tests pass"]'

# 3. Check status and finalize
crewmate brief status
crewmate brief complete

# 4. Create and manage tasks
crewmate task add <brief-id> --title "Setup DB Schema" --description "Create initial migration scripts"
crewmate task add <brief-id> --title "JWT Middleware" --description "Add token validation" --dependencies '["<task-1-id>"]'
crewmate task list --brief <brief-id>
crewmate task update <task-1-id> --status in_progress
```

Or let your AI agent handle the whole lifecycle conversationally through the `/brief` command.

## Multi-Agent Architecture

```
                       User / Slash Command (/brief)
                                     │
                                     ▼
                            [Frontman Orchestrator]
                      (Mode: primary | Zero Direct I/O)
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                                                 ▼
     [Scout Subagent]                                 [Planner Subagent]
(Read-only workspace explorer)                    (Task decomposition & DAG)
 - Scans manifests and configs                     - Breaks brief into tasks
 - Reports objective facts                         - Identifies dependencies
```

- **Frontman**: Primary conversational orchestrator. Manages user dialogue via the `question` tool, coordinates subagents, and persists state via `crewmate_*` tools. Denied direct read/edit/bash permissions.
- **Scout**: Read-only explorer. Dispatched to inspect existing codebase structure, framework setup, and tooling.
- **Planner**: Implementation planner. Dispatched after brief completion to break requirements into concrete, dependency-linked tasks.

## Commands Reference

### `crewmate init`

Install integration files for an AI harness.

| Flag | Description | Default |
|---|---|---|
| `-H, --harness <name>` | Target harness | `opencode` |
| `-d, --dir <path>` | Target directory | current directory |
| `--json` | Output raw JSON only | `false` |

### `crewmate brief <subcommand>`

Manage project briefs. All `brief` commands return structured JSON to stdout.

| Subcommand | Description |
|---|---|
| `init` | Create a new draft brief |
| `set <field> <value>` | Set a field value (string or JSON) |
| `get <field>` | Get a specific field value |
| `show` | Show the complete brief JSON |
| `status` | Check completeness of required fields |
| `complete` | Mark the brief as complete (validates required fields) |

All `brief` subcommands accept `--id <briefId>` to target a specific brief (defaults to the latest created brief).

### `crewmate task <subcommand>`

Manage implementation tasks linked to briefs. All `task` commands return structured JSON to stdout.

| Subcommand | Description | Options |
|---|---|---|
| `add <briefId>` | Create a new task linked to a brief | `--title <t>` (required), `--description <d>` (required), `--dependencies <ids...>` (optional), `--field <field>` (optional) |
| `list` | List all tasks for a brief | `--brief <briefId>` (required) |
| `get <taskId>` | Retrieve a task by ID | |
| `update <taskId>` | Update a task's status | `--status <pending\|in_progress\|completed>` (required) |
| `remove <taskId>` | Delete a task by ID | |

### Brief fields catalog

| Field | Required | Type | Schema Example |
|---|---|---|---|
| `workType` | Yes | enum string | `"software"` (`software`, `infrastructure`, `data`, `documentation`, `audit`) |
| `goal` | Yes | string | `"Build user authentication service"` |
| `scope` | Yes | JSON object | `{"included": ["auth", "users"], "excluded": ["billing"]}` |
| `functionalRequirements` | Yes | JSON array of strings | `["User registration", "Password reset"]` |
| `acceptanceCriteria` | Yes | JSON array of strings | `["All tests pass", "95% coverage"]` |
| `technicalStack` | No | JSON object | `{"frontend": ["React"], "backend": ["Node"], "database": ["Postgres"], "tools": ["Docker"]}` |
| `constraints` | No | JSON object | `{"exclusions": ["No third-party auth"], "requirements": ["WCAG AA"]}` |
| `existingCodebase` | No | JSON array of strings | `["packages/core", "apps/web"]` |
| `referenceMaterials` | No | JSON array of strings | `["https://spec.example.com"]` |
| `qualityStandards` | No | JSON object | `{"performance": {"maxLatency": "200ms"}, "security": {"auth": "JWT"}}` |
| `dependencies` | No | JSON array of strings | `["Node >= 20", "PostgreSQL 16"]` |
| `risks` | No | JSON array of strings | `["Tight deadline", "Legacy schema compatibility"]` |
| `deliverables` | No | JSON array of objects | `[{"type": "code", "format": "repo"}, {"type": "doc", "format": "file"}]` |

## Project structure

```
src/
  commands/       CLI command handlers (init, brief, task)
  db/             SQLite database layer (connection, migrations, repositories)
  harness/        Adapter system for AI coding assistants (opencode)
  models/         Data models, constants, and field definitions
  utils/          Validation and error utilities
tests/
  validation.spec.ts   Unit tests for field validation
  harness.spec.ts      Unit tests for harness templates & registry
  e2e/                 End-to-end CLI integration tests
```

## Development

```bash
npm run build          # Build with tsup
npm run dev            # Build in watch mode
npm test               # Run unit tests
npm run test:e2e       # Build and run E2E tests
npm run test:coverage  # Run unit test coverage with v8
npm run typecheck      # Type check without emitting
npm run lint           # Lint and fix
npm run format         # Format with Prettier
```

## License

Private
