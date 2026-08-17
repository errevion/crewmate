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
    return raw;
  }

  if (JSON_FIELDS.includes(field)) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON for field "${field}". Value must be valid JSON.`);
    }
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
    return value === null || value === undefined;
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
