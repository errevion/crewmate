import type { Brief, BriefField } from '../models/brief.js';

/**
 * Validates that a field name is a valid brief field
 *
 * @param field - The field name to validate
 * @returns true if the field is valid, false otherwise
 */
export function isValidField(_field: string): _field is BriefField {
  return true; // All field names are valid in the generic KV model
}

/**
 * Parses a raw string value into the appropriate type for a field
 *
 * @param field - The field name being parsed
 * @param raw - The raw string value to parse
 * @returns The parsed value in the correct type
 */
export function parseFieldValue(field: BriefField, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Status of a single brief field indicating whether it has been set
 */
export interface FieldStatus {
  field: BriefField;
  status: 'set' | 'missing';
}

/**
 * Gets the status of required fields in a brief
 *
 * @param brief - The brief to check
 * @param requiredFields - The list of fields that are required
 * @returns Record mapping field names to their status ('set' or 'missing')
 */
export function getRequiredFieldStatuses(
  brief: Brief,
  requiredFields: string[] = []
): Record<string, 'set' | 'missing'> {
  const result: Record<string, 'set' | 'missing'> = {};
  for (const field of requiredFields) {
    const value = brief.fields[field];
    result[field] = value !== null && value !== undefined && value !== '' ? 'set' : 'missing';
  }
  return result;
}

/**
 * Identifies which required fields are missing from a brief
 *
 * @param brief - The brief to check
 * @param requiredFields - The list of fields that are required
 * @returns Array of missing required field names
 */
export function getMissingRequiredFields(
  brief: Brief,
  requiredFields: string[] = []
): BriefField[] {
  return requiredFields.filter((field) => {
    const value = brief.fields[field];
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === 'string' && !value.trim()) {
      return true;
    }
    if (Array.isArray(value) && value.length === 0) {
      return true;
    }
    return false;
  });
}

/**
 * Checks if a brief has all required fields set
 *
 * @param brief - The brief to validate
 * @param requiredFields - The list of fields that are required
 * @returns true if all required fields are present, false otherwise
 */
export function isBriefComplete(brief: Brief, requiredFields: string[] = []): boolean {
  return getMissingRequiredFields(brief, requiredFields).length === 0;
}
