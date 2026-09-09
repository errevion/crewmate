import type { EditorState } from './state.js';
import { computeGraphLayout } from './graph-layout.js';

/**
 * 2D Character Buffer for rendering high-clarity graph visualizations.
 * Includes box drawing, orthogonal routing for edges, and viewport windowing.
 */
export class CanvasBuffer {
  public width: number;
  public height: number;
  private grid: Array<Array<{ char: string; tag?: string }>>;

  /**
   *
   */
  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.grid = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => ({ char: ' ' }))
    );
  }

  /**
   *
   */
  public set(x: number, y: number, char: string, tag?: string): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.grid[y][x] = { char, tag };
    }
  }

  /**
   *
   */
  public writeString(x: number, y: number, text: string, tag?: string): void {
    for (let i = 0; i < text.length; i++) {
      this.set(x + i, y, text[i], tag);
    }
  }

  /**
   *
   */
  public drawBox(
    x: number,
    y: number,
    w: number,
    h: number,
    title?: string,
    borderTag?: string,
    selected = false
  ): void {
    const tl = selected ? '╔' : '┌';
    const tr = selected ? '╗' : '┐';
    const bl = selected ? '╚' : '└';
    const br = selected ? '╝' : '┘';
    const horiz = selected ? '═' : '─';
    const vert = selected ? '║' : '│';

    // Corners
    this.set(x, y, tl, borderTag);
    this.set(x + w - 1, y, tr, borderTag);
    this.set(x, y + h - 1, bl, borderTag);
    this.set(x + w - 1, y + h - 1, br, borderTag);

    // Horizontal edges
    for (let cx = x + 1; cx < x + w - 1; cx++) {
      this.set(cx, y, horiz, borderTag);
      this.set(cx, y + h - 1, horiz, borderTag);
    }

    // Vertical edges
    for (let cy = y + 1; cy < y + h - 1; cy++) {
      this.set(x, cy, vert, borderTag);
      this.set(x + w - 1, cy, vert, borderTag);
    }

    // Clear interior
    for (let cy = y + 1; cy < y + h - 1; cy++) {
      for (let cx = x + 1; cx < x + w - 1; cx++) {
        this.set(cx, cy, ' ');
      }
    }

    // Title on top border
    if (title && w > 4) {
      const maxTitleLen = w - 4;
      const truncated = title.length > maxTitleLen ? title.slice(0, maxTitleLen - 1) + '…' : title;
      const startX = x + 2;
      this.writeString(startX, y, ` ${truncated} `, borderTag);
    }
  }

  /**
   * Draw an orthogonal edge connector with condition labels and directional arrow.
   * `routeIndex` is used to offset parallel/overlapping edges so they don't visually collide.
   */
  public drawEdge(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    label?: string,
    selected = false,
    isCycle = false,
    routeIndex = 0,
    isObstructed = false
  ): void {
    // Selected ALWAYS takes highest precedence so selected edges turn bright green!
    const lineTag = selected ? '{bold}{green-fg}' : isCycle ? '{yellow-fg}' : '{gray-fg}';

    const labelTag = selected ? '{bold}{green-fg}' : '{yellow-fg}';

    if (fromX < toX) {
      // Forward edge
      if (fromY === toY && !isObstructed && routeIndex === 0) {
        // Direct same-row straight horizontal connection without obstacles!
        for (let x = fromX + 1; x < toX - 1; x++) {
          this.set(x, fromY, '─', lineTag);
        }
        // Target arrow
        this.set(toX - 1, toY, '►', lineTag);

        // Edge label above the straight line
        if (label) {
          const midX = Math.floor((fromX + toX) / 2);
          const labelText = `(${label})`;
          const labelX = Math.max(fromX + 1, midX - Math.floor(labelText.length / 2));
          this.writeString(labelX, Math.max(0, fromY - 1), labelText, labelTag);
        }
      } else if (fromY === toY && (isObstructed || routeIndex > 0)) {
        // Same-row edge that either skips over intermediate nodes or is a parallel edge!
        // Route overhead via bridge so it does NOT collide or disappear behind other nodes
        const overheadY = Math.max(0, fromY - 3 - routeIndex * 2);
        const exitX = fromX + 1 + (routeIndex % 2);
        const enterX = toX - 2 - (routeIndex % 2);

        // Turn up
        this.set(exitX, fromY, '┐', lineTag);
        for (let y = overheadY + 1; y < fromY; y++) {
          this.set(exitX, y, '│', lineTag);
        }
        this.set(exitX, overheadY, '┌', lineTag);

        // Bridge horizontally overhead
        for (let x = exitX + 1; x < enterX; x++) {
          this.set(x, overheadY, '─', lineTag);
        }
        this.set(enterX, overheadY, '┐', lineTag);

        // Turn down into target
        for (let y = overheadY + 1; y < toY; y++) {
          this.set(enterX, y, '│', lineTag);
        }
        this.set(enterX, toY, '└', lineTag);

        for (let x = enterX + 1; x < toX - 1; x++) {
          this.set(x, toY, '─', lineTag);
        }
        this.set(toX - 1, toY, '►', lineTag);

        if (label) {
          const midX = Math.floor((exitX + enterX) / 2);
          const labelText = `(${label})`;
          const labelX = Math.max(exitX + 1, midX - Math.floor(labelText.length / 2));
          this.writeString(labelX, Math.max(0, overheadY - 1), labelText, labelTag);
        }
      } else {
        // Cross-row edge: routes horizontally, then vertically at an offset midX, then horizontally into target
        const channelOffset = (routeIndex % 3) * 2;
        const midX = Math.min(
          toX - 3,
          Math.max(fromX + 3, Math.floor((fromX + toX) / 2) + channelOffset)
        );

        // Horizontal segment 1: fromX -> midX at fromY
        for (let x = fromX + 1; x < midX; x++) {
          this.set(x, fromY, '─', lineTag);
        }

        // Vertical segment: fromY -> toY at midX
        const minY = Math.min(fromY, toY);
        const maxY = Math.max(fromY, toY);
        for (let y = minY + 1; y < maxY; y++) {
          this.set(midX, y, '│', lineTag);
        }

        // Junction corners
        if (toY > fromY) {
          this.set(midX, fromY, '┐', lineTag);
          this.set(midX, toY, '└', lineTag);
        } else {
          this.set(midX, fromY, '┘', lineTag);
          this.set(midX, toY, '┌', lineTag);
        }

        // Horizontal segment 2: midX -> toX at toY
        for (let x = midX + 1; x < toX - 1; x++) {
          this.set(x, toY, '─', lineTag);
        }

        // Target arrow head drawn outside the target box border
        this.set(toX - 1, toY, '►', lineTag);

        // Edge label
        if (label) {
          const labelText = `(${label})`;
          const labelX = Math.max(fromX + 1, midX - Math.floor(labelText.length / 2));
          const labelY = minY;
          this.writeString(labelX, Math.max(0, labelY), labelText, labelTag);
        }
      }
    } else {
      // Backward or vertical edge (loops or rearranged nodes)
      const heightStagger = routeIndex * 2;
      const pushoutStagger = routeIndex * 2;

      if (fromY === toY) {
        // Same-row loopback: route above nodes, pushing out to the right first
        const loopY = Math.max(0, fromY - 2 - heightStagger);
        const exitX = fromX + 2 + pushoutStagger;
        const enterX = toX - 2 - pushoutStagger;

        // Push out horizontally to the right
        for (let x = fromX + 1; x < exitX; x++) {
          this.set(x, fromY, '─', lineTag);
        }
        this.set(exitX, fromY, '┐', lineTag);

        // Go up to the overhead track
        for (let y = loopY + 1; y < fromY; y++) {
          this.set(exitX, y, '│', lineTag);
        }
        this.set(exitX, loopY, '┌', lineTag);

        // Go across to the left
        for (let x = enterX + 1; x < exitX; x++) {
          this.set(x, loopY, '─', lineTag);
        }

        // Go down on the left of target node
        this.set(enterX, loopY, '┐', lineTag);
        for (let y = loopY + 1; y < toY; y++) {
          this.set(enterX, y, '│', lineTag);
        }
        this.set(enterX, toY, '└', lineTag);

        // Lead directly into the target node
        for (let x = enterX + 1; x < toX - 1; x++) {
          this.set(x, toY, '─', lineTag);
        }
        // Enter target node with arrow head
        this.set(toX - 1, toY, '►', lineTag);

        if (label) {
          const midX = Math.floor((fromX + toX) / 2);
          const labelText = `(${label})`;
          this.writeString(midX, Math.max(0, loopY - 1), labelText, labelTag);
        }
      } else {
        // Different rows: route vertically then horizontally
        const minY = Math.min(fromY, toY);
        const maxY = Math.max(fromY, toY);
        const midY = Math.floor((fromY + toY) / 2);
        const pushoutStagger = routeIndex * 3;
        const exitX = fromX + 2 + pushoutStagger;
        const enterX = toX - 2 - pushoutStagger;

        // Push out to the right before turning
        for (let x = fromX + 1; x < exitX; x++) {
          this.set(x, fromY, '─', lineTag);
        }
        this.set(exitX, fromY, toY > fromY ? '┐' : '┘', lineTag);

        for (let y = minY + 1; y < maxY; y++) {
          this.set(exitX, y, '│', lineTag);
        }
        this.set(exitX, toY, toY > fromY ? '┘' : '┐', lineTag);

        for (let x = enterX + 1; x < exitX; x++) {
          this.set(x, toY, '─', lineTag);
        }

        for (let x = enterX + 1; x < toX - 1; x++) {
          this.set(x, toY, '─', lineTag);
        }
        this.set(toX - 1, toY, '►', lineTag);

        if (label) {
          const labelText = `(${label})`;
          // Stagger label Y by direction and routeIndex so bidirectional vertical edges never overlap labels
          const labelY =
            toY > fromY
              ? Math.max(minY + 1, midY - 1 - routeIndex * 2)
              : Math.min(maxY - 1, midY + 1 + routeIndex * 2);
          this.writeString(exitX + 1, labelY, labelText, labelTag);
        }
      }
    }
  }

  /**
   * Extracts a window into the canvas based on viewport scroll offset
   */
  public renderWindow(
    viewX: number,
    viewY: number,
    viewWidth: number,
    viewHeight: number
  ): string[] {
    const lines: string[] = [];

    for (let vy = 0; vy < viewHeight; vy++) {
      const cy = viewY + vy;
      let line = '';
      let currentTag: string | undefined = undefined;

      for (let vx = 0; vx < viewWidth; vx++) {
        const cx = viewX + vx;
        if (cy >= 0 && cy < this.height && cx >= 0 && cx < this.width) {
          const cell = this.grid[cy][cx];
          if (cell.tag !== currentTag) {
            if (currentTag) {
              line += '{/}';
            }
            if (cell.tag) {
              line += cell.tag;
            }
            currentTag = cell.tag;
          }
          line += cell.char;
        } else {
          if (currentTag) {
            line += '{/}';
            currentTag = undefined;
          }
          line += ' ';
        }
      }

      if (currentTag) {
        line += '{/}';
      }

      lines.push(line);
    }

    return lines;
  }
}

