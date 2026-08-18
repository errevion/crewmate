import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessAdapter, InstallResult } from '../../types.js';
import { CREWMATE_PLUGIN } from './templates/crewmate-plugin.js';
import BRIEF_MD from './templates/brief.md';
import EXECUTE_MD from './templates/execute.md';
import FRONTMAN_MD from './templates/agents/Frontman.md';
import SCOUT_MD from './templates/agents/Scout.md';
import PLANNER_MD from './templates/agents/Planner.md';
import EXECUTOR_MD from './templates/agents/Executor.md';

const PLUGIN_DEP = '@opencode-ai/plugin';

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
 * Installs crewmate integration files including plugins, commands, and package configuration
 */
export class OpenCodeAdapter implements HarnessAdapter {
  name = 'opencode';
  description = 'OpenCode AI coding assistant';

  /**
   * Installs crewmate integration files into the target directory
   *
   * Creates plugin files, command templates, and updates package.json with dependencies
   *
   * @param targetDir - The target directory to install files into
   * @returns Promise resolving to installation result with harness name and written files
   */
  async install(targetDir: string): Promise<InstallResult> {
    const baseDir = join(targetDir, '.opencode');
    const pluginsDir = join(baseDir, 'plugins');
    const commandsDir = join(baseDir, 'commands');
    const agentsDir = join(baseDir, 'agents');
    const filesWritten: string[] = [];

    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });

    const pluginPath = join(pluginsDir, 'crewmate.ts');
    writeFileSync(pluginPath, CREWMATE_PLUGIN, 'utf-8');
    filesWritten.push('.opencode/plugins/crewmate.ts');

    const commandPath = join(commandsDir, 'brief.md');
    writeFileSync(commandPath, BRIEF_MD, 'utf-8');
    filesWritten.push('.opencode/commands/brief.md');

    const executeCommandPath = join(commandsDir, 'execute.md');
    writeFileSync(executeCommandPath, EXECUTE_MD, 'utf-8');
    filesWritten.push('.opencode/commands/execute.md');

    const frontmanPath = join(agentsDir, 'frontman.md');
    writeFileSync(frontmanPath, FRONTMAN_MD, 'utf-8');
    filesWritten.push('.opencode/agents/frontman.md');

    const scoutPath = join(agentsDir, 'scout.md');
    writeFileSync(scoutPath, SCOUT_MD, 'utf-8');
    filesWritten.push('.opencode/agents/scout.md');

    const plannerPath = join(agentsDir, 'planner.md');
    writeFileSync(plannerPath, PLANNER_MD, 'utf-8');
    filesWritten.push('.opencode/agents/planner.md');

    const executorPath = join(agentsDir, 'executor.md');
    writeFileSync(executorPath, EXECUTOR_MD, 'utf-8');
    filesWritten.push('.opencode/agents/executor.md');

    const pkgPath = join(baseDir, 'package.json');
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
    pkg.dependencies = deps;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    filesWritten.push('.opencode/package.json');

    return { harness: this.name, filesWritten };
  }
}
