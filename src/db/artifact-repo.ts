import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type {
  ExecutionArtifact,
  ArtifactType,
  ArtifactStatus,
  ArtifactOutcome,
  ApiContractPayload,
} from '../models/artifact.js';
import {
  parseAndValidateArtifactPayload,
  summarizeArtifactContent,
} from '../utils/artifact-validation.js';
import { getTaskById, listTasksByBrief } from './task-repo.js';
import { redactSecrets } from '../utils/redaction.js';
import { checkArtifactStaleness } from '../utils/staleness.js';
import { writeSummaryFile } from '../utils/summary.js';

/**
 * Generates an 8-character hex ID
 */
export function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToArtifact(row: Record<string, unknown>): ExecutionArtifact {
  let tags: string[] = [];
  try {
    if (row.tags) {
      tags = JSON.parse(row.tags as string);
    }
  } catch {
    tags = [];
  }

  return {
    id: row.id as string,
    taskId: (row.task_id as string) || null,
    briefId: (row.brief_id as string) || null,
    type: row.type as ArtifactType,
    content: row.content as string,
    status: (row.status as ArtifactStatus) || 'active',
    supersededBy: (row.superseded_by as string) || null,
    tags,
    location: (row.location as string) || null,
    outcome: (row.outcome as ArtifactOutcome) || null,
    issueId: (row.issue_id as string) || null,
    createdAt: row.created_at as string,
  };
}

/**
 *
 */
export interface CreateArtifactOptions {
  tags?: string[];
  status?: ArtifactStatus;
  supersededBy?: string;
  autoSupersede?: boolean;
  location?: string;
  outcome?: ArtifactOutcome;
  issueId?: string;
}

/**
 * Creates an execution artifact in the database.
 * Supports auto-supersession for api_contracts targeting the same filePath/exportName.
 */
export function createArtifact(
  db: Database.Database,
  taskId: string | null,
  briefId: string | null | undefined,
  type: ArtifactType,
  content: string,
  options?: CreateArtifactOptions
): ExecutionArtifact {
  const sanitizedContent = redactSecrets(content);
  const validation = parseAndValidateArtifactPayload(type, sanitizedContent);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid artifact payload');
  }

  const payloadString = validation.rawString || sanitizedContent.trim();
  const id = generateId();
  const effectiveBriefId = briefId || null;
  const status = options?.status ?? 'active';
  const tags = options?.tags ?? [];
  const supersededBy = options?.supersededBy ?? null;
  const autoSupersede = options?.autoSupersede ?? true;
  const location = options?.location ?? null;
  const outcome = options?.outcome ?? null;
  const issueId = options?.issueId ?? null;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO execution_artifacts (id, task_id, brief_id, type, content, status, superseded_by, tags, location, outcome, issue_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      taskId,
      effectiveBriefId,
      type,
      payloadString,
      status,
      supersededBy,
      JSON.stringify(tags),
      location,
      outcome,
      issueId
    );

    // If this is an active api_contract and autoSupersede is enabled, check for previous active contracts
    if (type === 'api_contract' && status === 'active' && autoSupersede && validation.data) {
      const contractPayload = validation.data as ApiContractPayload;
      if (contractPayload.filePath) {
        const existingActive = db
          .prepare(
            `SELECT id, content FROM execution_artifacts WHERE (brief_id = ? OR brief_id IS NULL OR ? IS NULL) AND type = 'api_contract' AND status = 'active' AND id != ?`
          )
          .all(effectiveBriefId, effectiveBriefId, id) as Array<{ id: string; content: string }>;

        for (const prev of existingActive) {
          try {
            const prevParsed = JSON.parse(prev.content) as ApiContractPayload;
            const samePath =
              prevParsed.filePath &&
              prevParsed.filePath.toLowerCase() === contractPayload.filePath.toLowerCase();
            const sameExport =
              (!contractPayload.exportName && !prevParsed.exportName) ||
              contractPayload.exportName === prevParsed.exportName;

            if (samePath && sameExport) {
              db.prepare(
                `UPDATE execution_artifacts SET status = 'superseded', superseded_by = ? WHERE id = ?`
              ).run(id, prev.id);
            }
          } catch {
            // Ignore malformed previous content
          }
        }
      }
    }
  });

  tx();

  try {
    writeSummaryFile(db, process.cwd(), effectiveBriefId ?? undefined);
  } catch {
    // Ignore summary writing in in-memory test environments
  }

  const row = db.prepare(`SELECT * FROM execution_artifacts WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;

  if (!row) {
    throw new Error('Failed to create execution artifact');
  }

  return rowToArtifact(row);
}

/**
 *
 */
export function getArtifactById(db: Database.Database, id: string): ExecutionArtifact | null {
  const row = db.prepare(`SELECT * FROM execution_artifacts WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return rowToArtifact(row);
}

