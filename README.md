# Crewmate

[![npm version](https://img.shields.io/npm/v/@errevion/crewmate.svg)](https://www.npmjs.com/package/@errevion/crewmate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

> Contract-driven agent workflow engine and OpenCode v2 harness plugin enforcing architectural boundaries and dead-code prevention.

---

## Why Crewmate?

AI coding agents are fast, but left unchecked they frequently introduce architectural drift: importing across forbidden layer boundaries, leaving behind dead code, and modifying out-of-scope files.

**Crewmate** enforces hard, scriptable guardrails outside the model context. By defining module contracts, dependency directions, and multi-step workflows in plain YAML, Crewmate ensures agents respect system architecture before code lands.

For complete guides, configuration specifications, and architecture deep dives, visit the **[Docs Placeholder]**.

---

## Key Features

- **Files as Single Source of Truth**: Contracts (`contracts/`), workflows (`workflows/`), and state (`state.jsonl`) live in plain files under `.crewmate/`. Zero database required.
- **Authoritative Outside-the-Agent Gates**: Disk inspections and AST-based scanners verify architecture rules and dead-code policies deterministically.
- **Contract-Scoped Parallel Tasks**: File-level mutual exclusion locks and 3-source dependency checking prevent concurrent agents from colliding.
- **Dynamic Context Injection**: Injects tiered, minimal context on every model turn, surviving context compactions.
- **Live Terminal Observer**: Read-only real-time TUI (`crewmate watch`) built in Rust with Ratatui to monitor active agents, tasks, and state transitions.
- **Harness Integration**: Built-in OpenCode v2 plugin with 21 native agent tools and execution guardrails.

---

## Quick Start

```bash
# Install globally or run via npx
npm install -g @errevion/crewmate

# Scaffold contracts, default workflow, and plugin in your project
crewmate init

# Check workflow status
crewmate status

# Launch live observer
crewmate watch
```

`crewmate init` sets up `.crewmate/` with starter contracts, a 5-node pipeline (`scout → plan → execute → contract → verify`), and auto-configures the local OpenCode plugin shim and Matte orchestrator.

---

## Workflows

The workflows in Crewmate are declarative state machine graphs defined under `.crewmate/workflows/`. Two primary development workflows are supported:

### Feature Pipeline (`crewmate-feature-pipeline`)

A 10-node end-to-end development pipeline that drives features from initial exploration to pull request creation:

```text
scout → clarify → branch → plan → execute → contract → verify → docs → pr → done
                                                           ▲            │
                                                           └── fix ◄────┘ (on_fail)
```

- **Fix Loop**: When PR checks or verification fail (`on_fail`), the workflow routes automatically to `fix` instead of retrying `pr` directly. The agent applies targeted fixes based on review feedback or CI failure output, then re-enters the verification and documentation cycle (`pr -[on_fail]→ fix → verify → docs → pr`).
- **Happy Path**: When verification and review pass, `pr` advances directly to `done`.

### Fix Pipeline (`crewmate-fix-pipeline`)

A streamlined, standalone 3-node workflow optimized for fix-and-resubmit cycles on existing branches:

```text
fix → verify → pr → done
```

- Designed for returning to an open or declined pull request in a new session without re-running exploratory and planning stages (`scout`, `clarify`, `branch`, `plan`, `execute`, `contract`).
- Operates directly on the active PR branch using targeted fixup commits (`git commit -m "fix: ..."`) and force-pushes with `git push --force-with-lease`.

### When to Use Which Pipeline

- **Feature Pipeline Built-in Fix Loop**: Used automatically during active feature development when PR creation or local checks fail within the same session.
- **Fix Pipeline (`crewmate-fix-pipeline`)**: Recommended when starting a new session to address reviewer feedback or remote CI failures on an already-opened PR (run with `crewmate workflow run crewmate-fix-pipeline`).

---

## CLI Commands

| Command | Description |
|---|---|
| `crewmate init [-f] [-e\|--example]` | Scaffold `.crewmate/` contracts, workflows, and initialize state (opt-in example with `-e`) |
| `crewmate status` | Display current node, retry counts, and gate status |
| `crewmate watch [--fps <n>]` | Launch read-only live TUI observer |
| `crewmate context [--node <id>] [-m <mod>]` | Assemble tiered context bundle for model prompt injection |
| `crewmate query <module> -f <field>` | Single-field contract lookup without dumping full contracts |
| `crewmate gate check --node <id> [--phase <p>]` | Execute hard guardrail checks for a given node |
| `crewmate advance` | Re-verify post-gates on disk; advance or route back on failure |
| `crewmate goto <node> [-f]` | Manual override to transition directly to a specified node |
| `crewmate scan arch` | AST-based dependency direction check against `architecture.yaml` |
| `crewmate scan dead-code` | AST-based dead code scan cross-referenced with declared public APIs |
| `crewmate activity start --agent <a> --label <l>` | Log start of an agent activity (supports `--node`, `--parent`, `--meta`) |
| `crewmate activity end --id <id> [--status <s>]` | Log end of an activity (`completed`, `failed`, `interrupted`) |
| `crewmate activity list [--active]` | List activities with optional filters (`--active`, `--node`, `--agent`) |
| `crewmate activity tree` | Display activity tree showing parent/child nesting and unclosed items |
| `crewmate activity reconcile [--reason <r>]` | Reconcile and close stale or orphaned unclosed activities |
| `crewmate task create --contract <c> --files <f> --goal <g>` | Create an atomic, contract-scoped task with dependency checking |
| `crewmate task list [--status <s>]` | List tasks with optional status filter |
| `crewmate task start --id <id>` | Attempt atomic lock-grant and start task (sets `active` or `blocked`) |
| `crewmate task amend --id <id> --add-file <f>` | Request scope extension via atomic lock-grant |
| `crewmate task complete --id <id>` | Run completion gate backstop & contract gates; finalize task |
| `crewmate task locks` | Display active file lock table |
| `crewmate task conflicts` | Display scope conflict history and metrics per module |
| `crewmate workflow list` | List available workflows and show active workflow |
| `crewmate workflow run <name> [-f]` | Switch to and run a named workflow, auto-archiving previous run |
| `crewmate workflow reset [-r <reason>] [-n <node>] [-f]` | Reset workflow run to initial or specified node |
| `crewmate workflow report [--run <id>]` | View latest or specified workflow run report (Markdown or JSON) |
| `crewmate reset [-r <reason>] [-n <node>] [-f]` | Alias for `crewmate workflow reset` |
| `crewmate archive [runId]` | Archive run data (events, completed tasks, activities, report) to `.crewmate/archive/<runId>/` |
| `crewmate archive list` | List all archived workflow runs |

> **Note**: All CLI commands accept `-p, --project-root <dir>` to target an external workspace, and `--json` for structured JSON output.

For detailed command options and examples, see **[Docs Placeholder]**.

---

## OpenCode v2 Plugin

Crewmate includes a native OpenCode v2 harness plugin (`src/adapters/opencode/index.ts`). Running `crewmate init` automatically generates `.opencode/plugins/crewmate.ts` and the specialized orchestrator agent `.opencode/agents/matte.md`, along with the workflow subagents (`scout`, `planner`, `builder`, `contractor`, `verifier`) for zero-configuration orchestration.

The plugin provides:
- **Matte Orchestrator Agent**: A dedicated agent (`matte`) that drives the workflow state machine by briefing subagents, evaluating gate checks, and calling `crewmate_advance` without modifying source files directly.
- **Workflow Subagents**: Specialized phase agents (`scout`, `planner`, `builder`, `contractor`, `verifier`) with tailored permission sandboxes, ready for direct invocation by the user or delegation by Matte:
  - `planner`: Operates under `contracts-write` scope to author "future contracts" (`status: draft`) for greenfield modules before implementation begins.
  - `builder`: Executes file-locked implementation tasks bound to existing or draft contracts.
  - `contractor`: Reconciles draft contracts with actual implementation diffs, upgrading them to `status: final`.
- **Automatic Context Injection**: Injects tiered module contracts and subagent directives into the system prompt.
- **Tool Execution Guardrails**: Enforces read-only and `contracts-write` node scopes, tools whitelisting, forbidden path patterns, and file-level task locks.
- **23 Native Agent Tools**: Subagents can self-govern using tools like `crewmate_advance`, `crewmate_status`, `crewmate_task_*`, `crewmate_activity_*`, `crewmate_workflow_*`, and `crewmate_archive*`.

For detailed plugin architecture, hook configuration, and custom harness adapters, see **[Docs Placeholder]**.

---

## Live TUI Observer (`crewmate watch`)

`crewmate watch` launches a read-only, real-time terminal UI observer built in Rust with [Ratatui](https://ratatui.rs) and [Tachyonfx](https://github.com/sand4rt/tachyonfx).

### Native Binary Installation

The pre-built native `crewmate-watch` binary for your platform (Linux, macOS, Windows) is automatically downloaded and verified via `npm postinstall`. If the postinstall step is skipped (for example, when using `--ignore-scripts`), `crewmate watch` automatically falls back to an on-demand lazy download the first time the command is executed.

### Features

- **Strictly Read-Only**: Never alters workspace files or mutates engine state.
- **Visual Workflow Graph**: Renders live node transitions with smooth tweened animations (`[1] Workflow`).
- **Parallel Task Board**: Live lock tables, running/waiting task queues, and blocker diagnostics (`[2] Tasks`).
- **Contracts Registry**: Interactive browser for module public APIs, invariants, dependencies, and capabilities (`[3] Contracts`). Cycle subviews bidirectionally (`←/→` or `m/a/p`), select items (`↑/↓`), and press `Enter` to open a full-screen scrollable detail view (`Esc` or `Enter` to dismiss).
- **Adaptive Layout**: Automatically degrades gracefully across narrow or compact terminals.

For keybindings, configuration options, and custom themes, see **[Docs Placeholder]**.

---

## Testing

```bash
# Build TypeScript
npm run build

# Run full test suite (12 test suites, 49 tests)
npm test

# Run tests directly against TypeScript sources
npm run test:src
```

---

## Contributing & License

Contributions are welcome! Please feel free to submit issues and pull requests on GitHub.

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
