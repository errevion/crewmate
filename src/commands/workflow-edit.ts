import type { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DEFAULT_WORKFLOW } from '../graph/default-workflow.js';
import { loadAndResolveWorkflow } from '../graph/resolver.js';
import { EditorState } from '../editor/state.js';
import { createEditorUI } from '../editor/ui.js';
import { EditorController } from '../editor/controller.js';
import { discoverNodesInDirectory } from '../editor/node-discovery.js';

interface EditOptions {
  file?: string;
  new?: boolean;
}

/**
 *
 */
export function runEditor(options: EditOptions = {}): void {
  let initialWorkflow = DEFAULT_WORKFLOW;

  if (options.new) {
    initialWorkflow = {
      id: `custom-workflow-${Date.now().toString().slice(-4)}`,
      name: 'New Custom Workflow',
      description: 'Custom agent workflow graph',
      version: '1.0.0',
      stages: [
        {
          id: 'stage-1',
          name: 'Stage 1',
          graph: {
            nodes: [],
            edges: [],
          },
        },
      ],
    };
  } else if (options.file) {
    const fullPath = resolve(process.cwd(), options.file);
    initialWorkflow = loadAndResolveWorkflow(fullPath);
  } else {
    // Check if .crewmate/workflows/default.json exists
    const defaultModular = resolve(process.cwd(), '.crewmate/workflows/default.json');
    if (existsSync(defaultModular)) {
      try {
        initialWorkflow = loadAndResolveWorkflow(defaultModular);
      } catch {
        initialWorkflow = DEFAULT_WORKFLOW;
      }
    }
  }

  const state = new EditorState(initialWorkflow);
  // Auto-discover existing local nodes from folder
  state.discoveredNodes = discoverNodesInDirectory(process.cwd());

  const widgets = createEditorUI();

  const cleanup = () => {
    try {
      widgets.screen.program.showCursor();
      widgets.screen.program.write('\x1b[?25h');
      widgets.screen.program.disableMouse();
      widgets.screen.program.write(
        '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1007l'
      );
      widgets.screen.program.write('\x1b[?1049l');
    } catch {
      // Ignore cleanup errors
    }
  };

  const handleExit = () => {
    cleanup();
    widgets.screen.destroy();
    process.exit(0);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  new EditorController(state, widgets, handleExit);
}

/**
 *
 */
export function registerWorkflowEditCommand(program: Command): void {
  program
    .command('edit')
    .description('Launch the interactive terminal TUI workflow editor')
    .option('-f, --file <path>', 'Path to custom workflow JSON file to edit')
    .option('-n, --new', 'Create and edit a brand new empty workflow')
    .action((opts: EditOptions) => {
      if (!process.stdout.isTTY) {
        process.stdout.write(
          JSON.stringify({ ok: false, error: 'TUI editor requires an interactive TTY terminal' }) +
            '\n'
        );
        process.exit(1);
      }
      runEditor(opts);
    });
}
