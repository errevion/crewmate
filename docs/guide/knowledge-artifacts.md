# Knowledge Artifacts

In multi-agent collaborative systems, AI agents operate with independent execution contexts and transient context windows. Without structured, incremental memory, agents frequently suffer from rediscovery loops: re-inspecting the same directory trees, asking repetitive questions, making conflicting architectural choices, or violating interface contracts declared by concurrent workers.

Crewmate provides **Execution Artifacts**—a persistent, schema-validated knowledge base stored in SQLite (`.crewmate/crewmate.db`). Every artifact belongs to an active Brief and is optionally anchored to a specific Task. Artifacts serve as cross-session memory, contract enforcement gates, and real-time synchronization channels across all participating agents.

---

## Why Incremental Artifacts?

1. **Cross-Session Memory**: Context persists beyond individual LLM context windows or CLI sessions. When a task completes, its key decisions and discovered realities remain instantly queryable.
2. **Contract Enforcement**: Downstream agents can inspect exact TypeScript or API signatures declared by upstream agents before writing code that depends on them.
3. **Avoiding Rediscovery**: A Scout agent discovers environment configurations or project quirks once; subsequent Executor agents read the verified facts without re-running discovery scripts.
4. **Strict Completion Gates**: By default, Crewmate prevents tasks from reaching `completed` status unless the required knowledge artifacts have been properly recorded.

---

## The 6 Artifact Categories

Every artifact belongs to one of six core categories. Each category represents a distinct semantic purpose and comes with a structured payload schema:

| Type | Purpose | Key Payload Fields |
| :--- | :--- | :--- |
| `fact` | Concrete, verifiable discoveries about the project or system state | `statement`, `evidence`, `scope` |
| `decision` | Architecture, library, or design choices with documented rationale | `choice`, `rationale`, `alternatives`, `reversible` |
| `api_contract` | Route definitions, interface schemas, or exported function signatures | `signature`, `filePath`, `exportName`, `consumers` |
| `constraint` | Hard requirements, security boundaries, or conventions future tasks must follow | `rule`, `severity`, `scope`, `violation` |
| `note` | Informational commentary, operational findings, or scratchpad context | `summary`, `details` |
| `log` | Diagnostic traces, test outputs, or step-by-step audit logs | `summary`, `details` |

---

### 1. `fact`
Records a concrete discovery verified during execution or research.

**JSON Payload Schema**:
```json
{
  "statement": "SQLite WAL mode is enabled by default with busy_timeout=5000ms",
  "evidence": "Observed in src/db/connection.ts line 28",
  "scope": "module" // "project" | "module" | "file"
}
```

- `statement` (*string, required*): The discovered fact.
- `evidence` (*string, optional*): How or where the fact was verified.
- `scope` (*string, optional*): Granularity (`project`, `module`, or `file`).

---

### 2. `decision`
Documents an architectural, technological, or algorithmic choice made by an agent or human.

**JSON Payload Schema**:
```json
{
  "choice": "Adopt blessed for terminal dashboard rendering",
  "rationale": "Provides mature alternate screen buffer support and clean TUI widget hierarchies",
  "alternatives": ["ink", "terminal-kit"],
  "reversible": false
}
```

- `choice` (*string, required*): The decision or pattern adopted.
- `rationale` (*string, required*): Reason for choosing this approach.
- `alternatives` (*string[], optional*): Rejected alternatives considered.
- `reversible` (*boolean, optional*): Whether this decision is easily reversed later.

---

### 3. `api_contract`
Exposes an explicit programmatic interface, route definition, or data type for downstream tasks to consume.

**JSON Payload Schema**:
```json
{
  "signature": "export function listArtifacts(db: Database, filter?: ListArtifactsFilter): ExecutionArtifact[]",
  "filePath": "src/db/artifact-repo.ts",
  "exportName": "listArtifacts",
  "consumers": ["src/commands/artifact.ts", "src/commands/watch.ts"]
}
```

- `signature` (*string, required*): Function, class, type, or route contract signature.
- `filePath` (*string, required*): Target source file exposing the export.
- `exportName` (*string, optional*): Named export or identifier.
- `consumers` (*string[], optional*): Known downstream consumer modules or tasks.

---

### 4. `constraint`
Declares strict rules, security boundaries, or operational policies future agents must respect.

