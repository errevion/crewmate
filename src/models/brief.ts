export const WORK_TYPES = ['software', 'infrastructure', 'data', 'documentation', 'audit'] as const;

/**
 * Type of work for a project brief
 */
export type WorkType = (typeof WORK_TYPES)[number];

/**
 * Defines the scope boundaries for a project
 */
export interface BriefScope {
  included: string[];
  excluded: string[];
}

/**
 * Technical stack specifications for different layers
 */
export interface TechnicalStack {
  frontend: string[];
  backend: string[];
  database: string[];
  tools: string[];
}

/**
 * Project constraints and requirements
 */
export interface Constraints {
  exclusions: string[];
  requirements: string[];
}

/**
 * Quality standards across different dimensions
 */
export interface QualityStandards {
  performance: Record<string, unknown>;
  security: Record<string, unknown>;
  accessibility: Record<string, unknown>;
}

/**
 * A single deliverable specification
 */
export interface Deliverable {
  type: 'code' | 'doc' | 'report';
  format: 'file' | 'repo' | 'presentation';
}

/**
 * Complete project brief structure containing all requirements and specifications
 */
export interface Brief {
  id: string;
  workType: WorkType | null;
  goal: string | null;
  scope: BriefScope | null;
  functionalRequirements: string[] | null;
  technicalStack: TechnicalStack | null;
  constraints: Constraints | null;
  existingCodebase: string[] | null;
  referenceMaterials: string[] | null;
  acceptanceCriteria: string[] | null;
  qualityStandards: QualityStandards | null;
  dependencies: string[] | null;
  risks: string[] | null;
  deliverables: Deliverable[] | null;
  status: 'draft' | 'complete';
  createdAt: string;
  updatedAt: string;
}

/**
 * Array of all valid brief field names
 */
export const BRIEF_FIELDS = [
  'workType',
  'goal',
  'scope',
  'functionalRequirements',
  'technicalStack',
  'constraints',
  'existingCodebase',
  'referenceMaterials',
  'acceptanceCriteria',
  'qualityStandards',
  'dependencies',
  'risks',
  'deliverables',
] as const;

/**
 * Union type of all valid brief field names
 */
export type BriefField = (typeof BRIEF_FIELDS)[number];

/**
 * Array of required fields that must be set for a brief to be complete
 */
export const REQUIRED_FIELDS: BriefField[] = [
  'workType',
  'goal',
  'scope',
  'functionalRequirements',
  'acceptanceCriteria',
];

/**
 * Mapping from field names to database column names
 */
export const FIELD_TO_COLUMN: Record<BriefField, string> = {
  workType: 'work_type',
  goal: 'goal',
  scope: 'scope',
  functionalRequirements: 'functional_requirements',
  technicalStack: 'technical_stack',
  constraints: 'constraints',
  existingCodebase: 'existing_codebase',
  referenceMaterials: 'reference_materials',
  acceptanceCriteria: 'acceptance_criteria',
  qualityStandards: 'quality_standards',
  dependencies: 'dependencies',
  risks: 'risks',
  deliverables: 'deliverables',
};

/**
 * Mapping from database column names back to field names
 */
export const COLUMN_TO_FIELD: Record<string, BriefField> = Object.fromEntries(
  Object.entries(FIELD_TO_COLUMN).map(([k, v]) => [v, k as BriefField])
) as Record<string, BriefField>;

/**
 * Array of fields that are stored as JSON in the database
 */
export const JSON_FIELDS: BriefField[] = [
  'scope',
  'functionalRequirements',
  'technicalStack',
  'constraints',
  'existingCodebase',
  'referenceMaterials',
  'acceptanceCriteria',
  'qualityStandards',
  'dependencies',
  'risks',
  'deliverables',
];
