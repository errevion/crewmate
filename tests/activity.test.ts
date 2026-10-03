import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import { ActivityManager } from "../src/core/activity/activity-manager.js";
import { CrewmateEngine } from "../src/core/engine/engine.js";
import { scanDeadCode } from "../src/core/scanner/dead-code.js";

const execAsync = promisify(exec);
const cliPath = path.resolve("dist", "src", "cli", "index.js");

describe("Activity Tracking Engine & CLI", () => {
  it("logs activity start, end, lists history, and builds activity tree", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-act-test-"),
    );
    try {
      const manager = new ActivityManager(tmpDir);

      // 1. Start root activity
      const rootId = await manager.start({
        agent: "planner-subagent",
        label: "formulating implementation plan",
        node: "plan",
        meta: { tool: "think" },
      });
      assert.ok(rootId.startsWith("act_"));

      // 2. Start child activity under root
      const childId = await manager.start({
        agent: "builder-subagent",
        label: "editing src/example/index.ts",
        node: "execute",
        parent: rootId,
        meta: { files: ["src/example/index.ts"], tool: "edit" },
      });

      // 3. Check active activities
      let active = await manager.getUnclosedActivities();
      assert.equal(active.length, 2);

      // 4. End child activity
      const endedChild = await manager.end({
        id: childId,
        status: "completed",
        meta: { files_changed: ["src/example/index.ts"] },
      });
      assert.equal(endedChild.isUnclosed, false);
      assert.equal(endedChild.status, "completed");

      // Now only root is active (unclosed)
      active = await manager.getUnclosedActivities();
      assert.equal(active.length, 1);
      assert.equal(active[0].id, rootId);

      // 5. Test tree reconstruction
      const tree = await manager.getActivityTree();
      assert.equal(tree.length, 1);
      assert.equal(tree[0].activity.id, rootId);
      assert.equal(tree[0].activity.isUnclosed, true);
      assert.equal(tree[0].children.length, 1);
      assert.equal(tree[0].children[0].activity.id, childId);
      assert.equal(tree[0].children[0].activity.isUnclosed, false);

      // 6. Test tree text rendering
      const rendered = manager.renderTree(tree);
      assert.ok(rendered.includes(rootId));
      assert.ok(rendered.includes("[UNCLOSED] (active)"));
      assert.ok(rendered.includes(childId));
      assert.ok(rendered.includes("(completed)"));
      assert.ok(rendered.includes("└──"));

      // 7. Error handling: ending unknown activity or already ended activity
      await assert.rejects(async () => {
        await manager.end({ id: childId });
      });
      await assert.rejects(async () => {
        await manager.end({ id: "act_nonexistent" });
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("surfaces unclosed activities in status", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-status-act-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Start an unclosed activity
      await engine.getActivityManager().start({
        agent: "builder",
        label: "interrupted task writing auth.ts",
        node: "execute",
        meta: { files: ["src/auth.ts"] },
      });

      const status = await engine.status();
      assert.equal(status.unclosedActivities.length, 1);
      assert.equal(
        status.unclosedActivities[0].label,
        "interrupted task writing auth.ts",
      );

      // Verify CLI status output displays unclosed activity
      const statusOut = await execAsync(
        `node "${cliPath}" status --project-root "${tmpDir}"`,
      );
      assert.ok(
        statusOut.stdout.includes(
          "Unclosed Activities (1): [INTERRUPTED / UNFINISHED WORK]",
        ),
      );
      assert.ok(statusOut.stdout.includes("interrupted task writing auth.ts"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks advance when unclosed activity touches verified files", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-advance-act-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Create example file conforming to example.contract.yaml
      await fs.mkdir(path.join(tmpDir, "src", "example"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "index.ts"),
        "export function exampleFn(): void { console.log('hello'); }\n",
        "utf-8",
      );

      // Advance to execute
      await engine.goto("execute");

      // Now in execute: start an activity touching src/example/index.ts but leave it UNCLOSED!
      const unclosedId = await engine.getActivityManager().start({
        agent: "builder",
        label: "editing src/example/index.ts",
        node: "execute",
        meta: { files: ["src/example/index.ts"] },
      });

      // Advance to verify should be BLOCKED because of unclosed activity touching src/example/index.ts!
      const advBlocked = await engine.advance();
      assert.equal(advBlocked.advanced, false);
      assert.ok(
        advBlocked.message?.includes(
          "Advance blocked: Unclosed activities touching verified files",
        ),
      );
      assert.ok(advBlocked.message?.includes(unclosedId));
      assert.equal(advBlocked.unclosedActivities?.length, 1);

      // Now close/end the activity
      await engine.getActivityManager().end({
        id: unclosedId,
        status: "completed",
      });

      // Now advance should succeed!
      const advPass = await engine.advance();
      assert.equal(advPass.advanced, true);
      assert.equal(advPass.to, "contract");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("correlates dead-code scan candidates with originating activity provenance", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-provenance-test-"),
    );
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init({ example: true });

      // Setup dummy file with unreferenced dead code
      await fs.mkdir(path.join(tmpDir, "src", "example"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "index.ts"),
        "export function exampleFn(): void {}\n",
        "utf-8",
      );
      await fs.writeFile(
        path.join(tmpDir, "src", "example", "unused.ts"),
        "export function ghostFunction(): void {}\n",
        "utf-8",
      );

      // 1. Without activity log, dead code scan works and gracefully omits provenance
      const initialScan = await scanDeadCode(tmpDir);
      assert.equal(initialScan.safeDeleteCandidates.length, 1);
      assert.equal(initialScan.safeDeleteCandidates[0].symbol, "ghostFunction");
      assert.equal(initialScan.safeDeleteCandidates[0].provenance, undefined);

      // 2. Now record an activity that introduced unused.ts
      const act1 = await engine.getActivityManager().start({
        agent: "legacy-agent",
        label: "initial spike with experimental helpers",
        node: "execute",
        meta: { files: ["src/example/unused.ts"] },
      });
      await engine.getActivityManager().end({ id: act1 });

      // And a later activity that also touched unused.ts
      const act2 = await engine.getActivityManager().start({
        agent: "refactor-agent",
        label: "attempted cleanup in example",
        node: "execute",
        meta: { files: ["src/example/unused.ts"] },
      });
      await engine.getActivityManager().end({ id: act2 });

      // 3. Scan dead-code again -> provenance MUST be present!
      const scanWithProv = await scanDeadCode(tmpDir);
      assert.equal(scanWithProv.safeDeleteCandidates.length, 1);
      const candidate = scanWithProv.safeDeleteCandidates[0];
      assert.ok(candidate.provenance);
      assert.equal(candidate.provenance.originatingActivityId, act1);
      assert.equal(candidate.provenance.originatingAgent, "legacy-agent");
      assert.equal(
        candidate.provenance.originatingLabel,
        "initial spike with experimental helpers",
      );
      assert.equal(candidate.provenance.subsequentReferenceCount, 1);
      assert.deepEqual(candidate.provenance.subsequentActivityIds, [act2]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("executes CLI commands: activity start, end, list, tree", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-cli-act-"),
    );
    try {
      // 1. activity start
      const startOut = await execAsync(
        `node "${cliPath}" activity start --agent test-agent --label "writing feature" --project-root "${tmpDir}" --meta "{\\"files\\":[\\"src/feature.ts\\"]}"`,
      );
      const actId = startOut.stdout.trim();
      assert.ok(actId.startsWith("act_"));

      // 2. activity list --active
      const listActiveOut = await execAsync(
        `node "${cliPath}" activity list --active --project-root "${tmpDir}" --json`,
      );
      const activeList = JSON.parse(listActiveOut.stdout);
      assert.equal(activeList.length, 1);
      assert.equal(activeList[0].id, actId);

      // 3. activity tree
      const treeOut = await execAsync(
        `node "${cliPath}" activity tree --project-root "${tmpDir}"`,
      );
      assert.ok(treeOut.stdout.includes(actId));
      assert.ok(treeOut.stdout.includes("[UNCLOSED]"));

      // 4. activity end
      const endOut = await execAsync(
        `node "${cliPath}" activity end --id "${actId}" --status completed --project-root "${tmpDir}"`,
      );
      assert.ok(endOut.stdout.includes("ended with status 'completed'"));

      // 5. activity list --active now empty
      const listAfterEnd = await execAsync(
        `node "${cliPath}" activity list --active --project-root "${tmpDir}" --json`,
      );
      assert.equal(JSON.parse(listAfterEnd.stdout).length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
