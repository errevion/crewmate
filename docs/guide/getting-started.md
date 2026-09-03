# Getting Started

Crewmate is an orchestration framework and CLI tool designed for multi-agent software development workflows. It structures agent interactions into organized stages, models task execution as a Directed Acyclic Graph (DAG), coordinates subagents with strict role separation, prevents write collisions via dynamic file leases, and records incremental knowledge artifacts into a local database.

---

## Core Value Proposition

When large language model (LLM) agents collaborate on non-trivial codebases, they encounter key coordination failures:
- **Write Collisions & Race Conditions**: Agents overwrite each other's edits when executing parallel tasks.
- **Context Drift & Amnesia**: Upstream architecture decisions, interface signatures, and discovered constraints get lost between isolated agent sessions.
- **Unstructured Execution**: Flat agent execution lacks verification gates, progress observability, and dependency tracking.

Crewmate solves this by providing:
- **Strict Role Boundaries**: Dedicated agents for requirements interviewing (**Frontman**), read-only discovery (**Scout**), DAG decomposition (**Planner**), and isolated implementation (**Executor**).
- **Concurrency Safety via File Locks**: Leases with automatic timeout expiration and collision rejection prevent concurrent file overwrites.
- **Incremental Knowledge Base**: Gated task completion requiring structured facts, decisions, and API contracts stored locally in SQLite.
- **Workflow State Engine**: Resumable multi-stage workflows configured via modular JSON definitions.

---

## Prerequisites

Before installing Crewmate, ensure your environment meets the following requirements:

- **Node.js**: Version `>= 20.0.0`
- **npm** or **pnpm**
- **C/C++ Build Toolchain (for `better-sqlite3`)**:
  - Crewmate relies on native SQLite bindings via `better-sqlite3`.
  - **Windows**: Install the Visual Studio C++ Build Tools via Visual Studio Installer (workload: *Desktop development with C++*) or install `windows-build-tools`:
    ```powershell
    npm install --global --production windows-build-tools
    ```
    Alternatively, ensure `python` (3.x) and `node-gyp` dependencies are accessible in `PATH`.
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `build-essential` and `python3` (`sudo apt install build-essential python3`).

---

## Installation

Crewmate can be installed locally from source and linked globally:

```bash
# 1. Clone the repository
git clone https://github.com/errevion/crewmate.git
cd crewmate

# 2. Install dependencies
npm install

# 3. Build the CLI bundle
npm run build

# 4. Link the executable globally
npm link
```

Verify that the CLI is installed and available in your environment:

```bash
crewmate --version
# Output: 0.3.0
```

---

## Scaffolding a Workspace

