import type { Command } from 'commander';
import blessedModule from 'blessed';
import { buildSnapshot, type WorkflowSnapshot } from '../utils/snapshot.js';
import { renderGraph } from '../utils/graph.js';
import { SPINNERS } from '../utils/ascii.js';
import type { ExecutionEvent } from '../models/event.js';

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

function formatTime(createdAt: string): string {
  const date = new Date(createdAt.endsWith('Z') ? createdAt : `${createdAt}Z`);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }
  return date.toISOString().slice(11, 19);
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
    content: ' q / Ctrl-C: quit ',
    style: { fg: 'gray' },
    tags: true,
  });

  let spinnerFrame = 0;
  let currentSnapshot: WorkflowSnapshot | null = null;

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
    header.setContent(
      [
        `Brief {bold}{cyan-fg}${s.briefId}{/cyan-fg}{/bold} · status: ${status} · events: {cyan-fg}${s.eventCount}{/cyan-fg}`,
        `Goal: ${truncate(s.goal ?? '(no goal set)', 60)}`,
        `[{yellow-fg}${bar}{/yellow-fg}] {bold}${s.completedCount}/${s.totalCount}{/bold} tasks done · ${s.activeCount} running`,
      ].join('\n')
    );
  }

  function statusLine(status: string): string {
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
      const marker = statusLine(t.status);
      let suffix = '';
      if (t.status === 'in_progress') {
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

  const pollTimer = setInterval(
    pollDb,
    Math.max(200, parseInt(opts.interval ?? String(DEFAULT_INTERVAL_MS), 10))
  );
  const animTimer = setInterval(tickAnim, ANIMATION_TICK_MS);

  screen.key(['q', 'C-c', 'escape'], () => {
    clearInterval(pollTimer);
    clearInterval(animTimer);
    cleanup();
    screen.destroy();
    process.exit(0);
  });

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  screen.render();
}
