import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CrewmateEngine } from "../src/core/engine/engine.js";
import { crewmateOpenCodePlugin as crewmatePlugin } from "../src/adapters/opencode/index.js";

describe("Phase 4: Full End-to-End Dry Run", () => {
  it("executes complete lifecycle: scout -> clarify -> plan -> execute -> contract -> verify fail -> route back -> fix -> done", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-e2e-dryrun-"));
    try {
      const engine = new CrewmateEngine(tmpDir);

      // ==========================================
      // Step 1: Initialize Workspace
      // ==========================================
      const initRes = await engine.init({ example: true });
      assert.equal(initRes.initialized, true);

      // Verify state file created
      const stateMgr = engine.getStateManager();
      assert.equal(await stateMgr.exists(), true);

      // Wire OpenCode plugin simulation
      const pluginHooks: Record<string, Function[]> = {};
      const mockCtx: any = {
        location: { directory: tmpDir },
        session: {
          hook: (name: string, fn: Function) => {
            if (!pluginHooks[name]) pluginHooks[name] = [];
            pluginHooks[name].push(fn);
          },
        },
        tool: {
          hook: (name: string, fn: Function) => {
            if (!pluginHooks[name]) pluginHooks[name] = [];
            pluginHooks[name].push(fn);
          },
        },
        event: {
          subscribe: async function* () {},
        },
      };
      await crewmatePlugin.setup(mockCtx);

      // ==========================================
      // Step 2: SCOUT Phase
      // ==========================================
      let status = await engine.status();
      assert.equal(status.currentNode, "scout");
      assert.equal(status.status, "active");

      // Agent turn 1: Context injection
      const sessionCtx1: any = { system: [] };
      await pluginHooks["context"][0](sessionCtx1);
      assert.ok(sessionCtx1.system[0].text.includes("CREWMATE CONTEXT [NODE: SCOUT]"));
      assert.ok(sessionCtx1.system[1].text.includes("Active Role: scout"));

      // Analyst tries to write code -> Guardrail blocks!
      await assert.rejects(async () => {
        await pluginHooks["execute.before"][0]({
          tool: "write",
          input: { path: "src/example/index.ts", content: "console.log('scout');" },
        });
      });

      // Scout finishes discovery, advances to clarify
      const adv0 = await engine.advance();
      assert.equal(adv0.advanced, true);
      assert.equal(adv0.to, "clarify");

      // ==========================================
      // Step 2.5: CLARIFY Phase
      // ==========================================
      status = await engine.status();
      assert.equal(status.currentNode, "clarify");

      // Clarify turn: Context injection
      const sessionCtxClarify: any = { system: [] };
      await pluginHooks["context"][0](sessionCtxClarify);
      assert.ok(sessionCtxClarify.system[0].text.includes("CREWMATE CONTEXT [NODE: CLARIFY]"));
      assert.ok(sessionCtxClarify.system[1].text.includes("Active Role: orchestrator"));

      // Clarify is read-only -> writes are blocked!
      await assert.rejects(async () => {
        await pluginHooks["execute.before"][0]({
          tool: "write",
          input: { path: "src/example/index.ts", content: "console.log('clarify');" },
        });
      });

      // Clarifier finishes, advances to plan
      const advClarify = await engine.advance();
      assert.equal(advClarify.advanced, true);
      assert.equal(advClarify.to, "plan");

      // ==========================================
      // Step 3: PLAN Phase
      // ==========================================
      status = await engine.status();
      assert.equal(status.currentNode, "plan");

      // Agent turn 2: Context injection
      const sessionCtx2: any = { system: [] };
      await pluginHooks["context"][0](sessionCtx2);
      assert.ok(sessionCtx2.system[0].text.includes("CREWMATE CONTEXT [NODE: PLAN]"));
      assert.ok(sessionCtx2.system[1].text.includes("Active Role: planner"));

      // Planner tries to write code -> Guardrail blocks!
      await assert.rejects(async () => {
        await pluginHooks["execute.before"][0]({
          tool: "write",
          input: { path: "src/example/index.ts", content: "console.log('plan');" },
        });
      });

      // Planner finishes plan, advances to execute
      const adv1 = await engine.advance();
      assert.equal(adv1.advanced, true);
      assert.equal(adv1.to, "execute");

      // ==========================================
      // Step 4: EXECUTE Phase
      // ==========================================
      status = await engine.status();
      assert.equal(status.currentNode, "execute");

      // Agent turn 3: Context injection
      const sessionCtx3: any = { system: [] };
      await pluginHooks["context"][0](sessionCtx3);
      assert.ok(sessionCtx3.system[0].text.includes("CREWMATE CONTEXT [NODE: EXECUTE]"));
      assert.ok(sessionCtx3.system[1].text.includes("Active Role: builder"));

      // Builder implements example function conforming to example.contract.yaml
      await assert.doesNotReject(async () => {
        await pluginHooks["execute.before"][0]({
          tool: "write",
          input: {
            path: "src/example/index.ts",
            content: "export function exampleFn(): void { console.log('active'); }\n",
          },
        });
      });

      // Actually write the file to disk
      await fs.mkdir(path.join(tmpDir, "src", "example"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "index.ts"),
        "export function exampleFn(): void { console.log('active'); }\n",
        "utf-8"
      );

      // Advance to contract
      const adv2 = await engine.advance();
      assert.equal(adv2.advanced, true);
      assert.equal(adv2.to, "contract");

      // ==========================================
      // Step 5: CONTRACT Phase
      // ==========================================
      status = await engine.status();
      assert.equal(status.currentNode, "contract");

      // Agent turn 4: Context injection
      const sessionCtx4: any = { system: [] };
      await pluginHooks["context"][0](sessionCtx4);
      assert.ok(sessionCtx4.system[0].text.includes("CREWMATE CONTEXT [NODE: CONTRACT]"));
      assert.ok(sessionCtx4.system[1].text.includes("Active Role: contractor"));

      // Advance to verify
      const adv3 = await engine.advance();
      assert.equal(adv3.advanced, true);
      assert.equal(adv3.to, "verify");

      // ==========================================
      // Step 6: VERIFY Phase with Intentional Defect
      // ==========================================
      status = await engine.status();
      assert.equal(status.currentNode, "verify");

      // Verifier turn: context injection
      const sessionCtx5: any = { system: [] };
      await pluginHooks["context"][0](sessionCtx5);
      assert.ok(sessionCtx5.system[0].text.includes("CREWMATE CONTEXT [NODE: VERIFY]"));
      assert.ok(sessionCtx5.system[1].text.includes("Active Role: verifier"));

      // Introduce dead code: unreferenced export not in contracts!
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "dead.ts"),
        "export function unusedFunction(): string { return 'ghost'; }\n",
        "utf-8"
      );

      // Verify post-gate check on advance should FAIL and route back to execute
      const advFail = await engine.advance();
      assert.equal(advFail.advanced, false);
      assert.equal(advFail.to, "execute");
      assert.equal(advFail.retryCount, 1);
      assert.ok(advFail.message?.includes("Routed to execute"));

      // ==========================================
      // Step 7: FIX in EXECUTE & RE-VERIFY
      // ==========================================
      status = await engine.status();
      assert.equal(status.currentNode, "execute");

      // Remove dead code file
      await fs.rm(path.join(tmpDir, "src", "example", "dead.ts"));

      // Advance from execute -> contract
      const advFix1 = await engine.advance();
      assert.equal(advFix1.advanced, true);
      assert.equal(advFix1.to, "contract");

      // Advance from contract -> verify
      const advFix2 = await engine.advance();
      assert.equal(advFix2.advanced, true);
      assert.equal(advFix2.to, "verify");

      // Now verify post-gates will all pass (crewmate scan dead-code & crewmate scan arch)
      const advDone = await engine.advance();
      assert.equal(advDone.advanced, true);
      assert.equal(advDone.to, "done");
      assert.equal(advDone.status, "completed");

      // Final status check
      status = await engine.status();
      assert.equal(status.status, "completed");
      assert.equal(status.currentNode, "verify");

      // ==========================================
      // Step 6: Verify Append-Only History Audit Trail
      // ==========================================
      const events = await stateMgr.readEvents();
      assert.ok(events.length >= 8);

      const eventTypes = events.map((e) => e.event);
      assert.ok(eventTypes.includes("INIT"));
      assert.ok(eventTypes.includes("NODE_TRANSITION"));
      assert.ok(eventTypes.includes("GATE_CHECK"));
      assert.ok(eventTypes.includes("RETRY_INCREMENT"));
      assert.ok(eventTypes.includes("COMPLETE"));

      // Check state.jsonl raw text format
      const rawJsonl = await fs.readFile(stateMgr.getFilePath(), "utf-8");
      const lines = rawJsonl.trim().split("\n");
      assert.equal(lines.length, events.length);
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line));
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
