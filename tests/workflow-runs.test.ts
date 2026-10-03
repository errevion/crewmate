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

const BUGFIX_GRAPH_YAML = `version: "1.0.0"
name: "Bugfix Pipeline"
initial: "triage"
nodes:
  - id: "triage"
    next: "patch"
  - id: "patch"
    next: "verify"
  - id: "verify"
    next: "done"
`;

const BUGFIX_TRIAGE_NODE_YAML = `id: "triage"
instructions: "Triage bug issue"
subagent:
  model: "test-model"
  scope: "read-only"
`;

const BUGFIX_PATCH_NODE_YAML = `id: "patch"
instructions: "Apply bug fix"
subagent:
  model: "test-model"
  scope: "write"
`;

const BUGFIX_VERIFY_NODE_YAML = `id: "verify"
instructions: "Verify fix"
subagent:
  model: "test-model"
  scope: "read-only"
gates:
  pre: []
  post:
    - type: "hard"
      command: "node -e 'process.exit(0)'"
`;

describe("Multi-Workflow Orchestration and Run Reports", () => {
  it("scaffolds multi-workflows and lists them", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Check workflows exist under .crewmate/workflows/
      const workflows = await engine.listWorkflows();
      assert.equal(workflows.length, 2);

      const featureWf = workflows.find((w) => w.name === "feature-pipeline");
      assert.ok(featureWf);
      assert.equal(featureWf.active, true);
      assert.equal(featureWf.initialNode, "scout");
      assert.equal(featureWf.nodeCount, 6);

      const syncWf = workflows.find((w) => w.name === "contract-sync");
      assert.ok(syncWf);
      assert.equal(syncWf.active, false);
      assert.equal(syncWf.initialNode, "scout");
      assert.equal(syncWf.nodeCount, 2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("switches workflows, generates superseded run report, and syncs active workflow files", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Create a secondary workflow under .crewmate/workflows/bugfix/
      const bugfixDir = path.join(tmpDir, ".crewmate", "workflows", "bugfix");
      await fs.mkdir(path.join(bugfixDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(bugfixDir, "graph.yaml"),
        BUGFIX_GRAPH_YAML,
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "triage.node.yaml"),
        BUGFIX_TRIAGE_NODE_YAML,
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "patch.node.yaml"),
        BUGFIX_PATCH_NODE_YAML,
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "verify.node.yaml"),
        BUGFIX_VERIFY_NODE_YAML,
        "utf-8",
      );

      // List workflows
      const workflows = await engine.listWorkflows();
      assert.equal(workflows.length, 3);
      const bugfixInfo = workflows.find((w) => w.name === "bugfix");
      assert.ok(bugfixInfo);
      assert.equal(bugfixInfo.active, false);
      assert.equal(bugfixInfo.initialNode, "triage");
      assert.equal(bugfixInfo.nodeCount, 3);

      // Start bugfix workflow
      const runResult = await engine.runWorkflow("bugfix");
      assert.equal(runResult.workflow, "bugfix");
      assert.equal(runResult.initialNode, "triage");
      assert.ok(runResult.runId.startsWith("run_"));
      assert.ok(runResult.runId.includes("bugfix"));
      assert.ok(runResult.previousRunReport);
      assert.equal(runResult.previousRunReport?.status, "superseded");

      // Verify active workflow resolves directly to bugfix without duplicate workflow/ mirror
      const activeGraph = await engine.getGraph();
      assert.ok(activeGraph.name?.includes("Bugfix Pipeline"));

      // Verify no duplicate .crewmate/workflow/ directory was created
      let duplicateMirrorExists = false;
      try {
        await fs.access(path.join(tmpDir, ".crewmate", "workflow"));
        duplicateMirrorExists = true;
      } catch {
        duplicateMirrorExists = false;
      }
      assert.equal(duplicateMirrorExists, false);

      // Verify state manager reflects bugfix workflow
      const state = await engine.getStateManager().getState();
      assert.equal(state.activeWorkflow, "bugfix");
      assert.equal(state.currentNode, "triage");
      assert.equal(state.status, "active");

      // Verify report was written to .crewmate/reports/
      const reports = await engine.listReports();
      assert.equal(reports.length, 1);
      assert.equal(reports[0].workflow, "feature-pipeline");
      assert.equal(reports[0].status, "superseded");

      // Verify latest report is retrievable
      const latestReport = await engine.getReport();
      assert.ok(latestReport);
      assert.equal(latestReport.workflow, "feature-pipeline");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces idle safety guard when task locks are active", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Create a second workflow
      const bugfixDir = path.join(tmpDir, ".crewmate", "workflows", "bugfix");
      await fs.mkdir(path.join(bugfixDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(bugfixDir, "graph.yaml"),
        BUGFIX_GRAPH_YAML,
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "triage.node.yaml"),
        BUGFIX_TRIAGE_NODE_YAML,
        "utf-8",
      );

      // Initialize git repo for task start
      await execAsync("git init", { cwd: tmpDir });
      await execAsync('git config user.name "Test"', { cwd: tmpDir });
      await execAsync('git config user.email "test@test.local"', {
        cwd: tmpDir,
      });
      await execAsync("git add .", { cwd: tmpDir });
      await execAsync('git commit -m "Initial"', { cwd: tmpDir });

      // Create and start task to lock files
      const task = await engine.createTask({
        contract: "example",
        goal: "Refactor example contract",
        files: ["src/index.ts"],
      });
      await engine.startTask(task.id);

      // Attempting to switch workflow without force should be blocked
      await assert.rejects(async () => {
        await engine.runWorkflow("bugfix");
      }, /Cannot switch or run workflow while tasks are actively locked/);

      // Attempting to reset workflow without force should also be blocked
      await assert.rejects(async () => {
        await engine.resetWorkflow();
      }, /Cannot reset workflow while tasks are actively locked/);

      // With force: true, workflow switch should proceed
      const runRes = await engine.runWorkflow("bugfix", { force: true });
      assert.equal(runRes.workflow, "bugfix");
      assert.equal(runRes.initialNode, "triage");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles resetWorkflow and generates reset run report", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Track an activity
      const actId = await engine.getActivityManager().start({
        label: "Writing feature code",
        agent: "coder",
        node: "plan",
      });
      await engine.getActivityManager().end({
        id: actId,
        status: "completed",
      });

      // Advance one step: plan -> execute
      await engine.goto("execute");

      // Reset workflow
      const resetResult = await engine.resetWorkflow({
        reason: "Resetting run for fresh validation",
      });

      assert.equal(resetResult.node, "scout");
      assert.equal(resetResult.reason, "Resetting run for fresh validation");
      assert.ok(resetResult.runId.startsWith("run_"));
      assert.ok(resetResult.previousRunReport);
      assert.equal(resetResult.previousRunReport?.status, "reset");
      assert.equal(
        resetResult.previousRunReport?.reason,
        "Resetting run for fresh validation",
      );

      // Verify report was generated in .crewmate/reports/
      const report = await engine.getReport(
        resetResult.previousRunReport?.runId,
      );
      assert.ok(report);
      assert.equal(report.status, "reset");
      assert.equal(report.activities.length, 1);
      assert.equal(report.activities[0].label, "Writing feature code");
      assert.ok(report.transitions.length >= 1);

      // Check state is now back to scout
      const state = await engine.getStateManager().getState();
      assert.equal(state.currentNode, "scout");
      assert.equal(state.status, "active");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("automatically generates completion report when workflow reaches done", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Transition plan -> execute -> verify
      await engine.goto("execute");
      await engine.goto("verify");

      // Advance through verify post-gates to done
      const adv = await engine.advance();
      assert.equal(adv.advanced, true);
      assert.equal(adv.status, "completed");
      assert.equal(adv.to, "done");
      assert.ok(adv.report);
      assert.equal(adv.report.status, "completed");

      // Check reports directory has markdown and json
      const reportsDir = path.join(tmpDir, ".crewmate", "reports");
      const jsonFile = path.join(reportsDir, `${adv.report.runId}.json`);
      const mdFile = path.join(reportsDir, `${adv.report.runId}.md`);
      const latestFile = path.join(reportsDir, "latest.json");

      await fs.access(jsonFile);
      await fs.access(mdFile);
      await fs.access(latestFile);

      const mdContent = await fs.readFile(mdFile, "utf-8");
      assert.ok(mdContent.includes("# Crewmate Workflow Run Report:"));
      assert.ok(mdContent.includes("**Status:** `COMPLETED`"));
      assert.ok(mdContent.includes("## Summary"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes CLI commands: workflow list, run, reset, report", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    const cliPath = path.resolve("dist/src/cli/index.js");

    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Add bugfix workflow
      const bugfixDir = path.join(tmpDir, ".crewmate", "workflows", "bugfix");
      await fs.mkdir(path.join(bugfixDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(bugfixDir, "graph.yaml"),
        BUGFIX_GRAPH_YAML,
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "triage.node.yaml"),
        BUGFIX_TRIAGE_NODE_YAML,
        "utf-8",
      );

      // 1. crewmate workflow list --json
      const { stdout: listOut } = await execAsync(
        `node "${cliPath}" workflow list --json -p "${tmpDir}"`,
      );
      const listData = JSON.parse(listOut);
      assert.equal(listData.length, 3);
      assert.equal(
        listData.find((w: any) => w.name === "feature-pipeline")?.active,
        true,
      );

      // 2. crewmate workflow run bugfix --json
      const { stdout: runOut } = await execAsync(
        `node "${cliPath}" workflow run bugfix --json -p "${tmpDir}"`,
      );
      const runData = JSON.parse(runOut);
      assert.equal(runData.workflow, "bugfix");
      assert.equal(runData.initialNode, "triage");

      // 3. crewmate workflow reset --json
      const { stdout: resetOut } = await execAsync(
        `node "${cliPath}" workflow reset --reason "test reset" --json -p "${tmpDir}"`,
      );
      const resetData = JSON.parse(resetOut);
      assert.equal(resetData.workflow, "bugfix");
      assert.equal(resetData.node, "triage");

      // 4. crewmate workflow report --json
      const { stdout: repOut } = await execAsync(
        `node "${cliPath}" workflow report --json -p "${tmpDir}"`,
      );
      const repData = JSON.parse(repOut);
      assert.ok(repData.runId);
      assert.ok(repData.workflow);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes native plugin tools for workflow orchestration", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Add a bugfix workflow
      const bugfixDir = path.join(tmpDir, ".crewmate", "workflows", "bugfix");
      await fs.mkdir(path.join(bugfixDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(bugfixDir, "graph.yaml"),
        BUGFIX_GRAPH_YAML,
        "utf-8",
      );
      await fs.writeFile(
        path.join(bugfixDir, "nodes", "triage.node.yaml"),
        BUGFIX_TRIAGE_NODE_YAML,
        "utf-8",
      );

      const registeredTools: Record<string, any> = {};
      const mockPluginCtx: any = {
        tool: {
          transform: (fn: any) => {
            const editor = {
              add: (toolDef: any) => {
                registeredTools[toolDef.name] = toolDef;
              },
            };
            fn(editor);
          },
          hook: () => {},
        },
        session: {
          hook: () => {},
        },
      };

      const originalCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        await crewmatePlugin.setup(mockPluginCtx);

        // 1. Execute crewmate_workflow_list
        const listRes = await registeredTools["crewmate_workflow_list"].execute(
          {},
        );
        const workflows = JSON.parse(listRes.content);
        assert.equal(workflows.length, 3);

        // 2. Execute crewmate_workflow_run
        const runRes = await registeredTools["crewmate_workflow_run"].execute({
          workflow: "bugfix",
        });
        const runData = JSON.parse(runRes.content);
        assert.equal(runData.workflow, "bugfix");
        assert.equal(runData.initialNode, "triage");

        // 3. Execute crewmate_workflow_reset
        const resetRes = await registeredTools[
          "crewmate_workflow_reset"
        ].execute({
          reason: "Agent requested reset",
        });
        const resetData = JSON.parse(resetRes.content);
        assert.equal(resetData.workflow, "bugfix");
        assert.equal(resetData.node, "triage");

        // 4. Execute crewmate_report_get
        const reportRes = await registeredTools["crewmate_report_get"].execute(
          {},
        );
        const reportData = JSON.parse(reportRes.content);
        assert.ok(reportData.runId);
        assert.ok(reportData.workflow);
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("switches to contract-sync workflow and advances scout -> contract -> done", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-sync-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Switch to contract-sync workflow
      const switchRes = await engine.runWorkflow("contract-sync");
      assert.equal(switchRes.workflow, "contract-sync");
      assert.equal(switchRes.initialNode, "scout");

      // Verify active graph is Contract Sync
      const graph = await engine.getGraph();
      assert.equal(graph.name, "Contract Sync");
      assert.equal(graph.nodes.length, 2);

      // Verify scout node
      const scoutNode = await engine.getNodeDef("scout");
      assert.equal(scoutNode.id, "scout");
      assert.equal(scoutNode.subagent?.role, "scout");
      assert.ok(scoutNode.instructions.includes("Exhaustively explore"));

      // Advance: scout -> contract
      const adv1 = await engine.advance();
      assert.equal(adv1.advanced, true);
      assert.equal(adv1.from, "scout");
      assert.equal(adv1.to, "contract");

      // Verify contract node has scanners in post-gates
      const contractNode = await engine.getNodeDef("contract");
      assert.equal(contractNode.id, "contract");
      assert.equal(contractNode.subagent?.role, "contractor");
      assert.equal(contractNode.subagent?.scope, "contracts-write");
      assert.ok(
        contractNode.guardrails?.post?.some((g: any) =>
          g.run?.includes("scan arch"),
        ),
      );
      assert.ok(
        contractNode.guardrails?.post?.some((g: any) =>
          g.run?.includes("scan dead-code"),
        ),
      );

      // Advance: contract -> done (post-gates run scanners)
      const adv2 = await engine.advance();
      assert.equal(adv2.advanced, true);
      assert.equal(adv2.from, "contract");
      assert.equal(adv2.to, "done");
      assert.equal(adv2.status, "completed");
      assert.ok(adv2.report);
      assert.equal(adv2.report.workflow, "contract-sync");
      assert.equal(adv2.report.status, "completed");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates workflows and detects structural, schema, and connectivity issues", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-validate-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // 1. Validate default feature-pipeline workflow -> must be valid
      const valFeature = await engine.validateWorkflow("feature-pipeline");
      assert.equal(valFeature.valid, true);
      assert.equal(valFeature.summary.errors, 0);
      assert.equal(valFeature.summary.nodeCount, 6);

      // 2. Validate contract-sync workflow -> must be valid
      const valSync = await engine.validateWorkflow("contract-sync");
      assert.equal(valSync.valid, true);
      assert.equal(valSync.summary.errors, 0);
      assert.equal(valSync.summary.nodeCount, 2);

      // 3. Validate nonexistent workflow -> must be invalid (WORKFLOW_NOT_FOUND)
      const valNone = await engine.validateWorkflow("does-not-exist");
      assert.equal(valNone.valid, false);
      assert.equal(valNone.summary.errors, 1);
      assert.ok(valNone.issues.some((i) => i.code === "WORKFLOW_NOT_FOUND"));

      // 4. Create a broken workflow: missing initial node in graph nodes list
      const brokenDir = path.join(
        tmpDir,
        ".crewmate",
        "workflows",
        "broken-initial",
      );
      await fs.mkdir(path.join(brokenDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(brokenDir, "graph.yaml"),
        "version: '1.0.0'\nname: 'Broken'\ninitial: nonexistent\nnodes:\n  - id: step1\n    next: done\n",
        "utf-8",
      );
      await fs.writeFile(
        path.join(brokenDir, "nodes", "step1.node.yaml"),
        "id: step1\ninstructions: 'Test'\ninputs: []\nguardrails: { pre: [], post: [] }\n",
        "utf-8",
      );

      const valBrokenInit = await engine.validateWorkflow("broken-initial");
      assert.equal(valBrokenInit.valid, false);
      assert.ok(
        valBrokenInit.issues.some((i) => i.code === "INVALID_INITIAL_NODE"),
      );

      // 5. Create a broken workflow: invalid next target
      const brokenNextDir = path.join(
        tmpDir,
        ".crewmate",
        "workflows",
        "broken-next",
      );
      await fs.mkdir(path.join(brokenNextDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(brokenNextDir, "graph.yaml"),
        "version: '1.0.0'\nname: 'Broken Next'\ninitial: step1\nnodes:\n  - id: step1\n    next: missing_target\n",
        "utf-8",
      );
      await fs.writeFile(
        path.join(brokenNextDir, "nodes", "step1.node.yaml"),
        "id: step1\ninstructions: 'Test'\ninputs: []\nguardrails: { pre: [], post: [] }\n",
        "utf-8",
      );

      const valBrokenNext = await engine.validateWorkflow("broken-next");
      assert.equal(valBrokenNext.valid, false);
      assert.ok(
        valBrokenNext.issues.some((i) => i.code === "INVALID_NEXT_TARGET"),
      );

      // 6. Create a broken workflow: missing node definition file
      const missingNodeDir = path.join(
        tmpDir,
        ".crewmate",
        "workflows",
        "missing-node-file",
      );
      await fs.mkdir(path.join(missingNodeDir, "nodes"), { recursive: true });
      await fs.writeFile(
        path.join(missingNodeDir, "graph.yaml"),
        "version: '1.0.0'\nname: 'Missing Node File'\ninitial: step1\nnodes:\n  - id: step1\n    next: step2\n  - id: step2\n    next: done\n",
        "utf-8",
      );
      await fs.writeFile(
        path.join(missingNodeDir, "nodes", "step1.node.yaml"),
        "id: step1\ninstructions: 'Test'\ninputs: []\nguardrails: { pre: [], post: [] }\n",
        "utf-8",
      );
      // Notice: nodes/step2.node.yaml is NOT created!

      const valMissingNode = await engine.validateWorkflow("missing-node-file");
      assert.equal(valMissingNode.valid, false);
      assert.ok(
        valMissingNode.issues.some(
          (i) => i.code === "MISSING_NODE_FILE" && i.nodeId === "step2",
        ),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates new workflows via createWorkflow API and validates them", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-create-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // 1. Create a 3-node custom workflow
      const res = await engine.createWorkflow("hotfix", {
        displayName: "Hotfix Pipeline",
        nodes: ["triage", "patch", "verify"],
      });

      assert.equal(res.created, true);
      assert.equal(res.workflow, "hotfix");
      assert.equal(res.filesCreated.length, 4); // graph.yaml + 3 node files
      assert.equal(res.validation.valid, true);
      assert.equal(res.validation.summary.errors, 0);

      // Verify files on disk
      const graph = await fs.readFile(
        path.join(tmpDir, ".crewmate", "workflows", "hotfix", "graph.yaml"),
        "utf-8",
      );
      assert.ok(graph.includes("name: Hotfix Pipeline"));
      assert.ok(graph.includes("initial: triage"));
      assert.ok(graph.includes("next: patch"));
      assert.ok(graph.includes("next: verify"));
      assert.ok(graph.includes("next: done"));

      // Verify node roles mapped sensibly
      const triageDef = await fs.readFile(
        path.join(
          tmpDir,
          ".crewmate",
          "workflows",
          "hotfix",
          "nodes",
          "triage.node.yaml",
        ),
        "utf-8",
      );
      assert.ok(triageDef.includes("role: scout"));
      assert.ok(triageDef.includes("scope: read-only"));

      const patchDef = await fs.readFile(
        path.join(
          tmpDir,
          ".crewmate",
          "workflows",
          "hotfix",
          "nodes",
          "patch.node.yaml",
        ),
        "utf-8",
      );
      assert.ok(patchDef.includes("role: builder"));
      assert.ok(patchDef.includes("scope: implementation"));

      const verifyDef = await fs.readFile(
        path.join(
          tmpDir,
          ".crewmate",
          "workflows",
          "hotfix",
          "nodes",
          "verify.node.yaml",
        ),
        "utf-8",
      );
      assert.ok(verifyDef.includes("role: verifier"));
      assert.ok(verifyDef.includes("scope: read-only"));

      // 2. Reject re-creation without force
      await assert.rejects(async () => {
        await engine.createWorkflow("hotfix");
      }, /already exists/);

      // 3. Overwrite with force
      const forceRes = await engine.createWorkflow("hotfix", {
        force: true,
        displayName: "Hotfix Pipeline",
        nodes: ["triage", "patch", "verify"],
      });
      assert.equal(forceRes.created, true);
      assert.equal(forceRes.validation.valid, true);

      // 4. Reject invalid workflow names
      await assert.rejects(async () => {
        await engine.createWorkflow("");
      }, /cannot be empty/);
      await assert.rejects(async () => {
        await engine.createWorkflow("bad/name");
      }, /Invalid workflow name/);

      // 5. Run the created workflow
      const runRes = await engine.runWorkflow("hotfix");
      assert.equal(runRes.workflow, "hotfix");
      assert.equal(runRes.initialNode, "triage");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes CLI commands: workflow create and workflow validate", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-wf-cli-create-"),
    );
    const cliPath = path.resolve("dist/src/cli/index.js");

    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // 1. crewmate workflow validate --json (validate active workflow)
      const { stdout: valActiveOut } = await execAsync(
        `node "${cliPath}" workflow validate --json -p "${tmpDir}"`,
      );
      const valActiveData = JSON.parse(valActiveOut);
      assert.equal(valActiveData.workflow, "feature-pipeline");
      assert.equal(valActiveData.valid, true);

      // 2. crewmate workflow validate --all --json
      const { stdout: valAllOut } = await execAsync(
        `node "${cliPath}" workflow validate --all --json -p "${tmpDir}"`,
      );
      const valAllData = JSON.parse(valAllOut);
      assert.equal(valAllData.length, 2);
      assert.ok(valAllData.every((w: any) => w.valid === true));

      // 3. crewmate workflow create quickfix --nodes step1,step2 --json
      const { stdout: createOut } = await execAsync(
        `node "${cliPath}" workflow create quickfix --nodes step1,step2 -d "Quick Fix" --json -p "${tmpDir}"`,
      );
      const createData = JSON.parse(createOut);
      assert.equal(createData.created, true);
      assert.equal(createData.workflow, "quickfix");
      assert.equal(createData.validation.valid, true);
      assert.equal(createData.validation.summary.nodeCount, 2);

      // 4. Validate quickfix explicitly
      const { stdout: valQuickOut } = await execAsync(
        `node "${cliPath}" workflow validate quickfix --json -p "${tmpDir}"`,
      );
      const valQuickData = JSON.parse(valQuickOut);
      assert.equal(valQuickData.workflow, "quickfix");
      assert.equal(valQuickData.valid, true);

      // 5. Now list shows 3 workflows
      const { stdout: listOut } = await execAsync(
        `node "${cliPath}" workflow list --json -p "${tmpDir}"`,
      );
      const listData = JSON.parse(listOut);
      assert.equal(listData.length, 3);
      assert.ok(listData.some((w: any) => w.name === "quickfix"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
