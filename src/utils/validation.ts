import {
  type Brief,
  type BriefField,
  BRIEF_FIELDS,
  JSON_FIELDS,
  REQUIRED_FIELDS,
  WORK_TYPES,
  type WorkType,
} from '../models/brief.js';

/**
 * Human-readable format hints for brief fields used in validation error messages
 */
export const FIELD_FORMAT_HINTS: Record<BriefField, string> = {
  workType: 'One of: software, infrastructure, data, documentation, audit',
  goal: 'Plain text string',
  scope: '{"included": string[], "excluded": string[]}',
  functionalRequirements: 'string[] (e.g. ["req 1", "req 2"])',
  acceptanceCriteria: 'string[] (e.g. ["criteria 1", "criteria 2"])',
  technicalStack:
    '{"frontend": string[], "backend": string[], "database": string[], "tools": string[]}',
  constraints: '{"exclusions": string[], "requirements": string[]}',
  existingCodebase: 'string[] (e.g. ["src/index.ts"])',
  referenceMaterials: 'string[] (e.g. ["docs/spec.md"])',
  qualityStandards: '{"performance": object, "security": object, "accessibility": object}',
  dependencies: 'string[] (e.g. ["package1", "package2"])',
  risks: 'string[] (e.g. ["risk 1", "risk 2"])',
  deliverables: '[{"type": "code"|"doc"|"report", "format": "file"|"repo"|"presentation"}]',
};

/**
 * Validates that a field name is a valid brief field
 *
 * @param field - The field name to validate
 * @returns true if the field is valid, false otherwise
 */
export function isValidField(field: string): field is BriefField {
  return (BRIEF_FIELDS as readonly string[]).includes(field);
}

/**
 * Parses a raw string value into the appropriate type for a field
 *
 * @param field - The field name being parsed
 * @param raw - The raw string value to parse
 * @returns The parsed value in the correct type
 * @throws Error if the value is invalid for the field type
 */
export function parseFieldValue(field: BriefField, raw: string): unknown {
  if (field === 'workType') {
    if (!(WORK_TYPES as readonly string[]).includes(raw)) {
      throw new Error(`Invalid workType "${raw}". Must be one of: ${WORK_TYPES.join(', ')}`);
    }
    return raw as WorkType;
  }

  if (field === 'goal') {
    if (!raw.trim()) {
      throw new Error('Goal cannot be empty');
    }
    return raw;
  }

  if (JSON_FIELDS.includes(field)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Invalid JSON for field "${field}". Expected format: ${FIELD_FORMAT_HINTS[field]}`
      );
    }

    if (
      [
        'functionalRequirements',
        'acceptanceCriteria',
        'existingCodebase',
        'referenceMaterials',
        'dependencies',
        'risks',
      ].includes(field)
    ) {
      if (!Array.isArray(parsed)) {
        throw new Error(
          `Invalid structure for field "${field}". Expected an array of strings: ${FIELD_FORMAT_HINTS[field]}`
        );
      }
      for (const item of parsed) {
        if (typeof item !== 'string') {
          throw new Error(`Invalid element in "${field}": expected string, got ${typeof item}`);
        }
      }
    } else if (field === 'scope') {
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        !('included' in parsed) ||
        !('excluded' in parsed) ||
        !Array.isArray((parsed as Record<string, unknown>).included) ||
        !Array.isArray((parsed as Record<string, unknown>).excluded)
      ) {
        throw new Error(
          `Invalid structure for field "scope". Expected format: ${FIELD_FORMAT_HINTS.scope}`
        );
      }
    } else if (field === 'technicalStack') {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(
          `Invalid structure for field "technicalStack". Expected format: ${FIELD_FORMAT_HINTS.technicalStack}`
        );
      }
      const record = parsed as Record<string, unknown>;
      for (const key of ['frontend', 'backend', 'database', 'tools']) {
        if (key in record && record[key] !== null && record[key] !== undefined) {
          if (typeof record[key] === 'string') {
            record[key] = [record[key]];
          } else if (!Array.isArray(record[key])) {
            throw new Error(
              `Invalid structure for field "technicalStack". Expected format: ${FIELD_FORMAT_HINTS.technicalStack}`
            );
          }
        }
      }
    } else if (field === 'constraints') {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(
          `Invalid structure for field "constraints". Expected format: ${FIELD_FORMAT_HINTS.constraints}`
        );
      }
      const record = parsed as Record<string, unknown>;
      for (const key of ['exclusions', 'requirements']) {
        if (key in record && record[key] !== null && record[key] !== undefined) {
          if (typeof record[key] === 'string') {
            record[key] = [record[key]];
          } else if (!Array.isArray(record[key])) {
            throw new Error(
              `Invalid structure for field "constraints". Expected format: ${FIELD_FORMAT_HINTS.constraints}`
            );
          }
        }
      }
    } else if (field === 'deliverables') {
      if (!Array.isArray(parsed)) {
        throw new Error(
          `Invalid structure for field "deliverables". Expected format: ${FIELD_FORMAT_HINTS.deliverables}`
        );
      }
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new Error(
            `Invalid element in "deliverables": each item must be an object with "type" and "format"`
          );
        }
      }
    } else if (field === 'qualityStandards') {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(
          `Invalid structure for field "qualityStandards". Expected format: ${FIELD_FORMAT_HINTS.qualityStandards}`
        );
      }
    }

    return parsed;
  }

  return raw;
}

/**
 * Status of a single brief field indicating whether it has been set
 */
export interface FieldStatus {
  field: BriefField;
  status: 'set' | 'missing';
}

/**
 * Gets the status of all required fields in a brief
 *
 * @param brief - The brief to check
 * @returns Record mapping field names to their status ('set' or 'missing')
 */
export function getRequiredFieldStatuses(brief: Brief): Record<string, 'set' | 'missing'> {
  const result: Record<string, 'set' | 'missing'> = {};
  for (const field of REQUIRED_FIELDS) {
    const value = brief[field];
    result[field] = value !== null && value !== undefined ? 'set' : 'missing';
  }
  return result;
}

/**
 * Identifies which required fields are missing from a brief
 *
 * @param brief - The brief to check
 * @returns Array of missing required field names
 */
export function getMissingRequiredFields(brief: Brief): BriefField[] {
  return REQUIRED_FIELDS.filter((field) => {
    const value = brief[field];
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === 'string' && !value.trim()) {
      return true;
    }
    if (Array.isArray(value) && value.length === 0) {
      return true;
    }
    if (field === 'scope' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const scopeVal = value as unknown as Record<string, unknown>;
      if (
        Array.isArray(scopeVal.included) &&
        Array.isArray(scopeVal.excluded) &&
        (scopeVal.included as unknown[]).length === 0 &&
        (scopeVal.excluded as unknown[]).length === 0
      ) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Checks if a brief has all required fields set
 *
 * @param brief - The brief to validate
 * @returns true if all required fields are present, false otherwise
 */
export function isBriefComplete(brief: Brief): boolean {
  return getMissingRequiredFields(brief).length === 0;
}
