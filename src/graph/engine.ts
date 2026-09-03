import type {
  GraphDefinition,
  GraphExecutionState,
  NodeDefinition,
  NodeExecutionState,
  StageDefinition,
  StageExecutionState,
  WorkflowDefinition,
  WorkflowExecutionState,
} from '../models/graph.js';
import type { EvaluationContext } from './router.js';
import { getActiveOutgoingEdges } from './router.js';
import { validateWorkflow, validateGraph } from './validator.js';
import type { NodeRunner } from './runners/index.js';
import {
  PassthroughNodeRunner,
  ConditionNodeRunner,
  TransformNodeRunner,
  ToolNodeRunner,
} from './runners/index.js';
import { CrewmateError } from '../utils/errors.js';

/**
 * Options for configuring GraphEngine
 */
export interface GraphEngineOptions {
  runners?: Record<string, NodeRunner>;
  maxIterations?: number;
  maxParallel?: number;
  onNodeStart?: (node: NodeDefinition, state: NodeExecutionState) => void | Promise<void>;
  onNodeComplete?: (node: NodeDefinition, state: NodeExecutionState) => void | Promise<void>;
  onNodeError?: (
    node: NodeDefinition,
    state: NodeExecutionState,
    err: unknown
  ) => void | Promise<void>;
}

/**
 * Deterministic graph workflow engine
 */
export class GraphEngine {
  private runners: Map<string, NodeRunner> = new Map();
  private maxIterations: number;
  private maxParallel: number;
  private options: GraphEngineOptions;

  /**
   * Initializes a new GraphEngine
   */
  constructor(options: GraphEngineOptions = {}) {
    this.options = options;
    this.maxIterations = options.maxIterations ?? 50;
    this.maxParallel = options.maxParallel ?? 10;

    // Register standard runners
    this.registerRunner('passthrough', new PassthroughNodeRunner());
    this.registerRunner('condition', new ConditionNodeRunner());
    this.registerRunner('transform', new TransformNodeRunner());
    this.registerRunner('tool', new ToolNodeRunner());

    if (options.runners) {
      for (const [type, runner] of Object.entries(options.runners)) {
        this.registerRunner(type, runner);
      }
    }
  }

  /**
   * Registers a custom node runner
   */
  public registerRunner(type: string, runner: NodeRunner): void {
    this.runners.set(type, runner);
  }

  /**
   * Retrieves a registered node runner
   */
  public getRunner(type: string): NodeRunner | undefined {
    return this.runners.get(type);
  }

  /**
   * Executes a complete multi-stage workflow definition
   */
  public async executeWorkflow(
    workflow: WorkflowDefinition,
    initialContext: Record<string, unknown> = {}
  ): Promise<WorkflowExecutionState> {
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      throw new CrewmateError(
        `Invalid workflow definition: ${validation.errors.map((e) => e.message).join(', ')}`,
        'INVALID_WORKFLOW_DEF',
        validation.errors
      );
    }

    const runId = Math.random().toString(16).slice(2, 10);
    const globalContext: Record<string, unknown> = {
      ...workflow.initialContext,
      ...initialContext,
    };

    const workflowState: WorkflowExecutionState = {
      workflowId: workflow.id,
      runId,
      status: 'running',
      currentStageIndex: 0,
      stages: {},
      globalContext,
      startedAt: new Date().toISOString(),
    };

