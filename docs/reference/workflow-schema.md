# Workflow Schema Reference

Crewmate defines deterministic, multi-stage pipelines using hierarchical Directed Acyclic Graphs (DAGs). This document specifies the formal TypeScript definitions, schema rules, execution policies, variable interpolation semantics, and JSON wire formats for all workflow primitives.

---

## Schema Hierarchy

The workflow engine executes pipelines structured into four hierarchical layers:

```
WorkflowDefinition
 └── StageDefinition[] (Ordered pipeline milestones)
      └── GraphDefinition (Internal DAG per stage)
           ├── NodeDefinition[] (Executable steps: agent, task, condition, tool, transform, passthrough)
           └── EdgeDefinition[] (Transitions & routing rules)
```

| Layer | Type | Responsibility |
| :--- | :--- | :--- |
| **Workflow** | `WorkflowDefinition` | Root execution blueprint containing sequential stages, global context, and metadata. |
| **Stage** | `StageDefinition` | Milestone phase (e.g., Discussion, Research, Execution) containing an isolated execution graph. |
| **Graph** | `GraphDefinition` | Directed graph of nodes and edges with concurrency and iteration boundaries. |
| **Node** | `NodeDefinition` | Atomic unit of execution evaluated by a registered runner. |
| **Edge** | `EdgeDefinition` | Directed connection (`from -> to`) governed by an evaluation condition. |

---

## TypeScript Interfaces

All models are defined in and exported from `crewmate/src/models/graph.ts`.

### WorkflowDefinition

Root container for multi-stage pipelines.

```typescript
export interface WorkflowDefinition {
  /** Unique workflow identifier (e.g., 'software-development') */
  id: string;
  /** Human-readable workflow display name */
  name: string;
  /** Descriptive summary of workflow purpose */
  description?: string;
  /** Semantic version string (e.g., '1.0.0') */
  version?: string;
  /** Ordered list of stages executed sequentially */
  stages: StageDefinition[];
  /** Default key-value context seeded into global execution state */
  initialContext?: Record<string, unknown>;
  /** Custom extension metadata (e.g., required brief fields) */
  metadata?: Record<string, unknown>;
}
```

### StageDefinition

Represents an isolated milestone stage within a workflow pipeline.

```typescript
export interface StageDefinition {
  /** Unique stage identifier (e.g., 'discussion', 'planning', 'execution') */
  id: string;
  /** Human-readable stage name */
  name: string;
  /** Stage description and objectives */
  description?: string;
  /** Internal DAG executed during this stage */
  graph: GraphDefinition;
  /** Optional preconditions evaluated before stage execution begins */
  entryConditions?: EdgeCondition[];
  /** Optional postconditions verified before stage is marked completed */
  exitConditions?: EdgeCondition[];
  /** Input parameters passed into stage execution context */
  inputs?: Record<string, unknown>;
  /** Declared output keys made available downstream */
  outputs?: string[];
  /** Stage-level execution constraints */
  executionPolicy?: NodeExecutionPolicy;
  /** Stage-specific metadata */
  metadata?: Record<string, unknown>;
}
```

### GraphDefinition

Defines the graph topology (nodes and edges) executed inside a stage.

```typescript
export interface GraphDefinition {
  /** Optional graph identifier */
  id?: string;
  /** Optional graph name */
  name?: string;
  /** Optional graph description */
  description?: string;
  /** Nodes belonging to this graph */
  nodes: NodeDefinition[];
  /** Directed edges connecting nodes */
  edges: EdgeDefinition[];
  /** Specific node IDs to trigger at start (defaults to nodes with zero incoming edges) */
  entryNodeIds?: string[];
  /** Terminal node IDs that conclude graph execution */
  exitNodeIds?: string[];
  /** Maximum graph-wide step iterations before aborting (default: 50) */
  maxIterations?: number;
  /** Graph-level metadata */
  metadata?: Record<string, unknown>;
}
```

### NodeDefinition & Node Types

A node represents an atomic unit of execution. The `type` field determines the configuration interface required.

