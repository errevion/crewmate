# Crewmate

Structured project briefing for AI coding agents.

Crewmate is a CLI tool that helps AI agents gather project requirements through a structured briefing workflow. Instead of dumping unstructured context at an agent, Crewmate walks through a defined set of fields — work type, goals, scope, requirements, acceptance criteria — and stores them in a local database. The result is a complete, machine-readable brief that an AI agent can act on.

## How it works

```
You (or your AI agent)
  |
  v
crewmate brief init          # create a new brief
crewmate brief set goal ...   # fill in fields one by one
crewmate brief status         # check what's missing
crewmate brief complete       # finalize when ready
```

Crewmate integrates with AI coding assistants through a harness adapter system. Running `crewmate init` in a project scaffolds the necessary plugin and command files so your AI assistant can call Crewmate directly.

Currently supported harnesses:

- **OpenCode** — installs a plugin with tools (`crewmate_init`, `crewmate_set`, `crewmate_get`, etc.) and a `/brief` slash command

## Quick start

### Prerequisites

- Node.js >= 18

### Install

```bash
git clone https://github.com/your-username/crewmate.git
cd crewmate
npm install
npm run build
```

### Initialize in a project

```bash
crewmate init --harness opencode --dir /path/to/your/project
```

This creates integration files in your project's `.opencode/` directory:

- `.opencode/plugins/crewmate.ts` — plugin exposing crewmate tools to the AI agent
- `.opencode/commands/brief.md` — a `/brief` slash command for guided briefing
- `.opencode/package.json` — dependency on `@opencode-ai/plugin`

### Create a brief

```bash
crewmate brief init
crewmate brief set workType software
crewmate brief set goal "Build a REST API for user management"
crewmate brief set scope '{"included":["auth","users"],"excluded":["billing"]}'
crewmate brief set functionalRequirements '["CRUD operations","JWT auth"]'
crewmate brief set acceptanceCriteria '["All endpoints return JSON","Tests pass"]'
crewmate brief status
crewmate brief complete
```

Or let your AI agent handle it through the `/brief` command.

## Commands

### `crewmate init`

Install integration files for an AI harness.

| Flag | Description | Default |
|---|---|---|
| `-H, --harness <name>` | Target harness | `opencode` |
| `-d, --dir <path>` | Target directory | current directory |
| `--json` | Output raw JSON only | `false` |

### `crewmate brief <subcommand>`

Manage project briefs.

| Subcommand | Description |
|---|---|
| `init` | Create a new brief |
| `set <field> <value>` | Set a field value (string or JSON) |
| `get <field>` | Get a field value |
| `show` | Show the full brief |
| `status` | Check completeness of required fields |
| `complete` | Mark the brief as complete |

All `brief` subcommands accept `--id <briefId>` to target a specific brief (defaults to the latest).

### Brief fields

| Field | Required | Type |
|---|---|---|
| `workType` | Yes | `software`, `infrastructure`, `data`, `documentation`, `audit` |
| `goal` | Yes | string |
| `scope` | Yes | JSON (`{included, excluded}`) |
| `functionalRequirements` | Yes | JSON array |
| `acceptanceCriteria` | Yes | JSON array |
| `technicalStack` | No | JSON (`{frontend, backend, database, tools}`) |
| `constraints` | No | JSON (`{exclusions, requirements}`) |
| `existingCodebase` | No | JSON array |
| `referenceMaterials` | No | JSON array |
| `qualityStandards` | No | JSON (`{performance, security, accessibility}`) |
| `dependencies` | No | JSON array |
| `risks` | No | JSON array |
| `deliverables` | No | JSON array of `{type, format}` |

### Output format

All commands output structured JSON to stdout:

```json
{"ok": true, "id": "a1b2c3d4"}
```

```json
{"ok": false, "error": "Missing required fields", "missing": ["scope"]}
```

## Project structure

```
src/
  commands/       CLI command handlers (init, brief)
  db/             SQLite database layer (connection, migrations, repository)
  harness/        Adapter system for AI coding assistants
  models/         Data models and field definitions
  utils/          Validation and error utilities
tests/
  e2e/            End-to-end tests against the built CLI
```

## Development

```bash
npm run build          # Build with tsup
npm run dev            # Build in watch mode
npm test               # Run unit tests
npm run test:e2e       # Build and run E2E tests
npm run typecheck      # Type check without emitting
npm run lint           # Lint and fix
npm run format         # Format with Prettier
```

## License

Private
