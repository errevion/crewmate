# Live Watch & Observability

Observing parallel multi-agent workflows in terminal environments can quickly become chaotic. When multiple subagents read files, claim locks, dispatch tasks, and record execution artifacts simultaneously, raw scrolling terminal logs obscure progress and make state inspection difficult.

Crewmate provides `crewmate watch`, an interactive, dual-timer terminal user interface (TUI) dashboard built with `blessed`. It gives human operators and supervisors a crystal-clear, real-time command center over brief progress, task states, lifecycle events, and active subagent activities.

---

## Dual-Timer Architecture

The live watch dashboard decouples state synchronization from smooth visual rendering using a dual-timer loop:

```
┌─────────────────────────────────────────┐
│     500ms Database Poller Timer         │ ─── Reads SQLite .crewmate/crewmate.db
│     (buildSnapshot / DB queries)        │     Updates task states, events, locks
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│     100ms Animation & Render Ticker     │ ─── Advances spinner frames, eases
│     (screen.render / widget redraw)     │     Unicode rail transitions, redraws
└─────────────────────────────────────────┘
```

1. **500ms Database Poller (`DEFAULT_INTERVAL_MS`)**:
   - Queries `.crewmate/crewmate.db` for the latest brief, task statuses, held file locks, execution artifacts, and lifecycle events.
   - Builds a consolidated `WorkflowSnapshot` without blocking the terminal input thread.
   - Configurable via the `--interval <ms>` CLI flag.

2. **100ms Animation Ticker (`ANIMATION_TICK_MS`)**:
   - Ticks at a steady 10Hz to drive running spinners (`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`), smooth character easing on the activity rails, and real-time elapsed time counters.
   - Repaints only when visual frames or snapshots change, ensuring low CPU utilization.

---

## Terminal Buffer & Screen Management

The watch dashboard manages terminal state cleanly to ensure no disruption to user terminal sessions or scrollback history:

- **Alternate Screen Buffer (`\x1b[?1049h`)**: Switched immediately upon startup. The dashboard renders on a dedicated single-page canvas without polluting your shell's scrollback history. When exiting, `\x1b[?1049l` restores your shell prompt and prior output completely intact.
- **Hidden Hardware Cursor**: Emits `\x1b[?25l` to hide the terminal cursor during live dashboard updates, eliminating annoying cursor flickering across frames.
- **Mouse Wheel Friendly**: Disables terminal mouse tracking modes (`\x1b[?1000l` through `\x1b[?1015l`) so terminal emulators handle trackpad or mouse wheel gestures cleanly without dumping escape character garbage into the view.
- **Graceful Signal Cleanup**: Registered cleanup handlers catch `SIGINT`, `SIGTERM`, and normal exits, restoring cursor visibility (`\x1b[?25h`) and destroying the screen cleanly before process termination.

---

## 4 Dashboard Panes

The main dashboard is divided into four responsive panels:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Header: Brief ID, Status, Goal, Task Completion Progress Bar           │
├───────────────────────────────────┬────────────────────────────────────┤
│ Tasks                             │ Events                             │
│ [✓] Init database repo            │ 18:20:11 frontman dispatched scout │
│ [→] Implement auth service (⠋)    │ 18:20:15 scout    started    repo  │
│ [ ] Add verification suite (ready)│ 18:20:45 executor locked     src/..│
├───────────────────────────────────┼────────────────────────────────────┤
│ Workflow / Stage Execution        │ Activity                           │
│ ● 1. Discussion [complete]        │ [Frontman] ─────●───── [Executor]  │
│ ➜ 2. Execution  [running]         │             │                      │
│ ○ 3. Verification [pending]       │             └─────── [Scout] (idle)│
└───────────────────────────────────┴────────────────────────────────────┘
│ Footer: Keyboard shortcuts & navigation hints                          │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. Header Pane
- **Brief ID & Status**: Shows active brief identifier, status (`draft` or `complete`), total event count, and harness connectivity.
- **Goal**: One-line summary of the active brief's objective.
- **Task Completion Bar**: Visual progress bar (`[██████░░░░] 6/10 tasks done · 2 running`).

### 2. Task Board Pane
Displays all tasks for the brief with live status indicators:
- `[✓]` (Green): Task is `completed`.
- `[→]` (Yellow): Task is `in_progress` with an animated spinner.
- `[ ]` (Cyan): Task is `pending` and marked as `(ready)` if all dependencies are fulfilled.
- `[!]` (Red/Yellow): Blocked by unfinished dependencies or paused due to an idle session / disconnected harness.

### 3. Event Feed Pane
Streams the last 12 workflow lifecycle events in chronological order:
- Displays local timestamp (`HH:mm:ss`), emitting `actor` (`frontman`, `scout`, `planner`, `executor`), event `type` badge, and truncated event description.
- Color-coded badges: `dispatched` (blue), `started` (yellow), `locked` (magenta), `artifact` (cyan), `completed` (green), `error` (red).

### 4. Activity Graph Pane
Visualizes live coordination between Frontman and dispatched subagents:
- Renders animated connection rails linking Frontman to active child workers (`Scout`, `Planner`, `Executor`).
- Displays live pulse markers (`●`) traveling along rails while subagents are running.
- Details the current Frontman activity state (e.g. `asking user question`, `analyzing requirements`, `orchestrating subagents`).

---

## Keyboard Navigation & Modal Overlays

The live watch dashboard provides full modal drill-down support using intuitive hotkeys:

