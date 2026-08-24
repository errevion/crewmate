import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { getAdapter, listAdapterNames } from '../harness/registry.js';
import type { UpdateResult } from '../harness/types.js';

interface ErrorOutput {
  ok: false;
  error: string;
  available?: string[];
}

type UpdateCommandOutput = ({ ok: true } & UpdateResult) | ErrorOutput;

function out(data: UpdateCommandOutput, jsonOnly: boolean = false): void {
  if (!jsonOnly) {
    process.stdout.write(formatOutput(data) + '\n');
  } else {
    process.stdout.write(JSON.stringify(data) + '\n');
  }
}

function formatOutput(data: UpdateCommandOutput): string {
  if (data.ok === false) {
    const lines = [`Error: ${data.error}`];
    if (data.available && Array.isArray(data.available)) {
      lines.push('');
      lines.push(`Available harnesses: ${data.available.join(', ')}`);
    }
    lines.push('');
    lines.push(JSON.stringify(data));
    return lines.join('\n');
  }

  const successData = data as Extract<UpdateCommandOutput, { ok: true }>;
  const lines = [
    `Updated crewmate integration for ${successData.harness} (v${successData.version})${successData.dryRun ? ' [DRY RUN]' : ''}`,
    '',
    'Files:',
  ];

  for (const file of successData.files) {
    let actionLabel = `[${file.action.toUpperCase()}]`;
    if (file.action === 'backed_up_and_updated') {
      actionLabel = '[BACKUP & UPDATE]';
    }
    lines.push(`  ${actionLabel.padEnd(19)} ${file.path}`);
  }

  if (successData.backedUpFiles && successData.backedUpFiles.length > 0) {
    lines.push('');
    lines.push('Backups created:');
    for (const backup of successData.backedUpFiles) {
      lines.push(`  - ${backup}`);
    }
  }

  lines.push('');
  lines.push(
    `Summary: ${successData.summary.updated} updated, ${successData.summary.created} created, ${successData.summary.unchanged} unchanged, ${successData.summary.backedUp} backed up`
  );
  lines.push('');
  lines.push(JSON.stringify(data));

  return lines.join('\n');
}

function fail(
  error: string,
  extra?: Omit<ErrorOutput, 'ok' | 'error'>,
  jsonOnly: boolean = false
): never {
  out({ ok: false, error, ...extra }, jsonOnly);
  process.exit(1);
}

/**
 * Registers the update command with the Commander program
 *
 * @param program The Commander program instance to register commands on
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update crewmate integration files, prompts, plugins, and dependencies')
    .option('-H, --harness <name>', `Target harness (${listAdapterNames().join(', ')})`, 'opencode')
    .option('-d, --dir <path>', 'Target directory (defaults to current directory)')
    .option('--dry-run', 'Display planned updates without writing changes', false)
    .option('--no-backup', 'Do not create backup files before updating modified templates')
    .option('--json', 'Output raw JSON only (no human-readable messages)', false)
    .action(async (opts) => {
      const adapter = getAdapter(opts.harness);
      if (!adapter) {
        fail(
          `Unknown harness "${opts.harness}"`,
          {
            available: listAdapterNames(),
          },
          opts.json
        );
      }

      const targetDir = opts.dir ?? process.cwd();

      const opencodeDir = join(targetDir, '.opencode');
      const crewmateDir = join(targetDir, '.crewmate');
      if (!existsSync(opencodeDir) && !existsSync(crewmateDir)) {
        fail(
          `Project is not initialized with crewmate. Run 'crewmate init' first.`,
          undefined,
          opts.json
        );
      }

      try {
        const result = await adapter.update(targetDir, {
          dryRun: opts.dryRun,
          backup: opts.backup,
        });

        out(
          {
            ok: true,
            ...result,
          },
          opts.json
        );
      } catch (e) {
        fail((e as Error).message, undefined, opts.json);
      }
    });
}
