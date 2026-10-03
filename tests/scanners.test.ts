import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { scanArchitecture } from "../src/core/scanner/arch.js";
import { scanDeadCode } from "../src/core/scanner/dead-code.js";
import { CrewmateEngine } from "../src/core/engine/engine.js";

describe("Static Analysis Scanners (Phase 2)", () => {
  it("detects architectural boundary violations with evidence", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-arch-test-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Setup 2 modules in index.yaml & architecture.yaml:
      // auth: allowed_dependencies: []
      // billing: allowed_dependencies: [auth]
      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "index.yaml"),
        `version: "1.0.0"
modules:
  - name: auth
    responsibility: "Authentication"
    path: "src/auth"
    version: "1.0.0"
    public_surface: ["src/auth/index.ts"]
  - name: billing
    responsibility: "Billing"
    path: "src/billing"
    version: "1.0.0"
    public_surface: ["src/billing/index.ts"]
`,
        "utf-8"
      );

      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "architecture.yaml"),
        `version: "1.0.0"
modules:
  auth:
    allowed_dependencies: []
  billing:
    allowed_dependencies: [auth]
`,
        "utf-8"
      );

      // Create valid billing -> auth import
      await fs.mkdir(path.join(tmpDir, "src", "auth"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "src", "billing"), { recursive: true });

      await fs.writeFile(
        path.join(tmpDir, "src", "auth", "index.ts"),
        `export function getUserId(): string { return "user_1"; }\n`,
        "utf-8"
      );

      await fs.writeFile(
        path.join(tmpDir, "src", "billing", "index.ts"),
        `import { getUserId } from "../auth/index.js";
export function chargeUser(): void {
  const id = getUserId();
}
`,
        "utf-8"
      );

      // Check valid
      const validRes = await scanArchitecture(tmpDir);
      assert.equal(validRes.valid, true);
      assert.equal(validRes.violations.length, 0);

      // Now introduce an illegal import: auth importing billing!
      await fs.writeFile(
        path.join(tmpDir, "src", "auth", "leak.ts"),
        `import { chargeUser } from "../billing/index.js";
export function illegalOperation(): void {
  chargeUser();
}
`,
        "utf-8"
      );

      // Check violation detected
      const failRes = await scanArchitecture(tmpDir);
      assert.equal(failRes.valid, false);
      assert.equal(failRes.violations.length, 1);
      const v = failRes.violations[0];
      assert.equal(v.sourceModule, "auth");
      assert.equal(v.targetModule, "billing");
      assert.ok(v.message.includes("violates architecture rules"));
      assert.equal(v.line, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces the dead-code decision rule (safe-delete vs flag-for-review)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crewmate-deadcode-test-"));
    try {
      const engine = new CrewmateEngine(tmpDir);
      await engine.init();

      // Configure module contract for auth:
      // public_api has "verifyToken"
      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "modules", "auth.contract.yaml"),
        `module: auth
version: "1.0.0"
public_api:
  - export: "verifyToken"
    signature: "(token: string) => boolean"
    file: "src/auth/jwt.ts"
invariants: []
declared_consumers: []
`,
        "utf-8"
      );

      // Configure capabilities.yaml:
      // entrypoint has "externalHelper"
      await fs.writeFile(
        path.join(tmpDir, ".crewmate", "contracts", "capabilities.yaml"),
        `capabilities:
  - name: "external-capability"
    module: "auth"
    description: "External tool capability"
    entrypoint: "src/auth/tools.ts:externalHelper"
`,
        "utf-8"
      );

      await fs.mkdir(path.join(tmpDir, "src", "auth"), { recursive: true });

      // File 1: jwt.ts with verifyToken (unreferenced locally, but declared in contract public_api!)
      await fs.writeFile(
        path.join(tmpDir, "src", "auth", "jwt.ts"),
        `export function verifyToken(token: string): boolean { return true; }\n`,
        "utf-8"
      );

      // File 2: tools.ts with externalHelper (unreferenced locally, but in capabilities.yaml!)
      await fs.writeFile(
        path.join(tmpDir, "src", "auth", "tools.ts"),
        `export function externalHelper(): void {}\n`,
        "utf-8"
      );

      // File 3: internal.ts with unusedSecretFn (unreferenced AND NOT in any contract!)
      await fs.writeFile(
        path.join(tmpDir, "src", "auth", "internal.ts"),
        `export function unusedSecretFn(): void {}\n`,
        "utf-8"
      );

      // File 4: active.ts with usedFn, which is called within active.ts
      await fs.writeFile(
        path.join(tmpDir, "src", "auth", "active.ts"),
        `export function usedFn(): void {}
usedFn();
`,
        "utf-8"
      );

      const scanResult = await scanDeadCode(tmpDir);

      // unusedSecretFn MUST be in safeDeleteCandidates
      assert.equal(scanResult.safeDeleteCandidates.length, 1);
      const safe = scanResult.safeDeleteCandidates[0];
      assert.equal(safe.symbol, "unusedSecretFn");
      assert.equal(safe.confidence, "high");

      // verifyToken and externalHelper MUST be in flaggedForReview
      assert.equal(scanResult.flaggedForReview.length, 2);
      const flaggedSymbols = scanResult.flaggedForReview.map((f) => f.symbol);
      assert.ok(flaggedSymbols.includes("verifyToken"));
      assert.ok(flaggedSymbols.includes("externalHelper"));

      // usedFn MUST NOT be in either
      assert.ok(!flaggedSymbols.includes("usedFn"));
      assert.ok(scanResult.safeDeleteCandidates.every((c) => c.symbol !== "usedFn"));

      // valid must be false because there is a safeDeleteCandidate
      assert.equal(scanResult.valid, false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
