import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

const CLI_PATH = join(process.cwd(), 'dist', 'index.mjs');

/**
 * Run the crewmate CLI with given arguments in a specific working directory.
 * Resolves when the process completes.
 */
export function runCli(args: string[], options?: { cwd?: string }): Promise<CliResult> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    // Clean up CI/automation flags that might affect behavior
    delete env.CI;
    delete env.NODE_ENV;

    const child = spawn('node', [CLI_PATH, ...args], {
      cwd: options?.cwd ?? process.cwd(),
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        code: code ?? 0,
      });
    });
  });
}

/**
 * Parse JSON output from CLI command.
 * Handles both JSON output and whitespace.
 * If output contains multiple lines, extracts JSON from the last line.
 */
export function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return null;

  // Try parsing the whole output first (single-line JSON mode)
  try {
    return JSON.parse(trimmed);
  } catch {
    // If that fails, try extracting JSON from the last line (multi-line mode)
    const lines = trimmed.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const lastLine = lines[i].trim();
      if (lastLine.startsWith('{') && lastLine.endsWith('}')) {
        try {
          return JSON.parse(lastLine);
        } catch {
          // Continue searching
        }
      }
    }

    // Fallback to last non-empty line
    const lastNonEmpty = lines.findLast((line) => line.trim());
    if (lastNonEmpty) {
      try {
        return JSON.parse(lastNonEmpty.trim());
      } catch {
        throw new Error(`Failed to parse JSON from output: ${output}`);
      }
    }

    return null;
  }
}

/**
 * Assert CLI command succeeded (exit code 0).
 */
export async function expectSuccess(result: CliResult, description?: string): Promise<void> {
  if (result.code !== 0) {
    throw new Error(
      `${description || 'Command'} failed with exit code ${result.code}\n\nstderr: ${result.stderr}`
    );
  }
}

/**
 * Assert CLI command failed (non-zero exit code).
 */
export async function expectFailure(
  result: CliResult,
  expectedErrorPattern: RegExp | string,
  description?: string
): Promise<void> {
  if (result.code === 0) {
    throw new Error(
      `${description || 'Expected failure'} succeeded but should have failed\n\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }

  const errorMessage = result.stderr + result.stdout;
  const pattern =
    typeof expectedErrorPattern === 'string'
      ? new RegExp(expectedErrorPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : expectedErrorPattern;

  if (!pattern.test(errorMessage)) {
    throw new Error(
      `${description || 'Unexpected error'} does not match expected pattern.\n\nExpected: ${expectedErrorPattern}\nGot: ${errorMessage}`
    );
  }
}
