import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { listArtifacts } from '../db/artifact-repo.js';
import { summarizeArtifactContent } from './artifact-validation.js';

/**
 * Generates a concise, token-budgeted markdown summary from active artifacts in SQLite.
 * Modeled after ProjectMem's summary.md projection (~500 tokens).
 */
export function generateDistilledSummary(db: Database.Database, briefId?: string): string {
  const artifacts = listArtifacts(db, { briefId, status: 'active' });

  const decisions = artifacts.filter((a) => a.type === 'decision');
  const constraints = artifacts.filter((a) => a.type === 'constraint');
  const openIssues = artifacts.filter((a) => a.type === 'issue');
  const failedAttempts = artifacts.filter((a) => a.type === 'attempt' && a.outcome === 'failed');
  const factsAndContracts = artifacts.filter((a) => ['fact', 'api_contract'].includes(a.type));

  const sections: string[] = [];
  sections.push('# Project Memory Summary');
  sections.push(`*Generated at: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC*`);

  if (decisions.length > 0) {
    sections.push('## Active Decisions');
    for (const d of decisions.slice(0, 10)) {
      sections.push(`- **[${d.id}]** ${summarizeArtifactContent(d.type, d.content)}`);
    }
  }

  if (constraints.length > 0) {
    sections.push('## Invariants & Constraints');
    for (const c of constraints) {
      sections.push(`- **[${c.id}]** ${summarizeArtifactContent(c.type, c.content)}`);
    }
  }

  if (openIssues.length > 0 || failedAttempts.length > 0) {
    sections.push('## Open Issues & Failed Approaches (DO NOT RETRY)');
    for (const issue of openIssues.slice(0, 5)) {
      sections.push(
        `- **Issue [${issue.id}]** ${summarizeArtifactContent(issue.type, issue.content)}`
      );
      // Find failed attempts for this issue
      const issueAttempts = failedAttempts.filter((att) => att.issueId === issue.id);
      for (const att of issueAttempts.slice(0, 3)) {
        const atStr = att.location ? ` *(at ${att.location})*` : '';
        sections.push(`  - ✗ ${summarizeArtifactContent(att.type, att.content)}${atStr}`);
      }
    }

    // Unlinked failed attempts
    const unlinkedAttempts = failedAttempts.filter((att) => !att.issueId);
    for (const att of unlinkedAttempts.slice(0, 5)) {
      const atStr = att.location ? ` *(at ${att.location})*` : '';
      sections.push(`- ✗ ${summarizeArtifactContent(att.type, att.content)}${atStr}`);
    }
  }

  if (factsAndContracts.length > 0) {
    sections.push('## Discovered Facts & API Contracts');
    for (const f of factsAndContracts.slice(0, 10)) {
      sections.push(`- **[${f.id}]** ${summarizeArtifactContent(f.type, f.content)}`);
    }
  }

  if (artifacts.length === 0) {
    sections.push('*No active knowledge artifacts recorded yet.*');
  }

  return sections.join('\n\n') + '\n';
}

/**
 * Writes the distilled summary markdown file to `.crewmate/summary.md`.
 */
export function writeSummaryFile(
  db: Database.Database,
  targetDir: string = process.cwd(),
  briefId?: string
): string {
  const summaryMarkdown = generateDistilledSummary(db, briefId);
  const outDir = join(targetDir, '.crewmate');
  try {
    mkdirSync(outDir, { recursive: true });
    const filePath = join(outDir, 'summary.md');
    writeFileSync(filePath, summaryMarkdown, 'utf-8');
    return filePath;
  } catch {
    // If running in in-memory or read-only test filesystem, fallback safely
    return '';
  }
}
