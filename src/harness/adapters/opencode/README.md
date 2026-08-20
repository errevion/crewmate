# OpenCode Adapter

This adapter integrates Crewmate with [OpenCode](https://opencode.ai). When you run `crewmate init --harness opencode`, it scaffolds everything OpenCode needs to run the Crewmate workflow: a plugin, two slash commands, and four agent prompts.

For the general harness architecture and how to build new adapters, see [../../README.md](../../README.md).

## What gets installed

`adapter.ts` writes the following files into the target project's `.opencode/` directory:

```text
.opencode/
  package.json              @opencode-ai/plugin dependency
  plugins/
    crewmate.ts             Tool bridge — wraps every crewmate CLI command as an OpenCode tool
  commands/
    brief.md                /brief slash command
    execute.md              /execute slash command
  agents/
    frontman.md             Orchestrator (primary agent)
    scout.md                Codebase explorer (subagent)
    planner.md              Task decomposer (subagent)
    executor.md             Implementer (subagent)
```

If `.opencode/package.json` already exists, the adapter merges `@opencode-ai/plugin` into its `dependencies` without overwriting other entries. The plugin version defaults to `^1.18.0` but can be overridden with the `CREWMATE_PLUGIN_VERSION` environment variable.

## Plugin (`crewmate-plugin.ts`)

The plugin is the bridge between OpenCode's tool system and the `crewmate` CLI. It registers every Crewmate operation as a native OpenCode tool so agents can call them without shelling out directly.

### Registered tools

| Tool | CLI equivalent | Purpose |
| --- | --- | --- |
| `crewmate_create_brief` | `crewmate brief init` | Create a new draft brief |
| `crewmate_update_field` | `crewmate brief set` | Set a brief field |
| `crewmate_get_field` | `crewmate brief get` | Read a brief field |
| `crewmate_show_brief` | `crewmate brief show` | Show the full brief |
| `crewmate_check_status` | `crewmate brief status` | Check brief completeness |
| `crewmate_finish_brief` | `crewmate brief complete` | Mark the brief as done |
| `crewmate_add_task` | `crewmate task add` | Add a task to a brief |
| `crewmate_list_tasks` | `crewmate task list` | List tasks for a brief |
| `crewmate_update_task` | `crewmate task update` | Change a task's status |
| `crewmate_remove_task` | `crewmate task remove` | Delete a task |
| `crewmate_acquire_lock` | `crewmate lock acquire` | Claim file locks |
| `crewmate_release_lock` | `crewmate lock release` | Release file locks |
| `crewmate_list_locks` | `crewmate lock list` | Show active locks |
| `crewmate_add_artifact` | `crewmate artifact add` | Record a knowledge artifact |
| `crewmate_list_artifacts` | `crewmate artifact list` | List artifacts |
| `crewmate_add_event` | `crewmate event add` | Record a lifecycle event |
| `crewmate_list_events` | `crewmate event list` | List events |
| `crewmate_set_activity` | `crewmate activity set` | Set Frontman activity state |
| `crewmate_get_activity` | `crewmate activity get` | Get current activity |

### How the plugin calls Crewmate

Every tool invocation runs `crewmate <subcommand> <args>` in the project directory via OpenCode's shell helper (`$`), parses the JSON output, and returns a structured result to the calling agent. If the CLI exits with an error or returns invalid JSON, the tool throws so the agent can handle the failure.

### Automatic dispatch events

The plugin includes a `tool.execute.before` hook that detects when Frontman dispatches a subagent via the `task` tool. If the subagent type is `scout`, `planner`, or `executor`, the hook automatically records a `dispatched` event — with deduplication to avoid logging the same dispatch twice within 5 seconds.

## Slash commands

### `/brief`

Triggers Frontman to start a new briefing session. The command template instructs Frontman to:

1. Create a brief with `crewmate_create_brief`
2. Gather the five required fields conversationally (one or two at a time)
3. Dispatch Scout for codebase discovery
4. Discuss Scout's findings before setting optional fields
5. Finalize the brief and dispatch Planner for task breakdown
6. Present tasks for approval, persist them, and prompt for `/execute`

Accepts optional arguments (e.g. `/brief Add GitHub OAuth`) that Frontman uses as initial context.

### `/execute`

Triggers Frontman to begin the execution loop:

1. Retrieve tasks and check dependencies
2. Dispatch Executors in parallel for independent ready tasks
3. Continue automatically across batches without prompting
4. Pause only on errors or lock conflicts for user decision
5. Present a final summary when all tasks complete

## Agent prompts

Each agent prompt uses OpenCode's frontmatter format to declare its mode and permissions.

### Frontman (`agents/frontman.md`)

| Property | Value |
| --- | --- |
| Mode | `primary` |
| Can use | `question`, `task`, all `crewmate_*` tools |
| Cannot use | `edit`, `bash`, `read`, `glob`, `grep`, `webfetch`, `websearch` |

Frontman orchestrates the entire workflow but never touches files directly. It delegates codebase exploration to Scout, planning to Planner, and implementation to Executor. It is responsible for:

- Recording lifecycle events before every subagent dispatch
- Keeping the activity state updated for the `crewmate watch` dashboard
- Using the `question` tool for all user decisions

### Scout (`agents/scout.md`)

| Property | Value |
| --- | --- |
| Mode | `subagent` |
| Can use | `glob`, `grep`, `read`, `crewmate_add_event` |
| Cannot use | `edit`, `bash`, all other `crewmate_*` tools |

Scout is a read-only explorer. It inspects the repository's files, manifests, configs, and conventions, then returns an objective factual report. It does not recommend or prescribe — that is Frontman's job after discussing Scout's findings with the user.

### Planner (`agents/planner.md`)

| Property | Value |
| --- | --- |
| Mode | `subagent` |
| Can use | `glob`, `grep`, `read`, `crewmate_show_brief`, `crewmate_get_field`, `crewmate_add_event` |
| Cannot use | `edit`, `bash`, all other `crewmate_*` tools |

Planner reads the completed brief and the codebase structure, then decomposes the work into dependency-ordered implementation tasks. Each task includes a title, description, dependencies, and the brief field it addresses. Planner returns structured text that Frontman presents to the user for approval.

### Executor (`agents/executor.md`)

| Property | Value |
| --- | --- |
| Mode | `subagent` |
| Can use | `edit`, `bash`, `read`, `glob`, `grep`, `crewmate_update_task`, `crewmate_show_brief`, `crewmate_get_field`, `crewmate_acquire_lock`, `crewmate_release_lock`, `crewmate_list_locks`, `crewmate_add_artifact`, `crewmate_list_artifacts`, `crewmate_list_tasks`, `crewmate_add_event`, `crewmate_list_events` |
| Cannot use | `crewmate_create_brief`, `crewmate_update_field`, `crewmate_finish_brief`, `crewmate_add_task`, `crewmate_remove_task` |

Executor is the only agent that modifies files. It follows a strict protocol:

1. **Context** — Read task details, check prior artifacts for patterns and contracts
2. **Lock** — Acquire file locks; abort immediately on conflict
3. **Implement** — Edit files, run tests and lint via bash
4. **Document** — Record decisions, API contracts, and constraints as artifacts
5. **Complete** — Mark task done, emit completion event, release locks

## Customizing templates

All templates live in `templates/` and are embedded as string constants (for `.ts`) or raw imports (for `.md`) in `adapter.ts`. To modify agent behavior:

1. Edit the relevant `.md` file in `templates/agents/`
2. Rebuild Crewmate (`npm run build`)
3. Re-run `crewmate init --harness opencode` in your target project to update the scaffolded files

Changes to the plugin template (`crewmate-plugin.ts`) follow the same pattern. The plugin is exported as a `CREWMATE_PLUGIN` string constant and written verbatim into the target project.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CREWMATE_PLUGIN_VERSION` | `^1.18.0` | Override the `@opencode-ai/plugin` version written to `.opencode/package.json` |
