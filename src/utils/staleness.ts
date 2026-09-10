import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import spawn from 'cross-spawn';
import type { ExecutionArtifact } from '../models/artifact.js';
import { locationToFile } from './artifact-validation.js';

/**
 * Result of evaluating artifact staleness against git history and filesystem.
 */
export interface StalenessResult {
  isStale: boolean;
  reason?: 'file_deleted' | 'code_drift';
  commitCount?: number;
  filePath?: string;
}

/**
 * Evaluates whether an artifact referencing a file is stale due to code drift
 * or because the file was deleted.
 */
export function checkArtifactStaleness(
  artifact: Pick<ExecutionArtifact, 'location' | 'createdAt'>,
  cwd: string = process.cwd()
): StalenessResult {
  if (!artifact.location) {
    return { isStale: false };
  }

  const relPath = locationToFile(artifact.location);
  if (!relPath) {
    return { isStale: false };
  }

  const fullPath = resolve(cwd, relPath);
  if (!existsSync(fullPath)) {
    return { isStale: true, reason: 'file_deleted', filePath: relPath };
  }

  try {
    const result = spawn.sync(
      'git',
      ['log', `--since=${artifact.createdAt}`, '--oneline', '--', relPath],
      {
        cwd,
        encoding: 'utf-8',
        windowsHide: true,
      }
    );

    if (result.status === 0 && result.stdout) {
      const commitCount = result.stdout
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0).length;

      if (commitCount >= 3) {
        return { isStale: true, reason: 'code_drift', commitCount, filePath: relPath };
      }
      return { isStale: false, commitCount, filePath: relPath };
    }
  } catch {
    // If git is not installed or not in a repo, fallback safely
  }

  return { isStale: false, filePath: relPath };
}
