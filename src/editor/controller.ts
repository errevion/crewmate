import type { NodeDefinition, NodeType } from '../models/graph.js';
import type { EditorState } from './state.js';
import type { EditorWidgets } from './ui.js';
import { renderGraphCanvas } from './canvas.js';
import { validateConnection } from './edge-validator.js';
import { serializeWorkflowToModularFiles } from './serializer.js';

/**
 * Controller class coordinating interactions, keyboard events, and UI updates
 * Supports two-level graph navigation:
 * 1. Workflow View (Stages as graph nodes)
 * 2. Stage View (Internal stage graph with tasks, agents, tools)
 */
export class EditorController {
  private state: EditorState;
  private widgets: EditorWidgets;
  private onExitCallback: () => void;

  /**
   *
   */
  constructor(state: EditorState, widgets: EditorWidgets, onExit: () => void) {
    this.state = state;
    this.widgets = widgets;
    this.onExitCallback = onExit;

    this.bindGlobalKeys();
    this.refreshUI();
  }

  /**
   *
   */
  public isModalOpen(): boolean {
    return (
      !this.widgets.inputPrompt.hidden ||
      !this.widgets.paletteModal.hidden ||
      !this.widgets.conditionModal.hidden ||
      !this.widgets.stageModal.hidden ||
      !this.widgets.confirmModal.hidden ||
      !this.widgets.propertyModal.hidden ||
      !this.widgets.helpModal.hidden
    );
  }

  /**
   *
   */
  public refreshUI(): void {
    this.renderHeader();
    this.renderCanvas();
    this.renderSidebar();
    this.renderFooter();
    this.widgets.screen.render();
  }

  private renderHeader(): void {
    const wf = this.state.workflow;
    const stage = this.state.currentStage;
    const stageIdx = this.state.currentStageIndex + 1;
    const stageCount = wf.stages.length;

    const modifiedBadge = this.state.isModified
      ? '{yellow-fg}[modified]{/yellow-fg}'
      : '{green-fg}[saved]{/green-fg}';

    const headerText =
      this.state.viewLevel === 'workflow'
        ? [
            `{bold}{cyan-fg}Workflow Level Graph:{/cyan-fg}{/bold} ${wf.name} (v${wf.version || '1.0.0'})  ·  ${modifiedBadge}`,
            `{bold}{magenta-fg}Stages Overview:{/magenta-fg}{/bold} ${stageCount} stages total  ·  Selected: {bold}{green-fg}${this.state.selectedStageId || stage.id}{/green-fg}{/bold}  ·  {yellow-fg}[Enter: Drill Into Stage]{/yellow-fg}`,
          ].join('\n')
        : [
            `{bold}{cyan-fg}Workflow:{/cyan-fg}{/bold} ${wf.name}  ·  {bold}{yellow-fg}Stage [${stageIdx}/${stageCount}]:{/yellow-fg}{/bold} ${stage.name}{/bold} ({gray-fg}${stage.id}{/gray-fg})  ·  ${modifiedBadge}`,
            `Nodes: {cyan-fg}${stage.graph.nodes.length}{/cyan-fg}  ·  Edges: {magenta-fg}${stage.graph.edges.length}{/magenta-fg}  ·  {yellow-fg}[Backspace / Esc: Zoom Out to Workflow]{/yellow-fg}`,
          ].join('\n');

    this.widgets.headerBox.setContent(headerText);
  }

  private renderCanvas(): void {
    const canvasInnerWidth = (this.widgets.canvasBox.width as number) - 2;
    const canvasInnerHeight = (this.widgets.canvasBox.height as number) - 2;

    const rendered = renderGraphCanvas(
      this.state,
      Math.max(10, canvasInnerWidth),
      Math.max(5, canvasInnerHeight)
    );

    const maxX = Math.max(0, rendered.virtualWidth - canvasInnerWidth);
    const maxY = Math.max(0, rendered.virtualHeight - canvasInnerHeight);

    const viewBadge =
      this.state.viewLevel === 'workflow'
        ? 'WORKFLOW VIEW (Stages)'
        : `STAGE VIEW: ${this.state.currentStage.name}`;
    this.widgets.canvasBox.setLabel(
      ` [${viewBadge}] Pan: (${rendered.viewportX}, ${rendered.viewportY}) / Max: (${maxX}, ${maxY}) `
    );

    this.widgets.canvasBox.setContent(rendered.content);
  }