**JSON Payload Schema**:
```json
{
  "rule": "Never run raw shell file edits on Windows without normalized path separators",
  "severity": "must", // "must" | "should" | "prefer"
  "scope": "cross-platform",
  "violation": "Path separator mismatch corrupts SQLite lock entries"
}
```

- `rule` (*string, required*): The requirement or restriction.
- `severity` (*string, required*): Enforcement level (`must`, `should`, or `prefer`).
- `scope` (*string, optional*): Architectural or functional domain.
- `violation` (*string, optional*): Risk or failure mode if violated.

---

### 5. `note`
Stores general observations, implementation scratchpads, or guidance for reviewers.

**JSON Payload Schema**:
```json
{
  "summary": "Completed migration 003 for execution_artifacts table",
  "details": "Added status column, foreign key for superseded_by, and index on (brief_id, status)"
}
```

- `summary` (*string, required*): One-line summary.
- `details` (*string, optional*): Extended explanation or walkthrough.

---

### 6. `log`
Captures diagnostic traces, test run results, or command output snapshots.

**JSON Payload Schema**:
```json
{
  "summary": "Vitest test suite passed: 48 tests across 6 suites",
  "details": "All unit tests in tests/unit/artifact-validation.test.ts succeeded in 1.42s"
}
```

- `summary` (*string, required*): High-level result or operation title.
- `details` (*string, optional*): Raw output, stack trace, or benchmark data.

---

## Normalization & Relaxed Object Parsing

Agents frequently output payloads in varied formats—such as raw JSON, unquoted JavaScript object literals, or multiline key-value strings. 

Crewmate includes a robust parsing engine (`parseRelaxedObject`) that normalizes input content transparently before database persistence:

1. **Standard JSON**: Evaluates direct JSON payloads and handles double-encoded JSON strings (`"{\"statement\": ...}"`).
2. **Relaxed Object Literals**: Parses unquoted JavaScript syntax, such as `{ choice: "Use SQLite", rationale: "Zero config" }` or `{ signatures: [listArtifacts, getArtifact] }`.
3. **Multiline Key-Value Blocks**: Parses lines containing colon-separated values:
   ```yaml
   Rule: Always release file locks on error
   Severity: must
   Scope: execution
   ```
4. **Plain Strings**: If plain text is supplied (e.g. `--content "Discovered Node 20 runtime"`), Crewmate automatically maps the string into the primary field of the specified artifact type (e.g. `statement` for `fact`, `choice` for `decision`, `signature` for `api_contract`, `rule` for `constraint`, or `summary` for `note`/`log`).

---

## Lifecycle: `active`, `superseded`, `invalidated`

Artifacts follow an explicit lifecycle to ensure outdated knowledge does not mislead future agents:

```
                  ┌────────────┐
                  │   active   │
                  └─────┬──────┘
           ┌────────────┴────────────┐
           ▼                         ▼
   ┌───────────────┐         ┌───────────────┐
   │  superseded   │         │  invalidated  │
   │ (replaced by  │         │ (obsolete or  │
   │  newer item)  │         │  refuted)     │
   └───────────────┘         └───────────────┘
```

- **`active`**: Current, valid knowledge item. Default state for newly added artifacts. Only active artifacts are returned by default filters and satisfy completion gates.
- **`superseded`**: An artifact that has been replaced by a newer version. Maintains a `superseded_by` pointer referencing the newer artifact ID, preserving historical audit trails.
- **`invalidated`**: An artifact marked as wrong, deprecated, or no longer applicable.

---

## Automatic API Contract Superseding

When an agent records an `api_contract`, keeping outdated signatures active risks breaking concurrent workers. 

Crewmate automatically detects when a new `api_contract` is recorded for the same file and export:

```typescript
// When inserting an active api_contract:
const samePath = prev.filePath.toLowerCase() === newContract.filePath.toLowerCase();
const sameExport = (!newContract.exportName && !prev.exportName) ||
                   newContract.exportName === prev.exportName;

if (samePath && sameExport) {
  // Automatically mark the previous contract as superseded by the new one
  UPDATE execution_artifacts 
  SET status = 'superseded', superseded_by = :newId 
  WHERE id = :prevId;
}
```

This ensures downstream agents always query the latest interface contract for any given export without requiring manual deprecation steps.

---

