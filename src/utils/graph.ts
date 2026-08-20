/**
 * Graph rendering utilities for the activity visualization section.
 * Supports both Unicode box-drawing characters and ASCII fallback.
 */

import type { EventActor } from '../models/event.js';
import type { FrontmanActivity } from '../models/activity.js';
import { SPINNERS } from './ascii.js';
import { easeInOutCubic } from './animation.js';

/**
 * Character set used for box drawing and line animation
 */
export interface CharSet {
  rail: string;
  branch: string;
  corner: string;
  tee: string;
  dot: string;
  box: string;
}

export const CHAR_SETS = {
  unicode: {
    rail: '─',
    branch: '│',
    corner: '└',
    tee: '├',
    dot: '●',
    box: '■',
  } satisfies CharSet,
  ascii: {
    rail: '-',
    branch: '|',
    corner: '+',
    tee: '+',
    dot: 'o',
    box: '#',
  } satisfies CharSet,
} as const;

/**
 * Supported character set mode
 */
export type CharSetType = keyof typeof CHAR_SETS;

// Environment override or auto-detection result
let currentCharSet: CharSetType = 'unicode';

/**
 * Detects terminal capability for Unicode box-drawing characters.
 * Auto-detects based on terminal type and environment variables.
 */
export function detectTerminalCapability(): CharSetType {
  // Manual override via environment variable
  if (process.env.CREWMATE_GRAPH_RENDERER) {
    const mode = process.env.CREWMATE_GRAPH_RENDERER.toLowerCase();
    if (mode === 'ascii') {
      return 'ascii';
    }
    if (mode === 'unicode' || mode === '') {
      return 'unicode';
    }
  }

  // Windows CMD (conhost.exe) often has issues with double-width Unicode
  const wtSession = Boolean(process.env.WT_SESSION);
  const isWindowsCmd = process.platform === 'win32' && !wtSession;

  if (isWindowsCmd) {
    return 'ascii';
  }

  // Modern terminals generally support Unicode well
  return 'unicode';
}

/**
 * Get the character set to use for rendering
 * Calls detectTerminalCapability once and caches result
 */
export function getCharSet(): CharSet {
  if (currentCharSet === 'unicode') {
    const detected = detectTerminalCapability();
    if (detected !== 'unicode') {
      currentCharSet = detected;
    }
  }
  return CHAR_SETS[currentCharSet];
}

const AGENT_COLORS = {
  frontman: 'yellow',
  scout: 'cyan',
  planner: 'magenta',
  executor: 'green',
} as const;

/**
 * Renders a colored agent node.
 * When spinnerFrame is provided, renders an animated loading spinner (⠋ ⠙ ...).
 * Otherwise renders a solid box character (■).
 *
 * @param agent The agent role
 * @param charSet Optional character set override (defaults to current active set)
 * @param spinnerFrame Optional animation frame counter for loading spinner
 * @returns Formatted string with color tags
 */
export function buildAgentNode(
  agent: EventActor,
  charSet?: CharSet,
  spinnerFrame?: number
): string {
  const color = AGENT_COLORS[agent] || AGENT_COLORS.frontman;
  const cs = charSet ?? getCharSet();

  if (spinnerFrame !== undefined && cs === CHAR_SETS.unicode) {
    const spinnerChar = SPINNERS[spinnerFrame % SPINNERS.length];
    return `{${color}-fg}${spinnerChar}{/${color}-fg}`;
  }

  return `{${color}-fg}${cs.box}{/${color}-fg}`;
}

/**
 * Builds a horizontal rail segment with an animated dot at specified progress,
 * ending cleanly without arrowheads.
 *
 * @param totalChars Total number of characters in the rail
 * @param progress Animation progress (0..1) where dot travels from left to right
 * @param charSet Character set to use
 * @returns Formatted string representing the rail
 */
export function buildRailSegment(totalChars: number, progress: number, charSet: CharSet): string {
  const pos = Math.round(Math.max(0, Math.min(1, progress)) * (totalChars - 1));
  let rail = '';

  for (let i = 0; i < totalChars; i++) {
    if (i === pos) {
      rail += charSet.dot;
    } else {
      rail += charSet.rail;
    }
  }

  return rail;
}

/**
 * Dispatch edge interface for graph visualization
 */
export interface DispatchEdge {
  source: 'frontman';
  target: EventActor;
  taskId: string | null;
  startTime: number;
  nextPlayAt?: number;
}

/**
 * Activity graph rendering options
 */
export interface GraphRenderOptions {
  edges: DispatchEdge[];
  charSet?: CharSet;
  spinnerFrame?: number;
  frontmanState?: 'thinking' | 'asking' | 'idle';
  activity?: FrontmanActivity | null;
}

/**
 * Computes animation state for each edge
 * Returns edges with progress values clamped and next play times scheduled
 */
