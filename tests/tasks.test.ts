import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { CrewmateEngine } from "../src/core/engine/engine.js";
import { crewmatePlugin } from "../src/adapters/opencode/index.js";

const execAsync = promisify(exec);

describe("Parallel Task System", () => {
  it("creates tasks and verifies the 3 sources of dependency edges", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-task-deps-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Create two modules with a consumer relationship:
      // billing depends on auth, and auth declared_consumers includes [billing]
      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "modules", "auth.contract.yaml"),
        `module: auth
version: "1.0.0"
public_api:
  - export: "verifyToken"
    signature: "(t: string) => boolean"
    file: "src/auth/token.ts"
invariants: []
declared_consumers:
  - billing
`,
        "utf-8"
      );

      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "modules", "billing.contract.yaml"),
        `module: billing
version: "1.0.0"
public_api:
  - export: "charge"
    signature: "() => void"
    file: "src/billing/charge.ts"
invariants: []
declared_consumers: []
`,
        "utf-8"
      );

      // 1. Source 1: File overlap refusal
      // Task 1: touches src/auth/token.ts
      const task1 = await engine.createTask({
        id: "task_001",
        goal: "Update auth token validation",
        contract: "modules/auth.contract.yaml",
        files: ["src/auth/token.ts"],
      });
      assert.equal(task1.id, "task_001");
      assert.equal(task1.status, "pending");

      // Attempting to create Task 2 with overlapping file 'src/auth/token.ts' without depends_on MUST fail!
      await assert.rejects(
        async () => {
          await engine.createTask({
            id: "task_002",
            goal: "Refactor auth token",
            contract: "modules/auth.contract.yaml",
            files: ["src/auth/token.ts", "src/auth/helper.ts"],
          });
        },
        (err: Error) => {
          return (
            err.message.includes("Overlapping tasks cannot be parallel siblings") &&
            err.message.includes("task_001")
          );
        }
      );

      // Creating Task 2 with explicit depends_on: [task_001] succeeds and is tagged 'file-overlap'
      const task2 = await engine.createTask({
        id: "task_002",
        goal: "Refactor auth token",
        contract: "modules/auth.contract.yaml",
        files: ["src/auth/token.ts", "src/auth/helper.ts"],
        depends_on: ["task_001"],
      });
      assert.equal(task2.id, "task_002");
      assert.ok(task2.dependencies?.some((d) => d.taskId === "task_001" && d.reason === "file-overlap"));

      // 2. Source 2: Contract-visible consumer relationship
      // Task 3 is in billing (a declared consumer of auth), and task 1 changes src/auth/token.ts (which is in auth's public_api!).
      // Task 3 automatically depends on task 1 with reason 'contract-consumer'!
      const task3 = await engine.createTask({
        id: "task_003",
        goal: "Add discount logic to billing",
        contract: "modules/billing.contract.yaml",
        files: ["src/billing/discount.ts"],
      });
      assert.ok(task3.depends_on.includes("task_001"));
      assert.ok(task3.dependencies?.some((d) => d.taskId === "task_001" && d.reason === "contract-consumer"));

      // 3. Source 3: Explicit lead-declared manual edges
      const task4 = await engine.createTask({
        id: "task_004",
        goal: "Manual sequential task",
        contract: "modules/billing.contract.yaml",
        files: ["src/billing/invoice.ts"],
        depends_on: ["task_003"],
      });
      assert.ok(task4.depends_on.includes("task_003"));
      assert.ok(task4.dependencies?.some((d) => d.taskId === "task_003" && d.reason === "manual"));

      // 4. Future contract (status: draft) task creation
      // Authored during planning for a new module
      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "modules", "notifications.contract.yaml"),
        `module: notifications
status: draft
version: "0.1.0"
public_api:
  - export: "sendAlert"
    signature: "(msg: string) => Promise<void>"
    file: "src/notifications/alert.ts"
invariants:
  - Must not send duplicate alerts
declared_consumers: []
`,
        "utf-8"
      );

      const taskDraft = await engine.createTask({
        id: "task_draft_mod",
        goal: "Implement notifications module based on future contract",
        contract: "modules/notifications.contract.yaml",
        files: ["src/notifications/alert.ts"],
      });
      assert.equal(taskDraft.id, "task_draft_mod");
      assert.equal(taskDraft.contract, "modules/notifications.contract.yaml");
      assert.equal(taskDraft.status, "pending");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces scheduling: two tasks with overlapping files cannot both reach active simultaneously (concurrent-start test)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-task-concurrent-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Create two independent tasks that initially do not overlap
      const taskA = await engine.createTask({
        id: "task_A",
        goal: "Work on module A",
        contract: "modules/example.contract.yaml",
        files: ["src/shared/common.ts", "src/example/a.ts"],
        depends_on: [],
      });

      // Start Task A -> must reach active
      const startResA = await engine.startTask("task_A");
      assert.equal(startResA.success, true);
      assert.equal(startResA.status, "active");

      // Verify lock table shows common.ts locked by task_A
      const locks = await engine.getTaskLocks();
      assert.ok(locks.locks.some((l) => l.file === "src/shared/common.ts" && l.taskId === "task_A"));

      // Now create Task B that has an overlapping file with Task A (created after with explicit depends_on, or created directly)
      const taskB = await engine.createTask({
        id: "task_B",
        goal: "Work on module B",
        contract: "modules/example.contract.yaml",
        files: ["src/shared/common.ts", "src/example/b.ts"],
        depends_on: ["task_A"], // declared edge
      });

      // Task B attempts to start while Task A is active -> MUST be blocked!
      const startResB = await engine.startTask("task_B");
      assert.equal(startResB.success, false);
      assert.equal(startResB.status, "blocked");
      assert.ok(startResB.reason?.includes("task_A"));

      // Verify Task B status is blocked on disk
      const loadedB = await engine.getTaskManager().getTask("task_B");
      assert.equal(loadedB?.status, "blocked");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces depends_on gating: a task cannot start before dependencies reach done", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-task-dep-gate-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      await engine.createTask({
        id: "task_first",
        goal: "First step",
        contract: "modules/example.contract.yaml",
        files: ["src/first.ts"],
      });

      await engine.createTask({
        id: "task_second",
        goal: "Second step",
        contract: "modules/example.contract.yaml",
        files: ["src/second.ts"],
        depends_on: ["task_first"],
      });

      // Attempting to start task_second while task_first is pending:
      const startRes = await engine.startTask("task_second");
      assert.equal(startRes.success, false);
      assert.equal(startRes.status, "blocked");
      assert.ok(startRes.reason?.includes("task_first"));

      // Start and complete task_first:
      await engine.startTask("task_first");

      // Initialize git repo so completion gate check works
      await execAsync("git init", { cwd: tmpDir });
      await execAsync('git config user.email "test@crewmate.dev"', { cwd: tmpDir });
      await execAsync('git config user.name "Crewmate Test"', { cwd: tmpDir });
      await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "src", "first.ts"), "export const first = 1;\n");
      await execAsync("git add .", { cwd: tmpDir });
      await execAsync('git commit -m "feat: first"', { cwd: tmpDir });

      const completeFirst = await engine.completeTask("task_first");
      assert.equal(completeFirst.success, true);
      assert.equal(completeFirst.status, "done");

      // Now task_second can start!
      const startSecondAfter = await engine.startTask("task_second");
      assert.equal(startSecondAfter.success, true);
      assert.equal(startSecondAfter.status, "active");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles scope amendment: unclaimed file granted, while locked file triggers hard conflict and escalation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-task-amend-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      await engine.createTask({
        id: "task_alpha",
        goal: "Alpha work",
        contract: "modules/example.contract.yaml",
        files: ["src/alpha.ts"],
      });

      await engine.createTask({
        id: "task_beta",
        goal: "Beta work",
        contract: "modules/example.contract.yaml",
        files: ["src/beta.ts"],
      });

      // Start both tasks in parallel (no overlapping files)
      const resAlpha = await engine.startTask("task_alpha");
      const resBeta = await engine.startTask("task_beta");
      assert.equal(resAlpha.status, "active");
      assert.equal(resBeta.status, "active");

      // 1. Scope amendment with UNCLAIMED file -> granted
      const amendUnclaimed = await engine.amendTaskScope("task_alpha", "src/extra_alpha.ts");
      assert.equal(amendUnclaimed.success, true);
      assert.equal(amendUnclaimed.file, "src/extra_alpha.ts");

      // Verify file is now in task_alpha locked files
      const alphaDef = await engine.getTaskManager().getTask("task_alpha");
      assert.ok(alphaDef?.files.includes("src/extra_alpha.ts"));
      assert.ok(alphaDef?.amendments.some((a) => a.type === "scope_amendment" && a.file === "src/extra_alpha.ts"));

      // 2. Scope amendment with LOCKED file held by task_beta -> HARD CONFLICT!
      const conflictRes = await engine.amendTaskScope("task_alpha", "src/beta.ts");
      assert.equal(conflictRes.success, false);
      assert.equal(conflictRes.conflict, true);
      assert.equal(conflictRes.conflictingTaskId, "task_beta");
      assert.ok(conflictRes.message.includes("locked by active task 'task_beta'"));

      // Verify scope_conflict event logged
      const conflicts = await engine.getTaskConflictSummary();
      assert.equal(conflicts.totalConflicts, 1);
      assert.equal(conflicts.conflicts[0].taskId, "task_alpha");
      assert.equal(conflicts.conflicts[0].conflictingTaskId, "task_beta");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces task completion gate as ground-truth backstop: failing on un-amended file modifications", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-task-gate-backstop-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Git repo setup
      await execAsync("git init", { cwd: tmpDir });
      await execAsync('git config user.email "test@crewmate.dev"', { cwd: tmpDir });
      await execAsync('git config user.name "Crewmate Test"', { cwd: tmpDir });
      await execAsync("git add .", { cwd: tmpDir });
      await execAsync('git commit -m "initial"', { cwd: tmpDir });

      // Create task with declared file 'src/allowed.ts'
      await engine.createTask({
        id: "task_strict",
        goal: "Strict scope work",
        contract: "modules/example.contract.yaml",
        files: ["src/allowed.ts"],
      });

      await engine.startTask("task_strict");

      // Simulate a bypass (e.g. subagent writing directly to disk without plugin interception):
      // Worker touches allowed file AND forbidden out-of-scope file
      await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "src", "allowed.ts"), "export const ok = true;\n");
      await fs.writeFile(path.join(tmpDir, "src", "bypassed_leak.ts"), "export const forbidden = true;\n");

      // Run task complete -> MUST FAIL AT COMPLETION GATE!
      const completeRes = await engine.completeTask("task_strict");
      assert.equal(completeRes.success, false);
      assert.equal(completeRes.status, "failed");
      assert.ok(completeRes.error?.includes("bypassed_leak.ts"));
      assert.ok(completeRes.outOfScopeFiles?.some((f) => f.includes("bypassed_leak.ts")));

      // Verify task status is failed on disk and locks released
      const taskDef = await engine.getTaskManager().getTask("task_strict");
      assert.equal(taskDef?.status, "failed");

      const locks = await engine.getTaskLocks();
      assert.equal(locks.activeTasks.length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces plugin write-only guardrail while keeping reads unrestricted", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-plugin-tasks-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });
      await engine.goto("execute");

      // Create two active tasks: Task 1 claims file1, Task 2 claims file2
      await engine.createTask({
        id: "task_1",
        goal: "Task 1",
        contract: "modules/example.contract.yaml",
        files: ["src/file1.ts"],
      });
      await engine.createTask({
        id: "task_2",
        goal: "Task 2",
        contract: "modules/example.contract.yaml",
        files: ["src/file2.ts"],
      });

      await engine.startTask("task_1");
      await engine.startTask("task_2");

      let executeBeforeHook: Function | undefined;
      const registeredTools: Record<string, any> = {};

      const mockPluginCtx: any = {
        location: { directory: tmpDir },
        session: { hook: () => {} },
        tool: {
          hook: (name: string, cb: Function) => {
            if (name === "execute.before") executeBeforeHook = cb;
          },
          transform: async (editorFn: Function) => {
            const editor = {
              add: (toolDef: any) => {
                registeredTools[toolDef.name] = toolDef;
              },
            };
            editorFn(editor);
          },
        },
        event: {
          subscribe: async function* () {},
        },
      };

      const cleanup = await crewmatePlugin.setup(mockPluginCtx);
      assert.ok(executeBeforeHook);

      // Verify task native tools are registered
      assert.ok(registeredTools["crewmate_task_create"]);
      assert.ok(registeredTools["crewmate_task_start"]);
      assert.ok(registeredTools["crewmate_task_amend"]);
      assert.ok(registeredTools["crewmate_task_complete"]);
      assert.ok(registeredTools["crewmate_task_list"]);
      assert.ok(registeredTools["crewmate_task_locks"]);

      // 1. READ tool is ALWAYS allowed for any file (workers can read full codebase for context)
      await assert.doesNotReject(async () => {
        await executeBeforeHook!({
          tool: "read",
          input: { path: "src/file2.ts" },
        });
      });

      // 2. WRITE tool for task_1 to its own file is ALLOWED
      await assert.doesNotReject(async () => {
        await executeBeforeHook!({
          tool: "write",
          input: { path: "src/file1.ts", taskId: "task_1" },
        });
      });

      // 3. WRITE tool for task_1 to an unclaimed file automatically amends scope
      await assert.doesNotReject(async () => {
        await executeBeforeHook!({
          tool: "write",
          input: { path: "src/unclaimed.ts", taskId: "task_1" },
        });
      });
      const t1 = await engine.getTaskManager().getTask("task_1");
      assert.ok(t1?.files.includes("src/unclaimed.ts"));

      // 4. WRITE tool for task_1 attempting to write to file2 (locked by task_2) is HARD BLOCKED!
      await assert.rejects(
        async () => {
          await executeBeforeHook!({
            tool: "write",
            input: { path: "src/file2.ts", taskId: "task_1" },
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("Scope conflict") &&
            err.message.includes("task_2")
          );
        }
      );

      if (typeof cleanup === "function") {
        await cleanup();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes CLI commands: task create, list, start, amend, complete, locks, conflicts", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-cli-tasks-"));
    const cliPath = path.resolve("dist", "src", "cli", "index.js");
    try {
      // Init repo
      await execAsync(`node "${cliPath}" init --example -p "${tmpDir}"`);
      await execAsync("git init", { cwd: tmpDir });
      await execAsync('git config user.email "test@crewmate.dev"', { cwd: tmpDir });
      await execAsync('git config user.name "Crewmate Test"', { cwd: tmpDir });
      await execAsync("git add .", { cwd: tmpDir });
      await execAsync('git commit -m "init"', { cwd: tmpDir });

      // 1. task create
      const createOut = await execAsync(
        `node "${cliPath}" task create --contract modules/example.contract.yaml --files src/example/index.ts --goal "Implement example feature" --json -p "${tmpDir}"`
      );
      const created = JSON.parse(createOut.stdout);
      assert.equal(created.id, "task_001");
      assert.equal(created.status, "pending");

      // 2. task list
      const listOut = await execAsync(`node "${cliPath}" task list --json -p "${tmpDir}"`);
      const list = JSON.parse(listOut.stdout);
      assert.equal(list.length, 1);
      assert.equal(list[0].id, "task_001");

      // 3. task start
      const startOut = await execAsync(`node "${cliPath}" task start --id task_001 --json -p "${tmpDir}"`);
      const started = JSON.parse(startOut.stdout);
      assert.equal(started.success, true);
      assert.equal(started.status, "active");

      // 4. task locks
      const locksOut = await execAsync(`node "${cliPath}" task locks --json -p "${tmpDir}"`);
      const locks = JSON.parse(locksOut.stdout);
      assert.equal(locks.activeTasks.length, 1);
      assert.ok(locks.locks.some((l: any) => l.file === "src/example/index.ts"));

      // 5. task amend
      const amendOut = await execAsync(
        `node "${cliPath}" task amend --id task_001 --add-file src/example/helper.ts --json -p "${tmpDir}"`
      );
      const amended = JSON.parse(amendOut.stdout);
      assert.equal(amended.success, true);

      // Touch the declared files
      await fs.mkdir(path.join(tmpDir, "src", "example"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "src", "example", "index.ts"), "export const x = 1;\n");
      await fs.writeFile(path.join(tmpDir, "src", "example", "helper.ts"), "export const h = 2;\n");

      // 6. task complete
      const completeOut = await execAsync(
        `node "${cliPath}" task complete --id task_001 --json -p "${tmpDir}"`
      );
      const completed = JSON.parse(completeOut.stdout);
      assert.equal(completed.success, true);
      assert.equal(completed.status, "done");

      // 7. task conflicts
      const conflictsOut = await execAsync(`node "${cliPath}" task conflicts --json -p "${tmpDir}"`);
      const conflicts = JSON.parse(conflictsOut.stdout);
      assert.equal(conflicts.totalConflicts, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