## DAG-Aware Filtering (`--for-task`)

When an Executor picks up a task, it does not need to drown in the entire project's artifact history. It needs:
1. Universal constraints and decisions established at the **Brief level**.
2. Specific contracts, facts, and decisions produced by its **direct and indirect ancestor tasks** in the DAG.

Crewmate's `--for-task <taskId>` filter traverses the task graph dynamically:

```
        Brief Constraints (Universal)
                     │
               [Task A] (Ancestor) ──> establishes api_contract
                     │
               [Task B] (Ancestor) ──> records fact & decision
                     │
               [Task C] (Target Task: query with --for-task Task C)
```

### Traversal Algorithm
1. Finds the target task and loads all tasks for the brief.
2. Traverses `dependencies` transitively via BFS/queue to assemble the complete set of ancestor task IDs.
3. Filters the artifact database to include only:
   - Brief-level artifacts (`taskId IS NULL`)
   - Artifacts whose `taskId` belongs to the ancestor set
4. Sorts results using strict **Type Priority**, ensuring safety constraints and contracts appear ahead of informational logs:

| Priority Rank | Artifact Type | Purpose |
| :---: | :--- | :--- |
| **1** | `constraint` | Hard boundaries and invariants that must not be broken |
| **2** | `api_contract` | Function and module contracts required for integration |
| **3** | `decision` | Architectural directions guiding implementation |
| **4** | `fact` | Concrete technical findings and configurations |
| **5** | `note` | Informational commentary and tips |
| **6** | `log` | Step-by-step diagnostic outputs |

---

## CLI Examples

### Adding Artifacts

```bash
# Add a fact tied to a specific task
crewmate artifact add a1b2c3d4 \
  --type fact \
  --content '{"statement": "Database connection pool defaults to 10", "scope": "module"}' \
  --tags db config

# Add a brief-level architectural constraint
crewmate artifact add \
  --brief b018ac92 \
  --type constraint \
  --content '{"rule": "All database writes must execute inside transactions", "severity": "must"}' \
  --tags architecture safety

# Add an API contract (with relaxed formatting)
crewmate artifact add e4f1a09b \
  --type api_contract \
  --content 'filePath: "src/auth/jwt.ts", signature: "verifyToken(token: string): Promise<UserSession>", exportName: "verifyToken"'
```

### Listing Artifacts

```bash
# List all active artifacts for the current brief
crewmate artifact list

# List artifacts upstream for a specific task (DAG-aware filtering)
crewmate artifact list --for-task e4f1a09b

# Filter by type and include superseded/invalidated items
crewmate artifact list --type constraint --status all
```

### Inspecting, Superseding, and Invalidating

```bash
# Get full details of an artifact by ID
crewmate artifact get art_8f2a1b0c

# Manually mark an old artifact as superseded by a newer one
crewmate artifact supersede art_old123 art_new456

# Invalidate an obsolete or erroneous artifact
crewmate artifact invalidate art_err789
```

---

## Harness Tool Counterparts

Multi-agent harnesses (such as OpenCode and Claude Code) interact with the knowledge base via dedicated tool abstractions:

| Harness Tool | CLI Equivalent | Description |
| :--- | :--- | :--- |
| `crewmate_add_artifact` | `crewmate artifact add` | Record a new knowledge fact, decision, contract, or constraint. |
| `crewmate_list_artifacts` | `crewmate artifact list` | Query artifacts with support for `--for-task`, `--type`, and `--status`. |

### Agent Protocol Example

When an Executor agent starts working on a task:

```json
// 1. Gather upstream contracts and constraints before writing code
{
  "tool": "crewmate_list_artifacts",
  "parameters": {
    "forTask": "e4f1a09b"
  }
}

// 2. Implement the feature, then record the exported API contract
{
  "tool": "crewmate_add_artifact",
  "parameters": {
    "taskId": "e4f1a09b",
    "type": "api_contract",
    "content": "{\"signature\": \"export function hashPassword(raw: string): Promise<string>\", \"filePath\": \"src/auth/crypto.ts\", \"exportName\": \"hashPassword\"}"
  }
}

// 3. Mark task completed (artifact compliance gate automatically passes)
{
  "tool": "crewmate_update_task",
  "parameters": {
    "taskId": "e4f1a09b",
    "status": "completed"
  }
}
```
