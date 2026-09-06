import { describe, it, expect } from 'vitest';
import { EditorState } from '../src/editor/state.js';
import { computeGraphLayout } from '../src/editor/graph-layout.js';
import { validateConnection } from '../src/editor/edge-validator.js';
import { CanvasBuffer, renderGraphCanvas } from '../src/editor/canvas.js';
import type { GraphDefinition, WorkflowDefinition } from '../src/models/graph.js';

describe('Workflow Editor Engine & Core Modules', () => {
  const sampleWorkflow: WorkflowDefinition = {
    id: 'test-wf',
    name: 'Test Workflow',
    stages: [
      {
        id: 'stage-1',
        name: 'Stage One',
        graph: {
          nodes: [
            { id: 'nodeA', type: 'agent', config: { agent: 'executor' } },
            {
              id: 'nodeB',
              type: 'condition',
              config: { field: 'status', operator: 'equals', value: 'ok' },
            },
            { id: 'nodeC', type: 'task', config: { title: 'Do task', description: 'desc' } },
          ],
          edges: [
            { from: 'nodeA', to: 'nodeB', condition: { type: 'always' } },
            { from: 'nodeB', to: 'nodeC', condition: { type: 'on_success' } },
          ],
        },
      },
      {
        id: 'stage-2',
        name: 'Stage Two',
        graph: {
          nodes: [{ id: 'nodeX', type: 'tool', config: { tool: 'bash' } }],
          edges: [],
        },
      },
    ],
  };

  it('initializes EditorState in Workflow View and selects stages', () => {
    const state = new EditorState(sampleWorkflow);
    expect(state.viewLevel).toBe('workflow');
    expect(state.selectedStageId).toBe('stage-1');
    expect(state.workflow.stages.length).toBe(2);

    state.selectNextStage();
    expect(state.selectedStageId).toBe('stage-2');

    state.selectPrevStage();
    expect(state.selectedStageId).toBe('stage-1');
  });

  it('drills into a stage and zooms back out', () => {
    const state = new EditorState(sampleWorkflow);
    expect(state.viewLevel).toBe('workflow');

    // Drill in
    state.drillIntoStage('stage-1');
    expect(state.viewLevel).toBe('stage');
    expect(state.currentStage.id).toBe('stage-1');
    expect(state.selectedNodeId).toBe('nodeA');

    // Cycle nodes in stage view
    state.selectNextNode();
    expect(state.selectedNodeId).toBe('nodeB');

    // Zoom out
    state.zoomOutToWorkflow();
    expect(state.viewLevel).toBe('workflow');
    expect(state.selectedStageId).toBe('stage-1');
  });

  it('synthesizes virtual workflow graph for top-level stage rendering', () => {
    const state = new EditorState(sampleWorkflow);
    const wfGraph = state.workflowGraph;

    expect(wfGraph.nodes.length).toBe(2);
    expect(wfGraph.nodes[0].id).toBe('stage-1');
    expect(wfGraph.nodes[1].id).toBe('stage-2');
    expect(wfGraph.edges.length).toBe(1);
    expect(wfGraph.edges[0].from).toBe('stage-1');
    expect(wfGraph.edges[0].to).toBe('stage-2');
  });

  it('supports undo/redo on node additions and removals', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');
    expect(state.currentGraph.nodes.length).toBe(3);

    state.addNode({
      id: 'nodeD',
      type: 'passthrough',
      config: {},
    });
    expect(state.currentGraph.nodes.length).toBe(4);
    expect(state.isModified).toBe(true);

    state.undo();
    expect(state.currentGraph.nodes.length).toBe(3);
    expect(state.currentGraph.nodes.find((n) => n.id === 'nodeD')).toBeUndefined();

    state.redo();
    expect(state.currentGraph.nodes.length).toBe(4);
    expect(state.currentGraph.nodes.find((n) => n.id === 'nodeD')).toBeDefined();
  });

  it('computes 2D graph layout without crashing and respects manual positioning', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');
    const layout = computeGraphLayout(state.currentGraph);

    expect(layout.layouts.has('nodeA')).toBe(true);
    expect(layout.layouts.has('nodeB')).toBe(true);
    expect(layout.layouts.has('nodeC')).toBe(true);

    const posA = layout.layouts.get('nodeA')!;
    const posB = layout.layouts.get('nodeB')!;
    expect(posA.x).toBeLessThan(posB.x);

    state.setNodePosition('nodeA', 15, 10);
    const updatedLayout = computeGraphLayout(state.currentGraph, state.nodePositions);
    expect(updatedLayout.layouts.get('nodeA')?.x).toBe(15);
    expect(updatedLayout.layouts.get('nodeA')?.y).toBe(10);
  });

  it('validates connections to prevent self-loops and duplicate edges', () => {
    const graph: GraphDefinition = sampleWorkflow.stages[0].graph;

    const selfRes = validateConnection(graph, 'nodeA', 'nodeA');
    expect(selfRes.valid).toBe(false);
    expect(selfRes.message).toContain('Direct self-loops');

    const dupRes = validateConnection(graph, 'nodeA', 'nodeB');
    expect(dupRes.valid).toBe(false);
    expect(dupRes.message).toContain('already exists');

    const cycleRes = validateConnection(graph, 'nodeC', 'nodeA');
    expect(cycleRes.valid).toBe(true);
    expect(cycleRes.isLoop).toBe(true);
  });

  it('renders canvas buffer for both Workflow View and Stage View accurately', () => {
    const buffer = new CanvasBuffer(40, 10);
    buffer.drawBox(2, 2, 10, 4, 'TEST');
    const lines = buffer.renderWindow(0, 0, 40, 10);
    expect(lines.length).toBe(10);
    expect(lines[2]).toContain('TEST');

    const state = new EditorState(sampleWorkflow);

    // 1. Workflow View rendering (shows stage nodes)
    const wfRendered = renderGraphCanvas(state, 80, 20);
    expect(wfRendered.content).toContain('STAGE 1/2');
    expect(wfRendered.content).toContain('Stage One');

    // 2. Stage View rendering (shows internal nodes)
    state.drillIntoStage('stage-1');
    const stageRendered = renderGraphCanvas(state, 80, 20);
    expect(stageRendered.content).toContain('nodeA');
    expect(stageRendered.content).toContain('nodeB');
  });

  it('selects nodes and stages directionally using WASD', () => {
    const state = new EditorState(sampleWorkflow);

    // In Workflow View: A (left) / D (right) navigates stages
    expect(state.selectedStageId).toBe('stage-1');
    state.selectDirection('right');
    expect(state.selectedStageId).toBe('stage-2');
    state.selectDirection('left');
    expect(state.selectedStageId).toBe('stage-1');

    // Drill into stage-1
    state.drillIntoStage('stage-1');
    expect(state.selectedNodeId).toBe('nodeA');

    // D (right) moves to nodeB (which is downstream in the layout)
    state.selectDirection('right');
    expect(state.selectedNodeId).toBe('nodeB');

    // D (right) moves to nodeC
    state.selectDirection('right');
    expect(state.selectedNodeId).toBe('nodeC');

    // A (left) moves back to nodeB
    state.selectDirection('left');
    expect(state.selectedNodeId).toBe('nodeB');
  });

  it('renames stages and records history', () => {
    const state = new EditorState(sampleWorkflow);
    expect(state.workflow.stages[0].name).toBe('Stage One');

    const success = state.renameStage('stage-1', 'Requirements Discovery');
    expect(success).toBe(true);
    expect(state.workflow.stages[0].name).toBe('Requirements Discovery');
    expect(state.isModified).toBe(true);

    // Undo restores previous name
    state.undo();
    expect(state.workflow.stages[0].name).toBe('Stage One');

    // Redo applies renamed name
    state.redo();
    expect(state.workflow.stages[0].name).toBe('Requirements Discovery');
  });

  it('prevents duplicate node IDs by auto-suffixing', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');

    // Attempt to add a node with ID 'nodeA' which already exists
    const assignedId = state.addNode({
      id: 'nodeA',
      type: 'agent',
      config: { agent: 'scout' },
    });

    expect(assignedId).toBe('nodeA-2');
    expect(state.currentGraph.nodes.some((n) => n.id === 'nodeA-2')).toBe(true);

    // Another attempt suffixes to nodeA-3
    const assignedId2 = state.addNode({
      id: 'nodeA',
      type: 'agent',
      config: { agent: 'scout' },
    });
    expect(assignedId2).toBe('nodeA-3');
  });

  it('renders backward and same-row back-edges without infinite loops', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');

    // Add back-edge from nodeC to nodeA (same row or backwards)
    state.addEdge({
      from: 'nodeC',
      to: 'nodeA',
      condition: { type: 'on_failure' },
    });

    // Reset viewport offset to 0,0 to view the beginning of the canvas
    state.viewportOffset = { x: 0, y: 0 };

    // Renders without freezing
    const rendered = renderGraphCanvas(state, 120, 25);
    expect(rendered.content).toContain('nodeA');
    expect(rendered.content).toContain('nodeC');
    // Ensure arrows exist
    expect(rendered.content).toContain('►');
  });

  it('toggles selection mode between nodes and edges and allows deleting edges', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');

    expect(state.selectedNodeId).toBe('nodeA');
    expect(state.selectedEdgeIndex).toBeNull();
    const initialEdgeCount = state.currentGraph.edges.length;

    // Toggle to edge selection mode
    const mode = state.toggleSelectionMode();
    expect(mode).toBe('edge');
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeIndex).toBe(0);

    // Delete selected edge
    state.removeEdge(state.selectedEdgeIndex!);
    expect(state.currentGraph.edges.length).toBe(initialEdgeCount - 1);

    // Node count remains unchanged
    expect(state.currentGraph.nodes.length).toBe(3);
  });

  it('correctly tracks and toggles start node role', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');

    // Auto-detected start node is nodeA (0 incoming edges)
    expect(state.isStartNode('nodeA')).toBe(true);
    expect(state.isStartNode('nodeB')).toBe(false);

    // Toggle start node on nodeB explicitly
    const isNowStart = state.toggleStartNode('nodeB');
    expect(isNowStart).toBe(true);
    expect(state.isStartNode('nodeB')).toBe(true);
    expect(state.currentGraph.entryNodeIds).toContain('nodeB');

    // Untoggle
    state.toggleStartNode('nodeB');
    expect(state.currentGraph.entryNodeIds?.includes('nodeB')).toBe(false);
  });

  it('renders start and end node icons in the canvas boxes', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');
    state.viewportOffset = { x: 0, y: 0 };

    const rendered = renderGraphCanvas(state, 120, 25);
    // Start node has ▶ indicator
    expect(rendered.content).toContain('[▶ AGENT]');
    // End node has ■ indicator
    expect(rendered.content).toContain('[■ TASK]');
  });

  it('toggles selection mode between nodes and edges with Tab and highlights in green', () => {
    const state = new EditorState(sampleWorkflow);
    state.drillIntoStage('stage-1');

    // Initially nodeA is selected
    expect(state.selectedNodeId).toBe('nodeA');
    expect(state.selectedEdgeIndex).toBeNull();

    // Tab toggles from node to edge mode
    const mode1 = state.toggleSelectionMode();
    expect(mode1).toBe('edge');
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEdgeIndex).toBe(0);

    // Selected edge renders in bold green
    const renderedEdge = renderGraphCanvas(state, 120, 25);
    expect(renderedEdge.content).toContain('{bold}{green-fg}');

    // Tab toggles back to node mode, restoring node selection
    const mode2 = state.toggleSelectionMode();
    expect(mode2).toBe('node');
    expect(state.selectedNodeId).toBe('nodeA');
    expect(state.selectedEdgeIndex).toBeNull();

    // Selected node renders in bold green
    const renderedNode = renderGraphCanvas(state, 120, 25);
    expect(renderedNode.content).toContain('{bold}{green-fg}╔═');
  });

  it('keeps connected components horizontally layered even when orphaned nodes exist', () => {
    const cyclicWithOrphan: WorkflowDefinition = {
      id: 'test-wf-orphan',
      name: 'Test Workflow with Orphan',
      stages: [
        {
          id: 'stage-1',
          name: 'Stage 1',
          graph: {
            nodes: [
              { id: 'frontman-interview', type: 'agent', config: { agent: 'frontman' } },
              {
                id: 'validate-brief',
                type: 'condition',
                config: { field: 'status', operator: 'equals', value: 'ok' },
              },
              { id: 'frontman-interview-2', type: 'agent', config: { agent: 'frontman' } }, // Orphaned
            ],
            edges: [
              {
                from: 'frontman-interview',
                to: 'validate-brief',
                condition: { type: 'on_success' },
              },
              { from: 'validate-brief', to: 'frontman-interview', condition: { type: 'always' } },
            ],
          },
        },
      ],
    };

    const state = new EditorState(cyclicWithOrphan);
    state.drillIntoStage('stage-1');

    const layout = computeGraphLayout(state.currentGraph);
    const posFrontman = layout.layouts.get('frontman-interview')!;
    const posValidate = layout.layouts.get('validate-brief')!;
    const posOrphan = layout.layouts.get('frontman-interview-2')!;

    // Connected nodes must be horizontally separated in distinct layers (frontman before validate)
    expect(posFrontman.x).toBeLessThan(posValidate.x);

    // Canvas must render cleanly without merging labels
    const rendered = renderGraphCanvas(state, 120, 30);
    expect(rendered.content).toContain('frontman-interview');
    expect(rendered.content).toContain('validate-brief');
    expect(rendered.content).toContain('frontman-interview-2');

    // Edge labels must not collide into (always)ess)
    expect(rendered.content).not.toContain('(always)ess)');
    expect(rendered.content).toContain('(always)');
    expect(rendered.content).toContain('(on_success)');
  });
});