  private renderSidebar(): void {
    const lines: string[] = [];

    if (this.state.viewLevel === 'workflow') {
      // Sidebar for Workflow / Stage level
      const selectedStage =
        this.state.workflow.stages.find((s) => s.id === this.state.selectedStageId) ||
        this.state.currentStage;

      lines.push(`{bold}{magenta-fg}► SELECTED STAGE{/magenta-fg}{/bold}`);
      lines.push(`{bold}ID:{/bold} ${selectedStage.id}`);
      lines.push(`{bold}Name:{/bold} {cyan-fg}${selectedStage.name}{/cyan-fg}`);
      if (selectedStage.description) {
        lines.push(`{bold}Desc:{/bold} {gray-fg}${selectedStage.description}{/gray-fg}`);
      }

      lines.push('');
      lines.push(`{bold}{yellow-fg}Inner Graph Details:{/yellow-fg}{/bold}`);
      const nodeCount = selectedStage.graph?.nodes?.length ?? 0;
      const edgeCount = selectedStage.graph?.edges?.length ?? 0;
      lines.push(` • Nodes: {cyan-fg}${nodeCount}{/cyan-fg}`);
      lines.push(` • Edges: {magenta-fg}${edgeCount}{/magenta-fg}`);

      if (nodeCount > 0) {
        lines.push('');
        lines.push(`{bold}Stage Nodes:{/bold}`);
        for (const n of selectedStage.graph.nodes.slice(0, 6)) {
          lines.push(` • {bold}${n.id}{/bold} ({gray-fg}${n.type}{/gray-fg})`);
        }
        if (nodeCount > 6) {
          lines.push(`   {gray-fg}...and ${nodeCount - 6} more{/gray-fg}`);
        }
      }

      lines.push('');
      lines.push('{bold}{green-fg}Actions:{/green-fg}{/bold}');
      lines.push(' • {bold}Enter{/bold}: Edit Stage Graph');
      lines.push(' • {bold}n{/bold}: Add New Stage');
      lines.push(' • {bold}d{/bold}: Delete Stage');
      lines.push(' • {bold}← / →{/bold} (h/l): Reorder');
    } else {
      // Sidebar for Stage / Node level
      const graph = this.state.currentGraph;

      if (this.state.selectedNodeId) {
        const node = graph.nodes.find((n) => n.id === this.state.selectedNodeId);
        if (node) {
          lines.push(`{bold}{green-fg}► SELECTED NODE{/green-fg}{/bold}`);
          lines.push(`{bold}ID:{/bold} ${node.id}`);
          lines.push(`{bold}Type:{/bold} {cyan-fg}${node.type}{/cyan-fg}`);
          if (node.name) {
            lines.push(`{bold}Name:{/bold} ${node.name}`);
          }

          // Role indicator
          const isStart = this.state.isStartNode(node.id);
          const isEnd = this.state.isEndNode(node.id);
          const roleLabel = isStart
            ? '{bold}{green-fg}START NODE (entry){/green-fg}{/bold}'
            : isEnd
              ? '{bold}{yellow-fg}END NODE (exit){/yellow-fg}{/bold}'
              : '{gray-fg}INTERMEDIATE{/gray-fg}';
          lines.push(`{bold}Role:{/bold} ${roleLabel}`);

          lines.push('');
          lines.push(`{bold}{yellow-fg}Config:{/yellow-fg}{/bold}`);
          const cfg = (node.config || {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(cfg)) {
            const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            lines.push(` • {gray-fg}${k}:{/gray-fg} ${valStr}`);
          }

          const outgoing = graph.edges.filter((e) => e.from === node.id);
          lines.push('');
          lines.push(`{bold}{magenta-fg}Outgoing Edges (${outgoing.length}):{/magenta-fg}{/bold}`);
          for (const e of outgoing) {
            const cond = e.condition?.type || 'always';
            lines.push(` → {bold}${e.to}{/bold} {yellow-fg}(${cond}){/yellow-fg}`);
          }

          const incoming = graph.edges.filter((e) => e.to === node.id);
          lines.push('');
          lines.push(`{bold}{blue-fg}Incoming Edges (${incoming.length}):{/blue-fg}{/bold}`);
          for (const e of incoming) {
            lines.push(` ← {bold}${e.from}{/bold}`);
          }

          lines.push('');
          lines.push('{bold}{yellow-fg}Shortcuts:{/yellow-fg}{/bold}');
          lines.push(' • {bold}i{/bold}: Toggle Start Node role');
          lines.push(' • {bold}e{/bold}: Connect edge to another node');
          lines.push(' • {bold}x{/bold}: Delete this node');
        }
      } else if (this.state.selectedEdgeIndex !== null) {
        const edge = graph.edges[this.state.selectedEdgeIndex];
        if (edge) {
          lines.push(`{bold}{green-fg}► SELECTED EDGE{/green-fg}{/bold}`);
          lines.push(`{bold}From:{/bold} {cyan-fg}${edge.from}{/cyan-fg}`);
          lines.push(`{bold}To:{/bold} {magenta-fg}${edge.to}{/magenta-fg}`);
          lines.push(
            `{bold}Condition:{/bold} {yellow-fg}${edge.condition?.type || 'always'}{/yellow-fg}`
          );
          if (edge.condition?.expression) {
            lines.push(`{bold}Expression:{/bold} ${edge.condition.expression}`);
          }
          if (edge.condition?.field) {
            lines.push(
              `{bold}Field check:{/bold} ${edge.condition.field} (${edge.condition.operator || 'truthy'})`
            );
          }
        }
      } else {
        lines.push('{gray-fg}No element selected.{/gray-fg}');
        lines.push('');
        lines.push('Press {bold}Tab{/bold} to select nodes,');
        lines.push('or {bold}n{/bold} to add a new node.');
      }
    }

    // Node Discovery summary
    lines.push('');
    lines.push(`{bold}{cyan-fg}── Discovered Library ──{/cyan-fg}{/bold}`);
    if (this.state.discoveredNodes.length === 0) {
      lines.push('{gray-fg}(no custom node templates found){/gray-fg}');
    } else {
      lines.push(`Found {green-fg}${this.state.discoveredNodes.length}{/green-fg} local nodes.`);
      for (const d of this.state.discoveredNodes.slice(0, 4)) {
        lines.push(` • {bold}${d.node.id}{/bold} ({gray-fg}${d.node.type}{/gray-fg})`);
      }
      if (this.state.discoveredNodes.length > 4) {
        lines.push(` {gray-fg}...and ${this.state.discoveredNodes.length - 4} more{/gray-fg}`);
      }
    }

    this.widgets.sidebarBox.setContent(lines.join('\n'));
  }

  private renderFooter(): void {
    if (this.state.pendingEdgeSourceId) {
      this.widgets.footerBox.setContent(
        ` {bold}{yellow-fg}[CONNECTING EDGE]{/yellow-fg}{/bold} Select target with WASD, then press {bold}e{/bold} to connect (or {bold}Esc{/bold} to cancel) `
      );
    } else if (this.state.viewLevel === 'workflow') {
      this.widgets.footerBox.setContent(
        ' {bold}W/A/S/D{/bold}: select stage · {bold}Enter{/bold}: drill in · {bold}r{/bold}: rename · {bold}n{/bold}: add · {bold}x{/bold}: delete · {bold}h/l{/bold}: reorder · {bold}Ctrl-S{/bold}: save · {bold}?{/bold}: help '
      );
    } else {
      const modeLabel =
        this.state.selectedEdgeIndex !== null
          ? '{bold}{yellow-fg}[EDGE SELECTED]{/yellow-fg}{/bold}'
          : '{bold}[NODE SELECTED]{/bold}';
      this.widgets.footerBox.setContent(
        ` ${modeLabel} {bold}Tab{/bold}: cycle · {bold}W/A/S/D{/bold}: nav · {bold}n{/bold}: add node · {bold}e{/bold}: edge · {bold}i{/bold}: start node · {bold}x{/bold}: del · {bold}Ctrl-S{/bold}: save · {bold}Backspace{/bold}: out `
      );
    }
  }

  private bindGlobalKeys(): void {
    const screen = this.widgets.screen;

    // Viewport Panning via Arrow Keys
    screen.key(['left'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.panViewport(-4, 0);
      this.refreshUI();
    });
    screen.key(['right'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.panViewport(4, 0);
      this.refreshUI();
    });
    screen.key(['up'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.panViewport(0, -2);
      this.refreshUI();
    });
    screen.key(['down'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.panViewport(0, 2);
      this.refreshUI();
    });

    // Tab / Shift-Tab: Toggle/cycle between Nodes and Edges
    screen.key(['tab', 'S-tab'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'stage') {
        this.state.toggleSelectionMode();
        this.refreshUI();
      }
    });

    // WASD 2D Directional Selection
    screen.key(['w', 'W'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.selectDirection('up');
      this.refreshUI();
    });
    screen.key(['a', 'A'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.selectDirection('left');
      this.refreshUI();
    });
    screen.key(['s'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.selectDirection('down');
      this.refreshUI();
    });
    screen.key(['d'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.selectDirection('right');
      this.refreshUI();
    });

    // Enter key: Drill down from Workflow to Stage View
    screen.key(['enter'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'workflow') {
        this.state.drillIntoStage();
        this.refreshUI();
      }
    });

