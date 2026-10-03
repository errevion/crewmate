import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "yaml";

import {
  crewmateOpenCodePlugin as crewmatePlugin,
  isCrewmateCliCommand,
  extractCommandStrings,
  isCrewmateAgent,
  DEFAULT_CREWMATE_AGENTS,
} from "../src/adapters/opencode/index.js";
import { CrewmateEngine } from "../src/core/engine/engine.js";

describe("OpenCode v2 Crewmate Plugin (Phase 3)", () => {
  it("injects tiered context and subagent directives into session context", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-plugin-test-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Setup mock plugin context
      const hooks: Record<string, Function[]> = {};
      const mockPluginCtx: any = {
        location: { directory: tmpDir },
        session: {
          hook: (name: string, cb: Function) => {
            if (!hooks[name]) hooks[name] = [];
            hooks[name].push(cb);
          },
        },
        tool: {
          hook: (name: string, cb: Function) => {
            if (!hooks[name]) hooks[name] = [];
            hooks[name].push(cb);
          },
        },
        event: {
          subscribe: async function* () {
            // empty async generator
          },
        },
      };

      const cleanup = await crewmatePlugin.setup(mockPluginCtx);
      assert.ok(hooks["context"]);
      assert.ok(hooks["execute.before"]);

      // Test context injection
      const sessionCtx: any = { system: [] };
      await hooks["context"][0](sessionCtx);

      assert.equal(sessionCtx.system.length, 2);
      assert.ok(sessionCtx.system[0].text.includes("=== CREWMATE CONTEXT [NODE: SCOUT] ==="));
      assert.ok(sessionCtx.system[1].text.includes("[CREWMATE SUBAGENT ROLE DIRECTIVE]"));
      assert.ok(sessionCtx.system[1].text.includes("Active Role: scout"));
      assert.ok(sessionCtx.system[1].text.includes("Scope: read-only"));

      if (typeof cleanup === "function") {
        cleanup();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces tool guardrails: blocks read-only violations and forbidden paths", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-guardrail-test-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      const hooks: Record<string, Function[]> = {};
      const mockPluginCtx: any = {
        location: { directory: tmpDir },
        session: { hook: () => {} },
        tool: {
          hook: (name: string, cb: Function) => {
            if (!hooks[name]) hooks[name] = [];
            hooks[name].push(cb);
          },
        },
        event: {
          subscribe: async function* () {},
        },
      };

      const cleanup = await crewmatePlugin.setup(mockPluginCtx);
      const executeBefore = hooks["execute.before"][0];

      // On initial node "scout", subagent scope is read-only.
      // 1. Attempting to write a file should be BLOCKED!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "write",
            input: { path: "src/new-feature.ts", content: "export const x = 1;" },
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("has scope 'read-only'")
          );
        }
      );

      // 2. Read tool should be ALLOWED!
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "read",
          input: { path: ".crewmate/contracts/index.yaml" },
        });
      });

      // 2b. Transition to plan node (scope: contracts-write)
      await engine.goto("plan");

      // Attempting to write application code under contracts-write MUST be BLOCKED!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "write",
            input: { path: "src/new-feature.ts", content: "export const x = 1;" },
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("has scope 'contracts-write'")
          );
        }
      );

      // But writing a contract under .crewmate/contracts/ MUST be ALLOWED!
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "write",
          input: {
            path: ".crewmate/contracts/modules/feature.contract.yaml",
            content: "module: feature\nstatus: draft\n",
          },
        });
      });

      // 3. Jump to execute node (scope: implementation)
      await engine.goto("execute");

      // Now on execute node, write is allowed for normal files:
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "write",
          input: { path: "src/example/index.ts", content: "console.log('hi');" },
        });
      });

      // But writing to a path matching contracts/structure.yaml forbidden pattern (e.g. src/**/temp_*) MUST be blocked!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "write",
            input: { path: "src/example/temp_test.ts", content: "export const t = 1;" },
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("violates structure contract forbidden pattern")
          );
        }
      );

      // 4. Jump to contract node (scope: contracts-write)
      await engine.goto("contract");

      // Contractor attempting to write application code MUST be BLOCKED!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "write",
            input: { path: "src/example/index.ts", content: "console.log('contractor edit');" },
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("has scope 'contracts-write'")
          );
        }
      );

      // Contractor updating a contract under .crewmate/contracts/ MUST be ALLOWED!
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "write",
          input: {
            path: ".crewmate/contracts/modules/example.contract.yaml",
            content: "module: example\nstatus: final\n",
          },
        });
      });

      if (typeof cleanup === "function") {
        await cleanup();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("registers native crewmate tools and allows agents to execute them", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-tools-test-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      const registeredTools: Record<string, any> = {};
      const hooks: Record<string, Function[]> = {};

      const mockPluginCtx: any = {
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
            editorFn(editor);
          },
        },
        event: {
          subscribe: async function* () {},
        },
      };

      const cleanup = await crewmatePlugin.setup(mockPluginCtx);

      // Verify all tools are registered
      assert.ok(registeredTools["crewmate_status"]);
      assert.ok(registeredTools["crewmate_advance"]);
      assert.ok(registeredTools["crewmate_goto"]);
      assert.ok(registeredTools["crewmate_gate_check"]);
      assert.ok(registeredTools["crewmate_activity_start"]);
      assert.ok(registeredTools["crewmate_activity_end"]);
      assert.ok(registeredTools["crewmate_activity_list"]);
      assert.ok(registeredTools["crewmate_activity_reconcile"]);
      assert.ok(registeredTools["crewmate_context"]);
      assert.ok(registeredTools["crewmate_query"]);
      assert.ok(registeredTools["crewmate_scan_arch"]);
      assert.ok(registeredTools["crewmate_scan_dead_code"]);
      assert.ok(registeredTools["crewmate_workflow_list"]);
      assert.ok(registeredTools["crewmate_workflow_run"]);
      assert.ok(registeredTools["crewmate_workflow_reset"]);
      assert.ok(registeredTools["crewmate_report_get"]);

      // 1. Execute crewmate_status
      const statusRes = await registeredTools["crewmate_status"].execute({}, { agent: "lead" });
      const statusJson = JSON.parse(statusRes.content);
      assert.equal(statusJson.currentNode, "scout");
      assert.equal(statusJson.status, "active");
      assert.equal(statusJson.harness.alive, true);
      assert.equal(statusJson.harness.status, "idle");

      // 2. Execute crewmate_activity_start
      const startRes = await registeredTools["crewmate_activity_start"].execute(
        { label: "Design API contract", agent: "architect" },
        { agent: "architect" }
      );
      const startJson = JSON.parse(startRes.content);
      assert.ok(startJson.id.startsWith("act_"));
      assert.equal(startJson.label, "Design API contract");
      assert.equal(startJson.status, "active");

      // Verify activity shows in unclosed list
      const listRes = await registeredTools["crewmate_activity_list"].execute({ unclosedOnly: true });
      const listJson = JSON.parse(listRes.content);
      assert.equal(listJson.length, 1);
      assert.equal(listJson[0].id, startJson.id);

      // 3. Execute crewmate_activity_end
      const endRes = await registeredTools["crewmate_activity_end"].execute({
        id: startJson.id,
        status: "completed",
      });
      const endJson = JSON.parse(endRes.content);
      assert.equal(endJson.id, startJson.id);
      assert.equal(endJson.status, "completed");

      // 4. Verify crewmate native tool access control in execute.before
      const executeBefore = hooks["execute.before"][0];

      // 4a. Orchestrator-only activity command MUST be blocked for scout role!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "crewmate_activity_start",
            input: { label: "Subtask" },
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("is restricted: Subagent role 'scout'")
          );
        }
      );

      // 4b. Introspection tools (crewmate_status) MUST be allowed for any role
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_status",
          input: {},
          sessionID: "ses_unit_test",
        });
      });

      // 4c. Orchestrator-only commands MUST be allowed for orchestrator (agent: "matte")
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_activity_start",
          input: { label: "Subtask" },
          agent: "matte",
          sessionID: "ses_unit_test",
        });
      });

      // 4d. Advance command MUST be blocked for builder role
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "crewmate_advance",
            input: {},
            agent: "builder",
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("is restricted: Subagent role 'builder'")
          );
        }
      );

      // 4d2. Goto command MUST be blocked for builder role
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "crewmate_goto",
            input: { node: "execute" },
            agent: "builder",
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("is restricted: Subagent role 'builder'")
          );
        }
      );

      // 4d3. Goto command MUST be allowed for orchestrator (matte)
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_goto",
          input: { node: "execute" },
          agent: "matte",
          sessionID: "ses_unit_test",
        });
      });

      // 4e. Task mutation command (crewmate_task_start) MUST be allowed for builder role
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_task_start",
          input: { id: "task_1" },
          agent: "builder",
          sessionID: "ses_unit_test",
        });
      });

      // 4f. Scanner command (crewmate_scan_arch) MUST be allowed for verifier role
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_scan_arch",
          input: {},
          agent: "verifier",
          sessionID: "ses_unit_test",
        });
      });

      // 4f2. Scanner commands MUST also be allowed for contractor role
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_scan_arch",
          input: {},
          agent: "contractor",
          sessionID: "ses_unit_test",
        });
      });
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "crewmate_scan_dead_code",
          input: {},
          agent: "contractor",
          sessionID: "ses_unit_test",
        });
      });

      // 4g. Shell execution of crewmate CLI commands MUST be BLOCKED for subagent roles!
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "bash",
            input: { command: "crewmate advance" },
            agent: "builder",
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("Shell execution of crewmate CLI commands is restricted: Subagent role 'builder'")
          );
        }
      );

      // 4h. Shell execution with npx / chained commands MUST also be BLOCKED for subagents
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "shell",
            input: { command: "npm run build && npx crewmate task complete --id task_1" },
            agent: "builder",
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("Shell execution of crewmate CLI commands is restricted: Subagent role 'builder'")
          );
        }
      );

      // 4i. Orchestrator (Matte) MUST be ALLOWED to run crewmate CLI commands in shell if needed
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "bash",
          input: { command: "crewmate advance" },
          agent: "matte",
          sessionID: "ses_unit_test",
        });
      });

      // 4j. Normal shell commands (npm test, git status, cat) MUST NOT be blocked for subagents
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "bash",
          input: { command: "npm test" },
          agent: "builder",
          sessionID: "ses_unit_test",
        });
      });

      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "bash",
          input: { command: 'git commit -m "update crewmate configuration"' },
          agent: "builder",
          sessionID: "ses_unit_test",
        });
      });

      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "bash",
          input: { command: "cat .crewmate/contracts/index.yaml" },
          agent: "scout",
          sessionID: "ses_unit_test",
        });
      });

      // 4k. Execute crewmate_goto
      const gotoRes = await registeredTools["crewmate_goto"].execute({ node: "plan" });
      const gotoJson = JSON.parse(gotoRes.content);
      assert.equal(gotoJson.to, "plan");

      // 4l. Workspace boundary enforcement for subagents
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "read",
            input: { path: "../outside-file.txt" },
            agent: "scout",
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("Access to path outside the project workspace is forbidden")
          );
        }
      );

      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "grep",
            input: {
              path:
                process.platform === "win32"
                  ? "C:/some/external/system/path"
                  : "/some/external/system/path",
            },
            agent: "planner",
            sessionID: "ses_unit_test",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("Access to path outside the project workspace is forbidden")
          );
        }
      );

      // In-workspace reads MUST be permitted for subagents
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "read",
          input: { path: ".crewmate/contracts/index.yaml" },
          agent: "scout",
          sessionID: "ses_unit_test",
        });
      });

      // Liveness should now be "running" with session ID tracked
      const livenessDuringExec = await engine.getHarnessLiveness();
      assert.equal(livenessDuringExec.alive, true);
      assert.equal(livenessDuringExec.status, "running");
      assert.equal(livenessDuringExec.harness, "OpenCode");
      assert.equal(livenessDuringExec.session?.id, "ses_unit_test");

      // 5. Cleanup sets heartbeat to offline
      if (typeof cleanup === "function") {
        await cleanup();
      }

      const livenessAfterCleanup = await engine.getHarnessLiveness();
      assert.equal(livenessAfterCleanup.alive, false);
      assert.equal(livenessAfterCleanup.status, "offline");
      assert.equal(livenessAfterCleanup.reason, "Harness marked offline");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("reconciles stale orphan activities when harness goes offline", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-reconcile-test-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Start an activity but do not close it (simulating session crash)
      const actId = await engine.getActivityManager().start({
        agent: "coder",
        label: "Unfinished work on database schema",
      });

      const unclosedBefore = await engine.getActivityManager().getUnclosedActivities();
      assert.equal(unclosedBefore.length, 1);
      assert.equal(unclosedBefore[0].id, actId);

      // Reconcile stale activities
      const reconciled = await engine.reconcileStaleActivities("session crash");
      assert.equal(reconciled.length, 1);
      assert.equal(reconciled[0], actId);

      // After reconcile, no unclosed activities remain
      const unclosedAfter = await engine.getActivityManager().getUnclosedActivities();
      assert.equal(unclosedAfter.length, 0);

      // The ended activity now has status "interrupted"
      const allActs = await engine.getActivityManager().getActivities();
      const closedAct = allActs.find((a) => a.id === actId);
      assert.ok(closedAct);
      assert.equal(closedAct.status, "interrupted");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("accurately detects crewmate CLI invocations across shell formats without false positives", () => {
    // Should match direct CLI calls
    assert.equal(isCrewmateCliCommand("crewmate"), true);
    assert.equal(isCrewmateCliCommand("crewmate advance"), true);
    assert.equal(isCrewmateCliCommand("crewmate status --json"), true);
    assert.equal(isCrewmateCliCommand("crewmate.exe watch"), true);
    assert.equal(isCrewmateCliCommand("./node_modules/.bin/crewmate task start"), true);
    assert.equal(isCrewmateCliCommand(".\\bin\\crewmate goto execute"), true);

    // Should match chained / compound commands
    assert.equal(isCrewmateCliCommand("npm run build && crewmate advance"), true);
    assert.equal(isCrewmateCliCommand("git status; crewmate workflow reset"), true);
    assert.equal(isCrewmateCliCommand("FOO=bar crewmate task complete"), true);

    // Should match runner invocations (npx, pnpm, yarn, bun)
    assert.equal(isCrewmateCliCommand("npx crewmate advance"), true);
    assert.equal(isCrewmateCliCommand("npx --yes crewmate task start"), true);
    assert.equal(isCrewmateCliCommand("pnpm exec crewmate scan arch"), true);
    assert.equal(isCrewmateCliCommand("yarn crewmate init"), true);
    assert.equal(isCrewmateCliCommand("bunx crewmate status"), true);

    // Should match node cli invocations
    assert.equal(isCrewmateCliCommand("node dist/src/cli/index.js advance"), true);
    assert.equal(isCrewmateCliCommand("node bin/crewmate.js task list"), true);

    // Should NOT match non-crewmate commands
    assert.equal(isCrewmateCliCommand("npm test"), false);
    assert.equal(isCrewmateCliCommand("cargo test"), false);
    assert.equal(isCrewmateCliCommand("git status"), false);
    assert.equal(isCrewmateCliCommand("ls -la"), false);
    assert.equal(isCrewmateCliCommand("echo hello"), false);

    // Should NOT match commands that merely mention crewmate in arguments / commit messages / file paths
    assert.equal(isCrewmateCliCommand('git commit -m "fix: crewmate config"'), false);
    assert.equal(isCrewmateCliCommand("git add .crewmate/contracts/index.yaml"), false);
    assert.equal(isCrewmateCliCommand("cat .crewmate/state.jsonl"), false);
    assert.equal(isCrewmateCliCommand("grep -r 'crewmate' src/"), false);

    // Command string extraction
    assert.deepEqual(extractCommandStrings("ls"), ["ls"]);
    assert.deepEqual(extractCommandStrings({ command: "npm test" }), ["npm test"]);
    assert.deepEqual(extractCommandStrings({ cmd: "git status" }), ["git status"]);
    assert.deepEqual(extractCommandStrings({ script: "python app.py" }), ["python app.py"]);
    assert.deepEqual(extractCommandStrings({ args: ["crewmate", "advance"] }), ["crewmate advance"]);
  });

  it("isolates non-Matte agents: bypasses guardrails and context injection while enforcing subagents", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-agent-isolation-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // 1. Verify isCrewmateAgent helper correctly classifies agents
      assert.equal(await isCrewmateAgent(engine, "matte"), true);
      assert.equal(await isCrewmateAgent(engine, "scout"), true);
      assert.equal(await isCrewmateAgent(engine, "planner"), true);
      assert.equal(await isCrewmateAgent(engine, "builder"), true);
      assert.equal(await isCrewmateAgent(engine, "contractor"), true);
      assert.equal(await isCrewmateAgent(engine, "verifier"), true);
      assert.equal(await isCrewmateAgent(engine, "orchestrator"), true);

      // External user agents MUST return false
      assert.equal(await isCrewmateAgent(engine, "build"), false);
      assert.equal(await isCrewmateAgent(engine, "general"), false);
      assert.equal(await isCrewmateAgent(engine, "code"), false);
      assert.equal(await isCrewmateAgent(engine, "default"), false);
      assert.equal(await isCrewmateAgent(engine, "my-custom-assistant"), false);

      // Omitted agent defaults to true (backwards-compatible for test mocks)
      assert.equal(await isCrewmateAgent(engine, undefined), true);

      // Setup plugin mock
      const hooks: Record<string, Function[]> = {};
      const mockPluginCtx: any = {
        location: { directory: tmpDir },
        session: {
          hook: (name: string, cb: Function) => {
            if (!hooks[name]) hooks[name] = [];
            hooks[name].push(cb);
          },
        },
        tool: {
          hook: (name: string, cb: Function) => {
            if (!hooks[name]) hooks[name] = [];
            hooks[name].push(cb);
          },
        },
        event: {
          subscribe: async function* () {},
        },
      };

      const cleanup = await crewmatePlugin.setup(mockPluginCtx);
      const contextHook = hooks["context"][0];
      const executeBefore = hooks["execute.before"][0];

      // 2. Test Context Hook Isolation:
      // When caller is "build" or "general", ZERO context should be injected (completely invisible)
      const buildSessionCtx: any = { system: [], agent: "build" };
      await contextHook(buildSessionCtx);
      assert.equal(buildSessionCtx.system.length, 0, "Non-Matte agent must receive zero injected context");

      const generalSessionCtx: any = { system: [], agent: "general" };
      await contextHook(generalSessionCtx);
      assert.equal(generalSessionCtx.system.length, 0, "General agent must receive zero injected context");

      // But when caller is a Crewmate agent (e.g. "scout" or "matte"), context IS injected
      const scoutSessionCtx: any = { system: [], agent: "scout" };
      await contextHook(scoutSessionCtx);
      assert.ok(scoutSessionCtx.system.length > 0, "Crewmate subagent must receive injected context");
      assert.ok(scoutSessionCtx.system[0].text.includes("CREWMATE CONTEXT [NODE: SCOUT]"));

      // 3. Test Tool Execution Guardrail Bypass:
      // The workflow is currently at node "scout" (scope: "read-only").
      // An external agent (e.g. "build") MUST be allowed to write files freely:
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "write",
          input: { path: "src/user-code.ts", content: "console.log('by build agent');" },
          agent: "build",
        });
      }, "Non-Matte agent 'build' must NOT be blocked by read-only guardrail");

      // An external agent MUST NOT be blocked from running bash commands with crewmate:
      await assert.doesNotReject(async () => {
        await executeBefore({
          tool: "bash",
          input: { command: "crewmate status" },
          agent: "general",
        });
      }, "Non-Matte agent must NOT have CLI shell execution blocked");

      // BUT the Crewmate subagent "scout" MUST still be strictly blocked from writing files:
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "write",
            input: { path: "src/user-code.ts", content: "console.log('by scout');" },
            agent: "scout",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("has scope 'read-only'")
          );
        },
        "Crewmate subagent 'scout' MUST be strictly blocked by read-only guardrail"
      );

      // And Crewmate subagent "scout" MUST still have CLI execution blocked:
      await assert.rejects(
        async () => {
          await executeBefore({
            tool: "bash",
            input: { command: "crewmate advance" },
            agent: "scout",
          });
        },
        (err: Error) => {
          return (
            err.message.includes("[Crewmate Guardrail Blocked]") &&
            err.message.includes("Shell execution of crewmate CLI commands is restricted")
          );
        },
        "Crewmate subagent 'scout' MUST be blocked from running CLI shell commands"
      );

      // 4. Test Dynamic Discovery of Custom Workflow Agents:
      // Create a custom workflow with a custom subagent "security-auditor"
      const customNodeYaml = yaml.stringify({
        id: "audit",
        instructions: "Audit contracts",
        inputs: ["task_description"],
        subagent: {
          role: "auditor",
          agent: "security-auditor",
          scope: "read-only",
        },
      });
      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "workflows", "feature-pipeline", "nodes", "audit.node.yaml"),
        customNodeYaml,
        "utf-8"
      );

      // Add "audit" to graph.yaml
      const graphPath = path.join(tmpDir, ".crewmate", "workflows", "feature-pipeline", "graph.yaml");
      const currentGraph = yaml.parse(await fs.readFile(graphPath, "utf-8"));
      currentGraph.nodes.push({ id: "audit", next: "done" });
      await fs.writeFile(graphPath, yaml.stringify(currentGraph), "utf-8");

      // Now "security-auditor" MUST be dynamically recognized as a Crewmate agent!
      assert.equal(await isCrewmateAgent(engine, "security-auditor"), true);
      assert.equal(await isCrewmateAgent(engine, "auditor"), true);

      if (typeof cleanup === "function") {
        await cleanup();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
