import type {
  WorkflowDefinition,
  StageDefinition,
  GraphDefinition,
  NodeDefinition,
  EdgeDefinition,
  NodeType,
} from '../models/graph.js';
import { computeGraphLayout } from './graph-layout.js';

/**
 *
 */
export interface EditorPosition {
  x: number;
  y: number;
}

/**
 *
 */
export type EditorMode =
  | 'canvas'
  | 'palette'
  | 'property_editor'
  | 'add_edge_target'
  | 'stage_manager'
  | 'help'
  | 'confirm_delete'
  | 'condition_picker';

/**
 *
 */
export type ViewLevel = 'workflow' | 'stage';

/**
 *
 */
export interface NodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 *
 */
export interface DiscoveredNode {
  filePath: string;
  fileName: string;
  node: NodeDefinition;
}

/**
 *
 */
export interface EditorSnapshot {
  workflow: WorkflowDefinition;
  stageIndex: number;
  selectedNodeId: string | null;
  selectedEdgeIndex: number | null;
  viewLevel: ViewLevel;
  selectedStageId: string | null;
}

/**
 *
 */
export class EditorState {
  public workflow: WorkflowDefinition;
  public viewLevel: ViewLevel = 'workflow';
  public currentStageIndex = 0;
  public selectedStageId: string | null = null;
  public selectedNodeId: string | null = null;
  public selectedEdgeIndex: number | null = null;
  public lastSelectedNodeId: string | null = null;
  public lastSelectedEdgeIndex: number | null = null;
  public mode: EditorMode = 'canvas';
  public isModified = false;

  // Viewport panning offsets (characters)
  public viewportOffset: EditorPosition = { x: 0, y: 0 };

  // Manual node position overrides for rearranging: nodeId -> { x, y } (in grid coordinates)
  public nodePositions: Map<string, EditorPosition> = new Map();

  // Manual stage position overrides for rearranging in workflow view: stageId -> { x, y }
  public stagePositions: Map<string, EditorPosition> = new Map();

  // Edge creation state
  public pendingEdgeSourceId: string | null = null;

  // Node discovery cache
  public discoveredNodes: DiscoveredNode[] = [];

  // Undo / Redo history
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private maxHistory = 30;

  /**
   *
   */
  constructor(initialWorkflow: WorkflowDefinition) {
    this.workflow = JSON.parse(JSON.stringify(initialWorkflow));
    if (!this.workflow.stages || this.workflow.stages.length === 0) {
      this.workflow.stages = [
        {
          id: 'default-stage',
          name: 'Stage 1',
          graph: {
            nodes: [],
            edges: [],
          },
        },
      ];
    }
    this.selectedStageId = this.workflow.stages[0]?.id ?? null;
  }

  /**
   *
   */
  public get currentStage(): StageDefinition {
    if (this.currentStageIndex >= this.workflow.stages.length) {
      this.currentStageIndex = Math.max(0, this.workflow.stages.length - 1);
    }
    return this.workflow.stages[this.currentStageIndex];
  }

  /**
   *
   */
  public get currentGraph(): GraphDefinition {
    if (!this.currentStage.graph) {
      this.currentStage.graph = { nodes: [], edges: [] };
    }
    return this.currentStage.graph;
  }

  /**
   * Generates a virtual GraphDefinition representing the workflow stages as nodes,
   * connected by sequential transition edges.
   */
  public get workflowGraph(): GraphDefinition {
    const nodes: NodeDefinition[] = this.workflow.stages.map((stage) => {
      const nodeCount = stage.graph?.nodes?.length ?? 0;
      const edgeCount = stage.graph?.edges?.length ?? 0;
      return {
        id: stage.id,
        name: stage.name,
        type: 'subgraph' as NodeType,
        config: {
          stageId: stage.id,
          description: stage.description,
          nodeCount,
          edgeCount,
        },
      };
    });

    const edges: EdgeDefinition[] = [];
    for (let i = 0; i < this.workflow.stages.length - 1; i++) {
      const fromStage = this.workflow.stages[i];
      const toStage = this.workflow.stages[i + 1];
      edges.push({
        id: `edge-${fromStage.id}-${toStage.id}`,
        from: fromStage.id,
        to: toStage.id,
        condition: { type: 'on_success' },
      });
    }

    return {
      id: `${this.workflow.id}-stages-graph`,
      name: `${this.workflow.name} Stages`,
      nodes,
      edges,
    };
  }

