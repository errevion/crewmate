import * as fs from "node:fs/promises";
import * as path from "node:path";
import ts from "typescript";
import * as yaml from "yaml";
import {
  CapabilitiesSchema,
  IndexManifestSchema,
  ModuleContractSchema,
} from "../schemas/contracts.js";
import { type ActivityProvenance } from "../schemas/activity.js";
import { ActivityManager } from "../activity/activity-manager.js";
import {
  getFilesRecursively,
  isSourceFile,
  resolveContractPath,
} from "../utils/fs.js";

export interface SafeDeleteCandidate {
  file: string;
  symbol: string;
  line: number;
  column: number;
  confidence: "high";
  reason: string;
  provenance?: ActivityProvenance;
}

export interface FlaggedForReview {
  file: string;
  symbol: string;
  line: number;
  column: number;
  contract: string;
  reason: string;
  provenance?: ActivityProvenance;
}

export interface DeadCodeScanResult {
  valid: boolean;
  safeDeleteCandidates: SafeDeleteCandidate[];
  flaggedForReview: FlaggedForReview[];
  summary: {
    scannedFiles: number;
    totalExportsChecked: number;
    safeDeleteCount: number;
    flaggedCount: number;
  };
}

interface ExportItem {
  file: string;
  relFile: string;
  symbol: string;
  line: number;
  column: number;
}

/**
 * Scan codebase for unreferenced code and cross-reference with module contracts.
 */
