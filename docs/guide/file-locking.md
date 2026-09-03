# File Locking & Safety

In multi-agent systems, autonomous AI agents execute tasks concurrently. Without strict synchronization, parallel workers can easily overwrite each other's edits, produce split-brain code states, or create merge collisions.

Crewmate provides a centralized, database-backed file locking protocol integrated with harness-level tool guards to prevent race conditions and ensure file integrity during parallel execution.

---

## Why File Locking is Critical for Parallel AI Agents

When multiple AI executors operate concurrently across a codebase:

- **Race Conditions**: Two agents might read the same file at version $T_0$, apply different modifications, and overwrite each other's work at $T_1$, silently dropping changes.
- **Inconsistent Partial States**: An agent compiling or running unit tests might observe half-finished writes from another agent operating on a shared dependency or utility file.
- **Token & Resource Waste**: If two agents independently attempt to refactor overlapping modules without coordination, one or both tasks inevitably fail during merge or verification, wasting LLM context and API spend.

Crewmate solves this with **pessimistic file leases**: before touching any file, an executor must claim an exclusive lease. If a target file is already leased by another active task, acquisition fails immediately, allowing the agent to abort gracefully or wait rather than corrupting code.

---

## Lock Mechanics

Crewmate manages locks through its SQLite database (`.crewmate/crewmate.db`) using strict transactional guarantees and lease lifecycles.

### 1. Cross-Platform Path Normalization

File paths vary across operating systems and AI harness conventions (e.g., Windows backslashes `\` vs. POSIX forward slashes `/`, absolute paths vs. workspace-relative paths, case-insensitive filesystems).

Crewmate normalizes every file path before evaluation or storage via `normalizeFilePath`:

```typescript
// src/db/lock-repo.ts
export function normalizeFilePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return '';
  const resolved = resolve(trimmed);
  const root = findProjectRoot(process.cwd());
  const rel = relative(root, resolved);
  const normalized = rel.replace(/\\/g, '/');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLowerCase()
    : normalized;
}
```

- **Workspace-Relative**: Converts absolute paths to relative paths relative to the project root.
- **Forward Slashes**: Replaces all `\` with `/`.
- **Case Normalization**: Converts paths to lowercase on Windows (`win32`) and macOS (`darwin`) to prevent collisions on case-insensitive filesystems (e.g., `src/App.tsx` vs `src/app.tsx`).

### 2. Atomic All-or-Nothing Acquisition

When an agent requests locks on multiple files (e.g., `['src/router.ts', 'src/types.ts']`), acquisition is **atomic** within an immediate SQLite transaction:

- If **all** requested files are available (or already owned by the same task), all locks are granted simultaneously.
- If **any** file is held by another active task, the transaction aborts without locking *any* files. Partial claims are impossible, preventing partial-write deadlocks.

```json
// Failure output when a conflict occurs
{
  "ok": false,
  "error": "File already locked by task c2e4910a: src/router.ts",
  "conflict": "src/router.ts",
  "lockedBy": "c2e4910a"
}
```

### 3. Lease Duration (5 Minutes)

Locks are not indefinite. Every acquired lock is assigned an expiration timestamp set to 5 minutes into the future:

```sql
INSERT INTO file_locks (id, task_id, file_path, expires_at)
VALUES (?, ?, ?, datetime('now', '+5 minutes'))
```

This prevents orphaned locks from permanently freezing files if an agent crashes, gets aborted by a user, or loses network connectivity.

### 4. Automatic Heartbeat Renewal (Every 4 Seconds)

Long-running tasks need to retain locks past the initial 5-minute window without manual intervention. The Crewmate harness plugin runs a background heartbeat timer every **4 seconds**:

1. Identifies all active tasks with held locks (`activeLockedTasks`).
2. Calls `lock list --task <taskId>` to retrieve currently held files.
3. Automatically renews active leases by re-invoking `lock acquire` for the task, resetting `expires_at` to `datetime('now', '+5 minutes')`.
4. When the task finishes and releases its locks, it is removed from `activeLockedTasks`.

### 5. Deadlock Prevention & Crash Recovery

Crewmate employs two layers of protection against stale or orphaned locks:

- **Lazy Purge on Acquisition**: Every `acquireLocks` call begins by running:
  ```sql
  DELETE FROM file_locks WHERE expires_at IS NOT NULL AND expires_at < datetime('now');
  ```
  If a lock has expired, subsequent acquisition requests will immediately reclaim it without administrative intervention.
- **Manual / CI Purge (`clean-stale`)**: Teams and automation scripts can trigger immediate cleanup of expired leases using the CLI command `crewmate lock clean-stale`.
- **Force Unlocking (`unlock` / `clear`)**: If an unrecoverable failure occurs, human operators or supervisor agents can surgically release specific files or clear locks completely.

---

## Tool Interception Guard

Relying solely on agent prompts to voluntarily call locking tools is insufficient—an agent might attempt to invoke file write tools directly.

Crewmate enforces safety at the harness boundary. In the OpenCode/agent plugin template, the harness registers an **intercepting tool guard** inside the `tool.execute.before` lifecycle hook:

```typescript
// Plugin lifecycle: intercept before tool execution
if ((toolName === "edit" || toolName === "write") && args) {
  const filePath = args.filePath || args.file_path || args.path || "";
  if (typeof filePath === "string" && filePath.trim()) {
    const locksResult = await runCrewmate(targetDir, ["lock", "list"]);

    if (locksResult?.ok && Array.isArray(locksResult.locks)) {
      const rel = normalizePath(filePath);
      const lockForFile = locksResult.locks.find(l => l.filePath === rel);

      if (lockForFile) {
        const currentSession = sessionAgentMap.get(sessionId);
        const isOwner = currentSession?.taskId === lockForFile.taskId;

        if (!isOwner) {
          // Record violation event to observability log
          await runCrewmate(targetDir, [
            "event", "add",
            "--actor", "executor",
            "--type", "error",
            "--task", lockForFile.taskId,
            "--message", `Lock violation: ${toolName} on ${rel} locked by task ${lockForFile.taskId}`
          ]);

          // Throwing an error aborts the edit/write tool before execution
          throw new Error(
            `File is locked by task ${lockForFile.taskId}: ${rel}. Acquire the lock first or wait for the task to complete.`
          );
        }
      }
    }
  }
}
```

### How the Guard Works

1. **Interception**: Whenever any agent invokes `edit` or `write`, the plugin intercepts the call before the filesystem operation runs.
2. **Path Resolution**: Resolves and normalizes the target path against the project root.
3. **Ownership Verification**: Queries the database for active locks on that file and checks if the calling session owns the matching `taskId`.
4. **Hard Rejection**: If another task owns the lock (or if the file is locked and caller has no task ID), execution throws an error immediately, blocking changes to disk and emitting an error event to the live watch dashboard.

---

## CLI Reference

Crewmate provides a full set of CLI commands for inspecting and managing file locks directly from the terminal.

### 1. Acquire Locks

Claim exclusive write leases on one or more files for a task.

```bash
crewmate lock acquire <task-id> --files <path1> [path2...]
```

**Example:**
```bash
crewmate lock acquire 8a2f1b4c --files src/services/auth.ts src/models/user.ts
```

**Output:**
```json
{
  "ok": true,
  "taskId": "8a2f1b4c",
  "files": [
    "src/services/auth.ts",
    "src/models/user.ts"
  ]
}
```

### 2. Release Locks

Release locks held by a task. If `--files` is omitted, all locks held by the task are released.

```bash
# Release specific files
crewmate lock release <task-id> --files <path1> [path2...]