  /**
   *
   */
  public pushHistory(): void {
    const serialized = JSON.stringify({
      workflow: this.workflow,
      viewLevel: this.viewLevel,
      currentStageIndex: this.currentStageIndex,
      selectedStageId: this.selectedStageId,
    });
    this.undoStack.push(serialized);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.isModified = true;
  }

  /**
   *
   */
  public undo(): boolean {
    if (this.undoStack.length === 0) {
      return false;
    }
    const current = JSON.stringify({
      workflow: this.workflow,
      viewLevel: this.viewLevel,
      currentStageIndex: this.currentStageIndex,
      selectedStageId: this.selectedStageId,
    });
    this.redoStack.push(current);
    const prev = this.undoStack.pop();
    if (prev) {
      const parsed = JSON.parse(prev);
      this.workflow = parsed.workflow;
      this.viewLevel = parsed.viewLevel ?? 'workflow';
      this.currentStageIndex = parsed.currentStageIndex ?? 0;
      this.selectedStageId = parsed.selectedStageId ?? null;
      this.validateSelection();
      return true;
    }
    return false;
  }

  /**
   *
   */
  public redo(): boolean {
    if (this.redoStack.length === 0) {
      return false;
    }
    const current = JSON.stringify({
      workflow: this.workflow,
      viewLevel: this.viewLevel,
      currentStageIndex: this.currentStageIndex,
      selectedStageId: this.selectedStageId,
    });
    this.undoStack.push(current);
    const next = this.redoStack.pop();
    if (next) {
      const parsed = JSON.parse(next);
      this.workflow = parsed.workflow;
      this.viewLevel = parsed.viewLevel ?? 'workflow';
      this.currentStageIndex = parsed.currentStageIndex ?? 0;
      this.selectedStageId = parsed.selectedStageId ?? null;
      this.validateSelection();
      return true;
    }
    return false;
  }

  /**
   *
   */
  public drillIntoStage(stageId?: string): void {
    const targetId = stageId || this.selectedStageId || this.currentStage.id;
    const idx = this.workflow.stages.findIndex((s) => s.id === targetId);
    if (idx !== -1) {
      this.currentStageIndex = idx;
      this.selectedStageId = targetId;
      this.viewLevel = 'stage';
      this.viewportOffset = { x: 0, y: 0 };
      this.selectedNodeId = this.currentGraph.nodes[0]?.id ?? null;
      this.selectedEdgeIndex = null;
    }
  }

  /**
   *
   */
  public zoomOutToWorkflow(): void {
    this.viewLevel = 'workflow';
    this.viewportOffset = { x: 0, y: 0 };
    this.selectedStageId = this.currentStage.id;
    this.selectedNodeId = null;
    this.selectedEdgeIndex = null;
  }

  /**
   *
   */
  public selectNextStage(): void {
    const stages = this.workflow.stages;
    if (stages.length === 0) {
      this.selectedStageId = null;
      return;
    }
    if (!this.selectedStageId) {
      this.selectedStageId = stages[0].id;
      this.currentStageIndex = 0;
      return;
    }
    const idx = stages.findIndex((s) => s.id === this.selectedStageId);
    const nextIdx = (idx + 1) % stages.length;
    this.selectedStageId = stages[nextIdx].id;
    this.currentStageIndex = nextIdx;
  }

  /**
   *
   */
  public selectPrevStage(): void {
    const stages = this.workflow.stages;
    if (stages.length === 0) {
      this.selectedStageId = null;
      return;
    }
    if (!this.selectedStageId) {
      this.selectedStageId = stages[stages.length - 1].id;
      this.currentStageIndex = stages.length - 1;
      return;
    }
    const idx = stages.findIndex((s) => s.id === this.selectedStageId);
    const prevIdx = (idx - 1 + stages.length) % stages.length;
    this.selectedStageId = stages[prevIdx].id;
    this.currentStageIndex = prevIdx;
  }

