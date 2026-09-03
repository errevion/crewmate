# Harness Adapters

Crewmate coordinates multi-agent engineering workflows while remaining decoupled from any single AI development platform or editor. The **Harness System** establishes an abstraction layer between Crewmate's core orchestration capabilities (SQLite storage, briefs, task DAGs, file locking, and knowledge artifacts) and external AI coding assistants.

This guide details how the harness system operates, examines the built-in OpenCode adapter, explains manifest tracking and safe updates, and provides a walkthrough for implementing new harness adapters (such as Cursor, Claude Code, or proprietary agent runners).

---

## 1. What the Harness System Is

### Abstracting AI Assistants from Crewmate Core

AI coding assistants implement varied extension architectures:
- **OpenCode** uses TypeScript plugins (`@opencode-ai/plugin`), markdown slash commands (`.opencode/commands/`), and markdown agent definitions (`.opencode/agents/`).
- **Claude Code** relies on CLIs, system prompt files, tool definitions, and terminal subprocess pipes.
- **Cursor** leverages editor rules (`.cursorrules` or `.cursor/rules/`), IDE commands, and custom tool extensions.
- **Custom Agent Platforms** execute via HTTP servers, headless runtimes, or custom socket protocols.

If Crewmate were hardcoded to one assistant's directory conventions, prompt styles, or plugin APIs, it would be locked into that specific ecosystem.

```
┌────────────────────────────────────────────────────────┐
│                     Crewmate Core                      │
│   SQLite Database (.crewmate/crewmate.db)             │
│   CLI: brief | task | lock | artifact | workflow       │
│   State Engine: DAG validation, locks, events          │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
  ┌─────────────────────┐     ┌─────────────────────┐
  │  OpenCode Adapter   │     │   Custom Adapter    │
  │  (HarnessAdapter)   │     │  (Cursor, Claude)   │
  └──────────┬──────────┘     └──────────┬──────────┘
             ▼                           ▼
  ┌─────────────────────┐     ┌─────────────────────┐
  │   .opencode/        │     │  .cursor/ or config │
  │  plugins/crewmate.ts│     │  rules, scripts,    │
  │  commands/          │     │  MCP servers        │
  │  agents/*.md        │     │                     │
  └─────────────────────┘     └─────────────────────┘
```

The harness system solves this by making the scaffolding and integration layer pluggable:
1. **Core Engine Remains Pure**: Crewmate core exposes clean CLI subcommands and a local SQLite repository.
2. **Adapters Scaffold Platform Configurations**: Each adapter translates Crewmate operations into the native configuration format, tool bridge, and agent prompts expected by the target AI harness.
3. **Consistent Agent Experience**: Regardless of whether agents run in OpenCode or another harness, they interact with the same underlying state machine and concurrency guarantees.

---

## 2. Architecture

The harness architecture is defined in `src/harness/` and consists of typed interfaces, manifest helpers, and an adapter registry.

### The `HarnessAdapter` Interface

Every harness integration implements `HarnessAdapter` (`src/harness/types.ts`):

```typescript
export interface HarnessAdapter {
  /** Unique harness identifier (e.g. "opencode", "cursor", "claude-code") */
  name: string;

  /** Human-readable description displayed in CLI help */
  description: string;

  /**
   * Scaffolds harness files, prompts, and configurations into the target project.
   * Invoked by: crewmate init --harness <name>
   */
  install(targetDir: string): Promise<InstallResult>;

  /**
   * Updates harness integration files to match current Crewmate templates.
   * Invoked by: crewmate update --harness <name>
   */
  update(targetDir: string, options?: UpdateOptions): Promise<UpdateResult>;
}
```

### The `InstallResult` Interface

When an adapter installs integration files into a workspace, it returns an `InstallResult`:

```typescript
export interface InstallResult {
  /** Target harness identifier */
  harness: string;

  /** Relative paths of all files created or written */
  filesWritten: string[];
}
```

### Supporting Update Types

For template synchronization, adapters use additional types from `src/harness/types.ts`:

