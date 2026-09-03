/**
 * Graph-Based Workflow Domain Models
 *
 * Core primitives for graph orchestration:
 * Workflow -> Stage -> Graph -> Node / Edge
 */

export const WORKFLOW_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'paused',
  'cancelled',
] as const;

/**
 * Lifecycle status of a workflow
 */
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const STAGE_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'paused',
] as const;

/**
 * Lifecycle status of a stage
 */
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const NODE_STATUSES = [
  'pending',
  'ready',
  'running',
  'completed',
  'failed',
  'skipped',
  'blocked',
] as const;

/**
 * Lifecycle status of an individual node
 */
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const NODE_TYPES = [
  'agent',
  'task',
  'condition',
  'tool',
  'transform',
  'human',
  'subgraph',
  'passthrough',
] as const;

/**
 * Allowed node types in a graph
 */
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_CONDITION_TYPES = [
  'always',
  'on_success',
  'on_failure',
  'expression',
  'predicate',
] as const;

/**
 * Condition evaluation types for edges
 */
export type EdgeConditionType = (typeof EDGE_CONDITION_TYPES)[number];

/**
 * Port mapping for data flow between nodes
 */
export interface NodePortMapping {
  fromPort?: string;
  toPort: string;
  sourceNodeId?: string;
  defaultValue?: unknown;
}

/**
 * Execution policy for nodes
 */
export interface NodeExecutionPolicy {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  continueOnFailure?: boolean;
  maxIterations?: number; // for loop detection
  joinPolicy?: 'all' | 'any'; // 'all' requires all incoming edges to be completed (parallel join); 'any' triggers whenever an incoming edge satisfies (loops/branching)
}

/**
 * Base configuration for graph nodes
 */
export interface BaseNodeConfig {
  [key: string]: unknown;
}

/**
 * Configuration for Agent nodes
 */
export interface AgentNodeConfig extends BaseNodeConfig {
  agent: string;
  prompt?: string;
  taskTemplate?: string;
  allowedTools?: string[];
  deniedTools?: string[];
}

/**
 * Configuration for Task nodes
 */
export interface TaskNodeConfig extends BaseNodeConfig {
  title: string;
  description: string;
  field?: string | null;
  artifactRequirements?: string[];
  lockFiles?: string[];
}

/**
 * Configuration for Condition nodes
 */
export interface ConditionNodeConfig extends BaseNodeConfig {
  expression?: string;
  predicate?: string;
  field?: string;
  operator?:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'exists'
    | 'truthy'
    | 'falsy';
  value?: unknown;
  cases?: Record<string, string>; // case branch -> target node id
}

/**
 * Configuration for Tool nodes
 */
export interface ToolNodeConfig extends BaseNodeConfig {
  tool: string;
  args?: Record<string, unknown>;
  command?: string;
}

/**
 * Configuration for Transform nodes
 */
export interface TransformNodeConfig extends BaseNodeConfig {
  transformType: 'map' | 'merge' | 'filter' | 'extract' | 'custom';
  fn?: string;
  mapping?: Record<string, string>;
}

/**
 * Configuration for Human/Approval nodes
 */
export interface HumanNodeConfig extends BaseNodeConfig {
  prompt: string;
  options?: string[];
  requiredRole?: string;
  timeoutMs?: number;
}

/**
 * Configuration for Subgraph nodes
 */
export interface SubgraphNodeConfig extends BaseNodeConfig {
  subgraphId?: string;
  workflowId?: string;
  stageId?: string;
  graph?: GraphDefinition;
}

/**
 * Mapping of node types to their specific config shapes
 */
export type NodeConfigMap = {
  agent: AgentNodeConfig;
  task: TaskNodeConfig;
  condition: ConditionNodeConfig;
  tool: ToolNodeConfig;
  transform: TransformNodeConfig;
  human: HumanNodeConfig;
  subgraph: SubgraphNodeConfig;
  passthrough: BaseNodeConfig;
};

/**
 * Node definition in a graph
 */
export interface NodeDefinition<TType extends NodeType = NodeType> {
  id: string;
  name?: string;
  type: TType;
  config: TType extends keyof NodeConfigMap ? NodeConfigMap[TType] : BaseNodeConfig;
  inputs?: Record<string, unknown> | NodePortMapping[];
  outputs?: string[];
  executionPolicy?: NodeExecutionPolicy;
  metadata?: Record<string, unknown>;
}

/**
 * Edge condition definition
 */
export interface EdgeCondition {
  type: EdgeConditionType;
  expression?: string;
  operator?:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'exists'
    | 'truthy'
    | 'falsy';
  field?: string;
  value?: unknown;
  customFn?: (context: unknown) => boolean;
}

/**
 * Directed edge connecting nodes
 */
export interface EdgeDefinition {
  id?: string;
  from: string;
  to: string;
  condition?: EdgeCondition;
  label?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Graph definition containing nodes and edges
 */
export interface GraphDefinition {
  id?: string;
  name?: string;
  description?: string;
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
  entryNodeIds?: string[];
  exitNodeIds?: string[];
  maxIterations?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Stage definition in a workflow
 */
export interface StageDefinition {
  id: string;
  name: string;
  description?: string;
  graph: GraphDefinition;
  entryConditions?: EdgeCondition[];
  exitConditions?: EdgeCondition[];
  inputs?: Record<string, unknown>;
  outputs?: string[];
  executionPolicy?: NodeExecutionPolicy;
  metadata?: Record<string, unknown>;
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version?: string;
  stages: StageDefinition[];
  initialContext?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Runtime execution state of a node
 */
export interface NodeExecutionState {
  nodeId: string;
  status: NodeStatus;
  iteration: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  retries: number;
}

/**
 * Runtime execution state of a graph
 */
export interface GraphExecutionState {
  graphId: string;
  status: StageStatus;
  nodes: Record<string, NodeExecutionState>;
  iterationCount: number;
  activeNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  skippedNodeIds: string[];
  context: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * Runtime execution state of a stage
 */
export interface StageExecutionState {
  stageId: string;
  status: StageStatus;
  graphState: GraphExecutionState;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * Runtime execution state of a workflow
 */
export interface WorkflowExecutionState {
  workflowId: string;
  runId: string;
  status: WorkflowStatus;
  currentStageIndex: number;
  currentStageId?: string;
  stages: Record<string, StageExecutionState>;
  globalContext: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}