```typescript
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

export type NodeType = (typeof NODE_TYPES)[number];

export interface NodeDefinition<TType extends NodeType = NodeType> {
  /** Unique node identifier within the graph */
  id: string;
  /** Human-readable node name */
  name?: string;
  /** Node discriminator */
  type: TType;
  /** Type-specific configuration shape */
  config: TType extends keyof NodeConfigMap ? NodeConfigMap[TType] : BaseNodeConfig;
  /** Input variables or port mappings */
  inputs?: Record<string, unknown> | NodePortMapping[];
  /** Declared output keys returned by this node */
  outputs?: string[];
  /** Execution timeout, retry, loop, and join policies */
  executionPolicy?: NodeExecutionPolicy;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}
```

#### Node Configuration Types

```typescript
/** Base configuration interface */
export interface BaseNodeConfig {
  [key: string]: unknown;
}

/** Configuration for 'agent' nodes */
export interface AgentNodeConfig extends BaseNodeConfig {
  /** Target agent name: 'frontman', 'scout', 'planner', 'executor', etc. */
  agent: string;
  /** Directive prompt instructions dispatched to the agent */
  prompt?: string;
  /** Template identifier or path for agent instructions */
  taskTemplate?: string;
  /** Tool whitelist enforced during node execution */
  allowedTools?: string[];
  /** Tool blacklist enforced during node execution */
  deniedTools?: string[];
}

/** Configuration for 'task' nodes */
export interface TaskNodeConfig extends BaseNodeConfig {
  /** Concise task title */
  title: string;
  /** Detailed implementation specifications */
  description: string;
  /** Associated brief field requirement */
  field?: string | null;
  /** Mandatory knowledge artifact categories before task completion */
  artifactRequirements?: string[];
  /** Relative file paths to lock prior to execution */
  lockFiles?: string[];
}

/** Configuration for 'condition' nodes */
export interface ConditionNodeConfig extends BaseNodeConfig {
  /** Expression string (e.g. "status == 'completed'") */
  expression?: string;
  /** Named predicate rule */
  predicate?: string;
  /** Context field path to evaluate */
  field?: string;
  /** Evaluation operator */
  operator?:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'exists'
    | 'truthy'
    | 'falsy';
  /** Expected value for comparison */
  value?: unknown;
  /** Branch targets based on evaluation results */
  cases?: Record<string, string>;
}

/** Configuration for 'tool' nodes */
export interface ToolNodeConfig extends BaseNodeConfig {
  /** Tool identifier or function name */
  tool: string;
  /** Static tool arguments */
  args?: Record<string, unknown>;
  /** CLI command string if tool is a shell command */
  command?: string;
}

/** Configuration for 'transform' nodes */
export interface TransformNodeConfig extends BaseNodeConfig {
  /** Transformation operation */
  transformType: 'map' | 'merge' | 'filter' | 'extract' | 'custom';
  /** JavaScript transformation function string */
  fn?: string;
  /** Key mapping from input context to output keys */
  mapping?: Record<string, string>;
}

/** Configuration for 'passthrough' nodes */
export type PassthroughNodeConfig = BaseNodeConfig;

/** Port mapping for explicit data flow between nodes */
export interface NodePortMapping {
  /** Source output key from predecessor node */
  fromPort?: string;
  /** Target input key on this node */
  toPort: string;
  /** Predecessor node ID supplying the value */
  sourceNodeId?: string;
  /** Fallback value if port cannot be resolved */
  defaultValue?: unknown;
}
```

### EdgeDefinition & EdgeCondition

Directed edges connect nodes and determine execution sequencing and branch decisions.

```typescript
export const EDGE_CONDITION_TYPES = [
  'always',
  'on_success',
  'on_failure',
  'expression',
  'predicate',
] as const;

export type EdgeConditionType = (typeof EDGE_CONDITION_TYPES)[number];

export interface EdgeCondition {
  /** Condition evaluation type */
  type: EdgeConditionType;
  /** Infix comparison expression string (e.g. "node.validate.result == true") */
  expression?: string;
  /** Comparison operator */
  operator?:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'exists'
    | 'truthy'
    | 'falsy';
  /** Dotted path to evaluate against context */
  field?: string;
  /** Expected value */
  value?: unknown;
  /** Custom programmatic evaluation callback (in-memory engine) */
  customFn?: (context: unknown) => boolean;
}

export interface EdgeDefinition {
  /** Optional unique edge ID */
  id?: string;
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Condition that must evaluate to true for traversal */
  condition?: EdgeCondition;
  /** Human-readable edge label */
  label?: string;
  /** Edge metadata */
  metadata?: Record<string, unknown>;
}
```

