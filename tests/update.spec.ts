import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAdapter } from '../src/harness/registry.js';
import { readManifest } from '../src/harness/manifest.js';

const TEST_PREFIX = 'crewmate-harness-update-';

describe('OpenCodeAdapter install and update', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), TEST_PREFIX));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should install files and create manifest', async () => {
    const adapter = getAdapter('opencode')!;
    const result = await adapter.install(tmpDir);

    expect(result.harness).toBe('opencode');
    expect(result.filesWritten.length).toBeGreaterThan(0);

    const manifest = readManifest(tmpDir);
    expect(manifest).not.toBeNull();
    expect(manifest?.harness).toBe('opencode');
    expect(manifest?.version).toBe('0.2.1');
    expect(Object.keys(manifest!.files).length).toBe(result.filesWritten.length);
  });

  it('should report unchanged files on repeated update without modifications', async () => {
    const adapter = getAdapter('opencode')!;
    await adapter.install(tmpDir);

    const updateResult = await adapter.update(tmpDir);
    expect(updateResult.harness).toBe('opencode');
    expect(updateResult.summary.unchanged).toBe(updateResult.files.length);
    expect(updateResult.summary.updated).toBe(0);
    expect(updateResult.backedUpFiles.length).toBe(0);
  });

  it('should create backups and update when files are modified', async () => {
    const adapter = getAdapter('opencode')!;
    await adapter.install(tmpDir);

    // Modify frontman prompt
    const frontmanPath = join(tmpDir, '.opencode', 'agents', 'frontman.md');
    await writeFile(frontmanPath, '# Custom Frontman Modifications\n', 'utf-8');

    const updateResult = await adapter.update(tmpDir);
    expect(updateResult.summary.updated).toBe(1);
    expect(updateResult.summary.backedUp).toBe(1);
    expect(updateResult.backedUpFiles.length).toBe(1);

    const frontmanStatus = updateResult.files.find(
      (f) => f.path === '.opencode/agents/frontman.md'
    );
    expect(frontmanStatus?.action).toBe('backed_up_and_updated');
    expect(frontmanStatus?.backupPath).toBeDefined();

    // Verify backup exists on disk
    const backupFullPath = join(tmpDir, frontmanStatus!.backupPath!);
    expect(existsSync(backupFullPath)).toBe(true);
    const backupContent = await readFile(backupFullPath, 'utf-8');
    expect(backupContent).toBe('# Custom Frontman Modifications\n');

    // Verify file on disk was replaced with latest template
    const restoredContent = await readFile(frontmanPath, 'utf-8');
    expect(restoredContent).toContain('description:');
  });

  it('should support dry-run without writing changes or backups to disk', async () => {
    const adapter = getAdapter('opencode')!;
    await adapter.install(tmpDir);

    const scoutPath = join(tmpDir, '.opencode', 'agents', 'scout.md');
    await writeFile(scoutPath, '# Custom Scout Content\n', 'utf-8');

    const updateResult = await adapter.update(tmpDir, { dryRun: true });
    expect(updateResult.dryRun).toBe(true);
    expect(updateResult.summary.updated).toBe(1);

    // Verify disk content was NOT changed
    const currentScoutContent = await readFile(scoutPath, 'utf-8');
    expect(currentScoutContent).toBe('# Custom Scout Content\n');
  });

  it('should preserve custom dependencies in package.json during update', async () => {
    const adapter = getAdapter('opencode')!;
    await adapter.install(tmpDir);

    const pkgPath = join(tmpDir, '.opencode', 'package.json');
    const customPkg = {
      dependencies: {
        '@opencode-ai/plugin': '0.0.1',
        'custom-util-lib': '^2.0.0',
      },
    };
    await writeFile(pkgPath, JSON.stringify(customPkg, null, 2) + '\n', 'utf-8');

    const updateResult = await adapter.update(tmpDir);
    expect(updateResult.summary.updated).toBe(1);

    const updatedPkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    expect(updatedPkg.dependencies['custom-util-lib']).toBe('^2.0.0');
    expect(updatedPkg.dependencies['@opencode-ai/plugin']).toBe('^1.18.0');
  });
});