  /**
   * Unified cycling of all interactive graph elements (nodes and edges)
   */
  public cycleElement(direction: 'next' | 'prev'): void {
    if (this.viewLevel === 'workflow') {
      if (direction === 'next') {
        this.selectNextStage();
      } else {
        this.selectPrevStage();
      }
      return;
    }

    const nodes = this.currentGraph.nodes;
    const edges = this.currentGraph.edges;
    const totalNodes = nodes.length;
    const totalEdges = edges.length;

    if (totalNodes === 0 && totalEdges === 0) {
      this.selectedNodeId = null;
      this.selectedEdgeIndex = null;
      return;
    }

    // Sequence: Node 0 -> Node 1 -> ... -> Node N-1 -> Edge 0 -> ... -> Edge M-1 -> Node 0
    if (direction === 'next') {
      if (this.selectedNodeId !== null) {
        const nodeIdx = nodes.findIndex((n) => n.id === this.selectedNodeId);
        if (nodeIdx !== -1 && nodeIdx < totalNodes - 1) {
          // Move to next node
          this.selectedNodeId = nodes[nodeIdx + 1].id;
          this.selectedEdgeIndex = null;
        } else if (totalEdges > 0) {
          // Transition from last node to first edge
          this.selectedNodeId = null;
          this.selectedEdgeIndex = 0;
        } else {
          // Wrap around to first node
          this.selectedNodeId = nodes[0]?.id ?? null;
          this.selectedEdgeIndex = null;
        }
      } else if (this.selectedEdgeIndex !== null) {
        if (this.selectedEdgeIndex < totalEdges - 1) {
          // Move to next edge
          this.selectedEdgeIndex++;
          this.selectedNodeId = null;
        } else if (totalNodes > 0) {
          // Wrap around to first node
          this.selectedNodeId = nodes[0].id;
          this.selectedEdgeIndex = null;
        } else {
          // Wrap around to first edge
          this.selectedEdgeIndex = 0;
          this.selectedNodeId = null;
        }
      } else {
        this.selectedNodeId = nodes[0]?.id ?? null;
        this.selectedEdgeIndex = null;
      }
    } else {
      // Prev
      if (this.selectedNodeId !== null) {
        const nodeIdx = nodes.findIndex((n) => n.id === this.selectedNodeId);
        if (nodeIdx > 0) {
          // Move to prev node
          this.selectedNodeId = nodes[nodeIdx - 1].id;
          this.selectedEdgeIndex = null;
        } else if (totalEdges > 0) {
          // Wrap to last edge
          this.selectedNodeId = null;
          this.selectedEdgeIndex = totalEdges - 1;
        } else {
          // Wrap to last node
          this.selectedNodeId = nodes[totalNodes - 1]?.id ?? null;
          this.selectedEdgeIndex = null;
        }
      } else if (this.selectedEdgeIndex !== null) {
        if (this.selectedEdgeIndex > 0) {
          // Move to prev edge
          this.selectedEdgeIndex--;
          this.selectedNodeId = null;
        } else if (totalNodes > 0) {
          // Wrap to last node
          this.selectedNodeId = nodes[totalNodes - 1].id;
          this.selectedEdgeIndex = null;
        } else {
          // Wrap to last edge
          this.selectedEdgeIndex = totalEdges - 1;
          this.selectedNodeId = null;
        }
      } else {
        this.selectedNodeId = nodes[totalNodes - 1]?.id ?? null;
        this.selectedEdgeIndex = null;
      }
    }
  }