```typescript
export type FileUpdateAction = 
  | 'created' 
  | 'updated' 
  | 'unchanged' 
  | 'backed_up_and_updated';

export interface FileUpdateStatus {
  path: string;
  action: FileUpdateAction;
  backupPath?: string;
}

export interface UpdateOptions {
  force?: boolean;
  dryRun?: boolean;
  backup?: boolean;
}

export interface UpdateSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  backedUp: number;
}

export interface UpdateResult {
  harness: string;
  version: string;
  files: FileUpdateStatus[];
  backedUpFiles: string[];
  summary: UpdateSummary;
  dryRun?: boolean;
}
```

### The Adapter Registry (`registry.ts`)

The central registry (`src/harness/registry.ts`) tracks available adapters and provides lookup utilities:

```typescript
import type { HarnessAdapter } from './types.js';
import { OpenCodeAdapter } from './adapters/opencode/adapter.js';

const adapters: Record<string, HarnessAdapter> = {
  opencode: new OpenCodeAdapter(),
};

/** Get a specific adapter by name */
export function getAdapter(name: string): HarnessAdapter | undefined {
  return adapters[name];
}

/** List all registered adapter instances */
export function listAdapters(): HarnessAdapter[] {
  return Object.values(adapters);
}

/** Get identifiers of all registered adapters */
export function listAdapterNames(): string[] {
  return Object.keys(adapters);
}

/** Check if an adapter identifier is registered */
export function hasAdapter(name: string): boolean {
  return name in adapters;
}
```

The CLI (`crewmate init` and `crewmate update`) queries `listAdapterNames()` to validate input arguments and generate dynamic help messages:

```bash
crewmate init --help
# Options:
#   -H, --harness <name>   Target harness (opencode) (default: "opencode")
```

---

## 3. Supported Adapter: OpenCode