| Key | Action | Description |
| :---: | :--- | :--- |
| `b` | Briefs Overlay | Opens the brief switcher and detail inspector. Press `Enter` to switch briefs or `v` to view fields. |
| `t` | Tasks Overlay | Opens the full task manager list. Press `Enter` to view detailed descriptions, dependencies, and locks. |
| `a` | Artifacts Overlay | Opens the knowledge artifacts explorer. Browse facts, contracts, and decisions; press `Enter` for raw JSON view. |
| `e` | Events Overlay | Opens the full audit log of lifecycle events with complete timestamped messages. |
| `w` | Workflow Overlay | Inspects current stage execution, active nodes, and iteration counts. |
| `Up` / `Down` (`k`/`j`)| Scroll List / Modal | Navigates through list items and scrolls detailed overlay content. |
| `PageUp` / `PageDown` | Fast Scroll | Scrolls modal content by 5 lines at a time. |
| `Esc` | Close Overlay | Closes the current modal overlay and returns to the main dashboard view. |
| `q` / `Ctrl-C` | Exit | Cleanly restores terminal buffers and exits the watch command. |

---

## Frontman Activity Tracking

Frontman coordinates the entire workflow. To provide visual transparency into what Frontman is doing at any moment, agents use the `crewmate activity` command family:

```bash
# Set Frontman's current active state
crewmate activity set analyzing --message "Evaluating codebase structure"

# Inspect the active state
crewmate activity get

# Clear the current activity state
crewmate activity clear

# View recent activity history
crewmate activity list --limit 10
```

### Supported Activity Types
- `questioning`: Frontman is formulating a question for the user.
- `awaiting_response`: Frontman is waiting for the human operator's reply.
- `analyzing`: Frontman is parsing Scout discoveries, requirements, or code structure.
- `planning`: Frontman or Planner is decomposing the brief into a task DAG.
- `orchestrating`: Frontman is preparing batches or dispatching subagents.
- `reviewing`: Frontman is evaluating completed tasks, artifacts, or test runs.
- `idle`: Frontman is standing by waiting for new instructions.

---

## Event Emission & Semantic Deduplication

Agents and plugins emit workflow lifecycle events using `crewmate event add`:

```bash
crewmate event add \
  --actor executor \
  --type locked \
  --task e4f1a09b \
  --message "Acquired lock on src/db/connection.ts"
```

### Semantic Deduplication Rules
Automated hooks and parallel agent retries can easily flood event streams with duplicate logs. Crewmate enforces strict deduplication rules inside `event add`:

1. **10-Second Duplicate Message Guard**: Any event with the exact same message within **10 seconds** is silently deduplicated.
2. **30-Second Task Lifecycle Guard**: Duplicate `started` or `completed` events for the same task (or singleton `scout`/`planner` passes) within **30 seconds** are ignored even if message wording differs slightly.
3. **10-Second Lock Deduplication**: Repeated `locked` events for the same task within **10 seconds** are deduplicated.
4. **15-Second Dispatch Guard**: Repeated `dispatched` events for the same task within **15 seconds** are deduplicated.

When an event is deduplicated, the existing event record is returned with status `ok: true`, preventing redundant rows in SQLite.

---

## Non-Interactive Mode (`--once`)

For CI/CD pipelines, headless testing, or automated monitoring scripts, run `crewmate watch` with `--once` (or pipe stdout in non-TTY environments):

```bash
crewmate watch --once
```

**Sample Output**:
```json
{
  "ok": true,
  "snapshot": {
    "briefId": "c6078a9f",
    "status": "draft",
    "goal": "Write developer documentation for Crewmate",
    "totalCount": 6,
    "completedCount": 4,
    "activeCount": 1,
    "tasks": [
      {
        "id": "e4f1a09b",
        "title": "Knowledge artifacts documentation",
        "status": "completed",
        "dependencies": []
      }
    ],
    "events": [
      {
        "id": "evt_01",
        "actor": "executor",
        "type": "completed",
        "message": "Finished writing guide",
        "createdAt": "2026-09-04T12:00:00.000Z"
      }
    ]
  }
}
```

---

## Rendering Configuration

The activity graph supports both rich Unicode box-drawing characters and clean ASCII fallbacks for basic terminal emulators.

By default, Crewmate auto-detects terminal capability (e.g. falling back to ASCII on legacy Windows Command Prompt). You can manually force the rendering engine using the `CREWMATE_GRAPH_RENDERER` environment variable:

```bash
# Force ASCII rails (ideal for Windows CMD or simple serial consoles)
export CREWMATE_GRAPH_RENDERER=ascii
crewmate watch

# Force Unicode characters
export CREWMATE_GRAPH_RENDERER=unicode
crewmate watch
```

| Element | Unicode Mode (`unicode`) | ASCII Mode (`ascii`) |
| :--- | :---: | :---: |
| Horizontal Rail | `─` | `-` |
| Branch | `│` | `\|` |
| Corner | `└` | `+` |
| Tee Junction | `├` | `+` |
| Activity Pulse | `●` | `o` |
| Agent Box Icon | `■` | `#` |

---

## CLI Summary

```bash
# Start live TUI dashboard on current brief
crewmate watch

# Watch a specific brief with custom 1-second polling
crewmate watch --brief b018ac92 --interval 1000

# Snapshot current workflow state as JSON (CI / automation)
crewmate watch --once

# Manage Frontman activity state
crewmate activity set analyzing --message "Verifying code integrity"
crewmate activity get
crewmate activity clear

# Manually emit an event
crewmate event add --actor executor --type artifact --message "Recorded API contract for auth"
```