---

## Execution Policies

`NodeExecutionPolicy` controls failure recovery, timeouts, iteration bounds, and convergence behavior.

```typescript
export interface NodeExecutionPolicy {
  /** Maximum number of retry attempts on failure */
  maxRetries?: number;
  /** Backoff delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Node execution timeout in milliseconds */
  timeoutMs?: number;
  /** If true, node failure does not abort the graph if unhandled */
  continueOnFailure?: boolean;
  /** Maximum allowed execution iterations for this node (loop prevention) */
  maxIterations?: number;
  /** Synchronization behavior when multiple edges target this node */
  joinPolicy?: 'all' | 'any';
}
```

### Join Policy Semantics

When a node has multiple incoming edges from different predecessors, `joinPolicy` governs when the node becomes ready to execute:

| Policy | Classification | Evaluation Logic | Use Cases |
| :--- | :--- | :--- | :--- |
| `all` | **AND-Join** | Requires **all** incoming predecessor nodes to have completed successfully before this node transitions to `ready`. | Synchronizing parallel execution forks, waiting for all subtasks to finish. |
| `any` | **OR-Join** | Transitions this node to `ready` whenever **any** active incoming edge evaluates to true. | Looping constructs, cycle re-entry, error recovery paths, multiple alternative branches. |
| *(omitted)* | **Smart Join** | If all predecessors have started or completed, acts as an `all` join. If some predecessors are unrun loops, triggers immediately from the active predecessor. | Mixed topologies, iterative DAGs with back-edges. |

---

## Variable Interpolation & Path Addressing

Crewmate resolves dynamic data flow across nodes using two mechanisms: **prefix interpolation** in inputs and **dotted path addressing** in expressions.

### Input Variable Interpolation (`$`)

When specifying node `inputs` as a key-value map, strings prefixed with `$` resolve dynamically against active contexts:

```json
{
  "inputs": {
    "targetField": "$currentGoal",
    "workingDir": "$projectRoot"
  }
}
```

The resolver checks contexts in this prioritized order:
1. `graphContext` (Stage graph execution scope)
2. `stageContext` (Stage parent inputs)
3. `globalContext` (Workflow global context)

### Dotted Path Addressing

Edge conditions and condition nodes evaluate operands using dotted path syntax against the active `EvaluationContext`:

| Prefix / Path | Scope | Example | Description |
| :--- | :--- | :--- | :--- |
| `node.<id>.<key>` | Node Outputs | `node.validate-brief.isComplete` | Reads key `<key>` from the outputs dictionary of node `<id>`. |
| `output.<key>` | Relative Node Output | `output.testResults.passed` | Reads key `<key>` from the immediate predecessor node's outputs. |
| `global.<key>` | Workflow Global Context | `global.environment` | Reads key `<key>` from `workflowState.globalContext`. |
| `stage.<key>` | Stage Context | `stage.briefId` | Reads key `<key>` from the current stage's context. |
| `graph.<key>` | Graph Context | `graph.iteration` | Reads key `<key>` from the active graph's context. |
| `<key>` | Fallback Lookup | `isComplete` | Searches sequentially: `graphContext` &rarr; `stageContext` &rarr; `globalContext` &rarr; predecessor outputs. |

### Comparison Operators

Expressions support binary comparisons formatted as `<path> <operator> <literal|path>`:

- `==` (Equality check)
- `!=` (Inequality check)
- `>=` (Greater than or equal)
- `<=` (Less than or equal)
- `>` (Greater than)
- `<` (Less than)

---

## Annotated JSON Examples

Crewmate supports modular workflows where workflows reference stages via relative JSON file paths, and stages reference nodes via relative JSON file paths.

### Root Workflow Example (`default.json`)