Crewmate includes first-class support for [OpenCode](https://opencode.ai) via `OpenCodeAdapter` (`src/harness/adapters/opencode/adapter.ts`).

### Files Scaffolded in `.opencode/`

Running `crewmate init --harness opencode` populates the project with:

```text
.opencode/
├── package.json              # Declares @opencode-ai/plugin and cross-spawn
├── plugins/
│   └── crewmate.ts           # Plugin bridge: tools, hooks, locks, heartbeats
├── commands/
│   └── workflow.md           # /workflow slash command definition
└── agents/
    ├── frontman.md           # Primary supervisor prompt & permissions
    ├── scout.md              # Codebase explorer subagent prompt
    ├── planner.md            # DAG task decomposer subagent prompt
    └── executor.md           # Implementation specialist prompt
```

Additionally, `getModularWorkflowFiles()` scaffolds default workflow stages and graph configurations into `.crewmate/workflows/` and `.crewmate/stages/`.

#### Merging `package.json`
If `.opencode/package.json` already exists in the target directory, the adapter preserves existing dependencies and merges required packages:
- `@opencode-ai/plugin`: `^1.18.0` (or overridden by the `CREWMATE_PLUGIN_VERSION` environment variable).
- `cross-spawn`: `^7.0.6` for reliable cross-platform process execution on Windows, macOS, and Linux.

### Bridging CLI Commands into Typed Tools

OpenCode agents do not directly invoke raw shell commands like `crewmate brief show`. Instead, `plugins/crewmate.ts` exposes native tools wrapped with Zod schemas:

```typescript
// .opencode/plugins/crewmate.ts
import { type Plugin, tool } from "@opencode-ai/plugin";
import spawn from "cross-spawn";

const z = tool.schema;

async function runCrewmate(directory: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("crewmate", args, {
      cwd: directory,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      const text = stdout.trim();
      let parsed: any = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch {}
      }
      if (code !== 0 || !text) {
        return reject(new Error(parsed?.error || stderr || `exit code ${code}`));
      }
      if (parsed?.ok === false && parsed.error) {
        return reject(new Error(parsed.error));
      }
      resolve(parsed);
    });
  });
}
```

The plugin maps each CLI command to a typed tool definition:

| OpenCode Tool Name | Backing CLI Command | Description |
| :--- | :--- | :--- |
| `crewmate_create_brief` | `crewmate brief init` | Initializes a new draft brief |
| `crewmate_update_field` | `crewmate brief set` | Sets a field value on the active brief |
| `crewmate_get_field` | `crewmate brief get` | Retrieves a field from the active brief |
| `crewmate_show_brief` | `crewmate brief show` | Displays the complete brief in JSON |
| `crewmate_check_status` | `crewmate brief status` | Evaluates brief completeness |
| `crewmate_finish_brief` | `crewmate brief complete` | Freezes brief into completed state |
| `crewmate_add_task` | `crewmate task add` | Creates an implementation task |
| `crewmate_list_tasks` | `crewmate task list` | Lists all tasks for a brief |
| `crewmate_update_task` | `crewmate task update` | Updates task status or attributes |
| `crewmate_acquire_lock` | `crewmate lock acquire` | Acquires exclusive file leases |
| `crewmate_release_lock` | `crewmate lock release` | Releases held file leases |
| `crewmate_list_locks` | `crewmate lock list` | Lists active file locks |
| `crewmate_add_artifact` | `crewmate artifact add` | Stores a knowledge artifact in SQLite |
| `crewmate_list_artifacts` | `crewmate artifact list` | Queries stored knowledge artifacts |
| `crewmate_add_event` | `crewmate event add` | Emits a workflow lifecycle event |
| `crewmate_list_events` | `crewmate event list` | Queries recorded lifecycle events |

### Interception Hooks & Runtime Guards

The OpenCode plugin utilizes OpenCode's lifecycle hooks (`tool.execute.before` and `tool.execute.after`) to enforce safety and maintain observability without agent intervention.

#### 1. Pre-Execution File Lock Enforcement
Before any tool that modifies workspace files (`edit` or `write`) executes, `tool.execute.before` checks the target file against active locks in SQLite:

```typescript
// .opencode/plugins/crewmate.ts (Inside tool.execute.before)
if ((toolName === "edit" || toolName === "write") && args) {
  const filePath = args.filePath || args.file_path || args.path || "";
  if (typeof filePath === "string" && filePath.trim()) {
    const locksResult = await runCrewmate(targetDir, ["lock", "list"]);
    if (locksResult?.ok && Array.isArray(locksResult.locks)) {
      const resolved = pathResolve(filePath.trim());
      let rel = pathRelative(targetDir, resolved).replace(/\\/g, "/");
      if (process.platform === "win32" || process.platform === "darwin") {
        rel = rel.toLowerCase();
      }

      const lockForFile = locksResult.locks.find((l: any) => {
        const lp = (process.platform === "win32" || process.platform === "darwin")
          ? l.filePath.toLowerCase()
          : l.filePath;
        return lp === rel;
      });

      if (lockForFile) {
        const currentSessionId = input?.sessionID || input?.sessionId;
        const trackedForSession = currentSessionId ? sessionAgentMap.get(currentSessionId) : null;
        const isOwner = trackedForSession?.taskId === lockForFile.taskId;

        if (!isOwner) {
          // Record violation event in SQLite
          await runCrewmate(targetDir, [
            "event", "add",
            "--actor", "executor",
            "--type", "error",
            "--task", lockForFile.taskId,
            "--message", `Lock violation: ${toolName} on ${rel} locked by task ${lockForFile.taskId}`,
          ]).catch(() => {});

          // Throwing an error terminates tool execution before file corruption occurs
          throw new Error(
            `File is locked by task ${lockForFile.taskId}: ${rel}. Acquire the lock first or wait for the task to complete.`
          );
        }
      }
    }
  }
}
```

If an unauthorized subagent attempts to write to a locked file, the hook blocks the write and raises an exception.

#### 2. Session Heartbeats & Lease Renewals
Locks expire after 5 minutes to prevent abandoned locks after crashes. The plugin initializes a recurring heartbeat every 4 seconds:

```typescript
// Send initial session heartbeat
runCrewmate(targetDir, ["session", "heartbeat", "--pid", String(pid), "--status", "active"]).catch(() => {});

const heartbeatInterval = setInterval(async () => {
  const currentStatus = sessionIdle ? "idle" : "active";
  runCrewmate(targetDir, ["session", "heartbeat", "--pid", String(pid), "--status", currentStatus]).catch(() => {});

  // Renew lock leases for all active locked tasks
  for (const taskId of activeLockedTasks) {
    const locksResult = await runCrewmate(targetDir, ["lock", "list", "--task", taskId]).catch(() => null);
    if (locksResult?.ok && Array.isArray(locksResult.locks) && locksResult.locks.length > 0) {
      const files = locksResult.locks.map((l: any) => l.filePath);
      await runCrewmate(targetDir, ["lock", "acquire", taskId, "--files", ...files]).catch(() => {});
    } else {
      activeLockedTasks.delete(taskId);
    }
  }
}, 4000);
```

#### 3. Automatic Subagent Dispatch Event Tracking
When Frontman invokes the `task` tool to spawn a subagent (`scout`, `planner`, or `executor`), `tool.execute.before` automatically records a `dispatched` event in SQLite. This feeds the live terminal dashboard (`crewmate watch`) without requiring manual boilerplate prompts.

---

## 4. Project Update and Integrity

As Crewmate evolves, plugin templates, agent prompts, and workflow definitions receive bug fixes and feature enhancements. The `crewmate update` command brings scaffolded integration files up to date while protecting user modifications.

### The Manifest File (`.crewmate/manifest.json`)

When an adapter installs or updates files, Crewmate writes metadata and SHA-256 content hashes to `.crewmate/manifest.json`:

```json
{
  "version": "0.3.0",
  "harness": "opencode",
  "installedAt": "2026-09-03T18:15:28.123Z",
  "updatedAt": "2026-09-03T18:30:00.456Z",
  "files": {
    ".opencode/plugins/crewmate.ts": {
      "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "updatedAt": "2026-09-03T18:15:28.123Z"
    },
    ".opencode/commands/workflow.md": {
      "hash": "84a7e9e4f1659a8fcf140fd034e357feef8fa1c4a5c5ee39ba518197793d5be7",
      "updatedAt": "2026-09-03T18:15:28.123Z"
    },
    ".opencode/package.json": {
      "hash": "cb8762d3a3f5de5fef7297e68fa792fcde9b4d3db2ad550e59a1f26ecdf2b1ff",
      "updatedAt": "2026-09-03T18:15:28.123Z"
    }
  }
}
```

### Update Detection Logic

When `crewmate update` executes, the adapter performs a three-way checksum comparison for every managed template file:

1. **New Template Hash (`newHash`)**: Computed from the current bundled version of the template.
2. **Current Disk Hash (`currentHash`)**: Computed from the actual file in the workspace directory.
3. **Recorded Manifest Hash (`previousHash`)**: Retrieved from `.crewmate/manifest.json`.

```
                    ┌─────────────────────────┐
                    │ File Exists on Disk?    │
                    └───────────┬─────────────┘
                                │
               ┌────────────────┴────────────────┐
               ▼ No                              ▼ Yes
      [ Action: CREATED ]            ┌─────────────────────────┐
      Write template file            │ currentHash == newHash? │
                                     └───────────┬─────────────┘
                                                 │
                                ┌────────────────┴────────────────┐
                                ▼ Yes                             ▼ No
                       [ Action: UNCHANGED ]          ┌─────────────────────────┐
                       No write required              │ currentHash ==          │
                                                      │ previousHash?           │
                                                      └───────────┬─────────────┘
                                                                  │
                                                 ┌────────────────┴────────────────┐
                                                 ▼ Yes (Unmodified by user)        ▼ No (User modified)
                                        [ Action: UPDATED ]               [ Action: BACKUP & UPDATE ]
                                        Overwrite with template           Create backup, then overwrite
```

- **Unchanged**: Disk matches the incoming template. No disk write occurs.
- **Updated**: Disk matches the previous recorded hash. The user has not touched the file, so it is safely updated to the new template version.
- **Created**: A new template was added in the latest Crewmate release that was not previously present.
- **Backed Up and Updated**: The user edited the file locally (`currentHash !== previousHash`). Crewmate archives the user's customized version in `.crewmate/backups/` before writing the new template.

### Backups (`.crewmate/backups/`)

User-modified files are backed up to a timestamped folder inside `.crewmate/backups/`:

```text
.crewmate/
└── backups/
    └── 2026-09-03T18-35-10-000Z/
        └── .opencode/
            └── plugins/
                └── crewmate.ts
```

This ensures custom modifications, altered prompts, or custom hooks can be reviewed and merged back after an update.

### Running Updates

```bash
# Standard update: inspects files, creates backups, writes new templates
crewmate update

# Specify target directory and harness
crewmate update --harness opencode --dir /path/to/project

# Dry run: preview planned actions without modifying any files
crewmate update --dry-run

# Disable automatic backups (force overwrite without saving copies)
crewmate update --no-backup

# Emit machine-readable JSON output
crewmate update --json
```

#### Example Output:

```text
Updated crewmate integration for opencode (v0.3.0)

Files:
  [UNCHANGED]         .opencode/commands/workflow.md
  [BACKUP & UPDATE]   .opencode/plugins/crewmate.ts
  [UPDATED]           .opencode/agents/frontman.md
  [CREATED]           .crewmate/workflows/software-development.json

Backups created:
  - .crewmate/backups/2026-09-03T18-35-10-000Z/.opencode/plugins/crewmate.ts

Summary: 2 updated, 1 created, 1 unchanged, 1 backed up
```

---

## 5. Guide: Implementing a New Adapter

Adding support for an AI assistant (such as Cursor, Claude Code, or a custom internal runner) requires implementing the `HarnessAdapter` interface and registering it with the harness registry.

### Step-by-Step Instructions

1. **Create Adapter Directory**: Create a folder under `src/harness/adapters/<name>/`.
2. **Implement Scaffolding Requirements**:
   - **Tool Bridge**: A mechanism exposing `crewmate` CLI subcommands (via MCP server, plugin script, or subprocess helper).
   - **Entry Points**: Slash commands, rules files (e.g. `.cursorrules`), or workflow runners.
   - **Agent Prompts**: Prompt instructions for Frontman, Scout, Planner, and Executor tailored to the platform's prompt formatting rules.
   - **Dependencies / Manifests**: Any platform configuration files (such as `mcp.json`, `package.json`, or extension configs).
3. **Implement `HarnessAdapter`**: Write `src/harness/adapters/<name>/adapter.ts` implementing `install()` and `update()`.
4. **Register the Adapter**: Import and add your adapter instance to `adapters` in `src/harness/registry.ts`.
5. **Verify with Tests & CLI**: Test running `crewmate init --harness <name>` and `crewmate update --harness <name>`.

### Scaffolding Requirements Checklist

| Requirement | Description | Example (OpenCode) | Example (Cursor / Claude) |
| :--- | :--- | :--- | :--- |
| **Tool Bridge** | Translates assistant tool calls to `crewmate <cmd>` | `.opencode/plugins/crewmate.ts` | MCP server or CLI runner wrapper |
| **Entry Points** | User command to trigger the workflow | `.opencode/commands/workflow.md` | `.cursor/rules/workflow.mdc` or prompt shortcut |
| **Agent Prompts** | Persona prompts for the 4 roles | `.opencode/agents/*.md` | System prompts or rule profiles |
| **Integrity Tracking**| Manifest tracking with SHA-256 hashes | `.crewmate/manifest.json` | Managed via `writeManifest()` |

### Code Example: Implementing a Custom Harness Adapter

Below is a complete implementation of a custom adapter (e.g., for Cursor) following Crewmate conventions:

```typescript
// src/harness/adapters/cursor/adapter.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  FileUpdateStatus,
  HarnessAdapter,
  InstallResult,
  ManifestFileEntry,
  UpdateOptions,
  UpdateResult,
} from '../../types.js';
import {
  computeHash,
  createBackup,
  CREWMATE_VERSION,
  readManifest,
  writeManifest,
} from '../../manifest.js';

const CURSOR_RULES_TEMPLATE = `# Crewmate Multi-Agent Orchestration Rules

You are Frontman, the supervisor orchestrator for Crewmate workflows.
Coordinate subagents for Scout (exploration), Planner (DAG task decomposition),
and Executor (safe implementation with file locks).

All state is recorded in .crewmate/crewmate.db via the Crewmate CLI or MCP tools.
`;

const MCP_CONFIG_TEMPLATE = JSON.stringify(
  {
    mcpServers: {
      crewmate: {
        command: "crewmate",
        args: ["mcp", "serve"],
      },
    },
  },
  null,
  2
) + '\n';

export class CursorAdapter implements HarnessAdapter {
  name = 'cursor';
  description = 'Cursor AI code editor integration';

  private getTemplateFiles(): Record<string, string> {
    return {
      '.cursor/rules/crewmate.mdc': CURSOR_RULES_TEMPLATE,
      '.cursor/mcp.json': MCP_CONFIG_TEMPLATE,
    };
  }

  async install(targetDir: string): Promise<InstallResult> {
    const filesWritten: string[] = [];
    const manifestEntries: Record<string, ManifestFileEntry> = {};
    const now = new Date().toISOString();

    const templates = this.getTemplateFiles();
    for (const [relPath, content] of Object.entries(templates)) {
      const absPath = join(targetDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, 'utf-8');

      filesWritten.push(relPath);
      manifestEntries[relPath] = {
        hash: computeHash(content),
        updatedAt: now,
      };
    }

    // Persist manifest tracking
    writeManifest(targetDir, this.name, manifestEntries, now);

    return {
      harness: this.name,
      filesWritten,
    };
  }

  async update(targetDir: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    const existingManifest = readManifest(targetDir);
    const manifestEntries: Record<string, ManifestFileEntry> = {
      ...(existingManifest?.files ?? {}),
    };
    const now = new Date().toISOString();

    const templates = this.getTemplateFiles();
    const fileStatuses: FileUpdateStatus[] = [];
    const backedUpFiles: string[] = [];

    for (const [relPath, newContent] of Object.entries(templates)) {
      const absPath = join(targetDir, relPath);
      const fileExists = existsSync(absPath);
      const newHash = computeHash(newContent);

      if (!fileExists) {
        if (!options.dryRun) {
          mkdirSync(dirname(absPath), { recursive: true });
          writeFileSync(absPath, newContent, 'utf-8');
          manifestEntries[relPath] = { hash: newHash, updatedAt: now };
        }
        fileStatuses.push({ path: relPath, action: 'created' });
        continue;
      }

      const currentContent = readFileSync(absPath, 'utf-8');
      const currentHash = computeHash(currentContent);

      if (currentHash === newHash) {
        fileStatuses.push({ path: relPath, action: 'unchanged' });
        manifestEntries[relPath] = { hash: newHash, updatedAt: now };
        continue;
      }

      // Check if user modified the file
      const previousHash = existingManifest?.files?.[relPath]?.hash;
      const isUserModified = previousHash && previousHash !== currentHash;
      const shouldBackup = options.backup !== false && (isUserModified || !previousHash);

      let backupPath: string | undefined;
      if (shouldBackup) {
        if (!options.dryRun) {
          backupPath = createBackup(targetDir, relPath);
          if (backupPath) backedUpFiles.push(backupPath);
        } else {
          backupPath = `.crewmate/backups/<timestamp>/${relPath}`;
          backedUpFiles.push(backupPath);
        }
      }

      if (!options.dryRun) {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, newContent, 'utf-8');
        manifestEntries[relPath] = { hash: newHash, updatedAt: now };
      }

      fileStatuses.push({
        path: relPath,
        action: backupPath ? 'backed_up_and_updated' : 'updated',
        ...(backupPath && { backupPath }),
      });
    }

    if (!options.dryRun) {
      writeManifest(targetDir, this.name, manifestEntries, existingManifest?.installedAt ?? now);
    }

    const summary = {
      total: fileStatuses.length,
      created: fileStatuses.filter((f) => f.action === 'created').length,
      updated: fileStatuses.filter((f) => f.action === 'updated' || f.action === 'backed_up_and_updated').length,
      unchanged: fileStatuses.filter((f) => f.action === 'unchanged').length,
      backedUp: backedUpFiles.length,
    };

    return {
      harness: this.name,
      version: CREWMATE_VERSION,
      files: fileStatuses,
      backedUpFiles,
      summary,
      ...(options.dryRun && { dryRun: true }),
    };
  }
}
```

### Registering in `src/harness/registry.ts`

To enable the new adapter in the CLI, add it to the `adapters` dictionary in `src/harness/registry.ts`:

```typescript
// src/harness/registry.ts
import type { HarnessAdapter } from './types.js';
import { OpenCodeAdapter } from './adapters/opencode/adapter.js';
import { CursorAdapter } from './adapters/cursor/adapter.js';

const adapters: Record<string, HarnessAdapter> = {
  opencode: new OpenCodeAdapter(),
  cursor: new CursorAdapter(),
};
```

Once registered, `crewmate init -H cursor` and `crewmate update -H cursor` immediately become available.