function computeEdgeStates(
  edges: DispatchEdge[],
  now: number
): Array<{
  edge: DispatchEdge;
  progress: number;
}> {
  const results: Array<{ edge: DispatchEdge; progress: number }> = [];

  for (const edge of edges) {
    const elapsed = now - edge.startTime;
    const cycleDuration = 2000; // 2 seconds per animation cycle

    let linearProgress = elapsed / cycleDuration;

    if (linearProgress >= 1) {
      // Check if we should replay
      if (!edge.nextPlayAt || now >= edge.nextPlayAt) {
        // Start new cycle
        linearProgress = ((now - edge.startTime) % cycleDuration) / cycleDuration;
        // Schedule next replay 1 second after completion
        edge.nextPlayAt = edge.startTime + cycleDuration + 1000;
      } else {
        // Not time to replay yet, hold at 1
        linearProgress = 1;
      }
    }

    const clampedLinear = Math.min(1, Math.max(0, linearProgress));
    // Apply cubic ease-in-out curve for natural acceleration and deceleration
    const progress = linearProgress >= 1 ? 1 : easeInOutCubic(clampedLinear);

    results.push({
      edge,
      progress,
    });
  }

  return results;
}

/**
 * Returns the color legend line explaining agent roles (always with solid square shapes)
 *
 * @param charSet Optional character set to use for legend icons
 */
export function renderLegend(charSet?: CharSet): string {
  const cs = charSet ?? getCharSet();
  return (
    `   Legend: ` +
    `{yellow-fg}${cs.box}{/yellow-fg} Frontman  ` +
    `{cyan-fg}${cs.box}{/cyan-fg} Scout  ` +
    `{magenta-fg}${cs.box}{/magenta-fg} Planner  ` +
    `{green-fg}${cs.box}{/green-fg} Executor`
  );
}

/**
 * Renders the complete activity graph with a clean frontman -> agent layout
 * and color legend below.
 *
 * Layout:
 *   [Frontman] ─────────●──────── [Agent 1]
 *              │
 *              ├────────●──────── [Agent 2]
 *              │
 *              └────────●──────── [Agent 3]
 *
 *   Legend: ■ Frontman  ■ Scout  ■ Planner  ■ Executor
 *
 * @param options Graph configuration
 * @returns Multi-line string representing the graph
 */
export function renderGraph(options: GraphRenderOptions): string {
  const {
    edges,
    charSet: explicitCharSet,
    spinnerFrame,
    frontmanState = 'idle',
    activity,
  } = options;

  // Auto-detect character set if not provided
  const charSet = explicitCharSet ?? getCharSet();
  const legend = renderLegend(charSet);

  if (edges.length === 0) {
    let stateDescription = '{gray-fg}── (idle · waiting for dispatch){/gray-fg}';
    let frontmanNode = buildAgentNode('frontman', charSet);

    if (activity) {
      const msgSuffix = activity.message ? `: ${activity.message}` : '';
      switch (activity.activityType) {
        case 'questioning':
          frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
          stateDescription = `{cyan-fg}── (asking user question${msgSuffix}){/cyan-fg}`;
          break;
        case 'awaiting_response':
          frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
          stateDescription = `{cyan-fg}── (awaiting user response${msgSuffix}){/cyan-fg}`;
          break;
        case 'analyzing':
          frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
          stateDescription = `{gray-fg}── (analyzing requirements${msgSuffix}){/gray-fg}`;
          break;
        case 'planning':
          frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
          stateDescription = `{gray-fg}── (planning tasks${msgSuffix}){/gray-fg}`;
          break;
        case 'orchestrating':
          frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
          stateDescription = `{gray-fg}── (orchestrating subagents${msgSuffix}){/gray-fg}`;
          break;
        case 'reviewing':
          frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
          stateDescription = `{gray-fg}── (reviewing progress${msgSuffix}){/gray-fg}`;
          break;
        case 'idle':
        default:
          frontmanNode = buildAgentNode('frontman', charSet);
          stateDescription = `{gray-fg}── (idle · waiting for dispatch${msgSuffix}){/gray-fg}`;
          break;
      }
    } else if (frontmanState === 'asking') {
      frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
      stateDescription = '{cyan-fg}── (asking user question · waiting for response){/cyan-fg}';
    } else if (frontmanState === 'thinking') {
      frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
      stateDescription = '{gray-fg}── (thinking · analyzing requirements / tasks){/gray-fg}';
    }

    return [`   ${frontmanNode} ${stateDescription}`, '', legend].join('\n');
  }

  const now = Date.now();
  const computedEdges = computeEdgeStates([...edges], now);

  const maxVisible = 6;
  const visibleEdges = computedEdges.slice(0, maxVisible);
  const lines: string[] = [];

  const railLen = 22;

  for (let i = 0; i < visibleEdges.length; i++) {
    const { edge, progress } = visibleEdges[i];
    const rail = buildRailSegment(railLen, progress, charSet);
    const targetNode = buildAgentNode(edge.target, charSet, spinnerFrame);

    if (i === 0) {
      // First line: Frontman connected directly to first target
      const frontmanNode = buildAgentNode('frontman', charSet, spinnerFrame);
      lines.push(`   ${frontmanNode} ${charSet.rail}${rail}${charSet.rail} ${targetNode}`);
    } else {
      // Subsequent subagents: branch vertically right underneath Frontman's connector
      const isLast = i === visibleEdges.length - 1 && computedEdges.length <= maxVisible;
      const branchChar = isLast ? charSet.corner : charSet.tee;
      lines.push(`     ${branchChar}${charSet.rail}${rail}${charSet.rail} ${targetNode}`);
    }
  }

  if (computedEdges.length > maxVisible) {
    const hiddenCount = computedEdges.length - maxVisible;
    lines.push(`     ${charSet.corner}${charSet.rail} ... +${hiddenCount} more dispatches`);
  }

  lines.push('');
  lines.push(legend);

  return lines.join('\n');
}
