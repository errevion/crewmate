import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import {
  findPackageRoot,
  getDownloadUrl,
  getPackageVersion,
  getTarget,
  installWatchBinary,
} from "../src/cli/install-watch.js";

const execFileAsync = promisify(execFile);

describe("Crewmate Watch CLI & Binary", () => {
  const isWin = process.platform === "win32";
  const exeName = isWin ? "crewmate-watch.exe" : "crewmate-watch";
  const binaryPath = path.resolve(
    "crates",
    "crewmate-watch",
    "target",
    "release",
    exeName,
  );

  it("exposes crewmate watch in the Node CLI help", async () => {
    const cliPath = path.resolve("dist", "src", "cli", "index.js");
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "watch",
      "--help",
    ]);
    assert.strictEqual(stderr, "");
    assert.match(stdout, /Launch read-only live TUI observer/i);
    assert.match(stdout, /--fps <number>/i);
    assert.match(stdout, /-p, --project-root/i);
  });

  it("compiled Rust binary is executable and supports --help and --version", async () => {
    assert.ok(fs.existsSync(binaryPath), `Binary not found at ${binaryPath}`);

    const helpRes = await execFileAsync(binaryPath, ["--help"]);
    assert.match(
      helpRes.stdout,
      /Read-only live TUI observer for Crewmate workflow engine/i,
    );
    assert.match(helpRes.stdout, /--fps <FPS>/i);
    assert.match(helpRes.stdout, /--root <ROOT>/i);

    const versionRes = await execFileAsync(binaryPath, ["--version"]);
    assert.match(versionRes.stdout, /crewmate-watch 0\.1\.0/i);
  });

  it("resolves watch binary when invoked from an external initialized project directory", async () => {
    const cliPath = path.resolve("dist", "src", "cli", "index.js");
    const tempDir = path.resolve(`dist/test_external_watch_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Initialize in the external folder
      await execFileAsync(process.execPath, [cliPath, "init"], {
        cwd: tempDir,
      });

      // Run watch for 350ms in the external folder and ensure no "Could not find 'crewmate-watch.exe'" error
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [cliPath, "watch"], {
        cwd: tempDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const exitPromise = new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve(child.exitCode);
        } else {
          child.once("exit", resolve);
        }
      });

      let stderrOutput = "";
      child.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });

      await new Promise((resolve) => setTimeout(resolve, 350));
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      await exitPromise;
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.doesNotMatch(stderrOutput, /Could not find 'crewmate-watch/i);
      assert.doesNotMatch(stderrOutput, /Watch Error:/i);
    } finally {
      try {
        fs.rmSync(tempDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch {
        // ignore cleanup error on Windows
      }
    }
  });

  describe("install-watch: platform and architecture mapping (getTarget)", () => {
    it("maps Windows x64 correctly", () => {
      const res = getTarget("win32", "x64");
      assert.deepStrictEqual(res, {
        target: "x86_64-pc-windows-msvc",
        archiveExt: "zip",
        binaryName: "crewmate-watch.exe",
      });
    });

    it("maps macOS arm64 correctly", () => {
      const res = getTarget("darwin", "arm64");
      assert.deepStrictEqual(res, {
        target: "aarch64-apple-darwin",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      });
    });

    it("maps macOS x64 correctly", () => {
      const res = getTarget("darwin", "x64");
      assert.deepStrictEqual(res, {
        target: "x86_64-apple-darwin",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      });
    });

    it("maps Linux arm64 correctly", () => {
      const res = getTarget("linux", "arm64");
      assert.deepStrictEqual(res, {
        target: "aarch64-unknown-linux-gnu",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      });
    });

    it("maps Linux x64 correctly", () => {
      const res = getTarget("linux", "x64");
      assert.deepStrictEqual(res, {
        target: "x86_64-unknown-linux-gnu",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      });
    });

    it("returns null for unsupported platforms and architectures", () => {
      assert.strictEqual(getTarget("win32", "arm64"), null);
      assert.strictEqual(getTarget("freebsd", "x64"), null);
      assert.strictEqual(getTarget("linux", "ia32"), null);
      assert.strictEqual(getTarget("sunos", "x64"), null);
      assert.strictEqual(getTarget("aix", "ppc64"), null);
    });

    it("resolves target for the host system when called with defaults", () => {
      const res = getTarget();
      if (
        (process.platform === "win32" && process.arch === "x64") ||
        (process.platform === "darwin" &&
          (process.arch === "arm64" || process.arch === "x64")) ||
        (process.platform === "linux" &&
          (process.arch === "arm64" || process.arch === "x64"))
      ) {
        assert.ok(res !== null);
        assert.ok(res?.target);
        assert.ok(res?.binaryName);
      } else {
        assert.strictEqual(res, null);
      }
    });
  });

  describe("install-watch: release download URL generation (getDownloadUrl)", () => {
    it("constructs standard GitHub release URL", () => {
      const url = getDownloadUrl("0.1.0", "x86_64-pc-windows-msvc", "zip");
      assert.strictEqual(
        url,
        "https://github.com/errevion/crewmate/releases/download/v0.1.0/crewmate-watch-v0.1.0-x86_64-pc-windows-msvc.zip",
      );
    });

    it("normalizes version tags with leading v", () => {
      const url = getDownloadUrl(
        "v1.2.3",
        "aarch64-unknown-linux-gnu",
        "tar.gz",
      );
      assert.strictEqual(
        url,
        "https://github.com/errevion/crewmate/releases/download/v1.2.3/crewmate-watch-v1.2.3-aarch64-unknown-linux-gnu.tar.gz",
      );
    });

    it("respects CREWMATE_WATCH_DOWNLOAD_BASE_URL override", () => {
      const origBaseUrl = process.env.CREWMATE_WATCH_DOWNLOAD_BASE_URL;
      try {
        process.env.CREWMATE_WATCH_DOWNLOAD_BASE_URL =
          "https://mirror.internal/dist";
        const url = getDownloadUrl("0.5.0", "x86_64-apple-darwin", "tar.gz");
        assert.strictEqual(
          url,
          "https://mirror.internal/dist/v0.5.0/crewmate-watch-v0.5.0-x86_64-apple-darwin.tar.gz",
        );
      } finally {
        if (origBaseUrl !== undefined) {
          process.env.CREWMATE_WATCH_DOWNLOAD_BASE_URL = origBaseUrl;
        } else {
          delete process.env.CREWMATE_WATCH_DOWNLOAD_BASE_URL;
        }
      }
    });
  });

  describe("install-watch: package root and version resolution", () => {
    it("finds package root and reads package version from repo root", () => {
      const pkgRoot = findPackageRoot();
      assert.ok(fs.existsSync(path.join(pkgRoot, "package.json")));

      const version = getPackageVersion(pkgRoot);
      assert.strictEqual(version, "0.1.0");
    });

    it("finds package root from a nested subdirectory", () => {
      const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-pkg-"),
      );
      const nestedDir = path.join(tempRoot, "a", "b", "c");
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "package.json"),
        JSON.stringify({ name: "nested-pkg", version: "2.3.4" }),
      );

      try {
        const foundRoot = findPackageRoot(nestedDir);
        assert.strictEqual(foundRoot, tempRoot);
        const version = getPackageVersion(foundRoot);
        assert.strictEqual(version, "2.3.4");
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it("falls back to default version 0.1.0 when package.json has no version or is invalid", () => {
      const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-badpkg-"),
      );
      fs.writeFileSync(path.join(tempRoot, "package.json"), "invalid-json");

      try {
        const version = getPackageVersion(tempRoot);
        assert.strictEqual(version, "0.1.0");
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  });

  describe("install-watch: binary installation and lazy fallback behaviors", () => {
    it("returns null immediately when CREWMATE_SKIP_WATCH_INSTALL=1", async () => {
      const origSkip = process.env.CREWMATE_SKIP_WATCH_INSTALL;
      try {
        process.env.CREWMATE_SKIP_WATCH_INSTALL = "1";
        const res = await installWatchBinary();
        assert.strictEqual(res, null);
      } finally {
        if (origSkip !== undefined) {
          process.env.CREWMATE_SKIP_WATCH_INSTALL = origSkip;
        } else {
          delete process.env.CREWMATE_SKIP_WATCH_INSTALL;
        }
      }
    });

    it("returns existing binary path without downloading when force is false", async () => {
      const targetInfo = getTarget();
      if (!targetInfo) return;

      const tempProjectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-exist-"),
      );
      fs.writeFileSync(
        path.join(tempProjectDir, "package.json"),
        JSON.stringify({ name: "test-exist", version: "0.1.0" }),
      );
      const binDir = path.join(tempProjectDir, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const binPath = path.join(binDir, targetInfo.binaryName);
      fs.writeFileSync(binPath, "existing-binary-content", "utf-8");

      const origUrl = process.env.CREWMATE_WATCH_DOWNLOAD_URL;
      try {
        // Point to an invalid unreachable address; if it tries to download, it would fail
        process.env.CREWMATE_WATCH_DOWNLOAD_URL =
          "http://127.0.0.1:1/unreachable.zip";

        const res = await installWatchBinary({
          force: false,
          projectRoot: tempProjectDir,
        });

        assert.strictEqual(res, binPath);
      } finally {
        if (origUrl !== undefined) {
          process.env.CREWMATE_WATCH_DOWNLOAD_URL = origUrl;
        } else {
          delete process.env.CREWMATE_WATCH_DOWNLOAD_URL;
        }
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
      }
    });

    it("lazy: true returns null and logs warning on network failure without throwing", async () => {
      const tempProjectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-lazy-fail-"),
      );
      fs.writeFileSync(
        path.join(tempProjectDir, "package.json"),
        JSON.stringify({ name: "test-lazy", version: "0.1.0" }),
      );

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };

      const origUrl = process.env.CREWMATE_WATCH_DOWNLOAD_URL;
      try {
        process.env.CREWMATE_WATCH_DOWNLOAD_URL =
          "http://127.0.0.1:1/nonexistent.zip";

        const res = await installWatchBinary({
          force: true,
          lazy: true,
          projectRoot: tempProjectDir,
        });

        assert.strictEqual(res, null);
        assert.ok(
          warnings.some((w) =>
            w.includes("Failed to download pre-built watch binary"),
          ),
          `Expected download failure warning, got: ${JSON.stringify(warnings)}`,
        );
      } finally {
        console.warn = origWarn;
        if (origUrl !== undefined) {
          process.env.CREWMATE_WATCH_DOWNLOAD_URL = origUrl;
        } else {
          delete process.env.CREWMATE_WATCH_DOWNLOAD_URL;
        }
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
      }
    });

    it("lazy: false returns null and logs warning on network failure without throwing", async () => {
      const tempProjectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-nonlazy-fail-"),
      );
      fs.writeFileSync(
        path.join(tempProjectDir, "package.json"),
        JSON.stringify({ name: "test-nonlazy", version: "0.1.0" }),
      );

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };

      const origUrl = process.env.CREWMATE_WATCH_DOWNLOAD_URL;
      try {
        process.env.CREWMATE_WATCH_DOWNLOAD_URL =
          "http://127.0.0.1:1/nonexistent.zip";

        const res = await installWatchBinary({
          force: true,
          lazy: false,
          projectRoot: tempProjectDir,
        });

        assert.strictEqual(res, null);
        assert.ok(
          warnings.some((w) =>
            w.includes("Warning: Failed to download pre-built watch binary"),
          ),
          `Expected warning message, got: ${JSON.stringify(warnings)}`,
        );
      } finally {
        console.warn = origWarn;
        if (origUrl !== undefined) {
          process.env.CREWMATE_WATCH_DOWNLOAD_URL = origUrl;
        } else {
          delete process.env.CREWMATE_WATCH_DOWNLOAD_URL;
        }
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
      }
    });

    it("returns null and logs warning when platform is unsupported", async () => {
      const origPlatform = process.platform;
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };

      try {
        Object.defineProperty(process, "platform", {
          value: "unsupported_os",
          configurable: true,
        });

        const res = await installWatchBinary({ lazy: true });
        assert.strictEqual(res, null);
        assert.ok(
          warnings.some((w) =>
            w.includes("Unsupported platform 'unsupported_os'"),
          ),
          `Expected unsupported platform warning, got: ${JSON.stringify(warnings)}`,
        );
      } finally {
        Object.defineProperty(process, "platform", {
          value: origPlatform,
          configurable: true,
        });
        console.warn = origWarn;
      }
    });
  });

  describe("install-watch: mock HTTP release download and checksum verification", () => {
    it("downloads, verifies checksum, extracts, and installs binary from mock release server", async () => {
      const targetInfo = getTarget();
      if (!targetInfo) return;

      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-mock-server-"),
      );
      const tempProjectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-mock-proj-"),
      );
      fs.writeFileSync(
        path.join(tempProjectDir, "package.json"),
        JSON.stringify({ name: "test-mock-proj", version: "0.1.0" }),
      );

      try {
        const dummyBinaryContent =
          "mock-crewmate-watch-binary-payload-v0.1.0-content";
        const dummyBinaryPath = path.join(tempDir, targetInfo.binaryName);
        fs.writeFileSync(dummyBinaryPath, dummyBinaryContent, "utf-8");

        const archiveExt = targetInfo.archiveExt === "zip" ? "zip" : "tar.gz";
        const archivePath = path.join(tempDir, `archive.${archiveExt}`);

        execFileSync("tar", [
          "-acf",
          archivePath,
          "-C",
          tempDir,
          targetInfo.binaryName,
        ]);
        const archiveBuffer = fs.readFileSync(archivePath);
        const sha256 = createHash("sha256").update(archiveBuffer).digest("hex");

        let serverPort = 0;
        const server = http.createServer((req, res) => {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${serverPort}`);
          if (url.pathname === `/crewmate-watch.${archiveExt}`) {
            res.writeHead(200, { "Content-Type": "application/octet-stream" });
            res.end(archiveBuffer);
          } else if (url.pathname === `/crewmate-watch.${archiveExt}.sha256`) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(`${sha256}  crewmate-watch.${archiveExt}\n`);
          } else {
            res.writeHead(404);
            res.end("Not Found");
          }
        });

        await new Promise<void>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (typeof addr === "object" && addr !== null) {
              serverPort = addr.port;
            }
            resolve();
          });
        });

        const origUrl = process.env.CREWMATE_WATCH_DOWNLOAD_URL;
        try {
          process.env.CREWMATE_WATCH_DOWNLOAD_URL = `http://127.0.0.1:${serverPort}/crewmate-watch.${archiveExt}`;

          const installed = await installWatchBinary({
            force: true,
            projectRoot: tempProjectDir,
          });

          assert.ok(
            installed,
            "Expected installWatchBinary to return installed path",
          );
          assert.ok(fs.existsSync(installed));
          const content = fs.readFileSync(installed, "utf-8");
          assert.strictEqual(content, dummyBinaryContent);
        } finally {
          if (origUrl !== undefined) {
            process.env.CREWMATE_WATCH_DOWNLOAD_URL = origUrl;
          } else {
            delete process.env.CREWMATE_WATCH_DOWNLOAD_URL;
          }
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
      }
    });

    it("aborts and returns null when checksum verification fails", async () => {
      const targetInfo = getTarget();
      if (!targetInfo) return;

      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-mismatch-"),
      );
      const tempProjectDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-proj-mm-"),
      );
      fs.writeFileSync(
        path.join(tempProjectDir, "package.json"),
        JSON.stringify({ name: "test-mismatch-proj", version: "0.1.0" }),
      );

      try {
        const dummyBinaryPath = path.join(tempDir, targetInfo.binaryName);
        fs.writeFileSync(dummyBinaryPath, "dummy-content", "utf-8");

        const archiveExt = targetInfo.archiveExt === "zip" ? "zip" : "tar.gz";
        const archivePath = path.join(tempDir, `archive.${archiveExt}`);
        execFileSync("tar", [
          "-acf",
          archivePath,
          "-C",
          tempDir,
          targetInfo.binaryName,
        ]);
        const archiveBuffer = fs.readFileSync(archivePath);

        let serverPort = 0;
        const server = http.createServer((req, res) => {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${serverPort}`);
          if (url.pathname === `/crewmate-watch.${archiveExt}`) {
            res.writeHead(200, { "Content-Type": "application/octet-stream" });
            res.end(archiveBuffer);
          } else if (url.pathname === `/crewmate-watch.${archiveExt}.sha256`) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(
              "0000000000000000000000000000000000000000000000000000000000000000  archive\n",
            );
          } else {
            res.writeHead(404);
            res.end("Not Found");
          }
        });

        await new Promise<void>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (typeof addr === "object" && addr !== null) {
              serverPort = addr.port;
            }
            resolve();
          });
        });

        const warnings: string[] = [];
        const origWarn = console.warn;
        console.warn = (...args: unknown[]) => {
          warnings.push(args.map(String).join(" "));
        };

        const origUrl = process.env.CREWMATE_WATCH_DOWNLOAD_URL;
        try {
          process.env.CREWMATE_WATCH_DOWNLOAD_URL = `http://127.0.0.1:${serverPort}/crewmate-watch.${archiveExt}`;

          const installed = await installWatchBinary({
            force: true,
            projectRoot: tempProjectDir,
            lazy: true,
          });

          assert.strictEqual(installed, null);
          assert.ok(
            warnings.some((w) => w.includes("Checksum mismatch")),
            `Expected checksum mismatch warning, got: ${JSON.stringify(warnings)}`,
          );

          // Verify binary was not written to bin/
          const finalBinPath = path.join(
            tempProjectDir,
            "bin",
            targetInfo.binaryName,
          );
          assert.strictEqual(fs.existsSync(finalBinPath), false);
        } finally {
          console.warn = origWarn;
          if (origUrl !== undefined) {
            process.env.CREWMATE_WATCH_DOWNLOAD_URL = origUrl;
          } else {
            delete process.env.CREWMATE_WATCH_DOWNLOAD_URL;
          }
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
      }
    });
  });

  describe("scripts/postinstall.js lifecycle execution", () => {
    it("postinstall script exits cleanly with code 0 when dist is not built", async () => {
      const postinstallScript = path.resolve("scripts", "postinstall.js");
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "crewmate-test-postinstall-empty-"),
      );
      try {
        fs.writeFileSync(
          path.join(tempDir, "package.json"),
          JSON.stringify({ name: "test-postinstall", type: "module" }),
        );
        const dummyScriptsDir = path.join(tempDir, "scripts");
        fs.mkdirSync(dummyScriptsDir, { recursive: true });
        const scriptCopy = path.join(dummyScriptsDir, "postinstall.js");
        fs.copyFileSync(postinstallScript, scriptCopy);

        const { stdout, stderr } = await execFileAsync(process.execPath, [
          scriptCopy,
        ]);
        assert.strictEqual(stderr, "");
        assert.strictEqual(stdout, "");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("postinstall script runs installWatchBinary when dist exists", async () => {
      const postinstallScript = path.resolve("scripts", "postinstall.js");
      const { stderr } = await execFileAsync(
        process.execPath,
        [postinstallScript],
        {
          env: {
            ...process.env,
            CREWMATE_SKIP_WATCH_INSTALL: "1",
          },
        },
      );
      assert.strictEqual(stderr, "");
    });
  });
});
