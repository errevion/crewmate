/**
 * Type alias for brief field names (open-ended string)
 */
export type BriefField = string;

/**
 * Complete project brief structure using a generic key-value store
 */
export interface Brief {
  id: string;
  status: 'draft' | 'complete';
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
