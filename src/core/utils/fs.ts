import fs from "node:fs/promises";
import path from "node:path";

export function isSourceFile(file: string): boolean {
  return (
    (file.endsWith(".ts") ||
      file.endsWith(".js") ||
      file.endsWith(".tsx") ||
      file.endsWith(".jsx")) &&
    !file.endsWith(".d.ts")
  );
}

export async function getFilesRecursively(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getFilesRecursively(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

export async function resolveContractPath(
  projectRoot: string,
  ...segments: string[]
): Promise<string> {
  const crewmateDir = path.join(projectRoot, ".crewmate", "contracts");
  try {
    await fs.access(crewmateDir);
    return path.join(crewmateDir, ...segments);
  } catch {
    return path.join(projectRoot, "contracts", ...segments);
  }
}
