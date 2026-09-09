import type {
  ArtifactType,
  ArtifactOutcome,
  FactPayload,
  DecisionPayload,
  ApiContractPayload,
  ConstraintPayload,
  NotePayload,
  LogPayload,
  IssuePayload,
  AttemptPayload,
  FixPayload,
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
 * Detects if a string is base64 encoded and decodes it safely to UTF-8.
 * Returns null if the string is not valid base64 or decodes to non-text / binary.
 */
export function tryDecodeBase64(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (trimmed.length < 8 || trimmed.includes('\n') || trimmed.includes(' ')) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return null;
  }

  const isLikelyBase64 = trimmed.startsWith('ey') || trimmed.endsWith('=') || trimmed.length >= 20;
  if (!isLikelyBase64) {
    return null;
  }

  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 0) {
      return null;
    }
    const decoded = buf.toString('utf-8');
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        return null;
      }
    }
    const decodedTrimmed = decoded.trim();
    if (
      decodedTrimmed.startsWith('{') ||
      decodedTrimmed.startsWith('[') ||
      decoded.includes(' ') ||
      decoded.length >= 4
    ) {
      return decoded;
    }
  } catch {
    return null;
  }
  return null;
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

  const b64 = tryDecodeBase64(trimmed);
  if (b64) {
    const parsedB64 = parseRelaxedObject(b64);
    if (parsedB64) {
      return parsedB64;
    }
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
  const b64 = tryDecodeBase64(str);
  if (b64) {
    return cleanTextValue(b64);
  }
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
 * Extracts the file path from a location string, stripping line/column suffixes.
 * Handles formats: file:line:col, file:line, file, and Windows drive prefixes.
 */
export function locationToFile(location: string | null | undefined): string | null {
  if (!location || typeof location !== 'string') {
    return null;
  }
  const trimmed = location.trim();
  if (!trimmed) {
    return null;
  }

  const driveMatch = /^([A-Za-z]:[/\\])/.exec(trimmed);
  if (driveMatch) {
    const rest = trimmed.slice(driveMatch[1].length);
    const sepIdx = rest.lastIndexOf(':');
    if (sepIdx > 0) {
      const afterSep = rest.slice(sepIdx + 1);
      if (/^\d+(?::\d+)?$/.test(afterSep)) {
        return driveMatch[1] + rest.slice(0, sepIdx);
      }
    }
    return trimmed;
  }

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) {
    return trimmed;
  }
  const afterColon = trimmed.slice(lastColon + 1);
  if (/^\d+(?::\d+)?$/.test(afterColon)) {
    const beforeColon = trimmed.slice(0, lastColon);
    const prevColon = beforeColon.lastIndexOf(':');
    if (prevColon > 0 && /^\d+$/.test(beforeColon.slice(prevColon + 1))) {
      return beforeColon.slice(0, prevColon);
    }
    return beforeColon;
  }
  return trimmed;
}

/**
 *
 */