# Release all locks held by task
crewmate lock release <task-id>
```

**Example:**
```bash
crewmate lock release 8a2f1b4c
```

**Output:**
```json
{
  "ok": true,
  "taskId": "8a2f1b4c",
  "released": 2
}
```

### 3. List Active Locks

View currently held file locks, optionally filtering by task ID.

```bash
# List all active locks
crewmate lock list

# Filter by task ID
crewmate lock list --task <task-id>
```

**Output:**
```json
{
  "ok": true,
  "locks": [
    {
      "id": "e9a14d22",
      "taskId": "8a2f1b4c",
      "filePath": "src/services/auth.ts",
      "createdAt": "2026-09-04 10:15:00",
      "expiresAt": "2026-09-04 10:20:00"
    }
  ]
}
```

### 4. Unlock a Specific File

Force-release a lock on a single file regardless of which task holds it.

```bash
crewmate lock unlock <file-path>
```

**Example:**
```bash
crewmate lock unlock src/services/auth.ts
```

**Output:**
```json
{
  "ok": true,
  "filePath": "src/services/auth.ts",
  "released": true
}
```

### 5. Purge Expired Locks (`clean-stale`)

Immediately purge all expired locks from SQLite.

```bash
crewmate lock clean-stale
```

**Output:**
```json
{
  "ok": true,
  "purged": 1
}
```

### 6. Force Clear Locks (`clear`)

Force-release all locks in the entire repository, or all locks belonging to a specific task.

```bash
# Clear all locks across all tasks
crewmate lock clear

# Clear all locks held by a specific task
crewmate lock clear --task <task-id>
```

**Output:**
```json
{
  "ok": true,
  "released": 4
}
```

---

## Harness Tool Counterparts

Inside agent harnesses (such as OpenCode), agents interact with locks via specialized tool definitions that map directly to the CLI commands.

| Agent Tool | Parameters | CLI Equivalent | Description |
| :--- | :--- | :--- | :--- |
| `crewmate_acquire_lock` | `taskId: string`, `files: string[]` | `crewmate lock acquire` | Claim write leases on target files before editing. Fails atomically if any file is taken. |
| `crewmate_release_lock` | `taskId: string`, `files?: string[]` | `crewmate lock release` | Release leases when a task completes, fails, or no longer needs specific files. |
| `crewmate_list_locks` | `taskId?: string` | `crewmate lock list` | Inspect current locks to see which files are active or held by other workers. |
| `crewmate_clear_locks` | `taskId?: string` | `crewmate lock clear` | Administrative recovery tool to forcibly unlock files on deadlock or crash. |

### Harness Usage Example

Below is the standard protocol followed by an autonomous `Executor` agent:

```typescript
// 1. Executor inspects task and claims locks before editing
const acquireResult = await crewmate_acquire_lock({
  taskId: "8a2f1b4c",
  files: ["src/controllers/user.ts", "src/models/user.ts"]
});

if (!acquireResult.ok) {
  // 2. Abort immediately if conflict occurs
  await crewmate_add_event({
    actor: "executor",
    type: "error",
    taskId: "8a2f1b4c",
    message: `Lock conflict on ${acquireResult.conflict} — task aborted`
  });
  return;
}

// 3. Mark in progress, perform edits and testing safely...
await crewmate_update_task({ taskId: "8a2f1b4c", status: "in_progress" });

// ... edit files and run tests ...

// 4. Record required artifacts & mark complete
await crewmate_add_artifact({
  taskId: "8a2f1b4c",
  type: "decision",
  content: "Refactored user controller to use async repository pattern"
});

await crewmate_update_task({ taskId: "8a2f1b4c", status: "completed" });

// 5. Clean up locks
await crewmate_release_lock({ taskId: "8a2f1b4c" });
```
