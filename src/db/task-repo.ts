import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { Task } from '../models/task.js';

/**
 *
 */
export function generateId(): string {
  return randomBytes(4).toString('hex');
}

function rowToTask(row: Record<string, unknown>): Task {
  let deps: string[] = [];
  try {
    deps = JSON.parse(row.dependencies as string);
  } catch {
    // corrupted JSON defaults to empty array
  }
  return {
    id: row.id as string,
    briefId: row.brief_id as string,
    title: row.title as string,
    description: row.description as string,
    dependencies: deps,
    field: (row.field as string) || null,
    status: row.status as Task['status'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Create a new task without inserting it into the database.
 * Used by tests and for generating task objects.
 */
export function buildTask(
  id: string = generateId(),
  briefId: string,
  title: string,
  description: string,
  options?: {
    dependencies?: string[];
    field?: string | null;
    status?: Task['status'];
    createdAt?: string;
    updatedAt?: string;
  }
): Task {
  return {
    id,
    briefId,
    title,
    description,
    dependencies: options?.dependencies ?? [],
    field: options?.field ?? null,
    status: options?.status ?? 'pending',
    createdAt: options?.createdAt ?? new Date().toISOString(),
    updatedAt: options?.updatedAt ?? new Date().toISOString(),
  };
}

/**
 *
 */
export function createTask(
  db: Database.Database,
  briefId: string,
  title: string,
  description: string,
  options?: {
    dependencies?: string[];
    field?: string | null;
  }
): Task {
  const id = generateId();
  db.prepare(
    `INSERT INTO tasks (id, brief_id, title, description, dependencies, field, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    briefId,
    title,
    description,
    JSON.stringify(options?.dependencies ?? []),
    options?.field ?? null,
    'pending'
  );

  const result = getTaskById(db, id);
  if (!result) {
    throw new Error('Failed to create task');
  }
  return result;
}

/**
 *
 */
export function getTaskById(db: Database.Database, id: string): Task | null {
  const stmt = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return rowToTask(row);
}

/**
 *
 */
export function listTasksByBrief(db: Database.Database, briefId: string): Task[] {
  const stmt = db.prepare(`SELECT * FROM tasks WHERE brief_id = ? ORDER BY created_at ASC`);
  const rows = stmt.all(briefId) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

/**
 *
 */
export function updateTaskStatus(db: Database.Database, id: string, status: Task['status']): void {
  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    id
  );
}

/**
 *
 */
export function removeTask(db: Database.Database, id: string): void {
  const tx = db.transaction(() => {
    const allTasks = db
      .prepare(`SELECT id, dependencies FROM tasks WHERE id != ?`)
      .all(id) as Array<{ id: string; dependencies: string }>;

    for (const t of allTasks) {
      let deps: string[];
      try {
        deps = JSON.parse(t.dependencies);
      } catch {
        deps = [];
      }
      if (deps.includes(id)) {
        const filtered = deps.filter((d: string) => d !== id);
        db.prepare(
          `UPDATE tasks SET dependencies = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(JSON.stringify(filtered), t.id);
      }
    }

    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  });
  tx();
}

/**
 *
 */
export function deleteTasksByBrief(db: Database.Database, briefId: string): void {
  db.prepare(`DELETE FROM tasks WHERE brief_id = ?`).run(briefId);
}

/**
 * Validates that task dependencies exist, belong to the same brief, and don't create cycles.
 */
export function validateDependencies(
  db: Database.Database,
  briefId: string,
  dependencies: string[],
  taskId?: string
): { valid: boolean; error?: string } {
  if (dependencies.length === 0) {
    return { valid: true };
  }

  const briefTasks = listTasksByBrief(db, briefId);
  const taskIds = new Set(briefTasks.map((t) => t.id));

  for (const dep of dependencies) {
    if (taskId && dep === taskId) {
      return { valid: false, error: `Task cannot depend on itself: ${dep}` };
    }
    if (!taskIds.has(dep)) {
      return {
        valid: false,
        error: `Dependency task not found in this brief: ${dep}`,
      };
    }
  }

  if (taskId) {
    const graph = new Map<string, string[]>();
    for (const t of briefTasks) {
      graph.set(t.id, t.id === taskId ? dependencies : t.dependencies);
    }
    if (!taskIds.has(taskId)) {
      graph.set(taskId, dependencies);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    function hasCycle(node: string): boolean {
      if (inStack.has(node)) {
        return true;
      }
      if (visited.has(node)) {
        return false;
      }
      visited.add(node);
      inStack.add(node);
      for (const dep of graph.get(node) ?? []) {
        if (hasCycle(dep)) {
          return true;
        }
      }
      inStack.delete(node);
      return false;
    }

    for (const node of graph.keys()) {
      if (hasCycle(node)) {
        return { valid: false, error: 'Dependency cycle detected' };
      }
    }
  }

  return { valid: true };
}