export function parseAndValidateArtifactPayload(
  type: ArtifactType,
  rawContent: string
): ValidationResult {
  let trimmed = rawContent.trim();
  if (!trimmed) {
    return { valid: false, error: 'Artifact content cannot be empty' };
  }

  const b64 = tryDecodeBase64(trimmed);
  if (b64) {
    trimmed = b64.trim();
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

    case 'issue': {
      if (parsed) {
        const summary = cleanTextValue(parsed.summary ?? parsed.issue ?? parsed.bug);
        if (summary && isMeaningfulContent(summary)) {
          const payload: IssuePayload = {
            summary,
            location: parsed.location ? cleanTextValue(parsed.location) : undefined,
            issueNumber: parsed.issueNumber ? cleanTextValue(parsed.issueNumber) : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const summary = cleanTextValue(trimmed);
      if (!isMeaningfulContent(summary)) {
        return {
          valid: false,
          error: 'Issue summary must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: IssuePayload = { summary };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'attempt': {
      if (parsed) {
        const summary = cleanTextValue(parsed.summary ?? parsed.attempt ?? parsed.approach);
        if (summary && isMeaningfulContent(summary)) {
          const rawOutcome = String(parsed.outcome ?? '').toLowerCase();
          const outcome: ArtifactOutcome = (['worked', 'failed', 'partial'] as const).includes(
            rawOutcome as ArtifactOutcome
          )
            ? (rawOutcome as ArtifactOutcome)
            : 'failed';
          const payload: AttemptPayload = {
            summary,
            outcome,
            location: parsed.location ? cleanTextValue(parsed.location) : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const summary = cleanTextValue(trimmed);
      if (!isMeaningfulContent(summary)) {
        return {
          valid: false,
          error: 'Attempt summary must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: AttemptPayload = { summary, outcome: 'failed' };
      return { valid: true, data: payload, rawString: JSON.stringify(payload) };
    }

    case 'fix': {
      if (parsed) {
        const summary = cleanTextValue(parsed.summary ?? parsed.fix ?? parsed.solution);
        if (summary && isMeaningfulContent(summary)) {
          const payload: FixPayload = {
            summary,
            location: parsed.location ? cleanTextValue(parsed.location) : undefined,
          };
          return { valid: true, data: payload, rawString: JSON.stringify(payload) };
        }
      }
      const summary = cleanTextValue(trimmed);
      if (!isMeaningfulContent(summary)) {
        return {
          valid: false,
          error: 'Fix summary must contain meaningful text (not empty or punctuation only)',
        };
      }
      const payload: FixPayload = { summary };
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
    if (type === 'issue' && (parsed.summary || parsed.issue || parsed.bug)) {
      const summary = cleanTextValue(parsed.summary ?? parsed.issue ?? parsed.bug);
      const prefix = parsed.issueNumber ? `#${cleanTextValue(parsed.issueNumber)} ` : '';
      return `${prefix}${summary}`;
    }
    if (type === 'attempt' && (parsed.summary || parsed.attempt || parsed.approach)) {
      const summary = cleanTextValue(parsed.summary ?? parsed.attempt ?? parsed.approach);
      const outcome = String(parsed.outcome ?? 'failed').toUpperCase();
      return `[${outcome}] ${summary}`;
    }
    if (type === 'fix' && (parsed.summary || parsed.fix || parsed.solution)) {
      const summary = cleanTextValue(parsed.summary ?? parsed.fix ?? parsed.solution);
      return summary;
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

    case 'issue': {
      const summary = cleanTextValue(parsed.summary ?? parsed.issue ?? parsed.bug);
      const location = parsed.location ? cleanTextValue(parsed.location) : '';
      const issueNumber = parsed.issueNumber ? cleanTextValue(parsed.issueNumber) : '';

      if (summary) {
        const prefix = issueNumber ? `{cyan-fg}#${escapeForBlessed(issueNumber)}{/cyan-fg} ` : '';
        lines.push(`  ${prefix}{white-fg}${escapeForBlessed(summary)}{/white-fg}`);
      }
      if (location) {
        lines.push(`  {bold}Location:{/bold}   {gray-fg}${escapeForBlessed(location)}{/gray-fg}`);
      }
      break;
    }

    case 'attempt': {
      const summary = cleanTextValue(parsed.summary ?? parsed.attempt ?? parsed.approach);
      const rawOutcome = String(parsed.outcome ?? 'failed').toLowerCase();
      const outcome = (['worked', 'failed', 'partial'] as const).includes(
        rawOutcome as ArtifactOutcome
      )
        ? rawOutcome
        : 'failed';
      const location = parsed.location ? cleanTextValue(parsed.location) : '';

      const outcomeColor = outcome === 'worked' ? 'green' : outcome === 'failed' ? 'red' : 'yellow';
      lines.push(
        `  {bold}{${outcomeColor}-fg}[${outcome.toUpperCase()}]{/${outcomeColor}-fg}{/bold}`
      );
      if (summary) {
        lines.push(`  {white-fg}${escapeForBlessed(summary)}{/white-fg}`);
      }
      if (location) {
        lines.push(`  {bold}Location:{/bold}   {gray-fg}${escapeForBlessed(location)}{/gray-fg}`);
      }
      break;
    }

    case 'fix': {
      const summary = cleanTextValue(parsed.summary ?? parsed.fix ?? parsed.solution);
      const location = parsed.location ? cleanTextValue(parsed.location) : '';

      if (summary) {
        lines.push(`  {white-fg}${escapeForBlessed(summary)}{/white-fg}`);
      }
      if (location) {
        lines.push(`  {bold}Location:{/bold}   {gray-fg}${escapeForBlessed(location)}{/gray-fg}`);
      }
      break;
    }
  }

  if (lines.length === 0) {
    lines.push(`  ${escapeForBlessed(cleanTextValue(content))}`);
  }

  return lines;
}