/**
 * Renders the top-level Workflow view where STAGES are displayed as interactive graph nodes
 */
export function renderWorkflowStageGraphCanvas(
  state: EditorState,
  viewportWidth: number,
  viewportHeight: number
): {
  content: string;
  virtualWidth: number;
  virtualHeight: number;
  viewportX: number;
  viewportY: number;
} {
  const stageGraph = state.workflowGraph;
  const layoutResult = computeGraphLayout(stageGraph, state.stagePositions, {
    nodeWidth: 32,
    nodeHeight: 6,
    horizontalSpacing: 10,
    verticalSpacing: 3,
  });

  const { layouts, canvasWidth, canvasHeight } = layoutResult;
  const buffer = new CanvasBuffer(canvasWidth, canvasHeight);

  // 1. Draw inter-stage transition edges
  for (let eIdx = 0; eIdx < stageGraph.edges.length; eIdx++) {
    const edge = stageGraph.edges[eIdx];
    const fromLayout = layouts.get(edge.from);
    const toLayout = layouts.get(edge.to);

    if (fromLayout && toLayout) {
      const fromX = fromLayout.x + fromLayout.width - 1;
      const fromY = fromLayout.y + Math.floor(fromLayout.height / 2);
      const toX = toLayout.x;
      const toY = toLayout.y + Math.floor(toLayout.height / 2);

      buffer.drawEdge(fromX, fromY, toX, toY, 'next', false, false);
    }
  }

  // 2. Draw Stage Nodes as super-boxes
  for (let i = 0; i < state.workflow.stages.length; i++) {
    const stage = state.workflow.stages[i];
    const layout = layouts.get(stage.id);
    if (!layout) {
      continue;
    }

    const isSelected = state.selectedStageId === stage.id;
    const borderTag = isSelected ? '{bold}{green-fg}' : '{bold}{magenta-fg}';

    const stageTitle = `[STAGE ${i + 1}/${state.workflow.stages.length}]`;
    buffer.drawBox(
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      stageTitle,
      borderTag,
      isSelected
    );

    // Line 1: Stage Name
    const nameText =
      stage.name.length > layout.width - 4
        ? stage.name.slice(0, layout.width - 5) + '…'
        : stage.name;
    const titleTag = isSelected ? '{bold}{white-fg}' : '{white-fg}';
    buffer.writeString(layout.x + 2, layout.y + 1, nameText, titleTag);

    // Line 2: ID
    buffer.writeString(layout.x + 2, layout.y + 2, `id: ${stage.id}`, '{gray-fg}');

    // Line 3: Inner graph summary
    const innerNodes = stage.graph?.nodes?.length ?? 0;
    const innerEdges = stage.graph?.edges?.length ?? 0;
    const summaryText = `${innerNodes} node${innerNodes === 1 ? '' : 's'} · ${innerEdges} edge${innerEdges === 1 ? '' : 's'}`;
    buffer.writeString(layout.x + 2, layout.y + 3, summaryText, '{cyan-fg}');

    // Line 4: Drill-down hint
    if (isSelected) {
      buffer.writeString(
        layout.x + 2,
        layout.y + 4,
        'Enter: Edit Stage Graph ►',
        '{bold}{yellow-fg}'
      );
    } else {
      buffer.writeString(layout.x + 2, layout.y + 4, '─────────────────────────', '{gray-fg}');
    }
  }

  const windowLines = buffer.renderWindow(
    state.viewportOffset.x,
    state.viewportOffset.y,
    viewportWidth,
    viewportHeight
  );

  return {
    content: windowLines.join('\n'),
    virtualWidth: canvasWidth,
    virtualHeight: canvasHeight,
    viewportX: state.viewportOffset.x,
    viewportY: state.viewportOffset.y,
  };
}

