import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TargetInfo {
  target: string;
  archiveExt: "zip" | "tar.gz";
  binaryName: string;
}

export interface InstallWatchOptions {
  force?: boolean;
  lazy?: boolean;
  projectRoot?: string;
  version?: string;
}

/**
 * Maps platform and architecture to crewmate-watch release target.
 */
export function getTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): TargetInfo | null {
  if (platform === "win32" && arch === "x64") {
    return {
      target: "x86_64-pc-windows-msvc",
      archiveExt: "zip",
      binaryName: "crewmate-watch.exe",
    };
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return {
        target: "aarch64-apple-darwin",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      };
    }
    if (arch === "x64") {
      return {
        target: "x86_64-apple-darwin",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      };
    }
  }

  if (platform === "linux") {
    if (arch === "arm64") {
      return {
        target: "aarch64-unknown-linux-gnu",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      };
    }
    if (arch === "x64") {
      return {
        target: "x86_64-unknown-linux-gnu",
        archiveExt: "tar.gz",
        binaryName: "crewmate-watch",
      };
    }
  }

  return null;
}

/**
 * Finds the package root directory containing package.json.
 */
export function findPackageRoot(fromDir?: string): string {
  let current = fromDir ?? path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

/**
 * Reads the package version from package.json in the package root.
 */
export function getPackageVersion(pkgRoot: string): string {
  try {
    const pkgPath = path.join(pkgRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (typeof data.version === "string") {
        return data.version;
      }
    }
  } catch {
    // fallback to default version
  }
  return "0.2.0";
}

/**
 * Resolves the GitHub Releases download URL for a given version and target.
 */
export function getDownloadUrl(
  version: string,
  target: string,
  archiveExt: string,
): string {
  const cleanVersion = version.startsWith("v") ? version.slice(1) : version;
  const tag = `v${cleanVersion}`;
  const archiveName = `crewmate-watch-${tag}-${target}.${archiveExt}`;
  const baseUrl =
    process.env.CREWMATE_WATCH_DOWNLOAD_BASE_URL ||
    "https://github.com/errevion/crewmate/releases/download";
  return `${baseUrl}/${tag}/${archiveName}`;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "crewmate-install-watch",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function verifyChecksumIfAvailable(
  archiveBuffer: Buffer,
  downloadUrl: string,
): Promise<void> {
  try {
    const checksumRes = await fetch(`${downloadUrl}.sha256`, {
      headers: { "User-Agent": "crewmate-install-watch" },
    });
    if (!checksumRes.ok) {
      return;
    }
    const text = await checksumRes.text();
    const expectedHash = text.trim().split(/\s+/)[0]?.toLowerCase();
    if (!expectedHash) return;

    const actualHash = createHash("sha256")
      .update(archiveBuffer)
      .digest("hex")
      .toLowerCase();
    if (actualHash !== expectedHash) {
      throw new Error(
        `Checksum mismatch for ${downloadUrl}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Checksum mismatch")) {
      throw err;
    }
  }
}

async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });

  return new Promise<void>((resolve, reject) => {
    execFile("tar", ["-xf", archivePath, "-C", destDir], (tarErr) => {
      if (!tarErr) {
        resolve();
        return;
      }

      if (process.platform === "win32" && archivePath.endsWith(".zip")) {
        const psCommand = `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
        execFile(
          "powershell",
          ["-NoProfile", "-NonInteractive", "-Command", psCommand],
          (psErr) => {
            if (psErr) {
              reject(
                new Error(
                  `Extraction failed: tar: ${tarErr.message}; PowerShell: ${psErr.message}`,
                ),
              );
            } else {
              resolve();
            }
          },
        );
      } else {
        reject(tarErr);
      }
    });
  });
}

function findBinaryInDir(dir: string, binaryName: string): string | null {
  const directPath = path.join(dir, binaryName);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subPath = path.join(dir, entry.name, binaryName);
      if (fs.existsSync(subPath)) {
        return subPath;
      }
      const recursive = findBinaryInDir(path.join(dir, entry.name), binaryName);
      if (recursive) return recursive;
    }
  }

  return null;
}

/**
 * Downloads and installs pre-built crewmate-watch binary from GitHub Releases
 * for the host platform and architecture.
 */
export async function installWatchBinary(
  options?: InstallWatchOptions,
): Promise<string | null> {
  const isLazy = options?.lazy ?? false;
  const isForce = options?.force ?? false;

  if (process.env.CREWMATE_SKIP_WATCH_INSTALL === "1") {
    return null;
  }

  const pkgRoot = findPackageRoot(options?.projectRoot);
  const targetInfo = getTarget();

  if (!targetInfo) {
    const msg = `Unsupported platform '${process.platform}' or architecture '${process.arch}' for pre-built watch binary.`;
    if (isLazy) {
      console.warn(`[crewmate] ${msg}`);
    } else {
      console.warn(`[crewmate] Warning: ${msg}`);
    }
    return null;
  }

  const finalBinDir = path.join(pkgRoot, "bin");
  const finalBinPath = path.join(finalBinDir, targetInfo.binaryName);

  if (!isForce && fs.existsSync(finalBinPath)) {
    return finalBinPath;
  }

  const version = options?.version ?? getPackageVersion(pkgRoot);
  const downloadUrl =
    process.env.CREWMATE_WATCH_DOWNLOAD_URL ||
    getDownloadUrl(version, targetInfo.target, targetInfo.archiveExt);

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "crewmate-watch-install-"),
  );

  try {
    const archiveBuffer = await downloadBuffer(downloadUrl);
    await verifyChecksumIfAvailable(archiveBuffer, downloadUrl);

    const archivePath = path.join(
      tmpDir,
      `archive.${targetInfo.archiveExt === "zip" ? "zip" : "tar.gz"}`,
    );
    fs.writeFileSync(archivePath, archiveBuffer);

    const extractedDir = path.join(tmpDir, "extracted");
    await extractArchive(archivePath, extractedDir);

    const extractedBinary = findBinaryInDir(
      extractedDir,
      targetInfo.binaryName,
    );
    if (!extractedBinary) {
      throw new Error(
        `Binary '${targetInfo.binaryName}' not found in downloaded archive.`,
      );
    }

    fs.mkdirSync(finalBinDir, { recursive: true });
    fs.copyFileSync(extractedBinary, finalBinPath);

    try {
      fs.chmodSync(finalBinPath, 0o755);
    } catch {
      // chmod is a no-op / best-effort on Windows
    }

    return finalBinPath;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (isLazy) {
      console.warn(
        `[crewmate] Failed to download pre-built watch binary: ${errorMsg}`,
      );
    } else {
      console.warn(
        `[crewmate] Warning: Failed to download pre-built watch binary (${errorMsg}). crewmate-watch will be compiled from source or downloaded on-demand.`,
      );
    }
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore temporary directory cleanup error
    }
  }
}

// Support direct CLI invocation for postinstall lifecycle scripts
const isMainScript = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invokedFile = path.resolve(process.argv[1]);
    return thisFile === invokedFile;
  } catch {
    return false;
  }
};

if (isMainScript()) {
  installWatchBinary({ lazy: false })
    .then((binPath) => {
      if (binPath) {
        console.log(
          `[crewmate] Successfully installed crewmate-watch to ${binPath}`,
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      console.warn(
        `[crewmate] Postinstall watch binary installation skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(0);
    });
}