  /**
   *
   */
  public selectNextNode(): void {
    if (this.viewLevel === 'workflow') {
      this.selectNextStage();
      return;
    }
    const nodes = this.currentGraph.nodes;
    if (nodes.length === 0) {
      this.selectedNodeId = null;
      return;
    }
    if (!this.selectedNodeId) {
      this.selectedNodeId = nodes[0].id;
      this.selectedEdgeIndex = null;
      return;
    }
    const idx = nodes.findIndex((n) => n.id === this.selectedNodeId);
    const nextIdx = (idx + 1) % nodes.length;
    this.selectedNodeId = nodes[nextIdx].id;
    this.selectedEdgeIndex = null;
  }

  /**
   *
   */
  public selectPrevNode(): void {
    if (this.viewLevel === 'workflow') {
      this.selectPrevStage();
      return;
    }
    const nodes = this.currentGraph.nodes;
    if (nodes.length === 0) {
      this.selectedNodeId = null;
      return;
    }
    if (!this.selectedNodeId) {
      this.selectedNodeId = nodes[nodes.length - 1].id;
      this.selectedEdgeIndex = null;
      return;
    }
    const idx = nodes.findIndex((n) => n.id === this.selectedNodeId);
    const prevIdx = (idx - 1 + nodes.length) % nodes.length;
    this.selectedNodeId = nodes[prevIdx].id;
    this.selectedEdgeIndex = null;
  }

  /**
   * Directional selection (WASD) in 2D graph space.
   * Finds the closest adjacent node/stage in the requested direction.
   */
  public selectDirection(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (this.viewLevel === 'workflow') {
      // In workflow view, stages are arranged left-to-right or in 2D layout
      const stages = this.workflow.stages;
      if (stages.length === 0) {
        return;
      }

      if (direction === 'left') {
        this.selectPrevStage();
      } else if (direction === 'right') {
        this.selectNextStage();
      } else {
        // Up/Down: check 2D layout if stages are on multiple rows
        const layoutResult = computeGraphLayout(this.workflowGraph, this.stagePositions, {
          nodeWidth: 32,
          nodeHeight: 6,
          horizontalSpacing: 10,
          verticalSpacing: 3,
        });
        const currentStageId = this.selectedStageId || stages[0].id;
        const currentLayout = layoutResult.layouts.get(currentStageId);
        if (!currentLayout) {
          return;
        }

        let bestStageId: string | null = null;
        let minDistance = Infinity;

        for (const stage of stages) {
          if (stage.id === currentStageId) {
            continue;
          }
          const otherLayout = layoutResult.layouts.get(stage.id);
          if (!otherLayout) {
            continue;
          }

          const dx = otherLayout.x - currentLayout.x;
          const dy = otherLayout.y - currentLayout.y;

          if (direction === 'up' && dy < 0) {
            const dist = Math.abs(dy) + Math.abs(dx) * 1.5;
            if (dist < minDistance) {
              minDistance = dist;
              bestStageId = stage.id;
            }
          } else if (direction === 'down' && dy > 0) {
            const dist = Math.abs(dy) + Math.abs(dx) * 1.5;
            if (dist < minDistance) {
              minDistance = dist;
              bestStageId = stage.id;
            }
          }
        }

        if (bestStageId) {
          this.selectedStageId = bestStageId;
          const idx = stages.findIndex((s) => s.id === bestStageId);
          if (idx !== -1) {
            this.currentStageIndex = idx;
          }
        }
      }
      return;
    }

    // Stage View: 2D directional node selection
    const graph = this.currentGraph;

    // If currently in edge mode, W/A/S/D navigates edges
    if (this.selectedEdgeIndex !== null) {
      if (direction === 'right' || direction === 'down') {
        this.selectNextEdge();
      } else {
        this.selectPrevEdge();
      }
      return;
    }

    if (graph.nodes.length === 0) {
      return;
    }

    if (!this.selectedNodeId) {
      this.selectedNodeId = graph.nodes[0].id;
      return;
    }

    const layoutResult = computeGraphLayout(graph, this.nodePositions);
    const currentLayout = layoutResult.layouts.get(this.selectedNodeId);
    if (!currentLayout) {
      this.selectedNodeId = graph.nodes[0].id;
      return;
    }

    const currCx = currentLayout.x + currentLayout.width / 2;
    const currCy = currentLayout.y + currentLayout.height / 2;

    let bestNodeId: string | null = null;
    let minScore = Infinity;

    for (const node of graph.nodes) {
      if (node.id === this.selectedNodeId) {
        continue;
      }
      const otherLayout = layoutResult.layouts.get(node.id);
      if (!otherLayout) {
        continue;
      }

      const otherCx = otherLayout.x + otherLayout.width / 2;
      const otherCy = otherLayout.y + otherLayout.height / 2;

      const dx = otherCx - currCx;
      const dy = otherCy - currCy;

      let inDirection = false;
      let score = Infinity;

      if (direction === 'right' && dx > 0) {
        inDirection = true;
        score = dx + Math.abs(dy) * 2.5;
      } else if (direction === 'left' && dx < 0) {
        inDirection = true;
        score = Math.abs(dx) + Math.abs(dy) * 2.5;
      } else if (direction === 'down' && dy > 0) {
        inDirection = true;
        score = dy + Math.abs(dx) * 2.5;
      } else if (direction === 'up' && dy < 0) {
        inDirection = true;
        score = Math.abs(dy) + Math.abs(dx) * 2.5;
      }

      if (inDirection && score < minScore) {
        minScore = score;
        bestNodeId = node.id;
      }
    }

    if (bestNodeId) {
      this.selectedNodeId = bestNodeId;
      this.selectedEdgeIndex = null;
    } else {
      // Fallback: If no node in direct axis, cycle naturally so the user isn't stuck
      if (direction === 'right' || direction === 'down') {
        this.selectNextNode();
      } else {
        this.selectPrevNode();
      }
    }
  }

