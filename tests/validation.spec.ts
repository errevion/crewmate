import { describe, it, expect } from 'vitest';
import {
  isValidField,
  parseFieldValue,
  getMissingRequiredFields,
  isBriefComplete,
  FIELD_FORMAT_HINTS,
} from '../src/utils/validation.js';
import { BRIEF_FIELDS, type Brief } from '../src/models/brief.js';

describe('validation', () => {
  describe('FIELD_FORMAT_HINTS', () => {
    it('should provide format hints for all valid brief fields', () => {
      for (const field of BRIEF_FIELDS) {
        expect(FIELD_FORMAT_HINTS[field]).toBeDefined();
        expect(typeof FIELD_FORMAT_HINTS[field]).toBe('string');
        expect(FIELD_FORMAT_HINTS[field].length).toBeGreaterThan(0);
      }
    });
  });
  describe('isValidField', () => {
    const validFields = [
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
    ];

    for (const field of validFields) {
      it(`should recognize "${field}" as valid`, () => {
        expect(isValidField(field)).toBe(true);
      });
    }

    it('should reject unknown fields', () => {
      expect(isValidField('invalidField')).toBe(false);
      expect(isValidField('work')).toBe(false);
      expect(isValidField('')).toBe(false);
    });
  });

  describe('parseFieldValue', () => {
    it('should validate workType enum values', () => {
      expect(parseFieldValue('workType', 'software')).toBe('software');
      expect(parseFieldValue('workType', 'infrastructure')).toBe('infrastructure');
      expect(parseFieldValue('workType', 'data')).toBe('data');
      expect(parseFieldValue('workType', 'documentation')).toBe('documentation');
      expect(parseFieldValue('workType', 'audit')).toBe('audit');
    });

    it('should throw on invalid workType value', () => {
      expect(() => parseFieldValue('workType', 'invalid')).toThrow(/Invalid workType/);
    });

    it('should pass through string values for goal', () => {
      expect(parseFieldValue('goal', 'Build a chat app')).toBe('Build a chat app');
    });

    it('should parse JSON arrays for functionalRequirements', () => {
      const result = parseFieldValue('functionalRequirements', '["feat1", "feat2"]');
      expect(result).toEqual(['feat1', 'feat2']);
    });

    it('should parse JSON objects for scope', () => {
      const result = parseFieldValue('scope', '{"included": ["a"], "excluded": ["b"]}');
      expect(result).toEqual({ included: ['a'], excluded: ['b'] });
    });

    it('should throw on invalid JSON with format hint', () => {
      expect(() => parseFieldValue('scope', '{invalid')).toThrow(
        /Expected format: \{"included": string\[\], "excluded": string\[\]\}/
      );
    });

    it('should throw on invalid structure for scope', () => {
      expect(() => parseFieldValue('scope', '{"invalid": true}')).toThrow(
        /Invalid structure for field "scope"/
      );
      expect(() => parseFieldValue('scope', '["item"]')).toThrow(
        /Invalid structure for field "scope"/
      );
    });

    it('should throw on invalid structure for array fields', () => {
      expect(() => parseFieldValue('functionalRequirements', '{"not": "an array"}')).toThrow(
        /Invalid structure for field "functionalRequirements"/
      );
      expect(() => parseFieldValue('acceptanceCriteria', '"plain string"')).toThrow(
        /Invalid structure for field "acceptanceCriteria"/
      );
    });

    it('should throw on invalid structure for technicalStack and constraints', () => {
      expect(() => parseFieldValue('technicalStack', '["not", "object"]')).toThrow(
        /Invalid structure for field "technicalStack"/
      );
      expect(() => parseFieldValue('technicalStack', '{"frontend": 123}')).toThrow(
        /Invalid structure for field "technicalStack"/
      );
      expect(() => parseFieldValue('constraints', '"not an object"')).toThrow(
        /Invalid structure for field "constraints"/
      );
      expect(() => parseFieldValue('constraints', '{"requirements": 123}')).toThrow(
        /Invalid structure for field "constraints"/
      );
    });

    it('should normalize string values in technicalStack and constraints to arrays', () => {
      const ts = parseFieldValue('technicalStack', '{"frontend": "React", "backend": ["Node"]}');
      expect(ts).toEqual({ frontend: ['React'], backend: ['Node'] });

      const constraints = parseFieldValue(
        'constraints',
        '{"requirements": "Node 20+", "exclusions": ["Cloud"]}'
      );
      expect(constraints).toEqual({ requirements: ['Node 20+'], exclusions: ['Cloud'] });
    });

    it('should throw on invalid structure for deliverables', () => {
      expect(() => parseFieldValue('deliverables', '{"type": "code"}')).toThrow(
        /Invalid structure for field "deliverables"/
      );
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

  describe('getMissingRequiredFields', () => {
    const createMockBrief = (overrides: Partial<Brief>): Brief => ({
      id: 'test-id',
      workType: null,
      goal: null,
      scope: null,
      functionalRequirements: null,
      technicalStack: null,
      constraints: null,
      existingCodebase: null,
      referenceMaterials: null,
      acceptanceCriteria: null,
      qualityStandards: null,
      dependencies: null,
      risks: null,
      deliverables: null,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    it('should return all required fields when none are set', () => {
      const brief = createMockBrief({});
      const missing = getMissingRequiredFields(brief);

      expect(missing).toEqual([
        'workType',
        'goal',
        'scope',
        'functionalRequirements',
        'acceptanceCriteria',
      ]);
    });

    it('should not include set fields', () => {
      const brief = createMockBrief({
        workType: 'software',
        goal: 'Test',
      });
      const missing = getMissingRequiredFields(brief);

      expect(missing).not.toContain('workType');
      expect(missing).not.toContain('goal');
      expect(missing).toContain('scope');
    });

    it('should return empty array when all required fields are set', () => {
      const brief = createMockBrief({
        workType: 'software',
        goal: 'Test',
        scope: { included: [], excluded: [] },
        functionalRequirements: [],
        acceptanceCriteria: [],
      });
      const missing = getMissingRequiredFields(brief);

      expect(missing).toEqual([]);
    });
  });

  describe('isBriefComplete', () => {
    const createMockBrief = (overrides: Partial<Brief>): Brief => ({
      id: 'test-id',
      workType: null,
      goal: null,
      scope: null,
      functionalRequirements: null,
      technicalStack: null,
      constraints: null,
      existingCodebase: null,
      referenceMaterials: null,
      acceptanceCriteria: null,
      qualityStandards: null,
      dependencies: null,
      risks: null,
      deliverables: null,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    it('should be false when no required fields are set', () => {
      const brief = createMockBrief({});
      expect(isBriefComplete(brief)).toBe(false);
    });

    it('should be true when all required fields are set', () => {
      const brief = createMockBrief({
        workType: 'software',
        goal: 'Test',
        scope: { included: [], excluded: [] },
        functionalRequirements: [],
        acceptanceCriteria: [],
      });
      expect(isBriefComplete(brief)).toBe(true);
    });

    it('should be false when only some required fields are set', () => {
      const brief = createMockBrief({
        workType: 'software',
        goal: 'Test',
      });
      expect(isBriefComplete(brief)).toBe(false);
    });
  });
});
