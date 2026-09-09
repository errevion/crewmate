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
  'issue',
  'attempt',
  'fix',
] as const;

/**
 *
 */
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = ['active', 'superseded', 'invalidated', 'resolved'] as const;

export const ARTIFACT_OUTCOMES = ['worked', 'failed', 'partial'] as const;

/**
 *
 */
export type ArtifactOutcome = (typeof ARTIFACT_OUTCOMES)[number];

/**
 *
 */
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/**
 *
 */
export interface FactPayload {
  statement: string;
  evidence?: string;
  scope?: 'project' | 'module' | 'file';
}

/**
 *
 */
export interface DecisionPayload {
  choice: string;
  rationale: string;
  alternatives?: string[];
  reversible?: boolean;
}

/**
 *
 */
export interface ApiContractPayload {
  signature: string;
  filePath: string;
  exportName?: string;
  consumers?: string[];
}

/**
 *
 */
export interface ConstraintPayload {
  rule: string;
  severity: 'must' | 'should' | 'prefer';
  scope?: string;
  violation?: string;
}

/**
 *
 */
export interface NotePayload {
  summary: string;
  details?: string;
}

/**
 *
 */
export interface LogPayload {
  summary: string;
  details?: string;
}

/**
 *
 */
export interface IssuePayload {
  summary: string;
  location?: string;
  issueNumber?: string;
}

/**
 *
 */
export interface AttemptPayload {
  summary: string;
  outcome: 'worked' | 'failed' | 'partial';
  location?: string;
}

/**
 *
 */
export interface FixPayload {
  summary: string;
  location?: string;
}

/**
 *
 */
export type StructuredArtifactPayload =
  | FactPayload
  | DecisionPayload
  | ApiContractPayload
  | ConstraintPayload
  | NotePayload
  | LogPayload
  | IssuePayload
  | AttemptPayload
  | FixPayload;

/**
 *
 */
export interface ExecutionArtifact {
  id: string;
  taskId: string | null;
  briefId: string;
  type: ArtifactType;
  content: string;
  status: ArtifactStatus;
  supersededBy: string | null;
  tags: string[];
  location: string | null;
  outcome: ArtifactOutcome | null;
  issueId: string | null;
  createdAt: string;
}

export const ARTIFACT_FIELDS = [
  'id',
  'taskId',
  'briefId',
  'type',
  'content',
  'status',
  'supersededBy',
  'tags',
  'location',
  'outcome',
  'issueId',
  'createdAt',
] as const;

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
  status: 'status',
  supersededBy: 'superseded_by',
  tags: 'tags',
  location: 'location',
  outcome: 'outcome',
  issueId: 'issue_id',
  createdAt: 'created_at',
};

export const ARTIFACT_COLUMN_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(ARTIFACT_FIELD_TO_COLUMN).map(([k, v]) => [v, k])
);
