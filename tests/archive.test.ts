import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import { CrewmateEngine } from "../src/core/engine/engine.js";
import { ArchiveManager } from "../src/core/archive/archive-manager.js";
import { crewmateOpenCodePlugin } from "../src/adapters/opencode/index.js";

const execAsync = promisify(exec);
const cliPath = path.resolve("dist/src/cli/index.js");

describe("Workflow Run Archival System", () => {
  it("archives completed run data to .crewmate/archive/<runId>/ and prunes active state", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-archive-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Run through scout -> plan -> execute
      await engine.advance(); // to plan
      await engine.advance(); // to execute

      // Create a task and complete it
      await execAsync("git init", { cwd: tmpDir });
      await execAsync('git config user.email "test@crewmate.dev"', {
        cwd: tmpDir,
      });
      await execAsync('git config user.name "Crewmate Test"', { cwd: tmpDir });
      await execAsync("git add .", { cwd: tmpDir });
      await execAsync('git commit -m "init"', { cwd: tmpDir });

      const task = await engine.createTask({
        contract: "example",
        files: ["src/example/index.ts"],
        goal: "Implement example function",
      });
      await engine.startTask(task.id);
      await fs.mkdir(path.join(tmpDir, "src", "example"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "index.ts"),
        "export function exampleFn(): void {}\n",
        "utf-8",
      );
      await engine.completeTask(task.id);

      // Record an activity
      const actId = await engine.getActivityManager().start({
        agent: "builder",
        label: "build step",
        node: "execute",
      });
      await engine.getActivityManager().end({ id: actId });

      // Advance to done
      await engine.goto("done");

      const stateBefore = await engine.status();
      assert.equal(stateBefore.status, "completed");

      // Verify task exists in .crewmate/tasks/
      const tasksBefore = await fs.readdir(
        path.join(tmpDir, ".crewmate", "tasks"),
      );
      assert.ok(tasksBefore.some((f) => f.includes(task.id)));

      // Perform archive
      const manifest = await engine.archiveRun();
      assert.ok(manifest.runId.startsWith("run_"));
      assert.equal(manifest.workflow, "feature-pipeline");
      assert.equal(manifest.status, "completed");
      assert.ok(manifest.eventCount > 0);
      assert.equal(manifest.taskCount, 1);
      assert.ok(manifest.activityCount > 0);

      const archiveRunDir = path.join(
        tmpDir,
        ".crewmate",
        "archive",
        manifest.runId,
      );

      // Verify files in archive
      const archiveFiles = await fs.readdir(archiveRunDir);
      assert.ok(archiveFiles.includes("manifest.json"));
      assert.ok(archiveFiles.includes("state.jsonl"));
      assert.ok(archiveFiles.includes("report.json"));
      assert.ok(archiveFiles.includes("tasks"));
      assert.ok(archiveFiles.includes("activity.jsonl"));

      // Verify completed task was moved out of active .crewmate/tasks/
      const tasksAfter = await fs.readdir(
        path.join(tmpDir, ".crewmate", "tasks"),
      );
      assert.ok(!tasksAfter.some((f) => f.includes(task.id)));

      // Verify contracts in .crewmate/contracts/ REMAIN INTACT!
      const contractContent = await fs.readFile(
        path.join(
          tmpDir,
          ".crewmate",
          "contracts",
          "modules",
          "example.contract.yaml",
        ),
        "utf-8",
      );
      assert.ok(contractContent.includes("status: final"));

      // List archives
      const archives = await engine.listArchives();
      assert.equal(archives.length, 1);
      assert.equal(archives[0].runId, manifest.runId);

      // Get archive detail
      const detail = await engine
        .getArchiveManager()
        .getArchive(manifest.runId);
      assert.ok(detail);
      assert.equal(detail.manifest.runId, manifest.runId);
      assert.ok(detail.stateEvents.length > 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("auto-archives previous run when runWorkflow() starts a new run", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-auto-archive-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Add a secondary workflow
      const bugfixDir = path.join(tmpDir, ".crewmate", "workflows", "bugfix");
      await fs.mkdir(path.join(bugfixDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(bugfixDir, "graph.yaml"),
        "version: '1.0.0'\nname: 'Bugfix'\ninitial: triage\nnodes:\n  - id: triage\n    next: done\n",
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "triage.node.yaml"),
        "id: triage\ninstructions: 'Fix bug'\ninputs: []\nguardrails: { pre: [], post: [] }\n",
        "utf-8",
      );

      // Move default workflow ahead a couple nodes
      await engine.advance(); // scout -> plan

      // Switch to bugfix workflow -> triggers auto-archive of the previous run!
      const switchRes = await engine.runWorkflow("bugfix");
      assert.equal(switchRes.workflow, "bugfix");
      assert.ok(switchRes.previousRunReport);

      // Verify archive was created for previous run
      const archives = await engine.listArchives();
      assert.equal(archives.length, 1);
      assert.equal(archives[0].runId, switchRes.previousRunReport?.runId);
      assert.equal(archives[0].workflow, "feature-pipeline");
      assert.equal(archives[0].status, "superseded");

      // Verify state manager reflects the new run
      const activeState = await engine.getStateManager().getState();
      assert.equal(activeState.activeWorkflow, "bugfix");
      assert.equal(activeState.currentRunId, switchRes.runId);
      assert.equal(activeState.currentNode, "triage");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes CLI commands: crewmate archive and crewmate archive list", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-cli-archive-"),
    );
    try {
      await execAsync(`node "${cliPath}" init --example -p "${tmpDir}"`);

      // 1. Initially no archives
      const listEmptyOut = await execAsync(
        `node "${cliPath}" archive list --json -p "${tmpDir}"`,
      );
      const emptyArchives = JSON.parse(listEmptyOut.stdout);
      assert.equal(emptyArchives.length, 0);

      // 2. Archive current run via CLI
      const archiveOut = await execAsync(
        `node "${cliPath}" archive --json -p "${tmpDir}"`,
      );
      const manifest = JSON.parse(archiveOut.stdout);
      assert.ok(manifest.runId.startsWith("run_"));
      assert.equal(manifest.workflow, "feature-pipeline");

      // 3. Now list shows the archive
      const listOut = await execAsync(
        `node "${cliPath}" archive list --json -p "${tmpDir}"`,
      );
      const archives = JSON.parse(listOut.stdout);
      assert.equal(archives.length, 1);
      assert.equal(archives[0].runId, manifest.runId);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces plugin permissions on crewmate_archive (orchestrator only)", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-plugin-archive-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      const registeredTools: Record<string, any> = {};
      const hooks: Record<string, Function[]> = {};

      const mockCtx: any = {
        location: { directory: tmpDir },
        session: { hook: () => {} },
        tool: {
          hook: (name: string, cb: Function) => {
            if (!hooks[name]) hooks[name] = [];
            hooks[name].push(cb);
          },
          transform: async (editorFn: Function) => {
            const editor = {
              add: (toolDef: any) => {
                registeredTools[toolDef.name] = toolDef;
              },
            };
            await editorFn(editor);
          },
        },
        event: { subscribe: async function* () {} },
      };

      await crewmateOpenCodePlugin.setup(mockCtx);

      assert.ok(registeredTools["crewmate_archive"]);
      assert.ok(registeredTools["crewmate_archive_list"]);

      const executeBefore = hooks["execute.before"][0];

      // 1. Subagent (scout) MUST be BLOCKED from calling crewmate_archive!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "crewmate_archive",
            input: {},
            sessionID: "ses_1",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("is restricted: Subagent role 'scout'")
          );
        },
      );

      // 2. Orchestrator (Matte) MUST be ALLOWED to call crewmate_archive
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_archive",
          input: {},
          agent: "matte",
          sessionID: "ses_1",
        });
      });

      // 3. Any role MUST be ALLOWED to call crewmate_archive_list
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_archive_list",
          input: {},
          agent: "scout",
          sessionID: "ses_1",
        });
      });

      // 4. Execute the tool as orchestrator
      const res = await registeredTools["crewmate_archive"].execute(
        {},
        { agent: "matte" },
      );
      const manifest = JSON.parse(res.content);
      assert.ok(manifest.runId);

      // 5. Execute archive_list
      const listRes = await registeredTools["crewmate_archive_list"].execute(
        {},
        { agent: "scout" },
      );
      const list = JSON.parse(listRes.content);
      assert.equal(list.length, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
