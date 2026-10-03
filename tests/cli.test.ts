import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const cliPath = path.resolve("dist", "src", "cli", "index.js");

describe("CLI Integration Tests", () => {
  it("executes full CLI lifecycle: init, status, context, query, scan, advance, goto", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-cli-test-"));
    try {
      // 1. crewmate init
      const initOut = await execAsync(`node "${cliPath}" init --example --project-root "${tmpDir}"`);
      assert.ok(initOut.stdout.includes("Initialized Crewmate workspace successfully"));

      // 2. crewmate status --json
      const statusOut = await execAsync(`node "${cliPath}" status --project-root "${tmpDir}" --json`);
      const status = JSON.parse(statusOut.stdout);
      assert.equal(status.currentNode, "scout");
      assert.equal(status.status, "active");

      // 3. crewmate context --node scout --json
      const contextOut = await execAsync(`node "${cliPath}" context --node scout --project-root "${tmpDir}" --json`);
      const context = JSON.parse(contextOut.stdout);
      assert.equal(context.nodeId, "scout");
      assert.ok(context.tier0.index.modules.length > 0);

      // 4. crewmate query example --field public_api --json
      const queryOut = await execAsync(
        `node "${cliPath}" query example --field public_api --project-root "${tmpDir}" --json`
      );
      const query = JSON.parse(queryOut.stdout);
      assert.equal(query.module, "example");
      assert.equal(query.field, "public_api");
      assert.ok(Array.isArray(query.value));

      // 5. crewmate scan arch (no src files yet -> valid)
      const scanArchOut = await execAsync(`node "${cliPath}" scan arch --project-root "${tmpDir}" --json`);
      const archRes = JSON.parse(scanArchOut.stdout);
      assert.equal(archRes.valid, true);

      // 6. crewmate advance (scout -> clarify)
      const advOut = await execAsync(`node "${cliPath}" advance --project-root "${tmpDir}" --json`);
      const adv = JSON.parse(advOut.stdout);
      assert.equal(adv.advanced, true);
      assert.equal(adv.to, "clarify");

      // 7. crewmate goto verify
      const gotoOut = await execAsync(`node "${cliPath}" goto verify --project-root "${tmpDir}" --json`);
      const gotoRes = JSON.parse(gotoOut.stdout);
      assert.equal(gotoRes.to, "verify");

      // 8. crewmate status
      const statusAfterGoto = await execAsync(`node "${cliPath}" status --project-root "${tmpDir}" --json`);
      assert.equal(JSON.parse(statusAfterGoto.stdout).currentNode, "verify");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
