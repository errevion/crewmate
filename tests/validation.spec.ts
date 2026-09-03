import { describe, it, expect } from 'vitest';
import {
  isValidField,
  parseFieldValue,
  getRequiredFieldStatuses,
  getMissingRequiredFields,
  isBriefComplete,
} from '../src/utils/validation.js';
import type { Brief } from '../src/models/brief.js';

describe('validation', () => {
  describe('isValidField', () => {
    it('should accept any non-empty field name in the generic KV model', () => {
      expect(isValidField('workType')).toBe(true);
      expect(isValidField('goal')).toBe(true);
      expect(isValidField('customField')).toBe(true);
      expect(isValidField('any_field_123')).toBe(true);
    });
  });

  describe('parseFieldValue', () => {
    it('should pass through string values', () => {
      expect(parseFieldValue('goal', 'Build a chat app')).toBe('Build a chat app');
      expect(parseFieldValue('customField', 'some text')).toBe('some text');
    });

    it('should parse JSON arrays', () => {
      const result = parseFieldValue('functionalRequirements', '["feat1", "feat2"]');
      expect(result).toEqual(['feat1', 'feat2']);
    });

    it('should parse JSON objects', () => {
      const result = parseFieldValue('scope', '{"included": ["a"], "excluded": ["b"]}');
      expect(result).toEqual({ included: ['a'], excluded: ['b'] });
    });

    it('should pass through raw string if JSON parsing fails', () => {
      expect(parseFieldValue('anyField', '{not valid json')).toBe('{not valid json');
    });

    it('should parse complex nested JSON', () => {
      const json = '{"performance":{"latency":"<100ms"},"security":{"tls":"required"}}';
      const result = parseFieldValue('qualityStandards', json);
      expect(result).toEqual({
        performance: { latency: '<100ms' },
        security: { tls: 'required' },
      });
    });
  });

  describe('getRequiredFieldStatuses', () => {
    const brief: Brief = {
      id: 'test-id',
      status: 'draft',
      fields: {
        fieldA: 'valueA',
        fieldB: '',
        fieldC: null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('should report set and missing statuses based on required fields list', () => {
      const statuses = getRequiredFieldStatuses(brief, ['fieldA', 'fieldB', 'fieldC', 'fieldD']);
      expect(statuses).toEqual({
        fieldA: 'set',
        fieldB: 'missing',
        fieldC: 'missing',
        fieldD: 'missing',
      });
    });

    it('should return empty object when no required fields are specified', () => {
      const statuses = getRequiredFieldStatuses(brief, []);
      expect(statuses).toEqual({});
    });
  });

  describe('getMissingRequiredFields', () => {
    const createMockBrief = (fields: Record<string, unknown>): Brief => ({
      id: 'test-id',
      status: 'draft',
      fields,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    it('should return all required fields when none are set', () => {
      const brief = createMockBrief({});
      const required = ['workType', 'goal', 'scope'];
      const missing = getMissingRequiredFields(brief, required);

      expect(missing).toEqual(['workType', 'goal', 'scope']);
    });

    it('should not include set fields', () => {
      const brief = createMockBrief({
        workType: 'software',
        goal: 'Test',
      });
      const required = ['workType', 'goal', 'scope'];
      const missing = getMissingRequiredFields(brief, required);

      expect(missing).not.toContain('workType');
      expect(missing).not.toContain('goal');
      expect(missing).toContain('scope');
    });

    it('should return empty array when all required fields are set', () => {
      const brief = createMockBrief({
        workType: 'software',
        goal: 'Test',
        scope: { included: ['feature A'] },
      });
      const required = ['workType', 'goal', 'scope'];
      const missing = getMissingRequiredFields(brief, required);

      expect(missing).toEqual([]);
    });

    it('should return empty array when no required fields are configured', () => {
      const brief = createMockBrief({});
      expect(getMissingRequiredFields(brief, [])).toEqual([]);
      expect(getMissingRequiredFields(brief)).toEqual([]);
    });
  });

  describe('isBriefComplete', () => {
    const createMockBrief = (fields: Record<string, unknown>): Brief => ({
      id: 'test-id',
      status: 'draft',
      fields,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    it('should be true when no required fields are specified (default)', () => {
      const brief = createMockBrief({});
      expect(isBriefComplete(brief)).toBe(true);
      expect(isBriefComplete(brief, [])).toBe(true);
    });

    it('should be false when required fields are missing', () => {
      const brief = createMockBrief({});
      expect(isBriefComplete(brief, ['goal', 'scope'])).toBe(false);
    });

    it('should be true when all specified required fields are set', () => {
      const brief = createMockBrief({
        goal: 'Test goal',
        scope: ['a', 'b'],
      });
      expect(isBriefComplete(brief, ['goal', 'scope'])).toBe(true);
    });

    it('should be false when only some required fields are set', () => {
      const brief = createMockBrief({
        goal: 'Test',
      });
      expect(isBriefComplete(brief, ['goal', 'scope'])).toBe(false);
    });
  });
});