  /**
   *
   */
  public selectNextEdge(): void {
    const edges =
      this.viewLevel === 'workflow' ? this.workflowGraph.edges : this.currentGraph.edges;
    if (edges.length === 0) {
      this.selectedEdgeIndex = null;
      return;
    }
    if (this.selectedEdgeIndex === null) {
      this.selectedEdgeIndex = 0;
      this.selectedNodeId = null;
      return;
    }
    this.selectedEdgeIndex = (this.selectedEdgeIndex + 1) % edges.length;
    this.selectedNodeId = null;
  }

  /**
   *
   */
  public selectPrevEdge(): void {
    const edges =
      this.viewLevel === 'workflow' ? this.workflowGraph.edges : this.currentGraph.edges;
    if (edges.length === 0) {
      this.selectedEdgeIndex = null;
      return;
    }
    if (this.selectedEdgeIndex === null) {
      this.selectedEdgeIndex = edges.length - 1;
      this.selectedNodeId = null;
      return;
    }
    this.selectedEdgeIndex = (this.selectedEdgeIndex - 1 + edges.length) % edges.length;
    this.selectedNodeId = null;
  }

  /**
   *
   */
  public toggleSelectionMode(): 'node' | 'edge' {
    if (this.selectedEdgeIndex !== null) {
      // Currently on edge -> remember it and switch to node
      this.lastSelectedEdgeIndex = this.selectedEdgeIndex;
      this.selectedEdgeIndex = null;
      const targetNodeId =
        this.lastSelectedNodeId &&
        this.currentGraph.nodes.some((n) => n.id === this.lastSelectedNodeId)
          ? this.lastSelectedNodeId
          : (this.currentGraph.nodes[0]?.id ?? null);
      this.selectedNodeId = targetNodeId;
      return 'node';
    } else {
      // Currently on node -> remember it and switch to edge
      if (this.currentGraph.edges.length > 0) {
        this.lastSelectedNodeId = this.selectedNodeId;
        this.selectedNodeId = null;
        const targetEdgeIndex =
          this.lastSelectedEdgeIndex !== null &&
          this.lastSelectedEdgeIndex < this.currentGraph.edges.length
            ? this.lastSelectedEdgeIndex
            : 0;
        this.selectedEdgeIndex = targetEdgeIndex;
        return 'edge';
      }
      return 'node';
    }
  }

