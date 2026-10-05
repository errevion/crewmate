import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the root templates directory.
 * Works whether running directly from TypeScript source, compiled dist, or packaged npm installation.
 */
export function getTemplatesDir(): string {
  if (process.env.CREWMATE_TEMPLATES_DIR) {
    const custom = path.resolve(process.env.CREWMATE_TEMPLATES_DIR);
    if (fs.existsSync(custom)) {
      return custom;
    }
  }

  // Candidate 1: relative to current module (dist/src/core/engine -> dist/templates, or src/core/engine -> templates)
  const candidate1 = fileURLToPath(
    new URL("../../../templates", import.meta.url),
  );
  if (fs.existsSync(candidate1)) {
    return candidate1;
  }

  // Candidate 2: one level higher (e.g. dist/src/core/engine -> ../../../../templates which is repo root)
  const candidate2 = fileURLToPath(
    new URL("../../../../templates", import.meta.url),
  );
  if (fs.existsSync(candidate2)) {
    return candidate2;
  }

  return candidate1;
}

/**
 * Resolves the full path to a specific template file.
 */
export function resolveTemplatePath(relativePath: string): string {
  const templatesDir = getTemplatesDir();
  return path.join(templatesDir, relativePath);
}

/**
 * Reads a template file synchronously.
 */
export function readTemplateSync(relativePath: string): string {
  const filePath = resolveTemplatePath(relativePath);
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Reads a template file asynchronously.
 */
export async function readTemplate(relativePath: string): Promise<string> {
  const filePath = resolveTemplatePath(relativePath);
  return await fs.promises.readFile(filePath, "utf-8");
}
