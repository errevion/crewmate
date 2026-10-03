import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testsDir = path.resolve("dist/tests");
if (!fs.existsSync(testsDir)) {
  console.error("dist/tests directory not found. Did you forget to run 'npm run build'?");
  process.exit(1);
}

const testFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => path.join("dist", "tests", f));

if (testFiles.length === 0) {
  console.error("No test files found in dist/tests");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
