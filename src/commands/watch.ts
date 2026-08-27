import type { Command } from 'commander';
import blessedModule from 'blessed';
import { buildSnapshot, type WorkflowSnapshot } from '../utils/snapshot.js';
import { renderGraph } from '../utils/graph.js';
import { SPINNERS } from '../utils/ascii.js';
import type { ExecutionEvent } from '../models/event.js';
import { resolveBrief } from '../db/brief-repo.js';
import type { Brief, Deliverable } from '../models/brief.js';
import { getDb } from '../db/connection.js';
import { getTaskById, listTasksByBrief } from '../db/task-repo.js';
import type { Task } from '../models/task.js';

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
  if (brief.qualityStandards) {
    lines.push(`  ${JSON.stringify(brief.qualityStandards, null, 2).replace(/\n/g, '\n  ')}`);
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
    width: '40%',
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
    width: '100%',
    bottom: 2,
    label: ' Activity ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'yellow' } },
    tags: true,
    wrap: false,
  });

  blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 2,
    content: ' q / Ctrl-C: quit · b: brief details · t: task details ',
    style: { fg: 'gray' },
    tags: true,
  });

  const briefModal = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '90%',
    height: '90%',
    label: ' Brief Details (Press b or Esc to close, ↑/↓/PgUp/PgDn to scroll) ',
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
    top: 'center',
    left: 'center',
    width: '80%',
    height: '70%',
    label: ' Select Task (Press Enter to view, Esc/t to close, ↑/↓ to navigate) ',
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
    top: 'center',
    left: 'center',
    width: '90%',
    height: '90%',
    label: ' Task Details (Press Esc to return to list, ↑/↓/PgUp/PgDn to scroll) ',
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
  let currentTasks: Task[] = [];
  let selectedTaskId: string | null = null;

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
    const snapshot = buildSnapshot({ briefId: opts.brief, allowEmpty: true });
    if (!snapshot) {
      return;
    }

    currentSnapshot = snapshot;
    renderHeader(snapshot);
    renderTaskBoard(snapshot);
    renderEventFeed(snapshot);
    renderActivity(snapshot);

    if (!briefModal.hidden) {
      const brief = resolveBrief(opts.brief);
      briefModal.setContent(formatBriefDetails(brief));
    }

    if (!taskDetailModal.hidden && selectedTaskId) {
      const task = getTaskById(getDb(), selectedTaskId);
      const brief = resolveBrief(opts.brief);
      const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
      taskDetailModal.setContent(formatTaskDetails(task, allTasks));
    }

    if (!taskListModal.hidden) {
      const brief = resolveBrief(opts.brief);
      if (brief) {
        currentTasks = listTasksByBrief(getDb(), brief.id);
        if (currentTasks.length > 0) {
          taskListModal.setItems(currentTasks.map(formatTaskListItem));
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

  function openTaskListModal(): void {
    const brief = resolveBrief(opts.brief);
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
    screen.render();
  }

  function showTaskDetail(taskId: string): void {
    selectedTaskId = taskId;
    const task = getTaskById(getDb(), taskId);
    const brief = resolveBrief(opts.brief);
    const allTasks = brief ? listTasksByBrief(getDb(), brief.id) : [];
    taskDetailModal.setContent(formatTaskDetails(task, allTasks));
    taskDetailModal.scrollTo(0);
    taskListModal.hide();
    taskDetailModal.show();
    taskDetailModal.focus();
    screen.render();
  }

  taskListModal.on('select', (_item, index) => {
    const task = currentTasks[index];
    if (task) {
      showTaskDetail(task.id);
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
      screen.render();
      return;
    }
    if (!briefModal.hidden) {
      briefModal.hide();
    }
    openTaskListModal();
  }

  function toggleBriefModal(): void {
    if (!taskListModal.hidden) {
      taskListModal.hide();
    }
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
    }
    if (briefModal.hidden) {
      const brief = resolveBrief(opts.brief);
      briefModal.setContent(formatBriefDetails(brief));
      briefModal.scrollTo(0);
      briefModal.show();
      briefModal.focus();
      screen.render();
    } else {
      briefModal.hide();
      screen.render();
    }
  }

  screen.key(['b', 'B'], () => {
    toggleBriefModal();
  });

  screen.key(['t', 'T'], () => {
    toggleTaskListModal();
  });

  screen.key(['escape'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.hide();
      openTaskListModal();
      return;
    }
    if (!taskListModal.hidden) {
      taskListModal.hide();
      screen.render();
      return;
    }
    if (!briefModal.hidden) {
      briefModal.hide();
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
    } else if (!briefModal.hidden) {
      briefModal.scroll(-1);
      screen.render();
    } else if (!taskListModal.hidden) {
      taskListModal.up(1);
      screen.render();
    }
  });

  screen.key(['down', 'j'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(1);
      screen.render();
    } else if (!briefModal.hidden) {
      briefModal.scroll(1);
      screen.render();
    } else if (!taskListModal.hidden) {
      taskListModal.down(1);
      screen.render();
    }
  });

  screen.key(['pageup'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(-5);
      screen.render();
    } else if (!briefModal.hidden) {
      briefModal.scroll(-5);
      screen.render();
    }
  });

  screen.key(['pagedown'], () => {
    if (!taskDetailModal.hidden) {
      taskDetailModal.scroll(5);
      screen.render();
    } else if (!briefModal.hidden) {
      briefModal.scroll(5);
      screen.render();
    }
  });

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  screen.render();
}
