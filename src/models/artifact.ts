/**
 * Execution artifact entity definition for incremental knowledge base
 */

export const ARTIFACT_TYPES = [
  'fact',
  'decision',
  'api_contract',
  'constraint',
  'note',
  'log',
] as const;

/**
 *
 */
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/**
 *
 */
export interface ExecutionArtifact {
  id: string;
  taskId: string;
  briefId: string;
  type: ArtifactType;
  content: string;
  createdAt: string;
}

export const ARTIFACT_FIELDS = ['id', 'taskId', 'briefId', 'type', 'content', 'createdAt'] as const;

/**
 *
 */
export type ArtifactField = (typeof ARTIFACT_FIELDS)[number];

export const ARTIFACT_FIELD_TO_COLUMN: Record<string, string> = {
  id: 'id',
  taskId: 'task_id',
  briefId: 'brief_id',
  type: 'type',
  content: 'content',
  createdAt: 'created_at',
};

export const ARTIFACT_COLUMN_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(ARTIFACT_FIELD_TO_COLUMN).map(([k, v]) => [v, k])
);