Crewmate integrates with agent harnesses such as [OpenCode](https://opencode.ai) through adapters. To scaffold an existing project repository or empty directory:

```bash
# In your target project root:
crewmate init --harness opencode
```

You will see output detailing the scaffolded files:

```text
Initialized crewmate integration for opencode

Created files:
  - .opencode/plugins/crewmate.ts
  - .opencode/commands/workflow.md
  - .opencode/agents/frontman.md
  - .opencode/agents/scout.md
  - .opencode/agents/planner.md
  - .opencode/agents/executor.md
  - .crewmate/workflows/nodes/frontman-interview.json
  - .crewmate/workflows/nodes/validate-brief.json
  - .crewmate/workflows/nodes/scout-explore.json
  - .crewmate/workflows/nodes/planner-decompose.json
  - .crewmate/workflows/nodes/executor-run.json
  - .crewmate/workflows/nodes/verify-artifacts.json
  - .crewmate/workflows/stages/discussion.json
  - .crewmate/workflows/stages/research.json
  - .crewmate/workflows/stages/planning.json
  - .crewmate/workflows/stages/execution.json
  - .crewmate/workflows/stages/verification.json
  - .crewmate/workflows/default.json
  - .opencode/package.json
```

---

## Scaffolded Structure

Initializing a workspace generates two directories:

```text
my-project/
├── .crewmate/
│   ├── crewmate.db            # SQLite database (auto-created on first run)
│   ├── .manifest.json         # Tracks installed template versions & hashes
│   ├── backups/               # Automatic file backups created during updates
│   └── workflows/
│       ├── default.json       # Top-level workflow definition
│       ├── stages/            # Modular stage definitions (discussion, research, etc.)
│       └── nodes/             # Reusable execution nodes (interview, decompose, run, etc.)
└── .opencode/
    ├── package.json           # Harness dependencies (@opencode-ai/plugin, cross-spawn)
    ├── plugins/
    │   └── crewmate.ts        # Harness plugin exposing crewmate_* tools
    ├── commands/
    │   └── workflow.md        # /workflow slash command prompt definition
    └── agents/
        ├── frontman.md        # Primary orchestrator prompt & permission rules
        ├── scout.md           # Read-only explorer prompt & permission rules
        ├── planner.md         # Task decomposer prompt & permission rules
        └── executor.md        # Implementation specialist prompt & permission rules
```

### `.crewmate/` (Core State & Workflows)
- **`crewmate.db`**: Local SQLite database storing briefs, tasks, file locks, knowledge artifacts, workflow runs, and event logs.
- **`workflows/`**: JSON graph configurations defining stages, transitions, conditions, and subagent prompts.
- **`.manifest.json`**: Records SHA-256 hashes of generated files for version tracking and safe updates.

### `.opencode/` (Harness Integration)
- **`plugins/crewmate.ts`**: Implements tool bindings (`crewmate_create_brief`, `crewmate_acquire_lock`, `crewmate_add_task`, etc.) mapped to the `crewmate` CLI binary.
- **`agents/`**: Defines system prompts and strict tool permission matrices for each agent role.
- **`commands/workflow.md`**: Provides the entry point for the `/workflow` interactive command.

---

## Updating Projects

As Crewmate evolves, you can update templates, agent prompts, and harness plugins in existing workspaces:

```bash
# Preview changes without modifying files:
crewmate update --dry-run
```

Output:
```text
Updated crewmate integration for opencode (v0.3.0) [DRY RUN]

Files:
  [UNCHANGED]         .opencode/plugins/crewmate.ts
  [UNCHANGED]         .opencode/commands/workflow.md
  [BACKUP & UPDATE]   .opencode/agents/executor.md
  [UNCHANGED]         .opencode/package.json

Backups created:
  - .crewmate/backups/<timestamp>/.opencode/agents/executor.md

Summary: 1 updated, 0 created, 3 unchanged, 1 backed up
```

Apply the update:

```bash
crewmate update
```

### Safety & Backups
- If you modified any scaffolded template file (e.g., custom prompts in `.opencode/agents/frontman.md`), Crewmate detects hash differences against `.manifest.json`.
- Modified files are automatically preserved in `.crewmate/backups/<timestamp>/` before being updated.
- To disable automatic backups, pass `--no-backup`:
  ```bash
  crewmate update --no-backup
  ```

---

## Quick Tour & First Run

### 1. Interactive Execution via OpenCode

Inside OpenCode, trigger the workflow command:

```text
/workflow
```

What happens next:
1. **Discussion Stage**: Frontman initializes a brief session (`crewmate_create_brief`) and interviews you about requirements, scope, and technical stack.
2. **Research Stage**: Frontman dispatches **Scout** in read-only mode to scan repo architecture, existing dependencies, and conventions.
3. **Planning Stage**: **Planner** breaks down the approved brief into a DAG of concrete tasks, assigning dependencies and required artifacts (`crewmate_add_task`).
4. **Execution Stage**: Frontman launches **Executor** subagents. Executors acquire file locks (`crewmate_acquire_lock`), implement changes, execute test suites, record knowledge artifacts (`crewmate_add_artifact`), and mark tasks completed (`crewmate_update_task`).
5. **Verification Stage**: Artifact compliance and test suites are validated before marking the workflow run completed.

### 2. Live Watch Dashboard

In a separate terminal window, launch the interactive live TUI dashboard to monitor agent states, active locks, and the task graph in real time:

```bash
crewmate watch
```

The terminal interface displays:
- **Workflow & Stage Status**: Active stage, brief completeness, and elapsed time.
- **Task DAG**: Real-time statuses (`pending`, `in_progress`, `completed`).
- **File Locks**: Active leases held by specific task IDs.
- **Live Activity Feed**: Current subagent actions (`analyzing`, `planning`, `orchestrating`).

### 3. Direct CLI Management

You can inspect and manage your workspace directly from the command line:

```bash
# Show the active brief
crewmate brief show

# List tasks and their statuses
crewmate task list --brief <brief-id>

# View active file locks
crewmate lock list

# Inspect recorded knowledge artifacts
crewmate artifact list --brief <brief-id>
```
