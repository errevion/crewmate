import * as fs from "node:fs/promises";
import * as path from "node:path";
import ts from "typescript";
import * as yaml from "yaml";
import { ArchitectureSchema, IndexManifestSchema } from "../schemas/contracts.js";
import { getFilesRecursively, isSourceFile, resolveContractPath } from "../utils/fs.js";

export interface ArchViolation {
  file: string;
  line: number;
  column: number;
  sourceModule: string;
  targetModule: string;
  importSpecifier: string;
  allowed: string[];
  message: string;
}

export interface ArchScanResult {
  valid: boolean;
  violations: ArchViolation[];
  scannedFiles: number;
}

/**
 * Scan codebase imports using TypeScript Compiler API and verify against contracts/architecture.yaml
 */
export async function scanArchitecture(projectRoot: string = process.cwd()): Promise<ArchScanResult> {
  const archFile = await resolveContractPath(projectRoot, "architecture.yaml");
  const indexFile = await resolveContractPath(projectRoot, "index.yaml");

  let arch;
  let index;
  try {
    const archContent = await fs.readFile(archFile, "utf-8");
    arch = ArchitectureSchema.parse(yaml.parse(archContent));
    const indexContent = await fs.readFile(indexFile, "utf-8");
    index = IndexManifestSchema.parse(yaml.parse(indexContent));
  } catch (err) {
    throw new Error(`Failed to load architecture contracts: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Map module paths: e.g. "src/auth" -> "auth"
  const moduleByPath: Record<string, string> = {};
  for (const mod of index.modules) {
    const norm = path.normalize(mod.path).replace(/^[\\/]+|[\\/]+$/g, "").replace(/\\/g, "/");
    moduleByPath[norm] = mod.name;
  }

  const violations: ArchViolation[] = [];
  let scannedFiles = 0;

  // Search all files in src
  const srcDir = path.join(projectRoot, "src");
  const files = await getFilesRecursively(srcDir);

  for (const file of files) {
    if (!isSourceFile(file)) {
      continue;
    }
    scannedFiles++;

    const relPath = path.relative(projectRoot, file).replace(/\\/g, "/");
    const sourceModule = determineModule(relPath, moduleByPath);
    if (!sourceModule) {
      continue;
    }

    const content = await fs.readFile(file, "utf-8");
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

    const checkSpecifier = (specifier: string, node: ts.Node) => {
      let resolvedTargetModule: string | undefined = undefined;

      // Handle relative imports
      if (specifier.startsWith(".")) {
        const targetAbs = path.resolve(path.dirname(file), specifier);
        const targetRel = path.relative(projectRoot, targetAbs).replace(/\\/g, "/");
        resolvedTargetModule = determineModule(targetRel, moduleByPath);
      } else {
        // Direct module alias / bare specifier matching module name
        for (const [modPath, modName] of Object.entries(moduleByPath)) {
          if (specifier === modName || specifier.startsWith(modName + "/") || specifier.startsWith(modPath + "/")) {
            resolvedTargetModule = modName;
            break;
          }
        }
      }

      if (resolvedTargetModule && resolvedTargetModule !== sourceModule) {
        const allowed = arch.modules[sourceModule]?.allowed_dependencies || [];
        if (!allowed.includes(resolvedTargetModule)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relPath,
            line: line + 1,
            column: character + 1,
            sourceModule,
            targetModule: resolvedTargetModule,
            importSpecifier: specifier,
            allowed,
            message: `Module '${sourceModule}' violates architecture rules by importing from '${resolvedTargetModule}'. Allowed dependencies: [${allowed.join(
              ", "
            )}]`,
          });
        }
      }
    };

    const visit = (node: ts.Node) => {
      // 1. ES Import Declaration: import ... from 'specifier'
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          checkSpecifier(node.moduleSpecifier.text, node);
        }
      }
      // 2. Export Declaration with module specifier: export ... from 'specifier'
      else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          checkSpecifier(node.moduleSpecifier.text, node);
        }
      }
      // 3. Dynamic import() or require()
      else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            checkSpecifier(firstArg.text, node);
          }
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            checkSpecifier(firstArg.text, node);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return {
    valid: violations.length === 0,
    violations,
    scannedFiles,
  };
}

function determineModule(relPath: string, moduleByPath: Record<string, string>): string | undefined {
  const normalized = path.normalize(relPath).replace(/\\/g, "/");
  for (const [modPath, modName] of Object.entries(moduleByPath)) {
    if (normalized === modPath || normalized.startsWith(modPath + "/")) {
      return modName;
    }
  }
  return undefined;
}
