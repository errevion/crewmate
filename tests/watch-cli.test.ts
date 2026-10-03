import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

describe("Crewmate Watch CLI & Binary", () => {
  const isWin = process.platform === "win32";
  const exeName = isWin ? "crewmate-watch.exe" : "crewmate-watch";
  const binaryPath = path.resolve("crates", "crewmate-watch", "target", "release", exeName);

  it("exposes crewmate watch in the Node CLI help", async () => {
    const cliPath = path.resolve("dist", "src", "cli", "index.js");
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, "watch", "--help"]);
    assert.strictEqual(stderr, "");
    assert.match(stdout, /Launch read-only live TUI observer/i);
    assert.match(stdout, /--fps <number>/i);
    assert.match(stdout, /-p, --project-root/i);
  });

  it("compiled Rust binary is executable and supports --help and --version", async () => {
    assert.ok(fs.existsSync(binaryPath), `Binary not found at ${binaryPath}`);

    const helpRes = await execFileAsync(binaryPath, ["--help"]);
    assert.match(helpRes.stdout, /Read-only live TUI observer for Crewmate workflow engine/i);
    assert.match(helpRes.stdout, /--fps <FPS>/i);
    assert.match(helpRes.stdout, /--root <ROOT>/i);

    const versionRes = await execFileAsync(binaryPath, ["--version"]);
    assert.match(versionRes.stdout, /crewmate-watch 0\.1\.0/i);
  });

  it("resolves watch binary when invoked from an external initialized project directory", async () => {
    const cliPath = path.resolve("dist", "src", "cli", "index.js");
    const tempDir = path.resolve("dist", "test_external_watch_" + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Initialize in the external folder
      await execFileAsync(process.execPath, [cliPath, "init"], { cwd: tempDir });

      // Run watch for 300ms in the external folder and ensure no "Could not find 'crewmate-watch.exe'" error
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [cliPath, "watch"], {
        cwd: tempDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderrOutput = "";
      child.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });

      await new Promise((resolve) => setTimeout(resolve, 350));
      child.kill();
      await new Promise((resolve) => child.on("exit", resolve));
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.doesNotMatch(stderrOutput, /Could not find 'crewmate-watch/i);
      assert.doesNotMatch(stderrOutput, /Watch Error:/i);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // ignore cleanup error on Windows
      }
    }
  });
});
