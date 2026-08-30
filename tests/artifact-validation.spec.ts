import { describe, it, expect } from 'vitest';
import {
  parseRelaxedObject,
  parseAndValidateArtifactPayload,
  summarizeArtifactContent,
  formatArtifactBody,
  escapeForBlessed,
} from '../src/utils/artifact-validation.js';
import { formatArtifactListItem, formatArtifactDetail } from '../src/commands/watch.js';
import type { ExecutionArtifact } from '../models/artifact.js';

describe('artifact validation & relaxed parsing', () => {
  it('should parse standard JSON objects', () => {
    const raw = JSON.stringify({ statement: 'TypeScript build configured', scope: 'project' });
    const parsed = parseRelaxedObject(raw);
    expect(parsed).toEqual({ statement: 'TypeScript build configured', scope: 'project' });
  });

  it('should parse unquoted JS object literal strings (from screenshot)', () => {
    const raw =
      '{files:[src/types/units.ts,src/utils/conversion.ts,src/utils/validation.ts],signatures:[lbsToKg,kgToLbs,imperialHeightToCm]}';
    const parsed = parseRelaxedObject(raw);
    expect(parsed).toBeDefined();
    expect(parsed?.files).toEqual([
      'src/types/units.ts',
      'src/utils/conversion.ts',
      'src/utils/validation.ts',
    ]);
    expect(parsed?.signatures).toEqual(['lbsToKg', 'kgToLbs', 'imperialHeightToCm']);
  });

  it('should escape curly braces for blessed tags so they are not swallowed', () => {
    const raw = '{files:[a.ts],signatures:[b]}';
    const escaped = escapeForBlessed(raw);
    expect(escaped).not.toContain('{');
    expect(escaped).not.toContain('}');
    expect(escaped).toContain('❴');
    expect(escaped).toContain('❵');
  });

  it('should handle unclosed / double-escaped JSON strings cleanly without raw JSON leaks', () => {
    const raw = '{"statement": "TypeScript build (tsc';
    const result = parseAndValidateArtifactPayload('fact', raw);
    expect(result.valid).toBe(true);

    const summary = summarizeArtifactContent('fact', result.rawString || raw);
    expect(summary).not.toContain('{"statement":');
    expect(summary).toContain('TypeScript build (tsc');
  });

  it('should unwrap nested object literal strings stored inside signature fields', () => {
    // Stored as {"signature":"{files:[src/a.ts],signatures:[fnA,fnB]}","filePath":""}
    const legacyRaw = JSON.stringify({
      signature:
        '{files:[src/types/units.ts,src/utils/conversion.ts],signatures:[lbsToKg,kgToLbs]}',
      filePath: '',
    });
    const body = formatArtifactBody('api_contract', legacyRaw);
    const joined = body.join('\n');
    expect(joined).toContain('Files:');
    expect(joined).toContain('src/types/units.ts');
    expect(joined).toContain('Contracts:');
    expect(joined).toContain('lbsToKg');
    expect(joined).not.toContain('{files:');
  });

  it('should format multi-line structured artifact bodies cleanly', () => {
    // API Contract with files & signatures
    const contractRaw =
      '{files:[src/types/units.ts,src/utils/conversion.ts],signatures:[lbsToKg,kgToLbs]}';
    const body = formatArtifactBody('api_contract', contractRaw);
    const joined = body.join('\n');
    expect(joined).toContain('Files:');
    expect(joined).toContain('src/types/units.ts');
    expect(joined).toContain('Contracts:');
    expect(joined).toContain('lbsToKg');

    // Constraint with severity & rule
    const constraintRaw = JSON.stringify({
      rule: 'UI elements rely on specific IDs (#unit-metric, #unit-imperial)',
      severity: 'must',
    });
    const constraintBody = formatArtifactBody('constraint', constraintRaw).join('\n');
    expect(constraintBody).toContain('Severity:');
    expect(constraintBody).toContain('[MUST]');
    expect(constraintBody).toContain('Rule:');
    expect(constraintBody).toContain('UI elements rely on specific IDs');
  });

  it('should format decisions with choice and rationale', () => {
    const decisionRaw = JSON.stringify({
      choice: 'Semantic dual-mode form and result cards layout',
      rationale: 'CSS Grid and Flexbox with WCAG AA compliance',
    });
    const decisionBody = formatArtifactBody('decision', decisionRaw).join('\n');
    expect(decisionBody).toContain('Choice:');
    expect(decisionBody).toContain('Semantic dual-mode form');
    expect(decisionBody).toContain('Rationale:');
    expect(decisionBody).toContain('CSS Grid and Flexbox');
  });

  it('should reject meaningless / punctuation-only artifact content', () => {
    expect(parseAndValidateArtifactPayload('decision', '{').valid).toBe(false);
    expect(parseAndValidateArtifactPayload('decision', '{}').valid).toBe(false);
    expect(parseAndValidateArtifactPayload('api_contract', '[]').valid).toBe(false);
    expect(parseAndValidateArtifactPayload('fact', '...').valid).toBe(false);
    expect(parseAndValidateArtifactPayload('constraint', '').valid).toBe(false);
    expect(parseAndValidateArtifactPayload('note', '   ').valid).toBe(false);
  });

  it('should format artifact list items and detail view for interactive navigation', () => {
    const artifact: ExecutionArtifact = {
      id: 'art-1234',
      taskId: 'task-1',
      briefId: 'brief-1',
      type: 'decision',
      content: JSON.stringify({
        choice: 'Use Tailwind CSS',
        rationale: 'Fast styling with utility classes',
      }),
      status: 'active',
      supersededBy: null,
      tags: ['ui', 'config'],
      createdAt: '2026-08-28 17:00:00',
    };

    const listItem = formatArtifactListItem(artifact);
    expect(listItem).toContain('[DECISION]');
    expect(listItem).toContain('[✓]');
    expect(listItem).toContain('Use Tailwind CSS');

    const detail = formatArtifactDetail(artifact);
    expect(detail).toContain('Artifact ID:');
    expect(detail).toContain('art-1234');
    expect(detail).toContain('Category:');
    expect(detail).toContain('DECISION');
    expect(detail).toContain('Choice:');
    expect(detail).toContain('Use Tailwind CSS');
    expect(detail).toContain('Rationale:');
    expect(detail).toContain('Fast styling with utility classes');
    expect(detail).toContain('Tags:');
    expect(detail).toContain('ui, config');
  });
});