  /**
   *
   */
  public panViewport(dx: number, dy: number): void {
    this.viewportOffset.x = Math.max(0, this.viewportOffset.x + dx);
    this.viewportOffset.y = Math.max(0, this.viewportOffset.y + dy);
  }

  /**
   *
   */
  public setNodePosition(nodeId: string, x: number, y: number): void {
    if (this.viewLevel === 'workflow') {
      this.stagePositions.set(nodeId, { x, y });
    } else {
      this.nodePositions.set(nodeId, { x, y });
    }
    this.isModified = true;
  }

  /**
   *
   */
  public moveSelectedNode(dx: number, dy: number): void {
    if (this.viewLevel === 'workflow') {
      if (!this.selectedStageId) {
        return;
      }
      const current = this.stagePositions.get(this.selectedStageId) || { x: 0, y: 0 };
      this.setNodePosition(
        this.selectedStageId,
        Math.max(0, current.x + dx),
        Math.max(0, current.y + dy)
      );
    } else {
      if (!this.selectedNodeId) {
        return;
      }
      const current = this.nodePositions.get(this.selectedNodeId) || { x: 0, y: 0 };
      this.setNodePosition(
        this.selectedNodeId,
        Math.max(0, current.x + dx),
        Math.max(0, current.y + dy)
      );
    }
  }

  /**
   *
   */
  public toggleStartNode(nodeId: string): boolean {
    this.pushHistory();
    if (!this.currentGraph.entryNodeIds) {
      this.currentGraph.entryNodeIds = [];
    }
    const idx = this.currentGraph.entryNodeIds.indexOf(nodeId);
    if (idx !== -1) {
      this.currentGraph.entryNodeIds.splice(idx, 1);
      return false; // Removed as start node
    } else {
      this.currentGraph.entryNodeIds.push(nodeId);
      return true; // Marked as start node
    }
  }

  /**
   *
   */
  public isStartNode(nodeId: string): boolean {
    const graph = this.currentGraph;
    if (graph.entryNodeIds && graph.entryNodeIds.length > 0) {
      return graph.entryNodeIds.includes(nodeId);
    }
    // Auto-detect based on 0 incoming edges
    const incoming = graph.edges.filter((e) => e.to === nodeId);
    if (incoming.length === 0) {
      return true;
    }

    // Fallback: If no node has 0 incoming edges (e.g. cycle), the first node in array is start
    const allIncoming = new Set(graph.edges.map((e) => e.to));
    const hasZeroIncoming = graph.nodes.some((n) => !allIncoming.has(n.id));
    if (!hasZeroIncoming && graph.nodes.length > 0 && graph.nodes[0].id === nodeId) {
      return true;
    }

    return false;
  }

  /**
   *
   */
  public isEndNode(nodeId: string): boolean {
    const graph = this.currentGraph;
    if (graph.exitNodeIds && graph.exitNodeIds.length > 0) {
      return graph.exitNodeIds.includes(nodeId);
    }
    const outgoing = graph.edges.filter((e) => e.from === nodeId);
    return outgoing.length === 0;
  }

  /**
   *
   */
  public addNode(node: NodeDefinition): string {
    this.pushHistory();

    // Prevent duplicate node IDs: if ID already exists, auto-suffix
    let uniqueId = node.id;
    let suffix = 2;
    while (this.currentGraph.nodes.some((n) => n.id === uniqueId)) {
      uniqueId = `${node.id}-${suffix}`;
      suffix++;
    }

    const finalNode: NodeDefinition = {
      ...node,
      id: uniqueId,
      name: node.name === node.id ? uniqueId : node.name || uniqueId,
    };

    this.currentGraph.nodes.push(finalNode);
    this.selectedNodeId = uniqueId;
    this.selectedEdgeIndex = null;
    return uniqueId;
  }