/**
 *
 */
export interface ListArtifactsFilter {
  briefId?: string;
  taskId?: string;
  type?: ArtifactType | ArtifactType[];
  status?: ArtifactStatus | 'all';
  forTask?: string;
}

const TYPE_PRIORITY: Record<ArtifactType, number> = {
  issue: 0,
  constraint: 1,
  api_contract: 2,
  decision: 3,
  fact: 4,
  note: 5,
  log: 6,
  attempt: 7,
  fix: 8,
};

/**
 * Lists artifacts according to the given filters.
 * When `forTask` is specified, it resolves ancestor task dependencies in the DAG,
 * returning relevant upstream artifacts along with brief-level artifacts.
 */
export function listArtifacts(
  db: Database.Database,
  filter?: ListArtifactsFilter
): ExecutionArtifact[] {
  let briefId = filter?.briefId;
  let relevantTaskIds: Set<string> | null = null;

  if (filter?.forTask) {
    const targetTask = getTaskById(db, filter.forTask);
    if (targetTask) {
      briefId = targetTask.briefId;
      // Resolve transitive ancestor tasks
      const allBriefTasks = listTasksByBrief(db, targetTask.briefId);
      const tasksById = new Map(allBriefTasks.map((t) => [t.id, t]));

      relevantTaskIds = new Set<string>();
      const queue = [...targetTask.dependencies];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const depId = queue.shift();
        if (depId && !visited.has(depId)) {
          visited.add(depId);
          relevantTaskIds.add(depId);
          const depTask = tasksById.get(depId);
          if (depTask) {
            queue.push(...depTask.dependencies);
          }
        }
      }
    }
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (briefId && briefId !== 'all') {
    conditions.push('(brief_id = ? OR brief_id IS NULL)');
    params.push(briefId);
  }

  if (filter?.taskId) {
    conditions.push('task_id = ?');
    params.push(filter.taskId);
  }

  if (filter?.type) {
    if (Array.isArray(filter.type)) {
      if (filter.type.length > 0) {
        const placeholders = filter.type.map(() => '?').join(', ');
        conditions.push(`type IN (${placeholders})`);
        params.push(...filter.type);
      }
    } else {
      conditions.push('type = ?');
      params.push(filter.type);
    }
  }

  const statusFilter = filter?.status ?? 'active';
  if (statusFilter !== 'all') {
    conditions.push('status = ?');
    params.push(statusFilter);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(
    `SELECT * FROM execution_artifacts ${whereClause} ORDER BY created_at ASC`
  );
  const rows = stmt.all(...params) as Record<string, unknown>[];
  let artifacts = rows.map(rowToArtifact);

  if (relevantTaskIds !== null) {
    const taskIdsSet = relevantTaskIds;
    // Keep brief-level artifacts (taskId is null) + artifacts belonging to ancestor tasks
    artifacts = artifacts.filter((a) => a.taskId === null || taskIdsSet.has(a.taskId));
    // Sort by type priority first, then created_at
    artifacts.sort((a, b) => {
      const prioA = TYPE_PRIORITY[a.type] ?? 99;
      const prioB = TYPE_PRIORITY[b.type] ?? 99;
      if (prioA !== prioB) {
        return prioA - prioB;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  return artifacts;
}

/**
 *
 */
export interface TaskArtifactCompliance {
  compliant: boolean;
  recorded: number;
  required: ArtifactType[];
  missing: ArtifactType[];
  error?: string;
}

/**
 * Checks whether a task satisfies artifact requirements for completion.
 */
export function checkTaskArtifactCompliance(
  db: Database.Database,
  taskId: string
): TaskArtifactCompliance {
  const task = getTaskById(db, taskId);
  if (!task) {
    return {
      compliant: false,
      recorded: 0,
      required: [],
      missing: [],
      error: `Task not found: ${taskId}`,
    };
  }

  const artifacts = listArtifacts(db, { taskId, status: 'active' });
  const openIssues = artifacts.filter((a) => a.type === 'issue' && a.status === 'active');

  if (openIssues.length > 0) {
    return {
      compliant: false,
      recorded: artifacts.length,
      required: task.artifactRequirements ?? [],
      missing: [],
      error: `Cannot complete task — there are ${openIssues.length} unresolved issues associated with this task.`,
    };
  }

  const recordedTypes = new Set(artifacts.map((a) => a.type));

  const required = task.artifactRequirements ?? [];
  if (required.length === 0) {
    // Default requirement: at least 1 artifact of any type
    if (artifacts.length === 0) {
      return {
        compliant: false,
        recorded: 0,
        required: [],
        missing: [],
        error:
          'Cannot complete task — no active knowledge artifacts recorded. Record at least one decision, api_contract, fact, or constraint before completing.',
      };
    }
    return {
      compliant: true,
      recorded: artifacts.length,
      required: [],
      missing: [],
    };
  }

  const missing = required.filter((req) => !recordedTypes.has(req));
  if (missing.length > 0) {
    return {
      compliant: false,
      recorded: artifacts.length,
      required,
      missing,
      error: `Cannot complete task — missing required artifact types: ${missing.join(', ')}. Required: [${required.join(', ')}].`,
    };
  }

  return {
    compliant: true,
    recorded: artifacts.length,
    required,
    missing: [],
  };
}

/**
 * Marks an artifact as superseded
 */
export function supersedeArtifact(db: Database.Database, oldId: string, newId: string): void {
  db.prepare(
    `UPDATE execution_artifacts SET status = 'superseded', superseded_by = ? WHERE id = ?`
  ).run(newId, oldId);
  try {
    writeSummaryFile(db);
  } catch {
    // Ignore summary writing in in-memory test environments
  }
}

/**
 * Marks an artifact as invalidated
 */
export function invalidateArtifact(db: Database.Database, id: string): void {
  db.prepare(`UPDATE execution_artifacts SET status = 'invalidated' WHERE id = ?`).run(id);
  try {
    writeSummaryFile(db);
  } catch {
    // Ignore summary writing in in-memory test environments
  }
}

/**
 *
 */
export function nextIssueNumber(db: Database.Database, briefId?: string | null): string {
  let row: { count: number } | undefined;
  if (briefId) {
    row = db
      .prepare(
        `SELECT COUNT(*) as count FROM execution_artifacts WHERE (brief_id = ? OR brief_id IS NULL) AND type = 'issue'`
      )
      .get(briefId) as { count: number } | undefined;
  } else {
    row = db
      .prepare(`SELECT COUNT(*) as count FROM execution_artifacts WHERE type = 'issue'`)
      .get() as { count: number } | undefined;
  }
  return String((row?.count ?? 0) + 1).padStart(4, '0');
}

/**
 *
 */
export interface SearchArtifactsOptions {
  briefId?: string;
  type?: ArtifactType | ArtifactType[];
  status?: ArtifactStatus | 'all';
  failedOnly?: boolean;
  limit?: number;
}

/**
 *
 */
export function searchArtifacts(
  db: Database.Database,
  query: string,
  options?: SearchArtifactsOptions
): ExecutionArtifact[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  conditions.push('content LIKE ? COLLATE NOCASE');
  params.push(`%${query}%`);

  if (options?.briefId && options.briefId !== 'all') {
    conditions.push('(brief_id = ? OR brief_id IS NULL)');
    params.push(options.briefId);
  }

  if (options?.type) {
    if (Array.isArray(options.type)) {
      if (options.type.length > 0) {
        const placeholders = options.type.map(() => '?').join(', ');
        conditions.push(`type IN (${placeholders})`);
        params.push(...options.type);
      }
    } else {
      conditions.push('type = ?');
      params.push(options.type);
    }
  }

  const statusFilter = options?.status ?? 'active';
  if (statusFilter !== 'all') {
    conditions.push('status = ?');
    params.push(statusFilter);
  }

  if (options?.failedOnly) {
    conditions.push("type = 'attempt'");
    conditions.push("outcome = 'failed'");
  }

  const limit = options?.limit ?? 20;
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(
    `SELECT * FROM execution_artifacts ${whereClause} ORDER BY created_at DESC LIMIT ?`
  );
  const rows = stmt.all(...params, limit) as Record<string, unknown>[];
  return rows.map(rowToArtifact);
}

/**
 *
 */
export interface PrecheckWarning {
  severity: 'warning' | 'danger';
  title: string;
  details: string[];
}

/**
 *
 */
export function precheckFile(
  db: Database.Database,
  filePath: string,
  briefId?: string
): PrecheckWarning[] {
  const warnings: PrecheckWarning[] = [];
  const conditions: string[] = ['location LIKE ? COLLATE NOCASE'];
  const params: unknown[] = [`%${filePath}%`];

  if (briefId && briefId !== 'all') {
    conditions.push('(brief_id = ? OR brief_id IS NULL)');
    params.push(briefId);
  }

  const whereClause = conditions.join(' AND ');

  const activeIssues = db
    .prepare(
      `SELECT * FROM execution_artifacts WHERE ${whereClause} AND type = 'issue' AND status = 'active'`
    )
    .all(...params) as Record<string, unknown>[];

  if (activeIssues.length > 0) {
    const issueArtifacts = activeIssues.map(rowToArtifact);
    warnings.push({
      severity: 'danger',
      title: `${activeIssues.length} active issue(s) at this location`,
      details: issueArtifacts.map((a) => summarizeArtifactContent(a.type, a.content)),
    });
  }

  const failedAttempts = db
    .prepare(
      `SELECT * FROM execution_artifacts WHERE ${whereClause} AND type = 'attempt' AND outcome = 'failed' AND status = 'active'`
    )
    .all(...params) as Record<string, unknown>[];

  if (failedAttempts.length > 0) {
    const attemptArtifacts = failedAttempts.map(rowToArtifact);
    warnings.push({
      severity: 'warning',
      title: `${failedAttempts.length} previously failed approach(es) at this location`,
      details: attemptArtifacts.map((a) => summarizeArtifactContent(a.type, a.content)),
    });
  }

  const allActiveAtLocation = db
    .prepare(`SELECT * FROM execution_artifacts WHERE ${whereClause} AND status = 'active'`)
    .all(...params) as Record<string, unknown>[];

  const activeArtifacts = allActiveAtLocation.map(rowToArtifact);
  for (const art of activeArtifacts) {
    const staleness = checkArtifactStaleness(art);
    if (staleness.isStale) {
      if (staleness.reason === 'file_deleted') {
        warnings.push({
          severity: 'danger',
          title: `Stale artifact: referenced file was deleted`,
          details: [
            `Artifact [${art.id}] (${art.type}) references ${staleness.filePath} which does not exist on disk.`,
          ],
        });
      } else if (staleness.reason === 'code_drift') {
        warnings.push({
          severity: 'warning',
          title: `Stale context: code drift detected (${staleness.commitCount} commits since recorded)`,
          details: [
            `Artifact [${art.id}] (${art.type}) predates ${staleness.commitCount} commits to ${staleness.filePath}. Review or supersede before modifying.`,
          ],
        });
      }
    }
  }

  const allAtLocation = db
    .prepare(`SELECT COUNT(*) as count FROM execution_artifacts WHERE ${whereClause}`)
    .get(...params) as { count: number } | undefined;

  if ((allAtLocation?.count ?? 0) > 5) {
    warnings.push({
      severity: 'warning',
      title: `High churn: ${allAtLocation?.count ?? 0} artifacts at this location`,
      details: ['This file has been modified frequently — review before making further changes.'],
    });
  }

  return warnings;
}

/**
 *
 */
export interface SessionBriefing {
  openIssues: ExecutionArtifact[];
  recentFixes: ExecutionArtifact[];
  recentDecisions: ExecutionArtifact[];
  failedAttempts: ExecutionArtifact[];
  activeConstraints: ExecutionArtifact[];
  totalArtifacts: number;
}

/**
 *
 */
export function generateBriefing(db: Database.Database, briefId?: string): SessionBriefing {
  const briefWhere = briefId && briefId !== 'all' ? 'WHERE (brief_id = ? OR brief_id IS NULL)' : '';
  const briefAnd = briefId && briefId !== 'all' ? 'AND (brief_id = ? OR brief_id IS NULL)' : '';
  const params = briefId && briefId !== 'all' ? [briefId] : [];

  const openIssues = (
    db
      .prepare(
        `SELECT * FROM execution_artifacts WHERE type = 'issue' AND status = 'active' ${briefAnd}`
      )
      .all(...params) as Record<string, unknown>[]
  ).map(rowToArtifact);

  const recentFixes = (
    db
      .prepare(
        `SELECT * FROM execution_artifacts WHERE type = 'fix' ${briefAnd} ORDER BY created_at DESC LIMIT 5`
      )
      .all(...params) as Record<string, unknown>[]
  ).map(rowToArtifact);

  const recentDecisions = (
    db
      .prepare(
        `SELECT * FROM execution_artifacts WHERE type = 'decision' AND status = 'active' ${briefAnd} ORDER BY created_at DESC LIMIT 5`
      )
      .all(...params) as Record<string, unknown>[]
  ).map(rowToArtifact);

  const failedAttempts = (
    db
      .prepare(
        `SELECT * FROM execution_artifacts WHERE type = 'attempt' AND outcome = 'failed' AND status = 'active' ${briefAnd} ORDER BY created_at DESC LIMIT 10`
      )
      .all(...params) as Record<string, unknown>[]
  ).map(rowToArtifact);

  const activeConstraints = (
    db
      .prepare(
        `SELECT * FROM execution_artifacts WHERE type = 'constraint' AND status = 'active' ${briefAnd}`
      )
      .all(...params) as Record<string, unknown>[]
  ).map(rowToArtifact);

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM execution_artifacts ${briefWhere}`)
    .get(...params) as { count: number } | undefined;
  const totalArtifacts = totalRow?.count ?? 0;

  return {
    openIssues,
    recentFixes,
    recentDecisions,
    failedAttempts,
    activeConstraints,
    totalArtifacts,
  };
}

/**
 *
 */
export interface ContextOptions {
  tokens?: number;
  focus?: string;
}

/**
 *
 */
export function generateContext(
  db: Database.Database,
  briefId?: string,
  options?: ContextOptions
): string {
  const maxTokens = options?.tokens ?? 2000;
  const maxChars = maxTokens * 4;
  const focus = options?.focus?.toLowerCase();

  const briefing = generateBriefing(db, briefId);
  const sections: string[] = [];

  if (briefing.openIssues.length > 0) {
    const lines = ['## Open Issues'];
    const sorted = focus
      ? [...briefing.openIssues].sort((a, b) => {
          const aMatch =
            a.content.toLowerCase().includes(focus) ||
            (a.location?.toLowerCase().includes(focus) ?? false);
          const bMatch =
            b.content.toLowerCase().includes(focus) ||
            (b.location?.toLowerCase().includes(focus) ?? false);
          return aMatch === bMatch ? 0 : aMatch ? -1 : 1;
        })
      : briefing.openIssues;
    for (const a of sorted) {
      lines.push(`- [${a.id}] ${summarizeArtifactContent(a.type, a.content)}`);
    }
    sections.push(lines.join('\n'));
  }

  if (briefing.failedAttempts.length > 0) {
    const lines = ['## Failed Approaches (DO NOT retry)'];
    const sorted = focus
      ? [...briefing.failedAttempts].sort((a, b) => {
          const aMatch =
            a.content.toLowerCase().includes(focus) ||
            (a.location?.toLowerCase().includes(focus) ?? false);
          const bMatch =
            b.content.toLowerCase().includes(focus) ||
            (b.location?.toLowerCase().includes(focus) ?? false);
          return aMatch === bMatch ? 0 : aMatch ? -1 : 1;
        })
      : briefing.failedAttempts;
    for (const a of sorted) {
      lines.push(`- [${a.id}] ${summarizeArtifactContent(a.type, a.content)}`);
    }
    sections.push(lines.join('\n'));
  }

  if (briefing.recentDecisions.length > 0) {
    const lines = ['## Active Decisions'];
    const sorted = focus
      ? [...briefing.recentDecisions].sort((a, b) => {
          const aMatch = a.content.toLowerCase().includes(focus);
          const bMatch = b.content.toLowerCase().includes(focus);
          return aMatch === bMatch ? 0 : aMatch ? -1 : 1;
        })
      : briefing.recentDecisions;
    for (const a of sorted) {
      lines.push(`- [${a.id}] ${summarizeArtifactContent(a.type, a.content)}`);
    }
    sections.push(lines.join('\n'));
  }

  if (briefing.activeConstraints.length > 0) {
    const lines = ['## Constraints'];
    for (const a of briefing.activeConstraints) {
      lines.push(`- [${a.id}] ${summarizeArtifactContent(a.type, a.content)}`);
    }
    sections.push(lines.join('\n'));
  }

  let result = sections.join('\n\n');
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 3) + '...';
  }

  return result;
}