    // Backspace: Zoom out from Stage View to Workflow View
    screen.key(['backspace'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'stage') {
        this.state.zoomOutToWorkflow();
        this.refreshUI();
      }
    });

    // Rename Stage (Hotkeys: 'r', 'R', 'f2')
    screen.key(['r', 'R', 'f2'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.promptRenameStage();
    });

    // Move / reorder operations (Vim keys h/j/k/l)
    screen.key(['h'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'workflow') {
        if (this.state.selectedStageId) {
          this.state.reorderStage(this.state.selectedStageId, 'left');
          this.refreshUI();
        }
      } else {
        if (this.state.selectedNodeId) {
          this.state.moveSelectedNode(-4, 0);
          this.refreshUI();
        }
      }
    });
    screen.key(['l'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'workflow') {
        if (this.state.selectedStageId) {
          this.state.reorderStage(this.state.selectedStageId, 'right');
          this.refreshUI();
        }
      } else {
        if (this.state.selectedNodeId) {
          this.state.moveSelectedNode(4, 0);
          this.refreshUI();
        }
      }
    });
    screen.key(['k'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'stage' && this.state.selectedNodeId) {
        this.state.moveSelectedNode(0, -2);
        this.refreshUI();
      }
    });
    screen.key(['j'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'stage' && this.state.selectedNodeId) {
        this.state.moveSelectedNode(0, 2);
        this.refreshUI();
      }
    });

    // Center viewport
    screen.key(['c', 'C'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.viewportOffset = { x: 0, y: 0 };
      this.refreshUI();
    });

    // Add operation (Stage in workflow view, Node in stage view)
    screen.key(['n', 'N'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'workflow') {
        this.promptNewStage();
      } else {
        this.openPaletteModal();
      }
    });

    // Connect Edge (only in stage view)
    screen.key(['e', 'E'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'stage') {
        this.handleConnectEdge();
      }
    });

    // Toggle Start Node (Hotkey 'i' in stage view)
    screen.key(['i', 'I'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.viewLevel === 'stage' && this.state.selectedNodeId) {
        this.state.toggleStartNode(this.state.selectedNodeId);
        this.refreshUI();
      }
    });

    // Delete selected element ('x', 'X', or 'delete')
    screen.key(['x', 'X', 'delete'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.handleDeleteSelected();
    });

    // Undo / Redo
    screen.key(['u', 'U'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.undo()) {
        this.refreshUI();
      }
    });
    screen.key(['C-r'], () => {
      if (this.isModalOpen()) {
        return;
      }
      if (this.state.redo()) {
        this.refreshUI();
      }
    });

    // Quick Stage switching
    screen.key(['pageup', '['], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.switchStage(-1);
      this.refreshUI();
    });
    screen.key(['pagedown', ']'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.state.switchStage(1);
      this.refreshUI();
    });
    screen.key(['S'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.openStageModal();
    });

    // Save workflow (Ctrl-S or Shift-S)
    screen.key(['C-s'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.handleSave();
    });

    // Help modal
    screen.key(['?', '/'], () => {
      if (this.isModalOpen()) {
        return;
      }
      this.openHelpModal();
    });

    // Cancel / Esc
    screen.key(['escape'], () => {
      this.handleEscape();
    });

    // Quit
    screen.key(['q', 'C-c'], () => {
      if (this.isModalOpen()) {
        this.handleEscape();
        return;
      }
      this.handleQuit();
    });
  }

  private openPaletteModal(): void {
    const items: string[] = [];

    // Built-in types
    items.push('{bold}{yellow-fg}── Built-in Node Types ──{/yellow-fg}{/bold}');
    items.push('agent: AI agent prompt task');
    items.push('task: SQLite task with file locking & compliance');
    items.push('condition: Conditional if/else router node');
    items.push('tool: CLI or shell command runner');
    items.push('transform: JSON data transformer');
    items.push('passthrough: No-op passthrough node');

    // Discovered nodes
    if (this.state.discoveredNodes.length > 0) {
      items.push('{bold}{yellow-fg}── Discovered Local Nodes ──{/yellow-fg}{/bold}');
      for (const d of this.state.discoveredNodes) {
        items.push(`[Library] ${d.node.id} (${d.node.type})`);
      }
    }

    this.widgets.paletteModal.setItems(items);
    this.widgets.paletteModal.show();
    this.widgets.paletteModal.focus();
    this.widgets.screen.render();

    this.widgets.paletteModal.once('select', (_item, index) => {
      this.widgets.paletteModal.hide();
      this.widgets.screen.render();

      const selectedStr = items[index];
      if (selectedStr.startsWith('agent:')) {
        this.promptNewNode('agent');
      } else if (selectedStr.startsWith('task:')) {
        this.promptNewNode('task');
      } else if (selectedStr.startsWith('condition:')) {
        this.promptNewNode('condition');
      } else if (selectedStr.startsWith('tool:')) {
        this.promptNewNode('tool');
      } else if (selectedStr.startsWith('transform:')) {
        this.promptNewNode('transform');
      } else if (selectedStr.startsWith('passthrough:')) {
        this.promptNewNode('passthrough');
      } else if (selectedStr.startsWith('[Library]')) {
        const match = selectedStr.match(/\[Library\]\s+([^\s]+)/);
        if (match) {
          const nodeId = match[1];
          const found = this.state.discoveredNodes.find((d) => d.node.id === nodeId);
          if (found) {
            this.state.addNode(JSON.parse(JSON.stringify(found.node)));
            this.refreshUI();
          }
        }
      }
    });
  }

  private promptNewStage(): void {
    this.widgets.inputPrompt.setLabel(' Enter New Stage Name ');
    this.widgets.inputText.setValue(`Stage ${this.state.workflow.stages.length + 1}`);
    this.widgets.inputPrompt.show();
    this.widgets.inputText.focus();
    this.widgets.screen.render();

    const onSubmit = (val: string) => {
      this.widgets.inputText.removeListener('cancel', onCancel);
      this.widgets.inputPrompt.hide();
      const stageName = val.trim();
      if (!stageName) {
        this.refreshUI();
        return;
      }
      const stageId = stageName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      this.state.addStage(stageName, stageId);
      this.refreshUI();
    };

    const onCancel = () => {
      this.widgets.inputText.removeListener('submit', onSubmit);
      this.widgets.inputPrompt.hide();
      this.refreshUI();
    };

    this.widgets.inputText.once('submit', onSubmit);
    this.widgets.inputText.once('cancel', onCancel);
  }

  private promptRenameStage(): void {
    const stageToRename =
      this.state.viewLevel === 'workflow'
        ? this.state.workflow.stages.find((s) => s.id === this.state.selectedStageId) ||
          this.state.currentStage
        : this.state.currentStage;

    this.widgets.inputPrompt.setLabel(` Rename Stage (${stageToRename.id}) `);
    this.widgets.inputText.setValue(stageToRename.name);
    this.widgets.inputPrompt.show();
    this.widgets.inputText.focus();
    this.widgets.screen.render();

    const onSubmit = (val: string) => {
      this.widgets.inputText.removeListener('cancel', onCancel);
      this.widgets.inputPrompt.hide();
      const newName = val.trim();
      if (newName && newName !== stageToRename.name) {
        this.state.renameStage(stageToRename.id, newName);
      }
      this.refreshUI();
    };

    const onCancel = () => {
      this.widgets.inputText.removeListener('submit', onSubmit);
      this.widgets.inputPrompt.hide();
      this.refreshUI();
    };

    this.widgets.inputText.once('submit', onSubmit);
    this.widgets.inputText.once('cancel', onCancel);
  }

  private promptNewNode(type: NodeType): void {
    this.widgets.inputPrompt.setLabel(` Enter New Node ID (${type}) `);
    this.widgets.inputText.setValue(`${type}-${Date.now().toString().slice(-4)}`);
    this.widgets.inputPrompt.show();
    this.widgets.inputText.focus();
    this.widgets.screen.render();

    const onSubmit = (val: string) => {
      this.widgets.inputText.removeListener('cancel', onCancel);
      this.widgets.inputPrompt.hide();
      const nodeId = val.trim();
      if (!nodeId) {
        this.refreshUI();
        return;
      }

      const newNode: NodeDefinition = {
        id: nodeId,
        name: nodeId,
        type,
        config: this.getDefaultConfigForType(type, nodeId),
      };

      this.state.addNode(newNode);
      this.refreshUI();
    };

    const onCancel = () => {
      this.widgets.inputText.removeListener('submit', onSubmit);
      this.widgets.inputPrompt.hide();
      this.refreshUI();
    };

    this.widgets.inputText.once('submit', onSubmit);
    this.widgets.inputText.once('cancel', onCancel);
  }

  private getDefaultConfigForType(type: NodeType, id: string): Record<string, unknown> {
    switch (type) {
      case 'agent':
        return { agent: 'executor', prompt: 'Implement changes' };
      case 'task':
        return { title: id, description: 'Task execution details' };
      case 'condition':
        return { field: 'status', operator: 'equals', value: 'success' };
      case 'tool':
        return { tool: 'bash', command: 'echo "Running tool"' };
      case 'transform':
        return { transformType: 'custom' };
      default:
        return {};
    }
  }

  private handleConnectEdge(): void {
    if (!this.state.selectedNodeId) {
      return;
    }

    if (!this.state.pendingEdgeSourceId) {
      this.state.pendingEdgeSourceId = this.state.selectedNodeId;
      this.refreshUI();
    } else {
      const sourceId = this.state.pendingEdgeSourceId;
      const targetId = this.state.selectedNodeId;

      this.state.pendingEdgeSourceId = null;

      const validation = validateConnection(this.state.currentGraph, sourceId, targetId);
      if (!validation.valid) {
        this.showNotice('Connection Error', validation.message || 'Invalid connection');
        this.refreshUI();
        return;
      }

      // Always open condition modal so user can choose condition type & custom expressions
      this.openConditionModal(sourceId, targetId);
    }
  }

  private openConditionModal(fromId: string, toId: string): void {
    const conditions = ['always', 'on_success', 'on_failure', 'expression', 'predicate'];
    this.widgets.conditionModal.setItems(conditions);
    this.widgets.conditionModal.show();
    this.widgets.conditionModal.focus();
    this.widgets.screen.render();

    const onSelect = (_item: unknown, index: number) => {
      cleanup();
      const condType = conditions[index];

      if (condType === 'expression') {
        this.promptExpressionCondition(fromId, toId);
      } else if (condType === 'predicate') {
        this.promptPredicateCondition(fromId, toId);
      } else {
        this.state.addEdge({
          from: fromId,
          to: toId,
          condition: { type: condType as 'always' | 'on_success' | 'on_failure' },
        });
        this.refreshUI();
      }
    };

    const onKeypress = (_ch: unknown, key: { name?: string }) => {
      if (key && key.name === 'escape') {
        cleanup();
        this.refreshUI();
      }
    };

    const cleanup = () => {
      this.widgets.conditionModal.removeListener('select', onSelect);
      this.widgets.conditionModal.removeListener('keypress', onKeypress);
      this.widgets.conditionModal.hide();
    };

    this.widgets.conditionModal.once('select', onSelect);
    this.widgets.conditionModal.on('keypress', onKeypress);
  }

  private promptExpressionCondition(fromId: string, toId: string): void {
    this.widgets.inputPrompt.setLabel(' Enter Condition Expression (e.g. context.status === 200) ');
    this.widgets.inputText.setValue('context.status === 200');
    this.widgets.inputPrompt.show();
    this.widgets.inputText.focus();
    this.widgets.screen.render();

    const onSubmit = (val: string) => {
      this.widgets.inputText.removeListener('cancel', onCancel);
      this.widgets.inputPrompt.hide();
      const expr = val.trim() || 'true';
      this.state.addEdge({
        from: fromId,
        to: toId,
        condition: { type: 'expression', expression: expr },
      });
      this.refreshUI();
    };

    const onCancel = () => {
      this.widgets.inputText.removeListener('submit', onSubmit);
      this.widgets.inputPrompt.hide();
      this.refreshUI();
    };

    this.widgets.inputText.once('submit', onSubmit);
    this.widgets.inputText.once('cancel', onCancel);
  }

  private promptPredicateCondition(fromId: string, toId: string): void {
    this.widgets.inputPrompt.setLabel(' Enter Field Name to Test (e.g. status or result.code) ');
    this.widgets.inputText.setValue('status');
    this.widgets.inputPrompt.show();
    this.widgets.inputText.focus();
    this.widgets.screen.render();

    const onSubmit = (val: string) => {
      this.widgets.inputText.removeListener('cancel', onCancel);
      this.widgets.inputPrompt.hide();
      const field = val.trim() || 'status';
      this.state.addEdge({
        from: fromId,
        to: toId,
        condition: { type: 'predicate', field, operator: 'truthy' },
      });
      this.refreshUI();
    };

    const onCancel = () => {
      this.widgets.inputText.removeListener('submit', onSubmit);
      this.widgets.inputPrompt.hide();
      this.refreshUI();
    };

    this.widgets.inputText.once('submit', onSubmit);
    this.widgets.inputText.once('cancel', onCancel);
  }

  private handleDeleteSelected(): void {
    if (this.state.viewLevel === 'workflow') {
      if (this.state.workflow.stages.length <= 1) {
        this.showNotice('Cannot Delete Stage', 'A workflow must have at least one stage.');
        return;
      }
      this.state.removeCurrentStage();
      this.refreshUI();
    } else {
      if (this.state.selectedNodeId) {
        const id = this.state.selectedNodeId;
        this.state.removeNode(id);
        this.refreshUI();
      } else if (this.state.selectedEdgeIndex !== null) {
        this.state.removeEdge(this.state.selectedEdgeIndex);
        this.refreshUI();
      }
    }
  }

  private openStageModal(): void {
    const stages = this.state.workflow.stages.map((s, idx) => `${idx + 1}. ${s.name} (${s.id})`);
    this.widgets.stageModal.setItems(stages);
    this.widgets.stageModal.show();
    this.widgets.stageModal.focus();
    this.widgets.screen.render();

    this.widgets.stageModal.once('select', (_item, index) => {
      this.widgets.stageModal.hide();
      this.state.currentStageIndex = index;
      this.state.selectedStageId = this.state.workflow.stages[index].id;
      this.refreshUI();
    });
  }

  private openHelpModal(): void {
    const helpText = [
      '{bold}{yellow-fg}CREWMATE WORKFLOW EDITOR HIERARCHICAL SHORTCUTS{/yellow-fg}{/bold}',
      '',
      '{bold}Two-Level Navigation:{/bold}',
      '  Workflow View:      Displays all stages as high-level graph nodes',
      '  Stage View:         Displays internal tasks/agents/tools for a stage',
      '  Enter               Drill into selected stage (Workflow → Stage View)',
      '  Backspace / Esc     Zoom out to Workflow View (Stage → Workflow View)',
      '',
      '{bold}Selection & Movement (WASD):{/bold}',
      '  W / A / S / D       Select node/stage directionally (Up/Left/Down/Right)',
      '  ← / ↑ / → / ↓       Pan the canvas viewport window',
      '  c                   Center viewport back to (0,0)',
      '  h / j / k / l       Move/shift selected node or stage in 2D space',
      '',
      '{bold}Workflow View Operations:{/bold}',
      '  n                   Add a new stage',
      '  r / F2              Rename selected stage',
      '  x / Delete          Delete selected stage',
      '  h / l               Reorder stages left or right',
      '',
      '{bold}Stage View Operations:{/bold}',
      '  n                   Open node palette (add built-in or discovered node)',
      '  i                   Toggle Start Node role (sets entryNodeIds)',
      '  r / F2              Rename current stage',
      '  e                   Connect edge between nodes',
      '  Tab                 Toggle Node Mode vs Edge Mode',
      '  x / Delete          Delete selected node or edge',
      '  u / Ctrl-R          Undo / Redo',
      '  Ctrl-S              Save modular workflow JSON files',
      '  q / Ctrl-C          Quit editor',
      '',
      '{gray-fg}Press Esc or Enter to close this window.{/gray-fg}',
    ].join('\n');

    this.widgets.helpModal.setContent(helpText);
    this.widgets.helpModal.show();
    this.widgets.helpModal.focus();
    this.widgets.screen.render();

    this.widgets.helpModal.once('keypress', () => {
      this.widgets.helpModal.hide();
      this.refreshUI();
    });
  }

  private handleSave(): void {
    const result = serializeWorkflowToModularFiles(this.state.workflow);
    if (result.success) {
      this.state.isModified = false;
      this.showNotice('Workflow Saved', `Successfully wrote ${result.filesWritten.length} files.`);
    } else {
      this.showNotice('Save Failed', result.error || 'Validation error');
    }
    this.refreshUI();
  }

  private showNotice(title: string, message: string): void {
    this.widgets.confirmModal.setLabel(` ${title} `);
    this.widgets.confirmModal.setContent(
      `\n ${message}\n\n {gray-fg}(Press any key to dismiss){/gray-fg}`
    );
    this.widgets.confirmModal.show();
    this.widgets.confirmModal.focus();
    this.widgets.screen.render();

    this.widgets.confirmModal.once('keypress', () => {
      this.widgets.confirmModal.hide();
      this.refreshUI();
    });
  }

  private handleEscape(): void {
    if (this.state.pendingEdgeSourceId) {
      this.state.pendingEdgeSourceId = null;
      this.refreshUI();
      return;
    }

    // If modals are open, close them
    const modals = [
      this.widgets.paletteModal,
      this.widgets.conditionModal,
      this.widgets.stageModal,
      this.widgets.confirmModal,
      this.widgets.propertyModal,
      this.widgets.helpModal,
      this.widgets.inputPrompt,
    ];

    let modalClosed = false;
    for (const m of modals) {
      if (!m.hidden) {
        m.hide();
        modalClosed = true;
      }
    }

    if (modalClosed) {
      this.refreshUI();
      return;
    }

    // In Stage View, Esc zooms out to Workflow View
    if (this.state.viewLevel === 'stage') {
      this.state.zoomOutToWorkflow();
      this.refreshUI();
      return;
    }
  }

  private handleQuit(): void {
    this.onExitCallback();
  }
}