/**
 * Main dispatcher to render either the top-level Workflow graph or the inner Stage graph
 */
export function renderGraphCanvas(
  state: EditorState,
  viewportWidth: number,
  viewportHeight: number
): {
  content: string;
  virtualWidth: number;
  virtualHeight: number;
  viewportX: number;
  viewportY: number;
} {
  if (state.viewLevel === 'workflow') {
    return renderWorkflowStageGraphCanvas(state, viewportWidth, viewportHeight);
  }

  const graph = state.currentGraph;
  const layoutResult = computeGraphLayout(graph, state.nodePositions);
  const { layouts, canvasWidth, canvasHeight } = layoutResult;

  const buffer = new CanvasBuffer(canvasWidth, canvasHeight);

  // 1. Draw Edges first (under nodes) with unique routing index and obstacle detection
  const routeCounters = new Map<string, number>();
  const outgoingPortIndices = new Map<string, number>();

  // Count total outgoing edges per node to distribute ports if there are multiple
  const totalOutgoingPerNode = new Map<string, number>();
  for (const edge of graph.edges) {
    totalOutgoingPerNode.set(edge.from, (totalOutgoingPerNode.get(edge.from) || 0) + 1);
  }

  for (let eIdx = 0; eIdx < graph.edges.length; eIdx++) {
    const edge = graph.edges[eIdx];
    const fromLayout = layouts.get(edge.from);
    const toLayout = layouts.get(edge.to);

    if (fromLayout && toLayout) {
      const fromCenterY = fromLayout.y + Math.floor(fromLayout.height / 2);
      const toCenterY = toLayout.y + Math.floor(toLayout.height / 2);

      // Multi-port fanout: if a node has multiple outgoing edges, distribute exit pins vertically
      const totalOut = totalOutgoingPerNode.get(edge.from) || 1;
      const portIdx = outgoingPortIndices.get(edge.from) || 0;
      outgoingPortIndices.set(edge.from, portIdx + 1);

      let fromY = fromCenterY;
      if (totalOut > 1) {
        // e.g. 2 edges: -1, +1; 3 edges: -1, 0, +1
        const offset = portIdx === 0 ? -1 : portIdx === 1 ? 1 : 0;
        fromY = Math.max(
          fromLayout.y + 1,
          Math.min(fromLayout.y + fromLayout.height - 2, fromCenterY + offset)
        );
      }

      const fromX = fromLayout.x + fromLayout.width - 1;
      const toX = toLayout.x;
      const toY = toCenterY;

      const isSelected = state.selectedEdgeIndex === eIdx;
      const isCycle = toX <= fromX;

      // Group edges between the same two nodes (regardless of direction) to guarantee distinct routing lanes and non-overlapping labels
      const pairKey = [edge.from, edge.to].sort().join('<->');
      const routeIdx = routeCounters.get(pairKey) || 0;
      routeCounters.set(pairKey, routeIdx + 1);

      // Check if an intermediate node sits between fromX and toX on this row (skip-layer edge obstacle)
      const isObstructed =
        !isCycle &&
        fromY === toY &&
        graph.nodes.some((other) => {
          if (other.id === edge.from || other.id === edge.to) {
            return false;
          }
          const otherLayout = layouts.get(other.id);
          if (!otherLayout) {
            return false;
          }
          const nodeLeft = otherLayout.x;
          const nodeRight = otherLayout.x + otherLayout.width;
          const nodeTop = otherLayout.y;
          const nodeBottom = otherLayout.y + otherLayout.height;
          return nodeLeft > fromX && nodeRight < toX && fromY >= nodeTop && fromY <= nodeBottom;
        });

      let conditionLabel: string | undefined = undefined;
      if (edge.condition) {
        if (edge.condition.type === 'on_success') {
          conditionLabel = 'on_success';
        } else if (edge.condition.type === 'on_failure') {
          conditionLabel = 'on_failure';
        } else if (edge.condition.type === 'expression') {
          conditionLabel = edge.condition.expression;
        } else if (edge.condition.field) {
          conditionLabel = `${edge.condition.field}`;
        } else {
          conditionLabel = edge.condition.type;
        }
      }

      buffer.drawEdge(
        fromX,
        fromY,
        toX,
        toY,
        conditionLabel,
        isSelected,
        isCycle,
        routeIdx,
        isObstructed
      );
    }
  }

  // 2. Draw Nodes
  for (const node of graph.nodes) {
    const layout = layouts.get(node.id);
    if (!layout) {
      continue;
    }

    const isSelected = state.selectedNodeId === node.id;
    const isPendingSource = state.pendingEdgeSourceId === node.id;
    const isStart = state.isStartNode(node.id);
    const isEnd = state.isEndNode(node.id);

    let borderTag: string;
    if (isPendingSource) {
      borderTag = '{bold}{yellow-fg}';
    } else if (isSelected) {
      borderTag = '{bold}{green-fg}';
    } else if (isStart) {
      borderTag = '{bold}{white-fg}'; // Distinct border for start node
    } else {
      switch (node.type) {
        case 'agent':
          borderTag = '{cyan-fg}';
          break;
        case 'condition':
          borderTag = '{yellow-fg}';
          break;
        case 'task':
          borderTag = '{magenta-fg}';
          break;
        case 'tool':
          borderTag = '{blue-fg}';
          break;
        case 'transform':
          borderTag = '{green-fg}';
          break;
        default:
          borderTag = '{white-fg}';
          break;
      }
    }

    // Role indicator prefix: ▶ for START node, ■ for END node
    const rolePrefix = isStart ? '▶ ' : isEnd ? '■ ' : '';
    const typePrefix = `[${rolePrefix}${node.type.toUpperCase()}]`;

    buffer.drawBox(
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      typePrefix,
      borderTag,
      isSelected || isPendingSource
    );

    const contentTag = isSelected ? '{bold}{white-fg}' : '{white-fg}';
    const idText =
      node.id.length > layout.width - 4 ? node.id.slice(0, layout.width - 5) + '…' : node.id;
    buffer.writeString(layout.x + 2, layout.y + 1, idText, contentTag);

    const cfg = (node.config || {}) as Record<string, unknown>;
    let detail = '';
    if (node.type === 'agent' && cfg.agent) {
      detail = `agent: ${cfg.agent}`;
    } else if (node.type === 'task' && cfg.title) {
      detail = `${cfg.title}`;
    } else if (node.type === 'condition' && (cfg.field || cfg.expression)) {
      detail = `${cfg.field || cfg.expression}`;
    } else if (node.type === 'tool' && cfg.tool) {
      detail = `tool: ${cfg.tool}`;
    }

    if (detail) {
      const maxDetail = layout.width - 4;
      const truncatedDetail =
        detail.length > maxDetail ? detail.slice(0, maxDetail - 1) + '…' : detail;
      buffer.writeString(layout.x + 2, layout.y + 2, truncatedDetail, '{gray-fg}');
    }
  }

  // 3. Extract viewport window
  const windowLines = buffer.renderWindow(
    state.viewportOffset.x,
    state.viewportOffset.y,
    viewportWidth,
    viewportHeight
  );

  return {
    content: windowLines.join('\n'),
    virtualWidth: canvasWidth,
    virtualHeight: canvasHeight,
    viewportX: state.viewportOffset.x,
    viewportY: state.viewportOffset.y,
  };
}