    try {
      for (let i = 0; i < workflow.stages.length; i++) {
        const stage = workflow.stages[i];
        workflowState.currentStageIndex = i;
        workflowState.currentStageId = stage.id;

        const stageState = await this.executeStage(stage, workflowState.globalContext);
        workflowState.stages[stage.id] = stageState;

        if (stageState.status === 'failed') {
          workflowState.status = 'failed';
          workflowState.error = stageState.error || `Stage ${stage.id} failed`;
          workflowState.completedAt = new Date().toISOString();
          return workflowState;
        }

        // Merge stage outputs into global context
        Object.assign(workflowState.globalContext, stageState.graphState.context);
      }

      workflowState.status = 'completed';
      workflowState.completedAt = new Date().toISOString();
      return workflowState;
    } catch (err: unknown) {
      workflowState.status = 'failed';
      workflowState.error = err instanceof Error ? err.message : String(err);
      workflowState.completedAt = new Date().toISOString();
      return workflowState;
    }
  }

  /**
   * Executes a stage within a workflow
   */
  public async executeStage(
    stage: StageDefinition,
    parentContext: Record<string, unknown> = {}
  ): Promise<StageExecutionState> {
    const stageContext: Record<string, unknown> = {
      ...parentContext,
      ...stage.inputs,
    };

    const stageState: StageExecutionState = {
      stageId: stage.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      graphState: {
        graphId: stage.graph.id || stage.id,
        status: 'running',
        nodes: {},
        iterationCount: 0,
        activeNodeIds: [],
        completedNodeIds: [],
        failedNodeIds: [],
        skippedNodeIds: [],
        context: stageContext,
      },
    };

    const graphState = await this.executeGraph(stage.graph, stageContext);
    stageState.graphState = graphState;
    stageState.status = graphState.status;
    stageState.completedAt = new Date().toISOString();
    stageState.error = graphState.error;

    return stageState;
  }

  /**
   * Executes a standalone graph definition
   */
  public async executeGraph(
    graph: GraphDefinition,
    initialContext: Record<string, unknown> = {}
  ): Promise<GraphExecutionState> {
    const validation = validateGraph(graph);
    if (!validation.valid) {
      throw new CrewmateError(
        `Invalid graph definition: ${validation.errors.map((e) => e.message).join(', ')}`,
        'INVALID_GRAPH_DEF',
        validation.errors
      );
    }

    const maxIterations = graph.maxIterations ?? this.maxIterations;
    const nodeMap = new Map<string, NodeDefinition>(graph.nodes.map((n) => [n.id, n]));

    const nodeStates: Record<string, NodeExecutionState> = {};
    for (const node of graph.nodes) {
      nodeStates[node.id] = {
        nodeId: node.id,
        status: 'pending',
        iteration: 0,
        inputs: {},
        outputs: {},
        retries: 0,
      };
    }

    const nodeOutputs: Record<string, Record<string, unknown>> = {};
    const context: Record<string, unknown> = { ...initialContext };

    const graphState: GraphExecutionState = {
      graphId: graph.id || 'graph',
      status: 'running',
      nodes: nodeStates,
      iterationCount: 0,
      activeNodeIds: [],
      completedNodeIds: [],
      failedNodeIds: [],
      skippedNodeIds: [],
      context,
      startedAt: new Date().toISOString(),
    };

    // Determine initial entry nodes:
    // If entryNodeIds is provided, use it.
    // Otherwise, prefer nodes with 0 incoming edges.
    // If all nodes have incoming edges (cyclic graph without a clear root), use the first node.
    const incomingEdgeCounts = new Map<string, number>();
    for (const node of graph.nodes) {
      incomingEdgeCounts.set(node.id, 0);
    }
    for (const edge of graph.edges) {
      incomingEdgeCounts.set(edge.to, (incomingEdgeCounts.get(edge.to) || 0) + 1);
    }

    const entryNodeIds =
      graph.entryNodeIds && graph.entryNodeIds.length > 0
        ? graph.entryNodeIds
        : graph.nodes.filter((n) => (incomingEdgeCounts.get(n.id) || 0) === 0).map((n) => n.id);

    const initialEntries =
      entryNodeIds.length > 0 ? entryNodeIds : graph.nodes.length > 0 ? [graph.nodes[0].id] : [];

    // Queue of ready node IDs
    const readyQueue: string[] = [...initialEntries];
    for (const id of readyQueue) {
      if (nodeStates[id]) {
        nodeStates[id].status = 'ready';
      }
    }

    const iterationCounts = new Map<string, number>();

    // Step-by-step execution loop
    while (readyQueue.length > 0) {
      // Batch ready nodes respecting concurrency limit
      const currentBatch = readyQueue.splice(0, this.maxParallel);
      graphState.activeNodeIds = [...currentBatch];

      // Execute batch concurrently
      const batchPromises = currentBatch.map(async (nodeId) => {
        const nodeDef = nodeMap.get(nodeId);
        if (!nodeDef) {
          return { nodeId, success: false, fatalError: true };
        }
        const state = nodeStates[nodeId];

        const nodeIterations = (iterationCounts.get(nodeId) || 0) + 1;
        iterationCounts.set(nodeId, nodeIterations);
        state.iteration = nodeIterations;

        graphState.iterationCount++;
        if (graphState.iterationCount > maxIterations) {
          state.status = 'failed';
          state.error = `Graph exceeded maximum iteration limit of ${maxIterations} (possible infinite loop)`;
          return { nodeId, success: false, fatalError: true };
        }

        if (
          nodeDef.executionPolicy?.maxIterations &&
          nodeIterations > nodeDef.executionPolicy.maxIterations
        ) {
          state.status = 'failed';
          state.error = `Node ${nodeId} exceeded its maximum iteration limit of ${nodeDef.executionPolicy.maxIterations}`;
          return { nodeId, success: false, fatalError: true };
        }

        state.status = 'running';
        state.startedAt = new Date().toISOString();

        if (this.options.onNodeStart) {
          await this.options.onNodeStart(nodeDef, state);
        }

        const runner = this.runners.get(nodeDef.type) || this.runners.get('passthrough');
        if (!runner) {
          state.status = 'failed';
          state.error = `No runner registered for node type ${nodeDef.type}`;
          return { nodeId, success: false };
        }

        const evalContext: EvaluationContext = {
          globalContext: context,
          stageContext: context,
          graphContext: context,
          nodeOutputs,
          nodeStates,
          currentNodeId: nodeId,
        };

        try {
          const result = await runner.run(nodeDef, evalContext, state);
          state.status = result.status;
          state.outputs = result.outputs || {};
          nodeOutputs[nodeId] = state.outputs;

          // Merge outputs into graph context
          Object.assign(context, state.outputs);

          if (result.status === 'completed') {
            state.completedAt = new Date().toISOString();
            if (!graphState.completedNodeIds.includes(nodeId)) {
              graphState.completedNodeIds.push(nodeId);
            }
            if (this.options.onNodeComplete) {
              await this.options.onNodeComplete(nodeDef, state);
            }
            return { nodeId, success: true };
          } else {
            state.error = result.error || `Node ${nodeId} execution failed`;
            state.completedAt = new Date().toISOString();
            if (!graphState.failedNodeIds.includes(nodeId)) {
              graphState.failedNodeIds.push(nodeId);
            }
            if (this.options.onNodeError) {
              await this.options.onNodeError(nodeDef, state, new Error(state.error));
            }
            return { nodeId, success: false };
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          state.status = 'failed';
          state.error = errorMsg;
          state.completedAt = new Date().toISOString();
          if (!graphState.failedNodeIds.includes(nodeId)) {
            graphState.failedNodeIds.push(nodeId);
          }
          if (this.options.onNodeError) {
            await this.options.onNodeError(nodeDef, state, err);
          }
          return { nodeId, success: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      graphState.activeNodeIds = [];

      // Check for fatal errors (e.g. max iteration limit exceeded)
      for (const res of batchResults) {
        if (res.fatalError) {
          graphState.status = 'failed';
          graphState.error = nodeStates[res.nodeId].error;
          graphState.completedAt = new Date().toISOString();
          return graphState;
        }
      }

      // Check for failures without continueOnFailure
      for (const res of batchResults) {
        const nodeDef = nodeMap.get(res.nodeId);
        if (!nodeDef) {
          continue;
        }
        if (!res.success && !nodeDef.executionPolicy?.continueOnFailure) {
          // Check if there is an outgoing failure edge
          const evalContext: EvaluationContext = {
            globalContext: context,
            stageContext: context,
            graphContext: context,
            nodeOutputs,
            nodeStates,
            currentNodeId: res.nodeId,
          };
          const outgoingFailureEdges = getActiveOutgoingEdges(graph, res.nodeId, evalContext);
          if (outgoingFailureEdges.length === 0) {
            graphState.status = 'failed';
            graphState.error = nodeStates[res.nodeId].error || `Node ${res.nodeId} failed`;
            graphState.completedAt = new Date().toISOString();
            return graphState;
          }
        }
      }

      // Route to next nodes
      for (const res of batchResults) {
        const evalContext: EvaluationContext = {
          globalContext: context,
          stageContext: context,
          graphContext: context,
          nodeOutputs,
          nodeStates,
          currentNodeId: res.nodeId,
        };

        const activeEdges = getActiveOutgoingEdges(graph, res.nodeId, evalContext);

        for (const edge of activeEdges) {
          const targetNodeId = edge.to;
          const targetNode = nodeMap.get(targetNodeId);
          if (!targetNode) {
            continue;
          }

          // Check if active prerequisites for target node are satisfied
          const incomingEdges = graph.edges.filter((e) => e.to === targetNodeId);
          const joinPolicy = targetNode.executionPolicy?.joinPolicy;

          let isPrerequisiteMet: boolean;
          if (joinPolicy === 'all') {
            // Explicit AND-join: all predecessors must be completed
            isPrerequisiteMet = incomingEdges.every((inEdge) => {
              const srcState = nodeStates[inEdge.from];
              if (!srcState) return false;
              if (inEdge.from === res.nodeId) return true;
              return srcState.status === 'completed';
            });
          } else if (joinPolicy === 'any') {
            // Explicit OR-join / loop: any incoming trigger suffices
            isPrerequisiteMet = incomingEdges.some((inEdge) => inEdge.from === res.nodeId);
          } else {
            // Default smart join: if all incoming predecessors have run or are completed, require all;
            // otherwise, if some predecessors are loops/unrun, allow trigger from active predecessor
            const allPredecessorsStarted = incomingEdges.every((inEdge) => {
              const srcState = nodeStates[inEdge.from];
              return (
                inEdge.from === res.nodeId ||
                srcState?.status === 'completed' ||
                srcState?.status === 'running'
              );
            });

            if (allPredecessorsStarted) {
              isPrerequisiteMet = incomingEdges.every((inEdge) => {
                const srcState = nodeStates[inEdge.from];
                if (!srcState) return false;
                if (inEdge.from === res.nodeId) return true;
                return srcState.status === 'completed';
              });
            } else {
              isPrerequisiteMet = incomingEdges.some((inEdge) => inEdge.from === res.nodeId);
            }
          }

          if (isPrerequisiteMet) {
            const targetState = nodeStates[targetNodeId];
            if (!readyQueue.includes(targetNodeId)) {
              targetState.status = 'ready';
              readyQueue.push(targetNodeId);
            }
          }
        }
      }
    }

    const hasUnhandledFailures = graphState.failedNodeIds.some((failedId) => {
      const evalContext: EvaluationContext = {
        globalContext: context,
        stageContext: context,
        graphContext: context,
        nodeOutputs,
        nodeStates,
        currentNodeId: failedId,
      };
      const outgoingFailureEdges = getActiveOutgoingEdges(graph, failedId, evalContext);
      return outgoingFailureEdges.length === 0;
    });

    graphState.status = hasUnhandledFailures ? 'failed' : 'completed';
    graphState.completedAt = new Date().toISOString();
    return graphState;
  }
}
