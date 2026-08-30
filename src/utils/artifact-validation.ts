import type {
  ArtifactType,
  FactPayload,
  DecisionPayload,
  ApiContractPayload,
  ConstraintPayload,
  NotePayload,
  LogPayload,
  StructuredArtifactPayload,
} from '../models/artifact.js';

/**
 * Result of validating and parsing an artifact payload
 */
export interface ValidationResult<T = StructuredArtifactPayload> {
  valid: boolean;
  data?: T;
  rawString?: string;
  error?: string;
}

/**
 * Safely attempts to parse a string that might be JSON, double-escaped JSON,
 * or an unquoted JavaScript object literal (e.g. `{ files: [a, b], signatures: [c] }`).
 */
export function parseRelaxedObject(input: string): Record<string, unknown> | null {
  if (!input || typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Try standard JSON.parse directly
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // If it was double-encoded JSON string
    if (typeof parsed === 'string') {
      const nested = parseRelaxedObject(parsed);
      if (nested) {
        return nested;
      }
    }
  } catch {
    // Continue to fallback parsing
  }

  // 2. Try parsing JS object literal / relaxed syntax
  // Handles: {files:[src/a.ts,src/b.ts],signatures:[foo,bar]}
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return {};
    }

    // Try converting unquoted keys and unquoted array elements to valid JSON
    try {
      let jsonCandidate = trimmed
        // Quote unquoted keys: key: -> "key":
        .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
        // Fix trailing commas
        .replace(/,\s*([}\]])/g, '$1');

      // For unquoted strings in arrays: ["foo", bar, 123] -> ["foo", "bar", 123]
      jsonCandidate = jsonCandidate.replace(/\[([^\]]+)\]/g, (_match, arrayContent) => {
        const items = arrayContent
          .split(',')
          .map((item: string) => {
            const trimmedItem = item.trim();
            if (!trimmedItem) {
              return '';
            }
            if (
              (trimmedItem.startsWith('"') && trimmedItem.endsWith('"')) ||
              (trimmedItem.startsWith("'") && trimmedItem.endsWith("'")) ||
              trimmedItem === 'true' ||
              trimmedItem === 'false' ||
              trimmedItem === 'null' ||
              !Number.isNaN(Number(trimmedItem))
            ) {
              return trimmedItem.startsWith("'") ? `"${trimmedItem.slice(1, -1)}"` : trimmedItem;
            }
            return `"${trimmedItem.replace(/"/g, '\\"')}"`;
          })
          .filter(Boolean);
        return `[${items.join(',')}]`;
      });

      const parsed = JSON.parse(jsonCandidate);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue to regex field extraction
    }

    // 3. Fallback: manual regex extraction for common keys
    const extracted: Record<string, unknown> = {};

    // Extract arrays: key:[...]
    const arrayRegex = /([a-zA-Z0-9_$]+)\s*:\s*\[([^\]]*)\]/g;
    let match = arrayRegex.exec(inner);
    while (match !== null) {
      const key = match[1];
      const rawItems = match[2];
      const items = rawItems
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      extracted[key] = items;
      match = arrayRegex.exec(inner);
    }

    // Extract strings: key: "value" or key: value
    const strRegex = /([a-zA-Z0-9_$]+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,{}]+))/g;
    let strMatch = strRegex.exec(inner);
    while (strMatch !== null) {
      const key = strMatch[1];
      if (!(key in extracted)) {
        const val = (strMatch[2] ?? strMatch[3] ?? strMatch[4] ?? '').trim();
        if (val && !val.startsWith('[')) {
          extracted[key] = val;
        }
      }
      strMatch = strRegex.exec(inner);
    }

    if (Object.keys(extracted).length > 0) {
      return extracted;
    }
  }

  // 4. Check if text has key-value lines (e.g. "Rule: ...\nSeverity: ...")
  const kvLines = trimmed.split(/\r?\n/);
  if (kvLines.length > 1) {
    const extracted: Record<string, string> = {};
    for (const line of kvLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < 30) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const val = line.slice(colonIdx + 1).trim();
        if (key && val) {
          extracted[key] = val;
        }
      }
    }
    if (Object.keys(extracted).length > 1) {
      return extracted;
    }
  }

  return null;
}

/**
 * Escapes curly braces in dynamic user content so Blessed doesn't swallow them as formatting tags
 */
export function escapeForBlessed(str: string): string {
  if (!str) {
    return '';
  }
  return String(str).replace(/\{/g, '❴').replace(/\}/g, '❵');
}

/**
 * Cleans string from accidental raw JSON quotation artifacts
 */
