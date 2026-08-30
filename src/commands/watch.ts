import type { Command } from 'commander';
import blessedModule from 'blessed';
import { buildSnapshot, type WorkflowSnapshot } from '../utils/snapshot.js';
import { renderGraph } from '../utils/graph.js';
import { SPINNERS } from '../utils/ascii.js';
import type { ExecutionEvent } from '../models/event.js';
import { listBriefs, resolveBrief } from '../db/brief-repo.js';
import type { Brief, Deliverable } from '../models/brief.js';
import { getDb } from '../db/connection.js';
import { getTaskById, listTasksByBrief } from '../db/task-repo.js';
import type { Task } from '../models/task.js';
import { listLocks } from '../db/lock-repo.js';
import { listEvents } from '../db/event-repo.js';
import { listArtifacts, getArtifactById } from '../db/artifact-repo.js';
import type { FileLock } from '../models/lock.js';
import type { ExecutionArtifact, ArtifactType } from '../models/artifact.js';
import { formatArtifactBody, summarizeArtifactContent } from '../utils/artifact-validation.js';

// Resolve blessed default export for CJS/ESM interop
const blessed = ((blessedModule as unknown as { default?: typeof blessedModule }).default ||
  blessedModule) as unknown as typeof blessedModule;

interface WatchOptions {
  brief?: string;
  interval?: string;
  once?: boolean;
}

const DEFAULT_INTERVAL_MS = 500;
const ANIMATION_TICK_MS = 100;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Formats a timestamp into local HH:mm:ss for display
 *
 * @param createdAt UTC or ISO timestamp string
 * @returns Local time formatted as HH:mm:ss
 */
export function formatTime(createdAt: string): string {
  let dateStr = createdAt;
  if (!dateStr.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(dateStr)) {
    dateStr = dateStr.includes('T') ? `${dateStr}Z` : `${dateStr.replace(' ', 'T')}Z`;
  }
  let date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    date = new Date(createdAt);
  }
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Helper to safely extract an array of strings from a field value (string or array)
 *
 * @param val The value to convert to a string array
 * @returns Array of non-empty strings
 */
function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map(String).filter((s) => s.trim().length > 0);
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    return [val.trim()];
  }
  return [];
}

/**
 * Formats a brief for the brief selector list item
 *
 * @param brief The brief to format
 * @returns Tagged string representation for the brief list item
 */
export function formatBriefListItem(brief: Brief): string {
  const statusBadge =
    brief.status === 'complete'
      ? '{green-fg}[complete]{/green-fg}'
      : '{yellow-fg}[draft]{/yellow-fg}';

  const goalText = brief.goal ? truncate(brief.goal.replace(/\s+/g, ' ').trim(), 40) : '(no goal)';
  const time = formatTime(brief.updatedAt || brief.createdAt);

  return `${statusBadge} {bold}${brief.id}{/bold} ${goalText} {gray-fg}[${time}]{/gray-fg}`;
}

/**
 * Formats a project brief into a tagged string for display in the TUI overlay modal
 *
 * @param brief The brief to format, or null if not found
 * @returns Tagged string representation of the brief
 */
