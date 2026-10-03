import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distPath = path.join(
  packageRoot,
  "dist",
  "src",
  "cli",
  "install-watch.js",
);

if (fs.existsSync(distPath)) {
  try {
    const mod = await import(pathToFileURL(distPath).href);
    if (typeof mod.installWatchBinary === "function") {
      await mod.installWatchBinary({ lazy: false });
    }
  } catch (err) {
    console.warn(
      `[crewmate] Postinstall watch binary installation skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