function cleanTextValue(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }
  const str = String(val).trim();
  // If string contains escaped JSON wrappers like {"statement": "..."}
  if (str.startsWith('{"') || str.startsWith('{\\"') || str.startsWith('{')) {
    const parsed = parseRelaxedObject(str);
    if (parsed) {
      if (parsed.statement) {
        return cleanTextValue(parsed.statement);
      }
      if (parsed.choice) {
        return cleanTextValue(parsed.choice);
      }
      if (parsed.rule) {
        return cleanTextValue(parsed.rule);
      }
      if (parsed.signature) {
        return cleanTextValue(parsed.signature);
      }
      if (parsed.signatures && Array.isArray(parsed.signatures)) {
        return parsed.signatures
          .map((s) => cleanTextValue(s))
          .filter(Boolean)
          .join(', ');
      }
      if (parsed.files && Array.isArray(parsed.files)) {
        return parsed.files
          .map((f) => cleanTextValue(f))
          .filter(Boolean)
          .join(', ');
      }
      if (parsed.summary) {
        return cleanTextValue(parsed.summary);
      }
    }

    // Handle partial / unclosed JSON like {"statement": "some text...
    const match = str.match(
      /^{?\s*\\?"?(?:statement|choice|rule|signature|signatures|files|summary|fact|decision|constraint|note|log)\\?"?\s*:\s*\\?"?([\s\S]+?)\\?"?\s*}?$/i
    );
    if (match && match[1]) {
      return cleanTextValue(match[1].trim().replace(/^\\?"|\\?"$/g, ''));
    }
  }
  return str;
}

/**
 * Checks if a string has actual meaningful content (not just punctuation, quotes, or braces)
 */