export function formatBriefDetails(brief: Brief | null): string {
  if (!brief) {
    return '{yellow-fg}No brief found.{/yellow-fg}\n\nRun /brief or `crewmate brief init` to create one.';
  }

  const lines: string[] = [];
  lines.push(`{bold}{cyan-fg}Brief ID:{/cyan-fg}{/bold} ${brief.id}`);
  lines.push(
    `{bold}{cyan-fg}Status:{/cyan-fg}{/bold} ${
      brief.status === 'complete' ? '{green-fg}complete{/green-fg}' : '{yellow-fg}draft{/yellow-fg}'
    }`
  );
  lines.push(
    `{bold}{cyan-fg}Work Type:{/cyan-fg}{/bold} ${brief.workType ?? '{gray-fg}(not set){/gray-fg}'}`
  );
  lines.push(
    `{bold}{cyan-fg}Goal:{/cyan-fg}{/bold} ${brief.goal ?? '{gray-fg}(not set){/gray-fg}'}`
  );
  lines.push(
    `{bold}{cyan-fg}Created:{/cyan-fg}{/bold} ${brief.createdAt} · {bold}{cyan-fg}Updated:{/cyan-fg}{/bold} ${brief.updatedAt}`
  );
  lines.push('');

  // Scope
  lines.push(
    '{bold}{yellow-fg}── Scope ──────────────────────────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.scope) {
    const included = toStringArray(brief.scope.included);
    const excluded = toStringArray(brief.scope.excluded);
    if (included.length) {
      lines.push('  {bold}Included:{/bold}');
      for (const inc of included) {
        lines.push(`    • ${inc}`);
      }
    }
    if (excluded.length) {
      lines.push('  {bold}Excluded:{/bold}');
      for (const exc of excluded) {
        lines.push(`    • ${exc}`);
      }
    }
    if (!included.length && !excluded.length) {
      lines.push('  {gray-fg}(empty scope){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }
  lines.push('');

  // Functional Requirements
  lines.push(
    '{bold}{yellow-fg}── Functional Requirements ───────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.functionalRequirements) {
    const reqs = toStringArray(brief.functionalRequirements);
    if (reqs.length) {
      reqs.forEach((req, i) => lines.push(`  ${i + 1}. ${req}`));
    } else {
      lines.push('  {gray-fg}(not set){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }
  lines.push('');

  // Acceptance Criteria
  lines.push(
    '{bold}{yellow-fg}── Acceptance Criteria ───────────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.acceptanceCriteria) {
    const crits = toStringArray(brief.acceptanceCriteria);
    if (crits.length) {
      crits.forEach((crit, i) => lines.push(`  ${i + 1}. ${crit}`));
    } else {
      lines.push('  {gray-fg}(not set){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }
  lines.push('');

  // Technical Stack
  lines.push(
    '{bold}{yellow-fg}── Technical Stack ───────────────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.technicalStack) {
    const ts = brief.technicalStack;
    const fe = toStringArray(ts.frontend);
    const be = toStringArray(ts.backend);
    const db = toStringArray(ts.database);
    const tl = toStringArray(ts.tools);

    if (fe.length) {
      lines.push(`  {bold}Frontend:{/bold} ${fe.join(', ')}`);
    }
    if (be.length) {
      lines.push(`  {bold}Backend:{/bold} ${be.join(', ')}`);
    }
    if (db.length) {
      lines.push(`  {bold}Database:{/bold} ${db.join(', ')}`);
    }
    if (tl.length) {
      lines.push(`  {bold}Tools:{/bold} ${tl.join(', ')}`);
    }
    if (!fe.length && !be.length && !db.length && !tl.length) {
      lines.push('  {gray-fg}(empty stack){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }
  lines.push('');

  // Constraints
  lines.push(
    '{bold}{yellow-fg}── Constraints ───────────────────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.constraints) {
    const reqs = toStringArray(brief.constraints.requirements);
    const excs = toStringArray(brief.constraints.exclusions);
    if (reqs.length) {
      lines.push('  {bold}Requirements:{/bold}');
      for (const r of reqs) {
        lines.push(`    • ${r}`);
      }
    }
    if (excs.length) {
      lines.push('  {bold}Exclusions:{/bold}');
      for (const e of excs) {
        lines.push(`    • ${e}`);
      }
    }
    if (!reqs.length && !excs.length) {
      lines.push('  {gray-fg}(empty constraints){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }
  lines.push('');

  // Deliverables
  lines.push(
    '{bold}{yellow-fg}── Deliverables ──────────────────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.deliverables) {
    const dels = Array.isArray(brief.deliverables) ? brief.deliverables : [brief.deliverables];
    if (dels.length) {
      for (const d of dels) {
        if (typeof d === 'object' && d !== null) {
          const item = d as Partial<Deliverable>;
          lines.push(`  • [${item.type ?? 'item'}] (${item.format ?? 'format'})`);
        } else {
          lines.push(`  • ${String(d)}`);
        }
      }
    } else {
      lines.push('  {gray-fg}(not set){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }
  lines.push('');

  // Dependencies & Risks
  lines.push(
    '{bold}{yellow-fg}── Dependencies & Risks ──────────────────────────{/yellow-fg}{/bold}'
  );
  const deps = toStringArray(brief.dependencies);
  const risks = toStringArray(brief.risks);
  if (deps.length) {
    lines.push('  {bold}Dependencies:{/bold}');
    for (const d of deps) {
      lines.push(`    • ${d}`);
    }
  }
  if (risks.length) {
    lines.push('  {bold}Risks:{/bold}');
    for (const r of risks) {
      lines.push(`    • ${r}`);
    }
  }
  if (!deps.length && !risks.length) {
    lines.push('  {gray-fg}(none){/gray-fg}');
  }
  lines.push('');

  // References & Existing Codebase
  lines.push(
    '{bold}{yellow-fg}── References & Codebase ─────────────────────────{/yellow-fg}{/bold}'
  );
  const codebase = toStringArray(brief.existingCodebase);
  const refs = toStringArray(brief.referenceMaterials);
  if (codebase.length) {
    lines.push('  {bold}Existing Codebase:{/bold}');
    for (const c of codebase) {
      lines.push(`    • ${c}`);
    }
  }
  if (refs.length) {
    lines.push('  {bold}Reference Materials:{/bold}');
    for (const r of refs) {
      lines.push(`    • ${r}`);
    }
  }
  if (!codebase.length && !refs.length) {
    lines.push('  {gray-fg}(none){/gray-fg}');
  }
  lines.push('');

  // Quality Standards
  lines.push(
    '{bold}{yellow-fg}── Quality Standards ─────────────────────────────{/yellow-fg}{/bold}'
  );
  if (brief.qualityStandards && typeof brief.qualityStandards === 'object') {
    const qs = brief.qualityStandards as unknown as Record<string, unknown>;
    const categories: Array<{ label: string; key: string }> = [
      { label: 'Performance', key: 'performance' },
      { label: 'Security', key: 'security' },
      { label: 'Accessibility', key: 'accessibility' },
    ];
    let hasEntries = false;
    for (const cat of categories) {
      const data = qs[cat.key];
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const entries = Object.entries(data as Record<string, unknown>);
        if (entries.length > 0) {
          hasEntries = true;
          lines.push(`  {bold}${cat.label}:{/bold}`);
          for (const [k, v] of entries) {
            lines.push(`    • ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
          }
        }
      } else if (data && typeof data === 'string' && data.trim().length > 0) {
        hasEntries = true;
        lines.push(`  {bold}${cat.label}:{/bold} ${data}`);
      }
    }
    if (!hasEntries) {
      lines.push('  {gray-fg}(empty quality standards){/gray-fg}');
    }
  } else {
    lines.push('  {gray-fg}(not set){/gray-fg}');
  }

  return lines.join('\n');
}

/**
 * Formats a task for the task selector list item
 *
 * @param task The task to format
 * @returns Tagged string representation for the list item
 */
function formatTaskListItem(task: Task): string {
  let marker = '{cyan-fg}[ ]{/cyan-fg}';
  if (task.status === 'completed') {
    marker = '{green-fg}[✓]{/green-fg}';
  } else if (task.status === 'in_progress') {
    marker = '{yellow-fg}[→]{/yellow-fg}';
  }
  const field = task.field ? ` {gray-fg}(${task.field}){/gray-fg}` : '';
  return `${marker} {bold}${task.title}{/bold}${field}`;
}

/**
 * Formats a task into a tagged string for display in the TUI overlay modal
 *
 * @param task The task to format, or null if not found
 * @param allTasks Optional list or map of all tasks for dependency title resolution
 * @returns Tagged string representation of the task
 */
export function formatTaskDetails(
  task: Task | null,
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  if (!task) {
    return '{yellow-fg}No task selected.{/yellow-fg}';
  }

  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const lines: string[] = [];
  lines.push(`{bold}{cyan-fg}Task ID:{/cyan-fg}{/bold} ${task.id}`);
  lines.push(`{bold}{cyan-fg}Title:{/cyan-fg}{/bold} ${task.title}`);

  let statusText = '{cyan-fg}pending [ ]{/cyan-fg}';
  if (task.status === 'completed') {
    statusText = '{green-fg}complete [✓]{/green-fg}';
  } else if (task.status === 'in_progress') {
    statusText = '{yellow-fg}in_progress [→]{/yellow-fg}';
  }
  lines.push(`{bold}{cyan-fg}Status:{/cyan-fg}{/bold} ${statusText}`);
  lines.push(`{bold}{cyan-fg}Brief ID:{/cyan-fg}{/bold} ${task.briefId}`);
  if (task.field) {
    lines.push(`{bold}{cyan-fg}Brief Field:{/cyan-fg}{/bold} ${task.field}`);
  }
  lines.push(
    `{bold}{cyan-fg}Created:{/cyan-fg}{/bold} ${task.createdAt} · {bold}{cyan-fg}Updated:{/cyan-fg}{/bold} ${task.updatedAt}`
  );
  lines.push('');

  // Description
  lines.push(
    '{bold}{yellow-fg}── Description ───────────────────────────────────{/yellow-fg}{/bold}'
  );
  if (task.description && task.description.trim().length > 0) {
    lines.push(task.description);
  } else {
    lines.push('  {gray-fg}(no description provided){/gray-fg}');
  }
  lines.push('');

  // Dependencies
  lines.push(
    '{bold}{yellow-fg}── Dependencies ──────────────────────────────────{/yellow-fg}{/bold}'
  );
  if (task.dependencies && task.dependencies.length > 0) {
    for (const depId of task.dependencies) {
      const depTask = tasksMap.get(depId);
      const depTitle = depTask ? depTask.title : depId;
      lines.push(`  • {bold}${depId}:{/bold} ${depTitle}`);
    }
  } else {
    lines.push('  {gray-fg}(none){/gray-fg}');
  }

  return lines.join('\n');
}

/**
 * Formats a list of file locks into a tagged string for display in the fullscreen overlay modal
 *
 * @param locks Array of file locks
 * @param allTasks Optional list or map of all tasks for resolving task titles
 * @returns Tagged string representation of the file locks
 */
export function formatLockDetails(
  locks: FileLock[],
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  if (!locks || locks.length === 0) {
    return '{yellow-fg}No active file locks.{/yellow-fg}\n\nLocks are automatically acquired by Executor agents during parallel execution.';
  }

  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const lines: string[] = [];
  lines.push(`{bold}{cyan-fg}Active File Locks:{/cyan-fg}{/bold} ${locks.length}`);
  lines.push('');

  for (let i = 0; i < locks.length; i++) {
    const lock = locks[i];
    const task = tasksMap.get(lock.taskId);
    const taskTitle = task ? task.title : '(unknown task)';
    lines.push(`{bold}${i + 1}. ${lock.filePath}{/bold}`);
    lines.push(`   {cyan-fg}Task ID:{/cyan-fg} ${lock.taskId} · {bold}${taskTitle}{/bold}`);
    lines.push(`   {gray-fg}Acquired at:{/gray-fg} ${lock.createdAt}`);
    if (i < locks.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Formats a list of execution events into a tagged string for display in the fullscreen overlay modal
 *
 * @param events Array of execution events
 * @param allTasks Optional list or map of all tasks for resolving task titles
 * @returns Tagged string representation of execution events
 */
export function formatEventDetails(
  events: ExecutionEvent[],
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  if (!events || events.length === 0) {
    return '{yellow-fg}No execution events recorded yet.{/yellow-fg}';
  }

  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const lines: string[] = [];
  lines.push(`{bold}{cyan-fg}Total Events Recorded:{/cyan-fg}{/bold} ${events.length}`);
  lines.push('');

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const time = formatTime(evt.createdAt);
    const color =
      evt.type === 'completed'
        ? 'green'
        : evt.type === 'error'
          ? 'red'
          : evt.type === 'dispatched'
            ? 'cyan'
            : 'white';

    let taskSuffix = '';
    if (evt.taskId) {
      const task = tasksMap.get(evt.taskId);
      const title = task ? task.title : evt.taskId;
      taskSuffix = ` · {gray-fg}task:{/gray-fg} {bold}${truncate(title, 36)}{/bold}`;
    }

    lines.push(
      `{gray-fg}[${time}]{/gray-fg} {bold}${evt.actor}{/bold} {${color}-fg}${evt.type}{/${color}-fg}${taskSuffix}`
    );
    lines.push(`  ${evt.message}`);
    if (i < events.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Formats an event for the selectable event list item
 *
 * @param evt The execution event to format
 * @param allTasks Optional list or map of all tasks for resolving task titles
 * @returns Tagged string representation for the event list item
 */
export function formatEventListItem(
  evt: ExecutionEvent,
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const color =
    evt.type === 'completed'
      ? 'green'
      : evt.type === 'error'
        ? 'red'
        : evt.type === 'dispatched'
          ? 'cyan'
          : evt.type === 'started'
            ? 'yellow'
            : 'white';

  const time = formatTime(evt.createdAt);

  const taskSuffix = evt.taskId
    ? ` · {gray-fg}task:{/gray-fg} {bold}${truncate(tasksMap.get(evt.taskId)?.title ?? evt.taskId, 32)}{/bold}`
    : ' · {gray-fg}scope:{/gray-fg} {bold}brief{/bold}';

  return `{gray-fg}[${time}]{/gray-fg} {bold}${evt.actor}{/bold} {${color}-fg}[${evt.type.toUpperCase()}]{/${color}-fg} ${truncate(evt.message.replace(/\s+/g, ' ').trim(), 50)}${taskSuffix}`;
}

/**
 * Formats a single execution event into full structured view for the event detail modal
 *
 * @param evt The execution event to format, or null if not found
 * @param allTasks Optional list or map of all tasks for resolving task titles
 * @returns Tagged string representation of the single execution event
 */
export function formatSingleEventDetail(
  evt: ExecutionEvent | null,
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  if (!evt) {
    return '{yellow-fg}No event selected.{/yellow-fg}';
  }

  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const lines: string[] = [];
  const color =
    evt.type === 'completed'
      ? 'green'
      : evt.type === 'error'
        ? 'red'
        : evt.type === 'dispatched'
          ? 'cyan'
          : evt.type === 'started'
            ? 'yellow'
            : 'white';

  lines.push(`{bold}{cyan-fg}Event ID:{/cyan-fg}{/bold}   ${evt.id}`);
  lines.push(`{bold}{cyan-fg}Actor:{/cyan-fg}{/bold}      {bold}${evt.actor}{/bold}`);
  lines.push(
    `{bold}{cyan-fg}Type:{/cyan-fg}{/bold}       {bold}{${color}-fg}${evt.type.toUpperCase()}{/${color}-fg}{/bold}`
  );
  lines.push(`{bold}{cyan-fg}Brief ID:{/cyan-fg}{/bold}   ${evt.briefId}`);

  if (evt.taskId) {
    const task = tasksMap.get(evt.taskId);
    const title = task ? task.title : evt.taskId;
    lines.push(`{bold}{cyan-fg}Task:{/cyan-fg}{/bold}       ${evt.taskId} · {bold}${title}{/bold}`);
  } else {
    lines.push(
      `{bold}{cyan-fg}Scope:{/cyan-fg}{/bold}      {bold}brief-level{/bold} (workflow level event)`
    );
  }

  const localTime = formatTime(evt.createdAt);
  lines.push(
    `{bold}{cyan-fg}Timestamp:{/cyan-fg}{/bold}  ${evt.createdAt} {gray-fg}(local: ${localTime}){/gray-fg}`
  );
  lines.push('');

  // Event Message Body
  lines.push(
    '{bold}{yellow-fg}── Message & Details ─────────────────────────────{/yellow-fg}{/bold}'
  );
  if (evt.message && evt.message.trim().length > 0) {
    lines.push(evt.message);
  } else {
    lines.push('  {gray-fg}(no message content){/gray-fg}');
  }

  return lines.join('\n');
}

/**
 * Formats an artifact for the artifact selector list item
 */
export function formatArtifactListItem(
  a: ExecutionArtifact,
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const typeColor =
    a.type === 'constraint'
      ? 'red'
      : a.type === 'api_contract'
        ? 'yellow'
        : a.type === 'decision'
          ? 'cyan'
          : a.type === 'fact'
            ? 'green'
            : 'white';

  const statusBadge =
    a.status === 'active'
      ? '{green-fg}[✓]{/green-fg}'
      : a.status === 'superseded'
        ? '{gray-fg}[⟲]{/gray-fg}'
        : '{red-fg}[✗]{/red-fg}';

  const taskSuffix = a.taskId
    ? ` · {gray-fg}task:{/gray-fg} {bold}${truncate(tasksMap.get(a.taskId)?.title ?? a.taskId, 32)}{/bold}`
    : ' · {gray-fg}scope:{/gray-fg} {bold}brief{/bold}';

  const summary = summarizeArtifactContent(a.type, a.content);
  return `${statusBadge} {bold}{${typeColor}-fg}[${a.type.toUpperCase()}]{/${typeColor}-fg}{/bold} ${truncate(summary, 50)}${taskSuffix}`;
}

/**
 * Formats a single artifact into full structured view for the detail modal
 */
export function formatArtifactDetail(
  a: ExecutionArtifact | null,
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  if (!a) {
    return '{yellow-fg}No artifact selected.{/yellow-fg}';
  }

  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const lines: string[] = [];
  const typeColor =
    a.type === 'constraint'
      ? 'red'
      : a.type === 'api_contract'
        ? 'yellow'
        : a.type === 'decision'
          ? 'cyan'
          : a.type === 'fact'
            ? 'green'
            : 'white';

  lines.push(`{bold}{cyan-fg}Artifact ID:{/cyan-fg}{/bold} ${a.id}`);
  lines.push(
    `{bold}{cyan-fg}Category:{/cyan-fg}{/bold}    {bold}{${typeColor}-fg}${a.type.toUpperCase()}{/${typeColor}-fg}{/bold}`
  );

  let statusText = '{green-fg}active [✓]{/green-fg}';
  if (a.status === 'superseded') {
    statusText = `{gray-fg}superseded [⟲]${a.supersededBy ? ` by ${a.supersededBy}` : ''}{/gray-fg}`;
  } else if (a.status === 'invalidated') {
    statusText = '{red-fg}invalidated [✗]{/red-fg}';
  }
  lines.push(`{bold}{cyan-fg}Status:{/cyan-fg}{/bold}      ${statusText}`);
  lines.push(`{bold}{cyan-fg}Brief ID:{/cyan-fg}{/bold}    ${a.briefId}`);

  if (a.taskId) {
    const task = tasksMap.get(a.taskId);
    const title = task ? task.title : a.taskId;
    lines.push(`{bold}{cyan-fg}Task:{/cyan-fg}{/bold}        ${a.taskId} · {bold}${title}{/bold}`);
  } else {
    lines.push(
      `{bold}{cyan-fg}Scope:{/cyan-fg}{/bold}       {bold}brief-level{/bold} (discovered during briefing)`
    );
  }

  if (a.tags && a.tags.length > 0) {
    lines.push(`{bold}{cyan-fg}Tags:{/cyan-fg}{/bold}        ${a.tags.join(', ')}`);
  }

  lines.push(`{bold}{cyan-fg}Recorded:{/cyan-fg}{/bold}    ${a.createdAt}`);
  lines.push('');

  // Structured Content Body
  lines.push(
    '{bold}{yellow-fg}── Content & Details ─────────────────────────────{/yellow-fg}{/bold}'
  );
  const body = formatArtifactBody(a.type, a.content);
  for (const bLine of body) {
    lines.push(bLine);
  }

  return lines.join('\n');
}

/**
 * Formats a list of execution artifacts into a tagged string for display in the fullscreen overlay modal
 */
export function formatArtifactDetails(
  artifacts: ExecutionArtifact[],
  allTasks?: Task[] | Map<string, { title: string }>
): string {
  if (!artifacts || artifacts.length === 0) {
    return '{yellow-fg}No execution artifacts recorded yet.{/yellow-fg}';
  }

  const tasksMap =
    allTasks instanceof Map
      ? allTasks
      : Array.isArray(allTasks)
        ? new Map(allTasks.map((t) => [t.id, t]))
        : new Map<string, { title: string }>();

  const lines: string[] = [];
  lines.push(
    `{bold}{cyan-fg}Knowledge Base:{/cyan-fg}{/bold} ${artifacts.length} recorded artifact(s)`
  );
  lines.push('');

  const CATEGORIES: Array<{
    type: ArtifactType[];
    title: string;
    color: string;
  }> = [
    { type: ['constraint'], title: 'Constraints & Boundaries', color: 'red' },
    { type: ['api_contract'], title: 'API & Interface Contracts', color: 'yellow' },
    { type: ['decision'], title: 'Architectural Decisions', color: 'cyan' },
    { type: ['fact'], title: 'System Facts', color: 'green' },
    { type: ['note', 'log'], title: 'Notes & Logs', color: 'white' },
  ];

  for (const cat of CATEGORIES) {
    const catArtifacts = artifacts.filter((a) => cat.type.includes(a.type));
    if (catArtifacts.length === 0) {
      continue;
    }

    lines.push(
      `{bold}{${cat.color}-fg}── ${cat.title} (${catArtifacts.length}) ──────────────────────────────────{/${cat.color}-fg}{/bold}`
    );

    for (let i = 0; i < catArtifacts.length; i++) {
      const a = catArtifacts[i];
      const time = formatTime(a.createdAt);

      const statusBadge =
        a.status === 'active'
          ? '{green-fg}[active]{/green-fg}'
          : a.status === 'superseded'
            ? '{gray-fg}[superseded]{/gray-fg}'
            : '{red-fg}[invalidated]{/red-fg}';

      let taskSuffix = ' · {gray-fg}scope:{/gray-fg} {bold}brief{/bold}';
      if (a.taskId) {
        const task = tasksMap.get(a.taskId);
        const title = task ? task.title : a.taskId;
        taskSuffix = ` · {gray-fg}task:{/gray-fg} {bold}${truncate(title, 36)}{/bold}`;
      }

      lines.push(
        ` {gray-fg}[${time}]{/gray-fg} {bold}${a.type.toUpperCase()}{/bold} ${statusBadge}${taskSuffix}`
      );

      const bodyLines = formatArtifactBody(a.type, a.content);
      for (const bLine of bodyLines) {
        lines.push(`  ${bLine}`);
      }

      if (i < catArtifacts.length - 1) {
        lines.push('');
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Registers the watch command on commander program
 */
export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Live dashboard of the current workflow (brief, tasks, activity graph)')
    .option('--brief <briefId>', 'Brief ID (defaults to latest)')
    .option('--interval <ms>', 'Database poll interval in ms', String(DEFAULT_INTERVAL_MS))
    .option('--once', 'Print a single snapshot as JSON and exit (non-interactive)')
    .action((opts: WatchOptions) => {
      const snapshot = buildSnapshot({ briefId: opts.brief, allowEmpty: true });

      if (opts.once || !process.stdout.isTTY) {
        if (!snapshot) {
          process.stdout.write(JSON.stringify({ ok: false, error: 'No brief found' }) + '\n');
          process.exit(1);
        }
        process.stdout.write(JSON.stringify({ ok: true, snapshot }) + '\n');
        return;
      }

      runDashboard(opts);
    });
}

function runDashboard(opts: WatchOptions): void {
  const screen = blessed.screen({
    // On Windows PowerShell/CMD, TERM is unset and Blessed falls back to its
    // legacy "windows-ansi" profile whose smcup/rmcup (alternate screen buffer)
    // sequences are empty. Force a VT profile so enter/exit alternate screen
    // buffer actually switch buffers and disable scrollback history.
    terminal: process.env.TERM || 'xterm-256color',
    smartCSR: true,
    fullUnicode: true,
    title: 'crewmate watch',
    cursor: {
      artificial: false,
      shape: 'block',
      blink: false,
      color: 'black',
    },
  });

  // Enter the alternate screen buffer explicitly: switch to a dedicated
  // single-page canvas with no scrollback history, so the terminal cannot
  // scroll back into the previous shell output.
  screen.program.write('\x1b[?1049h');

  // Ensure hardware cursor is explicitly hidden in all terminal types (e.g. ConPTY / Windows Terminal)
  screen.program.hideCursor();
  screen.program.write('\x1b[?25l');

  // Disable all mouse tracking and alternate scroll mode so the terminal
  // handles wheel input natively. In the alternate buffer (no scrollback)
  // this means the wheel produces no scrolling at all.
  screen.program.disableMouse();
  screen.program.write(
    '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1007l'
  );

  const cleanup = () => {
    try {
      screen.program.showCursor();
      screen.program.write('\x1b[?25h');
      screen.program.disableMouse();
      screen.program.write(
        '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1007l'
      );
      // Exit the alternate screen buffer: restore the previous PowerShell
      // prompt and its scrollback history cleanly.
      screen.program.write('\x1b[?1049l');
    } catch {
      // Ignore errors during exit
    }
  };

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 5,
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' } },
    tags: true,
    wrap: false,
  });

  const taskBoard = blessed.box({
    parent: screen,
    top: 5,
    left: 0,
    width: '60%',
    height: '45%',
    label: ' Tasks ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'blue' } },
    tags: true,
    wrap: false,
  });

  const eventFeed = blessed.box({
    parent: screen,
    top: 5,
    left: '60%',
    right: 0,
    height: '45%',
    label: ' Events ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'green' } },
    tags: true,
    wrap: false,
  });

  const activityGraph = blessed.box({
    parent: screen,
    top: '50%',
    left: 0,
    width: '60%',
    bottom: 2,
    label: ' Activity ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'yellow' } },
    tags: true,
    wrap: false,
  });

  const locksBoard = blessed.box({
    parent: screen,
    top: '50%',
    left: '60%',
    right: 0,
    bottom: 2,
    label: ' Active File Locks ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'magenta' } },
    tags: true,
    wrap: false,
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 2,
    content: ' q / Ctrl-C: quit · b: briefs · t: tasks · a: artifacts · e: events · l: file locks ',
    style: { fg: 'gray' },
    tags: true,
  });

  const briefListModal = blessed.list({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Briefs (Enter: select active brief · v: view details) ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
      bg: 'black',
      selected: {
        bg: 'cyan',
        fg: 'black',
        bold: true,
      },
      item: {
        fg: 'white',
      },
    },
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'cyan' },
    },
    hidden: true,
  });

  const briefDetailModal = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Brief Details ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' }, bg: 'black' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'cyan' },
    },
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
  });

  const eventListModal = blessed.list({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Execution Events (Enter: view details) ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'green' },
      bg: 'black',
      selected: {
        bg: 'green',
        fg: 'black',
        bold: true,
      },
      item: {
        fg: 'white',
      },
    },
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'green' },
    },
    hidden: true,
  });

  const eventDetailModal = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Event Details ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'green' }, bg: 'black' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'green' },
    },
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
  });

  const lockModal = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Active File Locks ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'magenta' }, bg: 'black' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'magenta' },
    },
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
  });

  const artifactListModal = blessed.list({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Knowledge Artifacts (Enter: view details) ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
      bg: 'black',
      selected: {
        bg: 'cyan',
        fg: 'black',
        bold: true,
      },
      item: {
        fg: 'white',
      },
    },
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'cyan' },
    },
    hidden: true,
  });

  const artifactDetailModal = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Artifact Details ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' }, bg: 'black' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'cyan' },
    },
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
  });

  const taskListModal = blessed.list({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Tasks ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'blue' },
      bg: 'black',
      selected: {
        bg: 'blue',
        fg: 'white',
        bold: true,
      },
      item: {
        fg: 'white',
      },
    },
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'blue' },
    },
    hidden: true,
  });

  const taskDetailModal = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    bottom: 2,
    label: ' Task Details ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'blue' }, bg: 'black' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'blue' },
    },
    keys: true,
    vi: true,
    mouse: true,
    hidden: true,
  });

  let spinnerFrame = 0;
  let currentSnapshot: WorkflowSnapshot | null = null;
  let currentBriefId: string | undefined = opts.brief;
  let currentBriefs: Brief[] = [];
  let selectedBriefId: string | null = null;
  let currentTasks: Task[] = [];
  let selectedTaskId: string | null = null;
  let currentArtifacts: ExecutionArtifact[] = [];
  let selectedArtifactId: string | null = null;
  let currentEvents: ExecutionEvent[] = [];
  let selectedEventId: string | null = null;

  function eventColor(type: ExecutionEvent['type']): string {
    switch (type) {
      case 'completed':
        return 'green';
      case 'error':
        return 'red';
      case 'dispatched':
        return 'cyan';
      default:
        return 'white';
    }
  }

  function renderHeader(s: WorkflowSnapshot): void {
    if (s.briefId === '(none)') {
      header.setContent(
        [
          `Brief {bold}{red-fg}(none){/red-fg}{/bold} · status: {gray-fg}none{/gray-fg} · events: {cyan-fg}0{/cyan-fg}`,
          `Goal: {gray-fg}(no brief created yet — run /brief or \`crewmate brief init\` to begin){/gray-fg}`,
          `[{yellow-fg}░░░░░░░░░░{/yellow-fg}] {bold}0/0{/bold} tasks done · 0 running`,
        ].join('\n')
      );
      return;
    }

    const progress = s.totalCount > 0 ? Math.round((s.completedCount / s.totalCount) * 10) : 0;
    const bar = '█'.repeat(progress) + '░'.repeat(10 - progress);
    const status =
      s.briefStatus === 'complete'
        ? '{green-fg}complete{/green-fg}'
        : '{yellow-fg}draft{/yellow-fg}';
    const sessionTag =
      s.sessionStatus === 'stopped' || s.sessionStatus === 'offline'
        ? ' · {yellow-fg}(harness offline){/yellow-fg}'
        : s.sessionStatus === 'idle'
          ? ' · {yellow-fg}(session paused){/yellow-fg}'
          : '';
    header.setContent(
      [
        `Brief {bold}{cyan-fg}${s.briefId}{/cyan-fg}{/bold} · status: ${status}${sessionTag} · events: {cyan-fg}${s.eventCount}{/cyan-fg}`,
        `Goal: ${truncate(s.goal ?? '(no goal set)', 60)}`,
        `[{yellow-fg}${bar}{/yellow-fg}] {bold}${s.completedCount}/${s.totalCount}{/bold} tasks done · ${s.activeCount} running`,
      ].join('\n')
    );
  }

  function statusLine(status: string, interrupted?: boolean): string {
    if (interrupted) {
      return '{yellow-fg}{bold}[!]{/bold}{/yellow-fg}';
    }
    switch (status) {
      case 'completed':
        return '{green-fg}{bold}[✓]{/bold}{/green-fg}';
      case 'in_progress':
        return '{yellow-fg}{bold}[→]{/bold}{/yellow-fg}';
      default:
        return '{cyan-fg}[ ]{/cyan-fg}';
    }
  }

  function renderTaskBoard(s: WorkflowSnapshot): void {
    const tasksById = new Map(s.tasks.map((t) => [t.id, t]));
    const lines: string[] = [];
    for (const t of s.tasks) {
      const marker = statusLine(t.status, t.interrupted);
      let suffix = '';
      if (t.interrupted) {
        suffix =
          s.sessionStatus === 'idle'
            ? ' {yellow-fg}(paused · session idle){/yellow-fg}'
            : ' {yellow-fg}(paused · harness offline){/yellow-fg}';
      } else if (t.status === 'in_progress') {
        suffix = ` {yellow-fg}(${SPINNERS[spinnerFrame % SPINNERS.length]} running){/yellow-fg}`;
      } else if (t.blocked) {
        const blockers = t.dependencies
          .map((d) => tasksById.get(d)?.title)
          .filter((title): title is string => Boolean(title))
          .join(', ');
        suffix = ` {red-fg}(blocked by: ${truncate(blockers || 'unfinished deps', 30)}){/red-fg}`;
      } else if (t.ready) {
        suffix = ' {cyan-fg}(ready){/cyan-fg}';
      }
      lines.push(`${marker} ${truncate(t.title, 42)}${suffix}`);
      if (t.dependencies.length > 0 && t.status === 'pending') {
        const depTitles = t.dependencies
          .map((d) => tasksById.get(d)?.title)
          .filter((title): title is string => Boolean(title));
        if (depTitles.length > 0) {
          lines.push(`   {gray-fg}depends on: ${truncate(depTitles.join('; '), 40)}{/gray-fg}`);
        }
      }
    }
    if (lines.length === 0) {
      if (s.briefId === '(none)') {
        lines.push(
          '{gray-fg}No brief available. Run /brief or `crewmate brief init` to get started.{/gray-fg}'
        );
      } else {
        lines.push('{gray-fg}No tasks yet. Run /brief and /execute to get started.{/gray-fg}');
      }
    }
    taskBoard.setContent(lines.join('\n'));
  }

  function renderEventFeed(s: WorkflowSnapshot): void {
    const lines = s.events.slice(0, 12).map((e) => {
      const time = formatTime(e.createdAt);
      const actor = e.actor.padEnd(8);
      const type = e.type.padEnd(10);
      const color = eventColor(e.type);
      const msg = truncate(e.message, 24);
      return `{gray-fg}${time}{/gray-fg} {bold}${actor}{/bold} {${color}-fg}${type}{/${color}-fg} ${msg}`;
    });
    if (lines.length === 0) {
      lines.push('{gray-fg}No events recorded yet.{/gray-fg}');
    }
    eventFeed.setContent(lines.join('\n'));
  }

  function renderLocks(s: WorkflowSnapshot): void {
    const tasksById = new Map(s.tasks.map((t) => [t.id, t]));
    const lines: string[] = [];
    for (const lock of s.locks.slice(0, 10)) {
      const task = tasksById.get(lock.taskId);
      const title = task ? truncate(task.title, 20) : lock.taskId;
      lines.push(`• {bold}${truncate(lock.filePath, 26)}{/bold} {gray-fg}(${title}){/gray-fg}`);
    }
    if (lines.length === 0) {
      lines.push('{gray-fg}No active file locks.{/gray-fg}');
    }
    locksBoard.setContent(lines.join('\n'));
  }

  function renderActivity(s: WorkflowSnapshot): void {
    const graphContent = renderGraph({
      edges: s.dispatchEdges,
      spinnerFrame,
      frontmanState: s.frontmanState,
      activity: s.currentActivity,
      sessionStatus: s.sessionStatus,
      harnessName: s.harness,
    });
    activityGraph.setContent(graphContent);
  }

  function pollDb(): void {
    const snapshot = buildSnapshot({ briefId: currentBriefId, allowEmpty: true });
    if (!snapshot) {
      return;
    }

    currentSnapshot = snapshot;
    renderHeader(snapshot);
    renderTaskBoard(snapshot);
    renderEventFeed(snapshot);
    renderActivity(snapshot);
    renderLocks(snapshot);

    if (!briefListModal.hidden) {
      currentBriefs = listBriefs(getDb());
      if (currentBriefs.length > 0) {
        briefListModal.setItems(currentBriefs.map(formatBriefListItem));
      }
    }

    if (!briefDetailModal.hidden) {
      const brief = resolveBrief(selectedBriefId ?? currentBriefId);
      briefDetailModal.setContent(formatBriefDetails(brief));
    }

    if (!eventDetailModal.hidden && selectedEventId) {
      const brief = resolveBrief(currentBriefId);
      const events = brief ? listEvents(getDb(), { briefId: brief.id, limit: 100 }) : [];
      const event = events.find((e) => e.id === selectedEventId) ?? null;
      const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
      eventDetailModal.setContent(formatSingleEventDetail(event, allTasks));
    }

    if (!eventListModal.hidden) {
      const brief = resolveBrief(currentBriefId);
      if (brief) {
        currentEvents = listEvents(getDb(), { briefId: brief.id, limit: 100 });
        const allTasks = listTasksByBrief(getDb(), brief.id);
        if (currentEvents.length > 0) {
          eventListModal.setItems(currentEvents.map((e) => formatEventListItem(e, allTasks)));
        }
      }
    }

    if (!lockModal.hidden) {
      const locks = listLocks(getDb());
      const brief = resolveBrief(currentBriefId);
      const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
      lockModal.setContent(formatLockDetails(locks, allTasks));
    }

    if (!taskDetailModal.hidden && selectedTaskId) {
      const task = getTaskById(getDb(), selectedTaskId);
      const brief = resolveBrief(currentBriefId);
      const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
      taskDetailModal.setContent(formatTaskDetails(task, allTasks));
    }

    if (!taskListModal.hidden) {
      const brief = resolveBrief(currentBriefId);
      if (brief) {
        currentTasks = listTasksByBrief(getDb(), brief.id);
        if (currentTasks.length > 0) {
          taskListModal.setItems(currentTasks.map(formatTaskListItem));
        }
      }
    }

    if (!artifactDetailModal.hidden && selectedArtifactId) {
      const artifact = getArtifactById(getDb(), selectedArtifactId);
      const brief = resolveBrief(currentBriefId);
      const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
      artifactDetailModal.setContent(formatArtifactDetail(artifact, allTasks));
    }

    if (!artifactListModal.hidden) {
      const brief = resolveBrief(currentBriefId);
      if (brief) {
        currentArtifacts = listArtifacts(getDb(), { briefId: brief.id, status: 'all' });
        const allTasks = listTasksByBrief(getDb(), brief.id);
        if (currentArtifacts.length > 0) {
          artifactListModal.setItems(
            currentArtifacts.map((a) => formatArtifactListItem(a, allTasks))
          );
        }
      }
    }

    screen.render();
  }

  function tickAnim(): void {
    spinnerFrame += 1;
    if (currentSnapshot) {
      renderTaskBoard(currentSnapshot);
      renderActivity(currentSnapshot);
      screen.render();
    }
  }

  pollDb();

  const parsedInterval = parseInt(opts.interval ?? String(DEFAULT_INTERVAL_MS), 10);
  const safeInterval =
    Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : DEFAULT_INTERVAL_MS;
  const pollTimer = setInterval(pollDb, Math.max(200, safeInterval));
  const animTimer = setInterval(tickAnim, ANIMATION_TICK_MS);

  const MAIN_FOOTER =
    ' q / Ctrl-C: quit · b: briefs · t: tasks · a: artifacts · e: events · l: file locks ';
  const BRIEF_LIST_FOOTER =
    ' q / Ctrl-C: quit · Enter: select · v: view details · b / Esc: close · ↑/↓/k/j: navigate ';
  const BRIEF_DETAIL_FOOTER =
    ' q / Ctrl-C: quit · Esc: back to brief list · b: close · ↑/↓/k/j/PgUp/PgDn: scroll ';
  const ARTIFACT_LIST_FOOTER =
    ' q / Ctrl-C: quit · Enter: view artifact · a / Esc: close artifacts · ↑/↓/k/j: navigate ';
  const ARTIFACT_DETAIL_FOOTER =
    ' q / Ctrl-C: quit · Esc: back to artifact list · a: close artifacts · ↑/↓/k/j/PgUp/PgDn: scroll ';
  const EVENT_LIST_FOOTER =
    ' q / Ctrl-C: quit · Enter: view event · e / Esc: close events · ↑/↓/k/j: navigate ';
  const EVENT_DETAIL_FOOTER =
    ' q / Ctrl-C: quit · Esc: back to event list · e: close events · ↑/↓/k/j/PgUp/PgDn: scroll ';
  const LOCK_FOOTER = ' q / Ctrl-C: quit · l / Esc: close file locks · ↑/↓/k/j/PgUp/PgDn: scroll ';
  const TASK_LIST_FOOTER =
    ' q / Ctrl-C: quit · Enter: view task · t / Esc: close tasks · ↑/↓/k/j: navigate ';
  const TASK_DETAIL_FOOTER =
    ' q / Ctrl-C: quit · Esc: back to task list · t: close tasks · ↑/↓/k/j/PgUp/PgDn: scroll ';

  function updateFooter(): void {
    if (!taskDetailModal.hidden) {
      footer.setContent(TASK_DETAIL_FOOTER);
    } else if (!taskListModal.hidden) {
      footer.setContent(TASK_LIST_FOOTER);
    } else if (!artifactDetailModal.hidden) {
      footer.setContent(ARTIFACT_DETAIL_FOOTER);
    } else if (!artifactListModal.hidden) {
      footer.setContent(ARTIFACT_LIST_FOOTER);
    } else if (!eventDetailModal.hidden) {
      footer.setContent(EVENT_DETAIL_FOOTER);
    } else if (!eventListModal.hidden) {
      footer.setContent(EVENT_LIST_FOOTER);
    } else if (!briefDetailModal.hidden) {
      footer.setContent(BRIEF_DETAIL_FOOTER);
    } else if (!briefListModal.hidden) {
      footer.setContent(BRIEF_LIST_FOOTER);
    } else if (!lockModal.hidden) {
      footer.setContent(LOCK_FOOTER);
    } else {
      footer.setContent(MAIN_FOOTER);
    }
  }

  function openBriefListModal(): void {
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    currentBriefs = listBriefs(getDb());
    if (currentBriefs.length === 0) {
      briefListModal.setItems(['{yellow-fg}(no briefs created yet — run /brief init){/yellow-fg}']);
    } else {
      briefListModal.setItems(currentBriefs.map(formatBriefListItem));
      const activeIdx = currentBriefs.findIndex(
        (b) => b.id === (currentBriefId ?? currentBriefs[0]?.id)
      );
      briefListModal.select(activeIdx >= 0 ? activeIdx : 0);
    }
    briefListModal.show();
    briefListModal.focus();
    updateFooter();
    screen.render();
  }

  function showBriefDetail(briefId: string): void {
    selectedBriefId = briefId;
    const brief = resolveBrief(briefId);
    briefDetailModal.setContent(formatBriefDetails(brief));
    briefDetailModal.scrollTo(0);
    briefListModal.hide();
    briefDetailModal.show();
    briefDetailModal.focus();
    updateFooter();
    screen.render();
  }

  function switchActiveBrief(briefId: string): void {
    currentBriefId = briefId;
    briefListModal.hide();
    briefDetailModal.hide();
    pollDb();
    updateFooter();
    screen.render();
  }

  briefListModal.on('select', (_item, index) => {
    const brief = currentBriefs[index];
    if (brief) {
      switchActiveBrief(brief.id);
    }
  });

  briefListModal.key(['v', 'V'], () => {
    const selectedIdx = (briefListModal as unknown as { selected?: number }).selected ?? 0;
    const brief = currentBriefs[selectedIdx];
    if (brief) {
      showBriefDetail(brief.id);
    }
  });

  function openTaskListModal(): void {
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    const brief = resolveBrief(currentBriefId);
    if (!brief) {
      taskListModal.setItems(['{yellow-fg}(no brief created yet — run /brief init){/yellow-fg}']);
      currentTasks = [];
    } else {
      currentTasks = listTasksByBrief(getDb(), brief.id);
      if (currentTasks.length === 0) {
        taskListModal.setItems(['{yellow-fg}(no tasks yet — run /brief and /execute){/yellow-fg}']);
      } else {
        taskListModal.setItems(currentTasks.map(formatTaskListItem));
        taskListModal.select(0);
      }
    }
    taskListModal.show();
    taskListModal.focus();
    updateFooter();
    screen.render();
  }

  function showTaskDetail(taskId: string): void {
    selectedTaskId = taskId;
    const task = getTaskById(getDb(), taskId);
    const brief = resolveBrief(currentBriefId);
    const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
    taskDetailModal.setContent(formatTaskDetails(task, allTasks));
    taskDetailModal.scrollTo(0);
    taskListModal.hide();
    taskDetailModal.show();
    taskDetailModal.focus();
    updateFooter();
    screen.render();
  }

  taskListModal.on('select', (_item, index) => {
    const task = currentTasks[index];
    if (task) {
      showTaskDetail(task.id);
    }
  });

  function openArtifactListModal(): void {
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    const brief = resolveBrief(currentBriefId);
    if (!brief) {
      artifactListModal.setItems([
        '{yellow-fg}(no brief created yet — run /brief init){/yellow-fg}',
      ]);
      currentArtifacts = [];
    } else {
      currentArtifacts = listArtifacts(getDb(), { briefId: brief.id, status: 'all' });
      const allTasks = listTasksByBrief(getDb(), brief.id);
      if (currentArtifacts.length === 0) {
        artifactListModal.setItems([
          '{yellow-fg}(no artifacts recorded yet — run /execute){/yellow-fg}',
        ]);
      } else {
        artifactListModal.setItems(
          currentArtifacts.map((a) => formatArtifactListItem(a, allTasks))
        );
        artifactListModal.select(0);
      }
    }
    artifactListModal.show();
    artifactListModal.focus();
    updateFooter();
    screen.render();
  }

  function showArtifactDetail(artifactId: string): void {
    selectedArtifactId = artifactId;
    const artifact = getArtifactById(getDb(), artifactId);
    const brief = resolveBrief(currentBriefId);
    const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
    artifactDetailModal.setContent(formatArtifactDetail(artifact, allTasks));
    artifactDetailModal.scrollTo(0);
    artifactListModal.hide();
    artifactDetailModal.show();
    artifactDetailModal.focus();
    updateFooter();
    screen.render();
  }

  artifactListModal.on('select', (_item, index) => {
    const artifact = currentArtifacts[index];
    if (artifact) {
      showArtifactDetail(artifact.id);
    }
  });

  function openEventListModal(): void {
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    const brief = resolveBrief(currentBriefId);
    if (!brief) {
      eventListModal.setItems(['{yellow-fg}(no brief created yet — run /brief init){/yellow-fg}']);
      currentEvents = [];
    } else {
      currentEvents = listEvents(getDb(), { briefId: brief.id, limit: 100 });
      const allTasks = listTasksByBrief(getDb(), brief.id);
      if (currentEvents.length === 0) {
        eventListModal.setItems(['{yellow-fg}(no execution events recorded yet){/yellow-fg}']);
      } else {
        eventListModal.setItems(currentEvents.map((e) => formatEventListItem(e, allTasks)));
        eventListModal.select(0);
      }
    }
    eventListModal.show();
    eventListModal.focus();
    updateFooter();
    screen.render();
  }

  function showEventDetail(eventId: string): void {
    selectedEventId = eventId;
    const brief = resolveBrief(currentBriefId);
    const events = brief ? listEvents(getDb(), { briefId: brief.id, limit: 100 }) : [];
    const event = events.find((e) => e.id === eventId) ?? null;
    const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
    eventDetailModal.setContent(formatSingleEventDetail(event, allTasks));
    eventDetailModal.scrollTo(0);
    eventListModal.hide();
    eventDetailModal.show();
    eventDetailModal.focus();
    updateFooter();
    screen.render();
  }

  eventListModal.on('select', (_item, index) => {
    const event = currentEvents[index];
    if (event) {
      showEventDetail(event.id);
    }
  });

  function toggleTaskListModal(): void {
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
      openTaskListModal();
      return;
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    openTaskListModal();
  }

  function toggleBriefModal(): void {
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
      openBriefListModal();
      return;
    }
    if (!briefListModal.hidden) {
      briefListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    openBriefListModal();
  }

  function toggleArtifactModal(): void {
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
      openArtifactListModal();
      return;
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    openArtifactListModal();
  }

  function toggleEventModal(): void {
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
      openEventListModal();
      return;
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!lockModal.hidden) {
      lockModal.hide();
    }
    openEventListModal();
  }

  function toggleLockModal(): void {
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (!briefListModal.hidden) {
      briefListModal.hide();
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
    }
    if (lockModal.hidden) {
      const locks = listLocks(getDb());
      const brief = resolveBrief(currentBriefId);
      const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
      lockModal.setContent(formatLockDetails(locks, allTasks));
      lockModal.scrollTo(0);
      lockModal.show();
      lockModal.focus();
      updateFooter();
      screen.render();
    } else {
      lockModal.hide();
      updateFooter();
      screen.render();
    }
  }

  screen.key(['b', 'B'], () => {
    toggleBriefModal();
  });

  screen.key(['t', 'T'], () => {
    toggleTaskListModal();
  });

  screen.key(['a', 'A'], () => {
    toggleArtifactModal();
  });

  screen.key(['e', 'E'], () => {
    toggleEventModal();
  });

  screen.key(['l', 'L'], () => {
    toggleLockModal();
  });

  screen.key(['escape'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
      openTaskListModal();
      return;
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!artifactDetailModal.hidden) {
      artifactDetailModal.hide();
      openArtifactListModal();
      return;
    }
    if (!artifactListModal.hidden) {
      artifactListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!eventDetailModal.hidden) {
      eventDetailModal.hide();
      openEventListModal();
      return;
    }
    if (!eventListModal.hidden) {
      eventListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!briefDetailModal.hidden) {
      briefDetailModal.hide();
      openBriefListModal();
      return;
    }
    if (!briefListModal.hidden) {
      briefListModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    if (!lockModal.hidden) {
      lockModal.hide();
      updateFooter();
      screen.render();
      return;
    }
    clearInterval(pollTimer);
    clearInterval(animTimer);
    cleanup();
    screen.destroy();
    process.exit(0);
  });

  screen.key(['q', 'C-c'], () => {
    clearInterval(pollTimer);
    clearInterval(animTimer);
    cleanup();
    screen.destroy();
    process.exit(0);
  });

  screen.key(['up', 'k'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(-1);
      screen.render();
    } else if (!artifactDetailModal.hidden) {
      artifactDetailModal.scroll(-1);
      screen.render();
    } else if (!eventDetailModal.hidden) {
      eventDetailModal.scroll(-1);
      screen.render();
    } else if (!briefDetailModal.hidden) {
      briefDetailModal.scroll(-1);
      screen.render();
    } else if (!lockModal.hidden) {
      lockModal.scroll(-1);
      screen.render();
    }
  });

  screen.key(['down', 'j'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(1);
      screen.render();
    } else if (!artifactDetailModal.hidden) {
      artifactDetailModal.scroll(1);
      screen.render();
    } else if (!eventDetailModal.hidden) {
      eventDetailModal.scroll(1);
      screen.render();
    } else if (!briefDetailModal.hidden) {
      briefDetailModal.scroll(1);
      screen.render();
    } else if (!lockModal.hidden) {
      lockModal.scroll(1);
      screen.render();
    }
  });

  screen.key(['pageup'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(-5);
      screen.render();
    } else if (!artifactDetailModal.hidden) {
      artifactDetailModal.scroll(-5);
      screen.render();
    } else if (!eventDetailModal.hidden) {
      eventDetailModal.scroll(-5);
      screen.render();
    } else if (!briefDetailModal.hidden) {
      briefDetailModal.scroll(-5);
      screen.render();
    } else if (!lockModal.hidden) {
      lockModal.scroll(-5);
      screen.render();
    }
  });

  screen.key(['pagedown'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(5);
      screen.render();
    } else if (!artifactDetailModal.hidden) {
      artifactDetailModal.scroll(5);
      screen.render();
    } else if (!eventDetailModal.hidden) {
      eventDetailModal.scroll(5);
      screen.render();
    } else if (!briefDetailModal.hidden) {
      briefDetailModal.scroll(5);
      screen.render();
    } else if (!lockModal.hidden) {
      lockModal.scroll(5);
      screen.render();
    }
  });

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  screen.render();
}
