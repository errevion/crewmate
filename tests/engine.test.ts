import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { CrewmateEngine } from "../src/core/engine/engine.js";

describe("CrewmateEngine Core", () => {
  it("initializes project workspace and reads status", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-engine-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      const initResult = await engine.init();
      assert.equal(initResult.initialized, true);
      assert.ok(initResult.filesCreated.length > 5);

      // Verify contracts and workflow are inside .crewmate/
      assert.ok(
        initResult.filesCreated.includes(".crewmate/contracts/index.yaml"),
      );
      assert.ok(
        initResult.filesCreated.includes(".crewmate/contracts/SCHEMA.md"),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/feature-pipeline/graph.yaml",
        ),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/feature-pipeline/nodes/scout.node.yaml",
        ),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/feature-pipeline/nodes/clarify.node.yaml",
        ),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/feature-pipeline/nodes/contract.node.yaml",
        ),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/contract-sync/graph.yaml",
        ),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/contract-sync/nodes/scout.node.yaml",
        ),
      );
      assert.ok(
        initResult.filesCreated.includes(
          ".crewmate/workflows/contract-sync/nodes/contract.node.yaml",
        ),
      );
      assert.ok(
        !initResult.filesCreated.includes(".crewmate/workflow/graph.yaml"),
      );

      // Verify SCHEMA.md content
      const schemaMd = await fs.readFile(
        path.join(tmpDir, ".crewmate", "contracts", "SCHEMA.md"),
        "utf-8",
      );
      assert.ok(schemaMd.includes("Crewmate Contract System Specification"));
      assert.ok(schemaMd.includes("modules/<module>.contract.yaml"));
      assert.ok(schemaMd.includes("public_api"));
      assert.ok(schemaMd.includes("status: draft"));
      assert.ok(schemaMd.includes("status: final"));

      // Verify OpenCode project-wide plugin .ts was installed
      assert.ok(
        initResult.filesCreated.includes(".opencode/plugins/crewmate.ts"),
      );
      assert.ok(
        !initResult.filesCreated.includes(".opencode/plugins/crewmate.js"),
      );

      const pluginTsContent = await fs.readFile(
        path.join(tmpDir, ".opencode", "plugins", "crewmate.ts"),
        "utf-8",
      );
      assert.ok(pluginTsContent.includes("crewmate/plugin"));
      assert.ok(pluginTsContent.includes("adapters/opencode/index.js"));

      // Verify OpenCode Matte agent was installed
      assert.ok(initResult.filesCreated.includes(".opencode/agents/matte.md"));
      const matteContent = await fs.readFile(
        path.join(tmpDir, ".opencode", "agents", "matte.md"),
        "utf-8",
      );
      assert.ok(matteContent.includes("Matte"));
      assert.ok(matteContent.includes("edit: deny"));

      // Verify OpenCode workflow subagents were installed
      for (const sub of [
        "scout",
        "planner",
        "builder",
        "contractor",
        "verifier",
      ]) {
        assert.ok(
          initResult.filesCreated.includes(`.opencode/agents/${sub}.md`),
        );
        const subContent = await fs.readFile(
          path.join(tmpDir, ".opencode", "agents", `${sub}.md`),
          "utf-8",
        );
        assert.ok(subContent.includes("mode: subagent"));
        assert.ok(!subContent.includes("hidden: true"));
        if (sub === "planner") {
          assert.ok(subContent.includes("edit: allow"));
          assert.ok(subContent.includes("contracts-write"));
        }
        if (["scout", "planner", "builder", "contractor"].includes(sub)) {
          assert.ok(
            subContent.includes("SCHEMA.md"),
            `Subagent ${sub}.md must reference .crewmate/contracts/SCHEMA.md`,
          );
        }
      }

      const clarifyDef = await engine.getNodeDef("clarify");
      assert.equal(clarifyDef.subagent?.scope, "read-only");
      assert.equal(clarifyDef.subagent?.role, "orchestrator");

      const planDef = await engine.getNodeDef("plan");
      assert.equal(planDef.subagent?.scope, "contracts-write");

      const contractDef = await engine.getNodeDef("contract");
      assert.equal(contractDef.subagent?.scope, "contracts-write");

      // Default init should NOT scaffold example contract
      assert.ok(
        !initResult.filesCreated.includes(
          ".crewmate/contracts/modules/example.contract.yaml",
        ),
      );
      let exampleExists = false;
      try {
        await fs.access(
          path.join(
            tmpDir,
            ".crewmate",
            "contracts",
            "modules",
            "example.contract.yaml",
          ),
        );
        exampleExists = true;
      } catch {
        exampleExists = false;
      }
      assert.equal(exampleExists, false);

      const status = await engine.status();
      assert.equal(status.currentNode, "scout");
      assert.equal(status.status, "active");
      assert.equal(status.retryCount, 0);
      assert.ok(status.instructions.includes("contracts"));
      assert.equal(status.subagent?.role, "scout");
      assert.equal(status.subagent?.agent, "scout");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves existing opencode.json settings", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-existing-opencode-"),
    );
    try {
      // Create existing opencode.json with a custom plugin and setting
      const existingConfig = {
        $schema: "https://opencode.dev/schema.json",
        customSetting: true,
        plugins: ["existing-plugin"],
      };
      await fs.writeFile(
        path.join(tmpDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
        "utf-8",
      );

      const engine = new CrewmateEngine(tmpDir);
      const initResult = await engine.init();
      assert.equal(initResult.initialized, true);

      // Verify opencode.json custom settings were preserved
      const updatedConfig = JSON.parse(
        await fs.readFile(path.join(tmpDir, "opencode.json"), "utf-8"),
      );
      assert.equal(updatedConfig.customSetting, true);
      assert.ok(updatedConfig.plugins.includes("existing-plugin"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("scaffolds example contract when { example: true } is passed", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-example-init-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      const res = await engine.init({ example: true });
      assert.ok(
        res.filesCreated.includes(
          ".crewmate/contracts/modules/example.contract.yaml",
        ),
      );

      const exampleContract = await fs.readFile(
        path.join(
          tmpDir,
          ".crewmate",
          "contracts",
          "modules",
          "example.contract.yaml",
        ),
        "utf-8",
      );
      assert.ok(exampleContract.includes("status: final"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("assembles tiered context bundle", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-context-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      const context = await engine.context("plan");
      assert.equal(context.nodeId, "plan");
      assert.ok(context.tier0.index.modules.some((m) => m.name === "example"));
      assert.ok(
        context.tier0.capabilities.capabilities.some(
          (c) => c.name === "example-feature",
        ),
      );
      assert.ok(context.tier1.contracts["example"]);
      assert.ok(context.tier2.architecture.modules["example"]);
      assert.ok(context.formatted.includes("CREWMATE CONTEXT [NODE: PLAN]"));
      assert.ok(context.formatted.includes("Tier 0: Modules & Capabilities"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("queries single fields from module contracts", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-query-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      const api = await engine.query("example", "public_api");
      assert.ok(Array.isArray(api));
      assert.equal((api as any)[0].export, "exampleFn");

      const invariants = await engine.query("example", "invariants");
      assert.ok(Array.isArray(invariants));

      await assert.rejects(async () => {
        await engine.query("example", "non_existent_field");
      });

      // Querying a non-existent contract should throw an error pointing to .crewmate/contracts/modules/
      await assert.rejects(
        async () => {
          await engine.query("non_existent", "invariants");
        },
        (err: Error) => {
          return (
            err.message.includes(
              "Module contract not found for 'non_existent'",
            ) &&
            err.message.includes(
              path.join(
                ".crewmate",
                "contracts",
                "modules",
                "non_existent.contract.yaml",
              ),
            )
          );
        },
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolves contract paths canonically under .crewmate/contracts/", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-contract-path-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Even for a non-existent file, it resolves canonically inside .crewmate/contracts/
      const resolved = await engine.resolveContractPath(
        "modules",
        "test.contract.yaml",
      );
      assert.equal(
        resolved,
        path.join(
          tmpDir,
          ".crewmate",
          "contracts",
          "modules",
          "test.contract.yaml",
        ),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("performs manual goto override", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-goto-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      const res = await engine.goto("verify");
      assert.equal(res.from, "scout");
      assert.equal(res.to, "verify");

      const status = await engine.status();
      assert.equal(status.currentNode, "verify");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("advances through phases and handles gate checks and fail-routing", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-advance-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Create dummy example file satisfying the example contract
      await fs.mkdir(path.join(tmpDir, "src", "example"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "index.ts"),
        "export function exampleFn(): void { console.log('hello'); }\n",
        "utf-8",
      );

      // Current is scout. Advance -> clarify
      const adv0 = await engine.advance();
      assert.equal(adv0.advanced, true);
      assert.equal(adv0.to, "clarify");

      // Current is clarify. Advance -> plan
      const advClarify = await engine.advance();
      assert.equal(advClarify.advanced, true);
      assert.equal(advClarify.to, "plan");

      // Current is plan. Advance -> execute
      const adv1 = await engine.advance();
      assert.equal(adv1.advanced, true);
      assert.equal(adv1.to, "execute");

      // Current is execute. Advance -> contract
      const adv2 = await engine.advance();
      assert.equal(adv2.advanced, true);
      assert.equal(adv2.to, "contract");

      // Current is contract. Advance -> verify
      const adv3 = await engine.advance();
      assert.equal(adv3.advanced, true);
      assert.equal(adv3.to, "verify");

      // In verify: introduce unreferenced dead code to cause verify post-gates to fail!
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "dead.ts"),
        "export function unusedDeadFunction(): void {}\n",
        "utf-8",
      );

      // Verify post-gate (crewmate scan dead-code) should fail!
      const advFail1 = await engine.advance();
      assert.equal(advFail1.advanced, false);
      assert.equal(advFail1.to, "execute"); // routed back per on_fail: route(execute)
      assert.equal(advFail1.retryCount, 1);

      // Now on execute. Let's goto verify again and fail a 2nd time:
      await engine.goto("verify");
      const advFail2 = await engine.advance();
      assert.equal(advFail2.advanced, false);
      assert.equal(advFail2.retryCount, 2);

      // 3rd failure should escalate to human (max_retries was 2)
      await engine.goto("verify");
      const advFail3 = await engine.advance();
      assert.equal(advFail3.advanced, false);
      assert.equal(advFail3.status, "escalated");
      assert.equal(advFail3.escalationTarget, "human");

      // Verify state recorded escalation
      const state = await engine.status();
      assert.equal(state.status, "escalated");
      assert.equal(state.escalationTarget, "human");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
