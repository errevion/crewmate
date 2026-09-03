import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  FileUpdateStatus,
  HarnessAdapter,
  InstallResult,
  ManifestFileEntry,
  UpdateOptions,
  UpdateResult,
} from '../../types.js';
import {
  computeHash,
  createBackup,
  CREWMATE_VERSION,
  readManifest,
  writeManifest,
} from '../../manifest.js';
import { CREWMATE_PLUGIN } from './templates/crewmate-plugin.js';
import { getModularWorkflowFiles } from '../../../graph/modular-templates.js';
import WORKFLOW_MD from './templates/workflow.md';
import FRONTMAN_MD from './templates/agents/frontman.md';
import SCOUT_MD from './templates/agents/scout.md';
import PLANNER_MD from './templates/agents/planner.md';
import EXECUTOR_MD from './templates/agents/executor.md';

const PLUGIN_DEP = '@opencode-ai/plugin';
const CROSS_SPAWN_DEP = 'cross-spawn';

// Read version from environment variable or package.json peerDependencies
const getPluginVersion = (): string => {
  // Priority 1: Environment variable
  const envVersion = process.env.CREWMATE_PLUGIN_VERSION;
  if (envVersion) {
    return envVersion;
  }

  // Priority 2: Default fallback version
  return '^1.18.0';
};

/**
 * Adapter for OpenCode AI coding assistant harness
 *
 * Installs and updates crewmate integration files including plugins, commands, and package configuration
 */
export class OpenCodeAdapter implements HarnessAdapter {
  name = 'opencode';
  description = 'OpenCode AI coding assistant';

  private getTemplateFiles(): Record<string, string> {
    return {
      '.opencode/plugins/crewmate.ts': CREWMATE_PLUGIN,
      '.opencode/commands/workflow.md': WORKFLOW_MD,
      '.opencode/agents/frontman.md': FRONTMAN_MD,
      '.opencode/agents/scout.md': SCOUT_MD,
      '.opencode/agents/planner.md': PLANNER_MD,
      '.opencode/agents/executor.md': EXECUTOR_MD,
      ...getModularWorkflowFiles(),
    };
  }

  private generatePackageJson(targetDir: string): string {
    const pkgPath = join(targetDir, '.opencode', 'package.json');
    let pkg: Record<string, unknown> = {};
    if (existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      } catch {
        pkg = {};
      }
    }
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    deps[PLUGIN_DEP] = getPluginVersion();
    deps[CROSS_SPAWN_DEP] = '^7.0.6';
    pkg.dependencies = deps;
    return JSON.stringify(pkg, null, 2) + '\n';
  }

  /**
   * Installs crewmate integration files into the target directory
   *
   * Creates plugin files, command templates, and updates package.json with dependencies
   *
   * @param targetDir - The target directory to install files into
   * @returns Promise resolving to installation result with harness name and written files
   */
  async install(targetDir: string): Promise<InstallResult> {
    const filesWritten: string[] = [];
    const manifestEntries: Record<string, ManifestFileEntry> = {};
    const now = new Date().toISOString();

    const templateFiles = this.getTemplateFiles();
    for (const [relPath, content] of Object.entries(templateFiles)) {
      const absPath = join(targetDir, relPath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, 'utf-8');
      filesWritten.push(relPath);
      manifestEntries[relPath] = {
        hash: computeHash(content),
        updatedAt: now,
      };
    }

    const pkgContent = this.generatePackageJson(targetDir);
    const pkgRelPath = '.opencode/package.json';
    const pkgAbsPath = join(targetDir, pkgRelPath);
    mkdirSync(dirname(pkgAbsPath), { recursive: true });
    writeFileSync(pkgAbsPath, pkgContent, 'utf-8');
    filesWritten.push(pkgRelPath);
    manifestEntries[pkgRelPath] = {
      hash: computeHash(pkgContent),
      updatedAt: now,
    };

    writeManifest(targetDir, this.name, manifestEntries, now);

    return { harness: this.name, filesWritten };
  }

  /**
   * Updates crewmate integration files in the target directory
   *
   * If existing files were modified by the user, creates backups in .crewmate/backups/
   * and updates them to the latest template versions.
   *
   * @param targetDir - The target directory to update
   * @param options - Update options (force, dryRun, backup)
   * @returns Promise resolving to UpdateResult
   */
  async update(targetDir: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    const existingManifest = readManifest(targetDir);
    const manifestEntries: Record<string, ManifestFileEntry> = {
      ...(existingManifest?.files ?? {}),
    };
    const now = new Date().toISOString();

    const templateFiles = this.getTemplateFiles();
    templateFiles['.opencode/package.json'] = this.generatePackageJson(targetDir);

    const fileStatuses: FileUpdateStatus[] = [];
    const backedUpFiles: string[] = [];

    for (const [relPath, newContent] of Object.entries(templateFiles)) {
      const absPath = join(targetDir, relPath);
      const fileExists = existsSync(absPath);
      const newHash = computeHash(newContent);

      if (!fileExists) {
        // File didn't exist before, create it
        if (!options.dryRun) {
          mkdirSync(dirname(absPath), { recursive: true });
          writeFileSync(absPath, newContent, 'utf-8');
          manifestEntries[relPath] = { hash: newHash, updatedAt: now };
        }
        fileStatuses.push({ path: relPath, action: 'created' });
        continue;
      }

      const currentContent = readFileSync(absPath, 'utf-8');
      const currentHash = computeHash(currentContent);

      if (currentHash === newHash) {
        // File content is identical to latest template
        fileStatuses.push({ path: relPath, action: 'unchanged' });
        manifestEntries[relPath] = { hash: newHash, updatedAt: now };
        continue;
      }

      // Content differs from new template.
      // Check if file was modified by user since last recorded installation/update.
      const previousRecordedHash = existingManifest?.files?.[relPath]?.hash;
      const isUserModified = previousRecordedHash && previousRecordedHash !== currentHash;

      let backupPath: string | undefined;
      const shouldBackup = options.backup !== false && (isUserModified || !previousRecordedHash);

      if (shouldBackup) {
        if (!options.dryRun) {
          backupPath = createBackup(targetDir, relPath);
          if (backupPath) {
            backedUpFiles.push(backupPath);
          }
        } else {
          backupPath = `.crewmate/backups/<timestamp>/${relPath}`;
          backedUpFiles.push(backupPath);
        }
      }

      if (!options.dryRun) {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, newContent, 'utf-8');
        manifestEntries[relPath] = { hash: newHash, updatedAt: now };
      }

      fileStatuses.push({
        path: relPath,
        action: backupPath ? 'backed_up_and_updated' : 'updated',
        ...(backupPath && { backupPath }),
      });
    }

    if (!options.dryRun) {
      writeManifest(targetDir, this.name, manifestEntries, existingManifest?.installedAt ?? now);
    }

    const summary = {
      total: fileStatuses.length,
      created: fileStatuses.filter((f) => f.action === 'created').length,
      updated: fileStatuses.filter(
        (f) => f.action === 'updated' || f.action === 'backed_up_and_updated'
      ).length,
      unchanged: fileStatuses.filter((f) => f.action === 'unchanged').length,
      backedUp: backedUpFiles.length,
    };

    return {
      harness: this.name,
      version: CREWMATE_VERSION,
      files: fileStatuses,
      backedUpFiles,
      summary,
      ...(options.dryRun && { dryRun: true }),
    };
  }
}
