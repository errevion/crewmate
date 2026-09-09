import blessedModule from 'blessed';
import type { Widgets } from 'blessed';

const blessed = ((blessedModule as unknown as { default?: typeof blessedModule }).default ||
  blessedModule) as unknown as typeof blessedModule;

/**
 *
 */
export interface EditorWidgets {
  screen: Widgets.Screen;
  headerBox: Widgets.BoxElement;
  canvasBox: Widgets.BoxElement;
  sidebarBox: Widgets.BoxElement;
  footerBox: Widgets.BoxElement;
  paletteModal: Widgets.ListElement;
  conditionModal: Widgets.ListElement;
  stageModal: Widgets.ListElement;
  confirmModal: Widgets.BoxElement;
  propertyModal: Widgets.BoxElement;
  helpModal: Widgets.BoxElement;
  inputPrompt: Widgets.BoxElement;
  inputText: Widgets.TextboxElement;
}

/**
 *
 */
export function createEditorUI(): EditorWidgets {
  const screen = blessed.screen({
    terminal: process.env.TERM || 'xterm-256color',
    smartCSR: true,
    fullUnicode: true,
    title: 'crewmate workflow editor',
    cursor: {
      artificial: false,
      shape: 'block',
      blink: false,
      color: 'black',
    },
  });

  // VT setup mirroring watch.ts
  screen.program.write('\x1b[?1049h');
  screen.program.hideCursor();
  screen.program.write('\x1b[?25l');
  screen.program.disableMouse();
  screen.program.write(
    '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1007l'
  );

  // Top header bar
  const headerBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' } },
    tags: true,
    wrap: false,
  });

  // Main canvas area (left 72%)
  const canvasBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '72%',
    bottom: 2,
    border: { type: 'line' },
    label: ' Workflow Graph Canvas ',
    style: { fg: 'white', border: { fg: 'blue' } },
    tags: true,
    wrap: false,
  });

  // Sidebar info / properties (right 28%)
  const sidebarBox = blessed.box({
    parent: screen,
    top: 3,
    left: '72%',
    right: 0,
    bottom: 2,
    border: { type: 'line' },
    label: ' Properties & Palette ',
    style: { fg: 'white', border: { fg: 'magenta' } },
    tags: true,
    wrap: true,
    scrollable: true,
  });

  // Footer navigation bar
  const footerBox = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 2,
    style: { fg: 'gray' },
    tags: true,
    wrap: false,
  });

  // --- OVERLAYS & MODALS ---

  // Palette modal (for adding built-in or discovered nodes)
  const paletteModal = blessed.list({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: '60%',
    label: ' Select Node Template or Discovered Node (Enter to Add) ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
      bg: 'black',
      selected: { bg: 'cyan', fg: 'black', bold: true },
    },
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    hidden: true,
  });

  // Condition type picker modal (for edges)
  const conditionModal = blessed.list({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: '40%',
    label: ' Select Edge Condition ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'yellow' },
      bg: 'black',
      selected: { bg: 'yellow', fg: 'black', bold: true },
    },
    tags: true,
    keys: true,
    vi: true,
    hidden: true,
  });

  // Stage manager list modal
  const stageModal = blessed.list({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: '50%',
    label: ' Stages (Enter: Switch · a: Add Stage · d: Delete Stage) ',
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'magenta' },
      bg: 'black',
      selected: { bg: 'magenta', fg: 'white', bold: true },
    },
    tags: true,
    keys: true,
    vi: true,
    hidden: true,
  });

  // Confirmation modal
  const confirmModal = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '45%',
    height: 7,
    label: ' Confirm Action ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'red' }, bg: 'black' },
    tags: true,
    hidden: true,
  });

  // Property Editor Modal
  const propertyModal = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '70%',
    label: ' Node Property Editor ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'green' }, bg: 'black' },
    tags: true,
    scrollable: true,
    hidden: true,
  });

  // Help Modal
  const helpModal = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '75%',
    height: '80%',
    label: ' Workflow Editor Help & Shortcuts ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' }, bg: 'black' },
    tags: true,
    scrollable: true,
    hidden: true,
  });

  // Input prompt popup
  const inputPrompt = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 60,
    height: 7,
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'yellow' }, bg: 'black' },
    tags: true,
    hidden: true,
  });

  const inputText = blessed.textbox({
    parent: inputPrompt,
    top: 2,
    left: 2,
    right: 2,
    height: 1,
    style: { fg: 'white', bg: 'blue' },
    inputOnFocus: true,
  });

  return {
    screen,
    headerBox,
    canvasBox,
    sidebarBox,
    footerBox,
    paletteModal,
    conditionModal,
    stageModal,
    confirmModal,
    propertyModal,
    helpModal,
    inputPrompt,
    inputText,
  };
}
