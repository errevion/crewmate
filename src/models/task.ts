/**
 * Task entity definition
 */

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;

/**
 *
 */
export interface Task {
  id: string;
  briefId: string;
  title: string;
  description: string;
  dependencies: string[]; // array of task IDs
  field: string | null; // brief field this addresses (optional)
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export const TASK_FIELDS = [
  'id',
  'briefId',
  'title',
  'description',
  'dependencies',
  'field',
  'status',
  'createdAt',
  'updatedAt',
] as const;

/**
 *
 */
export type TaskField = (typeof TASK_FIELDS)[number];

// Map camelCase fields to snake_case column names
export const FIELD_TO_COLUMN: Record<string, string> = {
  id: 'id',
  briefId: 'brief_id',
  title: 'title',
  description: 'description',
  dependencies: 'dependencies',
  field: 'field',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// Reverse mapping
export const COLUMN_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_TO_COLUMN).map(([k, v]) => [v, k])
);

// Fields stored as JSON strings in SQLite
export const JSON_FIELDS = ['dependencies'] as const;
