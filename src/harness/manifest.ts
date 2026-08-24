import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CrewmateManifest, ManifestFileEntry } from './types.js';

export const CREWMATE_VERSION = '0.2.2';

/**
 * Computes sha256 checksum of a string content
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Gets path to the manifest file inside .crewmate/
 */
export function getManifestPath(targetDir: string): string {
  return join(targetDir, '.crewmate', 'manifest.json');
}

/**
 * Reads manifest from .crewmate/manifest.json if it exists
 */
export function readManifest(targetDir: string): CrewmateManifest | null {
  const manifestPath = getManifestPath(targetDir);
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as CrewmateManifest;
  } catch {
    return null;
  }
}

/**
 * Writes or updates the manifest file in .crewmate/manifest.json
 */
export function writeManifest(
  targetDir: string,
  harness: string,
  files: Record<string, ManifestFileEntry>,
  installedAt?: string
): CrewmateManifest {
  const manifestDir = join(targetDir, '.crewmate');
  mkdirSync(manifestDir, { recursive: true });

  const now = new Date().toISOString();
  const manifest: CrewmateManifest = {
    version: CREWMATE_VERSION,
    harness,
    installedAt: installedAt ?? now,
    updatedAt: now,
    files,
  };

  writeFileSync(getManifestPath(targetDir), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

/**
 * Creates a backup of a file in .crewmate/backups/<timestamp>/<relativePath>
 * @returns The relative backup path from targetDir
 */
export function createBackup(targetDir: string, relativeFilePath: string): string {
  const sourcePath = join(targetDir, relativeFilePath);
  if (!existsSync(sourcePath)) {
    return '';
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRelPath = join('.crewmate', 'backups', timestamp, relativeFilePath);
  const backupAbsPath = join(targetDir, backupRelPath);

  mkdirSync(dirname(backupAbsPath), { recursive: true });
  const content = readFileSync(sourcePath, 'utf-8');
  writeFileSync(backupAbsPath, content, 'utf-8');

  // Normalize path separators to forward slashes for cross-platform consistency
  return backupRelPath.replace(/\\/g, '/');
}