export function isMeaningfulContent(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  const stripped = str
    .trim()
    .replace(/^[\s{}[\]"':;,.*`~_()\-+=|\\/]+|[\s{}[\]"':;,.*`~_()\-+=|\\/]+$/g, '');
  return stripped.length >= 3;
}

/**
 * Validates and normalizes artifact payloads
 */
export function parseAndValidateArtifactPayload(
  type: ArtifactType,
  rawContent: string
): ValidationResult {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return { valid: false, error: 'Artifact content cannot be empty' };
  }

  const parsed = parseRelaxedObject(trimmed);

  switch (type) {
    case 'fact': {
      if (parsed) {
        const statement = cleanTextValue(parsed.statement ?? parsed.fact ?? parsed.info);
        if (statement && isMeaningfulContent(statement)) {
          const payload: FactPayload = {
            statement,
            evidence: parsed.evidence ? cleanTextValue(parsed.evidence) : undefined,
            scope: ['project', 'module', 'file'].includes(parsed.scope as string)
              ? (parsed.scope as 'project' | 'module' | 'file')
              : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const statement = cleanTextValue(trimmed);
      if (!isMeaningfulContent(statement)) {
        return {
          valid: false,
          error: 'Fact statement must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: FactPayload = {
        statement,
        scope: 'project',
      };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'decision': {
      if (parsed) {
        const choice = cleanTextValue(parsed.choice ?? parsed.decision ?? parsed.title);
        if (choice && isMeaningfulContent(choice)) {
          const rationale =
            cleanTextValue(parsed.rationale ?? parsed.why ?? parsed.reason) ||
            'Documented decision';
          let alternatives: string[] | undefined;
          if (Array.isArray(parsed.alternatives)) {
            alternatives = parsed.alternatives.map((a) => cleanTextValue(a)).filter(Boolean);
          }
          const payload: DecisionPayload = {
            choice,
            rationale,
            alternatives: alternatives && alternatives.length > 0 ? alternatives : undefined,
            reversible: typeof parsed.reversible === 'boolean' ? parsed.reversible : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const choice = cleanTextValue(trimmed);
      if (!isMeaningfulContent(choice)) {
        return {
          valid: false,
          error: 'Decision choice must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: DecisionPayload = {
        choice,
        rationale: 'Documented architectural choice',
        reversible: true,
      };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'api_contract': {
      if (parsed) {
        // Handle variations: { files: [...], signatures: [...] } or { filePath: ..., signature: ... }
        let signature = cleanTextValue(parsed.signature ?? parsed.exports);
        let filePath = cleanTextValue(parsed.filePath ?? parsed.path ?? parsed.file);

        if (!signature && Array.isArray(parsed.signatures)) {
          signature = parsed.signatures
            .map((s) => cleanTextValue(s))
            .filter(Boolean)
            .join(', ');
        }
        if (!filePath && Array.isArray(parsed.files)) {
          filePath = parsed.files
            .map((f) => cleanTextValue(f))
            .filter(Boolean)
            .join(', ');
        }

        if (
          (signature && isMeaningfulContent(signature)) ||
          (filePath && isMeaningfulContent(filePath))
        ) {
          const exportName = parsed.exportName ? cleanTextValue(parsed.exportName) : undefined;
          let consumers: string[] | undefined;
          if (Array.isArray(parsed.consumers)) {
            consumers = parsed.consumers.map((c) => cleanTextValue(c)).filter(Boolean);
          }
          const payload: ApiContractPayload = {
            signature: signature || filePath,
            filePath: filePath || '',
            exportName,
            consumers: consumers && consumers.length > 0 ? consumers : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }

      const signature = cleanTextValue(trimmed);
      if (!isMeaningfulContent(signature)) {
        return {
          valid: false,
          error:
            'API contract signature or file path must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: ApiContractPayload = {
        signature,
        filePath: '',
      };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'constraint': {
      if (parsed) {
        const rule = cleanTextValue(parsed.rule ?? parsed.constraint ?? parsed.boundary);
        if (rule && isMeaningfulContent(rule)) {
          const rawSeverity = String(parsed.severity ?? '').toLowerCase();
          const severity = ['must', 'should', 'prefer'].includes(rawSeverity)
            ? (rawSeverity as 'must' | 'should' | 'prefer')
            : 'must';
          const payload: ConstraintPayload = {
            rule,
            severity,
            scope: parsed.scope ? cleanTextValue(parsed.scope) : undefined,
            violation: parsed.violation ? cleanTextValue(parsed.violation) : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }

      const rule = cleanTextValue(trimmed);
      if (!isMeaningfulContent(rule)) {
        return {
          valid: false,
          error: 'Constraint rule must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: ConstraintPayload = {
        rule,
        severity: 'must',
      };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'note': {
      if (parsed) {
        const summary = cleanTextValue(parsed.summary ?? parsed.content ?? parsed.note);
        if (summary && isMeaningfulContent(summary)) {
          const payload: NotePayload = {
            summary,
            details: parsed.details ? cleanTextValue(parsed.details) : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const summary = cleanTextValue(trimmed);
      if (!isMeaningfulContent(summary)) {
        return {
          valid: false,
          error: 'Note summary must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: NotePayload = { summary };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'log': {
      if (parsed) {
        const summary = cleanTextValue(parsed.summary ?? parsed.log ?? parsed.output);
        if (summary && isMeaningfulContent(summary)) {
          const payload: LogPayload = {
            summary,
            details: parsed.details ? cleanTextValue(parsed.details) : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const summary = cleanTextValue(trimmed);
      if (!isMeaningfulContent(summary)) {
        return {
          valid: false,
          error: 'Log summary must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: LogPayload = { summary };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    default:
      return { valid: false, error: `Unsupported artifact type: ${type}` };
  }
}

/**
 * Extracts a human-friendly single-line summary from any artifact content string
 */
export function summarizeArtifactContent(type: ArtifactType, content: string): string {
  if (!content) {
    return '';
  }
  const parsed = parseRelaxedObject(content);
  if (parsed) {
    if (parsed.statement) {
      return cleanTextValue(parsed.statement);
    }
    if (parsed.choice) {
      const rationale = parsed.rationale ? ` (${cleanTextValue(parsed.rationale)})` : '';
      return `${cleanTextValue(parsed.choice)}${rationale}`;
    }
    if (parsed.signature || parsed.filePath || parsed.files || parsed.signatures) {
      const files = parsed.filePath
        ? cleanTextValue(parsed.filePath)
        : Array.isArray(parsed.files)
          ? parsed.files.join(', ')
          : '';
      const sigs = parsed.signature
        ? cleanTextValue(parsed.signature)
        : Array.isArray(parsed.signatures)
          ? parsed.signatures.join(', ')
          : '';
      if (files && sigs && files !== sigs) {
        return `[${files}] ${sigs}`;
      }
      return sigs || files;
    }
    if (parsed.rule) {
      const sev = parsed.severity ? `[${String(parsed.severity).toUpperCase()}] ` : '';
      return `${sev}${cleanTextValue(parsed.rule)}`;
    }
    if (parsed.summary) {
      return cleanTextValue(parsed.summary);
    }
  }
  return cleanTextValue(content.split(/\r?\n/)[0].slice(0, 120));
}

/**
 * Formats structured artifact content into clean, readable multi-line tagged lines for display
 */
export function formatArtifactBody(type: ArtifactType, content: string): string[] {
  if (!content) {
    return [];
  }
  const parsed = parseRelaxedObject(content);
  const lines: string[] = [];

  if (!parsed) {
    const cleaned = escapeForBlessed(cleanTextValue(content));
    lines.push(`  ${cleaned}`);
    return lines;
  }

  switch (type) {
    case 'api_contract': {
      let contractSource = parsed;
      // If parsed.signature is itself an object literal or JSON string with files/signatures
      if (
        typeof parsed.signature === 'string' &&
        parsed.signature.trim().startsWith('{') &&
        parsed.signature.includes(':')
      ) {
        const nested = parseRelaxedObject(parsed.signature);
        if (nested) {
          contractSource = { ...parsed, ...nested };
        }
      }

      const files = contractSource.filePath
        ? cleanTextValue(contractSource.filePath)
        : Array.isArray(contractSource.files)
          ? contractSource.files.map((f) => cleanTextValue(f)).join(', ')
          : '';
      const signatures = contractSource.signature
        ? cleanTextValue(contractSource.signature)
        : Array.isArray(contractSource.signatures)
          ? contractSource.signatures.map((s) => cleanTextValue(s)).join(', ')
          : '';
      const exportName = contractSource.exportName ? cleanTextValue(contractSource.exportName) : '';
      const consumers =
        Array.isArray(contractSource.consumers) && contractSource.consumers.length > 0
          ? contractSource.consumers.map((c) => cleanTextValue(c)).join(', ')
          : '';

      if (files) {
        lines.push(`  {bold}Files:{/bold}      {white-fg}${escapeForBlessed(files)}{/white-fg}`);
      }
      if (exportName) {
        lines.push(`  {bold}Export:{/bold}     {cyan-fg}${escapeForBlessed(exportName)}{/cyan-fg}`);
      }
      if (signatures && signatures !== files) {
        lines.push(
          `  {bold}Contracts:{/bold}  {yellow-fg}${escapeForBlessed(signatures)}{/yellow-fg}`
        );
      }
      if (consumers) {
        lines.push(`  {bold}Consumers:{/bold}  {gray-fg}${escapeForBlessed(consumers)}{/gray-fg}`);
      }
      break;
    }

    case 'constraint': {
      const rule = cleanTextValue(parsed.rule ?? parsed.constraint);
      const severity = String(parsed.severity ?? 'must').toUpperCase();
      const scope = parsed.scope ? cleanTextValue(parsed.scope) : '';
      const violation = parsed.violation ? cleanTextValue(parsed.violation) : '';

      const sevColor = severity === 'MUST' ? 'red' : severity === 'SHOULD' ? 'yellow' : 'cyan';
      lines.push(
        `  {bold}Severity:{/bold}   {bold}{${sevColor}-fg}[${severity}]{/${sevColor}-fg}{/bold}${scope ? ` · {gray-fg}scope: ${escapeForBlessed(scope)}{/gray-fg}` : ''}`
      );
      if (rule) {
        lines.push(`  {bold}Rule:{/bold}       {white-fg}${escapeForBlessed(rule)}{/white-fg}`);
      }
      if (violation) {
        lines.push(`  {bold}Violation:{/bold}  {red-fg}${escapeForBlessed(violation)}{/red-fg}`);
      }
      break;
    }

    case 'decision': {
      const choice = cleanTextValue(parsed.choice ?? parsed.decision);
      const rationale = cleanTextValue(parsed.rationale ?? parsed.why);
      const alternatives =
        Array.isArray(parsed.alternatives) && parsed.alternatives.length > 0
          ? parsed.alternatives.map((a) => cleanTextValue(a)).join(', ')
          : '';

      if (choice) {
        lines.push(`  {bold}Choice:{/bold}     {white-fg}${escapeForBlessed(choice)}{/white-fg}`);
      }
      if (rationale && rationale !== 'Documented decision') {
        lines.push(`  {bold}Rationale:{/bold}  {gray-fg}${escapeForBlessed(rationale)}{/gray-fg}`);
      }
      if (alternatives) {
        lines.push(
          `  {bold}Rejected:{/bold}   {gray-fg}${escapeForBlessed(alternatives)}{/gray-fg}`
        );
      }
      break;
    }

    case 'fact': {
      const statement = cleanTextValue(parsed.statement ?? parsed.fact);
      const evidence = parsed.evidence ? cleanTextValue(parsed.evidence) : '';
      const scope = parsed.scope ? cleanTextValue(parsed.scope) : '';

      if (statement) {
        lines.push(
          `  • {white-fg}${escapeForBlessed(statement)}{/white-fg}${scope ? ` {gray-fg}(${escapeForBlessed(scope)}){/gray-fg}` : ''}`
        );
      }
      if (evidence) {
        lines.push(`    {gray-fg}evidence: ${escapeForBlessed(evidence)}{/gray-fg}`);
      }
      break;
    }

    case 'note':
    case 'log': {
      const summary = cleanTextValue(parsed.summary ?? parsed.content);
      const details = parsed.details ? cleanTextValue(parsed.details) : '';
      if (summary) {
        lines.push(`  {white-fg}${escapeForBlessed(summary)}{/white-fg}`);
      }
      if (details) {
        lines.push(`    {gray-fg}${escapeForBlessed(details)}{/gray-fg}`);
      }
      break;
    }
  }

  if (lines.length === 0) {
    lines.push(`  ${escapeForBlessed(cleanTextValue(content))}`);
  }

  return lines;
}