export async function scanDeadCode(
  projectRoot: string = process.cwd(),
): Promise<DeadCodeScanResult> {
  const contractsDir = await resolveContractPath(projectRoot, "modules");
  const indexFile = await resolveContractPath(projectRoot, "index.yaml");
  const capabilitiesFile = await resolveContractPath(
    projectRoot,
    "capabilities.yaml",
  );

  // Public surface set: maps "file:symbol" or "symbol" or "file" to source contract/feature
  const declaredPublicMap = new Map<
    string,
    { source: string; type: "contract" | "surface" | "capability" }
  >();

  // 1. Load module contracts
  try {
    const files = await fs.readdir(contractsDir);
    for (const file of files) {
      if (file.endsWith(".contract.yaml")) {
        const content = await fs.readFile(
          path.join(contractsDir, file),
          "utf-8",
        );
        const contract = ModuleContractSchema.parse(yaml.parse(content));
        for (const api of contract.public_api) {
          const normFile = path.normalize(api.file).replace(/\\/g, "/");
          declaredPublicMap.set(`${normFile}:${api.export}`, {
            source: contract.module,
            type: "contract",
          });
          declaredPublicMap.set(api.export, {
            source: contract.module,
            type: "contract",
          });
        }
      }
    }
  } catch {
    // optional
  }

  // 2. Load index.yaml public_surface
  try {
    const content = await fs.readFile(indexFile, "utf-8");
    const index = IndexManifestSchema.parse(yaml.parse(content));
    for (const mod of index.modules) {
      for (const surfaceFile of mod.public_surface) {
        const normFile = path.normalize(surfaceFile).replace(/\\/g, "/");
        declaredPublicMap.set(normFile, { source: mod.name, type: "surface" });
      }
    }
  } catch {
    // optional
  }

  // 3. Load capabilities.yaml entrypoints
  try {
    const content = await fs.readFile(capabilitiesFile, "utf-8");
    const caps = CapabilitiesSchema.parse(yaml.parse(content));
    for (const cap of caps.capabilities) {
      if (cap.entrypoint) {
        const [epFile, epSymbol] = cap.entrypoint.split(":");
        const normFile = path.normalize(epFile).replace(/\\/g, "/");
        if (epSymbol) {
          declaredPublicMap.set(`${normFile}:${epSymbol}`, {
            source: cap.name,
            type: "capability",
          });
          declaredPublicMap.set(epSymbol, {
            source: cap.name,
            type: "capability",
          });
        } else {
          declaredPublicMap.set(normFile, {
            source: cap.name,
            type: "capability",
          });
        }
      }
    }
  } catch {
    // optional
  }

  // 4. Discover all source files in src/
  const srcDir = path.join(projectRoot, "src");
  const allFiles = await getFilesRecursively(srcDir);
  const codeFiles = allFiles.filter(isSourceFile);

  const parsedSourceFiles = new Map<
    string,
    { sourceFile: ts.SourceFile; relPath: string }
  >();

  for (const absFile of codeFiles) {
    const content = await fs.readFile(absFile, "utf-8");
    const relPath = path.relative(projectRoot, absFile).replace(/\\/g, "/");
    const sf = ts.createSourceFile(
      absFile,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    parsedSourceFiles.set(absFile, { sourceFile: sf, relPath });
  }

  // 5. Extract all declared exports using AST
  const exportsFound: ExportItem[] = [];

  for (const [
    absFile,
    { sourceFile, relPath },
  ] of parsedSourceFiles.entries()) {
    const extractExports = (node: ts.Node) => {
      const modifiers = ts.canHaveModifiers(node)
        ? ts.getModifiers(node)
        : undefined;
      const isExported =
        modifiers &&
        modifiers.some(
          (m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword,
        );

      if (isExported) {
        // Function declaration
        if (ts.isFunctionDeclaration(node) && node.name) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.name.getStart(),
          );
          exportsFound.push({
            file: absFile,
            relFile: relPath,
            symbol: node.name.text,
            line: line + 1,
            column: character + 1,
          });
        }
        // Class declaration
        else if (ts.isClassDeclaration(node) && node.name) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.name.getStart(),
          );
          exportsFound.push({
            file: absFile,
            relFile: relPath,
            symbol: node.name.text,
            line: line + 1,
            column: character + 1,
          });
        }
        // Variable statement: export const X = ...
        else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const { line, character } =
                sourceFile.getLineAndCharacterOfPosition(decl.name.getStart());
              exportsFound.push({
                file: absFile,
                relFile: relPath,
                symbol: decl.name.text,
                line: line + 1,
                column: character + 1,
              });
            }
          }
        }
        // Type alias or Interface
        else if (
          (ts.isTypeAliasDeclaration(node) ||
            ts.isInterfaceDeclaration(node)) &&
          node.name
        ) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.name.getStart(),
          );
          exportsFound.push({
            file: absFile,
            relFile: relPath,
            symbol: node.name.text,
            line: line + 1,
            column: character + 1,
          });
        }
        // Enum
        else if (ts.isEnumDeclaration(node) && node.name) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.name.getStart(),
          );
          exportsFound.push({
            file: absFile,
            relFile: relPath,
            symbol: node.name.text,
            line: line + 1,
            column: character + 1,
          });
        }
      }

      // export { A, B as C }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            element.name.getStart(),
          );
          exportsFound.push({
            file: absFile,
            relFile: relPath,
            symbol: element.name.text,
            line: line + 1,
            column: character + 1,
          });
        }
      }

      ts.forEachChild(node, extractExports);
    };

    extractExports(sourceFile);
  }

  // 6. Count references across all source files
  const safeDeleteCandidates: SafeDeleteCandidate[] = [];
  const flaggedForReview: FlaggedForReview[] = [];

  for (const exp of exportsFound) {
    let externalReferences = 0;
    let internalReferences = 0;

    for (const [absFile, { sourceFile }] of parsedSourceFiles.entries()) {
      const isDeclaringFile = absFile === exp.file;

      const countReferences = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === exp.symbol) {
          // If in the declaring file, ignore the declaration node itself
          if (isDeclaringFile) {
            const { line, character } =
              sourceFile.getLineAndCharacterOfPosition(node.getStart());
            if (line + 1 === exp.line && character + 1 === exp.column) {
              // This is the declaration itself
              return;
            }
            internalReferences++;
          } else {
            externalReferences++;
          }
        }
        ts.forEachChild(node, countReferences);
      };

      countReferences(sourceFile);
    }

    const totalReferences = externalReferences + internalReferences;

    if (totalReferences === 0) {
      // Check if declared in contracts, index, or capabilities
      const contractMatch =
        declaredPublicMap.get(`${exp.relFile}:${exp.symbol}`) ||
        declaredPublicMap.get(exp.symbol) ||
        declaredPublicMap.get(exp.relFile);

      if (contractMatch) {
        flaggedForReview.push({
          file: exp.relFile,
          symbol: exp.symbol,
          line: exp.line,
          column: exp.column,
          contract: contractMatch.source,
          reason: `Unreferenced in local codebase, but declared public in ${contractMatch.type} '${contractMatch.source}'. External consumers may exist.`,
        });
      } else {
        safeDeleteCandidates.push({
          file: exp.relFile,
          symbol: exp.symbol,
          line: exp.line,
          column: exp.column,
          confidence: "high",
          reason:
            "Unreferenced across codebase and not declared in any contract or capability.",
        });
      }
    }
  }

  // 5. Look up activity provenance if activity log exists
  const activityManager = new ActivityManager(projectRoot);
  try {
    if (await activityManager.exists()) {
      for (const c of safeDeleteCandidates) {
        const prov = await activityManager.findProvenance(c.file);
        if (prov) {
          c.provenance = prov;
        }
      }
      for (const f of flaggedForReview) {
        const prov = await activityManager.findProvenance(f.file);
        if (prov) {
          f.provenance = prov;
        }
      }
    }
  } catch {
    // Fall back gracefully if activity log cannot be read
  }

  return {
    valid: safeDeleteCandidates.length === 0,
    safeDeleteCandidates,
    flaggedForReview,
    summary: {
      scannedFiles: codeFiles.length,
      totalExportsChecked: exportsFound.length,
      safeDeleteCount: safeDeleteCandidates.length,
      flaggedCount: flaggedForReview.length,
    },
  };
}