  /**
   *
   */
  public removeNode(nodeId: string): void {
    this.pushHistory();
    this.currentGraph.nodes = this.currentGraph.nodes.filter((n) => n.id !== nodeId);
    // Remove all edges connected to this node
    this.currentGraph.edges = this.currentGraph.edges.filter(
      (e) => e.from !== nodeId && e.to !== nodeId
    );
    this.nodePositions.delete(nodeId);
    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId =
        this.currentGraph.nodes.length > 0 ? this.currentGraph.nodes[0].id : null;
    }
  }

  /**
   *
   */
  public addEdge(edge: EdgeDefinition): void {
    this.pushHistory();
    this.currentGraph.edges.push(edge);
    this.selectedEdgeIndex = this.currentGraph.edges.length - 1;
    this.selectedNodeId = null;
  }

  /**
   *
   */
  public removeEdge(index: number): void {
    if (index < 0 || index >= this.currentGraph.edges.length) {
      return;
    }
    this.pushHistory();
    this.currentGraph.edges.splice(index, 1);
    if (this.selectedEdgeIndex !== null) {
      if (this.currentGraph.edges.length === 0) {
        this.selectedEdgeIndex = null;
      } else {
        this.selectedEdgeIndex = Math.min(index, this.currentGraph.edges.length - 1);
      }
    }
  }

  /**
   *
   */
  public switchStage(delta: number): void {
    const totalStages = this.workflow.stages.length;
    if (totalStages <= 1) {
      return;
    }
    this.currentStageIndex = (this.currentStageIndex + delta + totalStages) % totalStages;
    this.selectedStageId = this.currentStage.id;
    this.validateSelection();
  }

  /**
   *
   */
  public addStage(name: string, id?: string): void {
    this.pushHistory();
    const stageId = id || `stage-${Date.now().toString().slice(-4)}`;
    this.workflow.stages.push({
      id: stageId,
      name,
      graph: { nodes: [], edges: [] },
    });
    this.currentStageIndex = this.workflow.stages.length - 1;
    this.selectedStageId = stageId;
    this.validateSelection();
  }

  /**
   *
   */
  public removeCurrentStage(): boolean {
    if (this.workflow.stages.length <= 1) {
      return false; // Cannot delete the only stage
    }
    this.pushHistory();
    const stageIdToRemove = this.selectedStageId || this.currentStage.id;
    const removeIdx = this.workflow.stages.findIndex((s) => s.id === stageIdToRemove);
    if (removeIdx !== -1) {
      this.workflow.stages.splice(removeIdx, 1);
      this.currentStageIndex = Math.min(removeIdx, this.workflow.stages.length - 1);
      this.selectedStageId = this.workflow.stages[this.currentStageIndex].id;
    }
    this.validateSelection();
    return true;
  }

  /**
   *
   */
  public renameStage(stageId: string, newName: string): boolean {
    const stage = this.workflow.stages.find((s) => s.id === stageId);
    if (!stage) {
      return false;
    }
    this.pushHistory();
    stage.name = newName;
    return true;
  }

  /**
   *
   */
  public reorderStage(stageId: string, direction: 'left' | 'right'): boolean {
    const idx = this.workflow.stages.findIndex((s) => s.id === stageId);
    if (idx === -1) {
      return false;
    }
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= this.workflow.stages.length) {
      return false;
    }

    this.pushHistory();
    const temp = this.workflow.stages[idx];
    this.workflow.stages[idx] = this.workflow.stages[targetIdx];
    this.workflow.stages[targetIdx] = temp;
    this.currentStageIndex = targetIdx;
    this.selectedStageId = stageId;
    return true;
  }

  private validateSelection(): void {
    const stages = this.workflow.stages;
    if (this.selectedStageId && !stages.some((s) => s.id === this.selectedStageId)) {
      this.selectedStageId = stages[0]?.id ?? null;
      this.currentStageIndex = 0;
    }

    const nodes = this.currentGraph.nodes;
    if (this.selectedNodeId && !nodes.some((n) => n.id === this.selectedNodeId)) {
      this.selectedNodeId = nodes.length > 0 ? nodes[0].id : null;
    }
    const edges = this.currentGraph.edges;
    if (this.selectedEdgeIndex !== null && this.selectedEdgeIndex >= edges.length) {
      this.selectedEdgeIndex = edges.length > 0 ? edges.length - 1 : null;
    }
  }
}
