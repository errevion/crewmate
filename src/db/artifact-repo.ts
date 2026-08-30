import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type {
  ExecutionArtifact,
  ArtifactType,
  ArtifactStatus,
  ApiContractPayload,
} from '../models/artifact.js';
import { parseAndValidateArtifactPayload } from '../utils/artifact-validation.js';
import { getTaskById, listTasksByBrief } from './task-repo.js';

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
    briefId: row.brief_id as string,
    type: row.type as ArtifactType,
    content: row.content as string,
    status: (row.status as ArtifactStatus) || 'active',
    supersededBy: (row.superseded_by as string) || null,
    tags,
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
}

/**
 * Creates an execution artifact in the database.
 * Supports auto-supersession for api_contracts targeting the same filePath/exportName.
 */
export function createArtifact(
  db: Database.Database,
  taskId: string | null,
  briefId: string,
  type: ArtifactType,
  content: string,
  options?: CreateArtifactOptions
): ExecutionArtifact {
  const validation = parseAndValidateArtifactPayload(type, content);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid artifact payload');
  }

  const payloadString = validation.rawString || content.trim();
  const id = generateId();
  const status = options?.status ?? 'active';
  const tags = options?.tags ?? [];
  const supersededBy = options?.supersededBy ?? null;
  const autoSupersede = options?.autoSupersede ?? true;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO execution_artifacts (id, task_id, brief_id, type, content, status, superseded_by, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, taskId, briefId, type, payloadString, status, supersededBy, JSON.stringify(tags));

    // If this is an active api_contract and autoSupersede is enabled, check for previous active contracts
    if (type === 'api_contract' && status === 'active' && autoSupersede && validation.data) {
      const contractPayload = validation.data as ApiContractPayload;
      if (contractPayload.filePath) {
        const existingActive = db
          .prepare(
            `SELECT id, content FROM execution_artifacts WHERE brief_id = ? AND type = 'api_contract' AND status = 'active' AND id != ?`
          )
          .all(briefId, id) as Array<{ id: string; content: string }>;

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
  constraint: 1,
  api_contract: 2,
  decision: 3,
  fact: 4,
  note: 5,
  log: 6,
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

  if (briefId) {
    conditions.push('brief_id = ?');
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
}

/**
 * Marks an artifact as invalidated
 */
export function invalidateArtifact(db: Database.Database, id: string): void {
  db.prepare(`UPDATE execution_artifacts SET status = 'invalidated' WHERE id = ?`).run(id);
}