```json
{
  "id": "software-development",
  "name": "Software Development Workflow",
  "description": "Standard default Crewmate workflow with requirements discussion, scout discovery, planning, execution, and verification.",
  "version": "1.0.0",
  "metadata": {
    "requiredBriefFields": [
      "workType",
      "goal",
      "scope",
      "functionalRequirements",
      "acceptanceCriteria"
    ]
  },
  "initialContext": {
    "projectLanguage": "typescript",
    "targetPlatform": "node"
  },
  "stages": [
    "./stages/discussion.json",
    "./stages/research.json",
    "./stages/planning.json",
    "./stages/execution.json",
    "./stages/verification.json"
  ]
}
```

### Stage Definition Example (`discussion.json`)

```json
{
  "id": "discussion",
  "name": "Discussion",
  "description": "Requirements interview and brief completion with Frontman.",
  "inputs": {
    "interviewMode": "interactive"
  },
  "outputs": ["briefComplete", "verifiedScope"],
  "graph": {
    "id": "discussion-graph",
    "maxIterations": 20,
    "nodes": [
      "../nodes/frontman-interview.json",
      "../nodes/validate-brief.json"
    ],
    "edges": [
      {
        "id": "interview-to-validate",
        "from": "frontman-interview",
        "to": "validate-brief",
        "condition": {
          "type": "on_success"
        },
        "label": "Interview completed"
      }
    ]
  }
}
```

### Node Examples

#### Agent Node (`frontman-interview.json`)

```json
{
  "id": "frontman-interview",
  "name": "Frontman Requirements Interview",
  "type": "agent",
  "config": {
    "agent": "frontman",
    "prompt": "Interview the user to complete all brief fields. Persist fields with crewmate_update_field.",
    "allowedTools": [
      "crewmate_create_brief",
      "crewmate_update_field",
      "crewmate_get_field",
      "crewmate_show_brief",
      "crewmate_check_status",
      "crewmate_finish_brief",
      "crewmate_set_activity",
      "crewmate_workflow_status",
      "crewmate_workflow_advance"
    ],
    "deniedTools": [
      "bash",
      "edit",
      "write",
      "crewmate_acquire_lock"
    ]
  },
  "executionPolicy": {
    "timeoutMs": 600000,
    "continueOnFailure": false
  }
}
```

#### Task Node (`compile-typescript.json`)

```json
{
  "id": "compile-typescript",
  "name": "Compile TypeScript Project",
  "type": "task",
  "config": {
    "title": "Compile TypeScript Project",
    "description": "Run tsc to ensure clean compilation without diagnostic errors.",
    "field": "functionalRequirements",
    "artifactRequirements": ["fact", "decision"],
    "lockFiles": ["tsconfig.json", "src/index.ts"]
  },
  "executionPolicy": {
    "maxRetries": 2,
    "retryDelayMs": 3000,
    "joinPolicy": "all"
  }
}
```

#### Condition Node (`validate-brief.json`)

```json
{
  "id": "validate-brief",
  "name": "Validate Brief Completeness",
  "type": "condition",
  "config": {
    "field": "node.frontman-interview.isComplete",
    "operator": "truthy",
    "cases": {
      "true": "research-stage",
      "false": "frontman-interview"
    }
  }
}
```

#### Tool Node (`run-linter.json`)

```json
{
  "id": "run-linter",
  "name": "Run Linter",
  "type": "tool",
  "config": {
    "tool": "eslint",
    "command": "npm run lint",
    "args": {
      "fix": true,
      "cache": true
    }
  }
}
```

#### Transform Node (`map-brief-to-context.json`)

```json
{
  "id": "map-brief-to-context",
  "name": "Map Brief Fields to Context",
  "type": "transform",
  "config": {
    "transformType": "map",
    "mapping": {
      "goal": "briefGoal",
      "scope": "briefScope"
    }
  },
  "inputs": {
    "briefGoal": "$goal",
    "briefScope": "$scope"
  }
}
```

#### Passthrough Node (`sync-gateway.json`)

```json
{
  "id": "sync-gateway",
  "name": "Synchronization Gateway",
  "type": "passthrough",
  "config": {},
  "executionPolicy": {
    "joinPolicy": "all"
  }
}
```
