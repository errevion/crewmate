/**
 * File lock entity definition for parallel execution safety
 */

/**
 *
 */
export interface FileLock {
  id: string;
  taskId: string;
  filePath: string;
  createdAt: string;
}

export const LOCK_FIELDS = ['id', 'taskId', 'filePath', 'createdAt'] as const;

/**
 *
 */
export type LockField = (typeof LOCK_FIELDS)[number];

export const LOCK_FIELD_TO_COLUMN: Record<string, string> = {
  id: 'id',
  taskId: 'task_id',
  filePath: 'file_path',
  createdAt: 'created_at',
};

export const LOCK_COLUMN_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(LOCK_FIELD_TO_COLUMN).map(([k, v]) => [v, k])
);
