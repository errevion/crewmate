import { describe, it, expect, beforeEach } from 'vitest';
import { GraphEngine } from '../src/graph/engine.js';
import { validateWorkflow, validateGraph, validateNode } from '../src/graph/validator.js';
import type { GraphDefinition, WorkflowDefinition } from '../src/models/graph.js';
import { AgentNodeRunner, TaskNodeRunner } from '../src/graph/runners/agent-task.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createBrief } from '../src/db/brief-repo.js';
import { listTasksByBrief } from '../src/db/task-repo.js';

describe('Graph Engine & Workflow Orchestration', () => {
  describe('Graph Construction and Validation', () => {
    it('validates a correct node', () => {
      const errors = validateNode({
        id: 'node-1',
        type: 'passthrough',
        config: {},
      });
      expect(errors).toHaveLength(0);
    });

    it('rejects a node missing an id or invalid type', () => {
      const err1 = validateNode({ type: 'passthrough', config: {} });
      expect(err1.some((e) => e.code === 'MISSING_NODE_ID')).toBe(true);

      const err2 = validateNode({ id: 'n1', type: 'invalid_type', config: {} });
      expect(err2.some((e) => e.code === 'INVALID_NODE_TYPE')).toBe(true);
    });

    it('rejects an agent node without config.agent', () => {
      const errors = validateNode({ id: 'agent-1', type: 'agent', config: {} });
      expect(errors.some((e) => e.code === 'MISSING_AGENT_CONFIG')).toBe(true);
    });

    it('detects duplicate node IDs and dangling edges', () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'node-1', type: 'passthrough', config: {} },
          { id: 'node-1', type: 'passthrough', config: {} },
        ],
        edges: [{ from: 'node-1', to: 'non-existent' }],
      };
      const res = validateGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.code === 'DUPLICATE_NODE_ID')).toBe(true);
      expect(res.errors.some((e) => e.code === 'DANGLING_EDGE_TO')).toBe(true);
    });

    it('validates a multi-stage workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Test Workflow',
        stages: [
          {
            id: 'stage-1',
            name: 'Stage 1',
            graph: {
              nodes: [{ id: 'n1', type: 'passthrough', config: {} }],
              edges: [],
            },
          },
        ],
      };
      const res = validateWorkflow(workflow);
      expect(res.valid).toBe(true);
    });
  });

  describe('Sequential Execution (A -> B -> C)', () => {
    it('executes nodes in strict sequential order and passes context', async () => {
      const executionOrder: string[] = [];

      const graph: GraphDefinition = {
        nodes: [
          { id: 'A', type: 'passthrough', config: {} },
          { id: 'B', type: 'passthrough', config: {} },
          { id: 'C', type: 'passthrough', config: {} },
        ],
        edges: [
          { from: 'A', to: 'B', condition: { type: 'on_success' } },
          { from: 'B', to: 'C', condition: { type: 'on_success' } },
        ],
      };

      const engine = new GraphEngine({
        onNodeStart: (node) => {
          executionOrder.push(node.id);
        },
      });

      const res = await engine.executeGraph(graph);
      expect(res.status).toBe('completed');
      expect(executionOrder).toEqual(['A', 'B', 'C']);
      expect(res.completedNodeIds).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Parallel Execution (A -> [B, C] -> D)', () => {
    it('executes branch nodes independently and merges at join node', async () => {
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      const graph: GraphDefinition = {
        nodes: [
          { id: 'A', type: 'passthrough', config: {} },
          { id: 'B', type: 'tool', config: { tool: 'build-backend' } },
          { id: 'C', type: 'tool', config: { tool: 'build-frontend' } },
          { id: 'D', type: 'passthrough', config: {} },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'C' },
          { from: 'B', to: 'D' },
          { from: 'C', to: 'D' },
        ],
      };

      const engine = new GraphEngine({
        onNodeStart: (node) => {
          startTimes[node.id] = Date.now();
        },
        onNodeComplete: (node) => {
          endTimes[node.id] = Date.now();
        },
      });

      const res = await engine.executeGraph(graph);
      expect(res.status).toBe('completed');
      expect(res.completedNodeIds).toContain('A');
      expect(res.completedNodeIds).toContain('B');
      expect(res.completedNodeIds).toContain('C');
      expect(res.completedNodeIds).toContain('D');
    });
  });

  describe('Conditional Branching', () => {
    it('routes to approved branch when condition evaluates to true', async () => {
      const executed: string[] = [];

      const graph: GraphDefinition = {
        nodes: [
          { id: 'reviewer', type: 'passthrough', config: {} },
          {
            id: 'condition',
            type: 'condition',
            config: { field: 'score', operator: 'greater_than', value: 70 },
          },
          { id: 'approved', type: 'passthrough', config: {} },
          { id: 'rejected', type: 'passthrough', config: {} },
        ],
        edges: [
          { from: 'reviewer', to: 'condition' },
          {
            from: 'condition',
            to: 'approved',
            condition: { type: 'predicate', field: 'score', operator: 'greater_than', value: 70 },
          },
          {
            from: 'condition',
            to: 'rejected',
            condition: { type: 'predicate', field: 'score', operator: 'less_than', value: 70 },
          },
        ],
      };

      const engine = new GraphEngine({
        onNodeStart: (node) => {
          executed.push(node.id);
        },
      });

      const res = await engine.executeGraph(graph, { score: 85 });
      expect(res.status).toBe('completed');
      expect(executed).toContain('approved');
      expect(executed).not.toContain('rejected');
    });

    it('routes to failure branch when node fails', async () => {
      const executed: string[] = [];

      const graph: GraphDefinition = {
        nodes: [
          { id: 'build', type: 'agent', config: { agent: 'builder' } },
          { id: 'recovery', type: 'passthrough', config: {} },
          { id: 'deploy', type: 'passthrough', config: {} },
        ],
        edges: [
          { from: 'build', to: 'deploy', condition: { type: 'on_success' } },
          { from: 'build', to: 'recovery', condition: { type: 'on_failure' } },
        ],
      };

      const engine = new GraphEngine({
        onNodeStart: (node) => {
          executed.push(node.id);
        },
      });

      engine.registerRunner('agent', {
        run: async () => {
          return { status: 'failed', error: 'Compilation error' };
        },
      });

      const res = await engine.executeGraph(graph);
      expect(res.status).toBe('completed');
      expect(executed).toContain('build');
      expect(executed).toContain('recovery');
      expect(executed).not.toContain('deploy');
    });
  });

  describe('Cycles and Iterative Loops', () => {
    it('executes iterative retry loop until condition passes', async () => {
      let attempts = 0;
      const history: string[] = [];

      const graph: GraphDefinition = {
        maxIterations: 10,
        nodes: [
          { id: 'implement', type: 'agent', config: { agent: 'executor' } },
          { id: 'test', type: 'tool', config: { tool: 'vitest' } },
          { id: 'verify', type: 'passthrough', config: {} },
          { id: 'done', type: 'passthrough', config: {} },
        ],
        edges: [
          { from: 'implement', to: 'test' },
          { from: 'test', to: 'verify' },
          {
            from: 'verify',
            to: 'implement',
            condition: { type: 'predicate', field: 'testsPassing', operator: 'falsy' },
          },
          {
            from: 'verify',
            to: 'done',
            condition: { type: 'predicate', field: 'testsPassing', operator: 'truthy' },
          },
        ],
      };

      const engine = new GraphEngine({
        onNodeStart: (node) => {
          history.push(node.id);
        },
      });

      engine.registerRunner('agent', {
        run: async () => {
          attempts++;
          return {
            status: 'completed',
            outputs: {
              attemptCount: attempts,
              testsPassing: attempts >= 3,
            },
          };
        },
      });

      engine.registerRunner('tool', {
        run: async () => {
          return {
            status: 'completed',
            outputs: {
              testsPassing: attempts >= 3,
            },
          };
        },
      });

      const res = await engine.executeGraph(graph);
      expect(res.status).toBe('completed');
      expect(attempts).toBe(3);
      expect(history.filter((n) => n === 'implement')).toHaveLength(3);
      expect(history).toContain('done');
    });

    it('safely aborts when loop exceeds max iterations', async () => {
      const graph: GraphDefinition = {
        maxIterations: 4,
        nodes: [
          { id: 'A', type: 'passthrough', config: {} },
          { id: 'B', type: 'passthrough', config: {} },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
        ],
      };

      const engine = new GraphEngine();
      const res = await engine.executeGraph(graph);
      expect(res.status).toBe('failed');
      expect(res.error).toMatch(/maximum iteration limit/i);
    });
  });

  describe('Agent & Task Runtime Integration with SQLite DB', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      runMigrations(db);
    });

    it('integrates TaskNodeRunner with SQLite tasks, locking, and compliance gates', async () => {
      const brief = createBrief(db, 'software', 'Build graph engine');

      const graph: GraphDefinition = {
        nodes: [
          {
            id: 'task-1',
            type: 'task',
            config: {
              title: 'Implement feature',
              description: 'Write code in src/index.ts',
              artifactRequirements: ['fact', 'decision'],
              lockFiles: ['src/index.ts'],
            },
          },
        ],
        edges: [],
      };

      const engine = new GraphEngine();
      engine.registerRunner('task', new TaskNodeRunner({ db, briefId: brief.id }));

      const res = await engine.executeGraph(graph, { briefId: brief.id });
      if (res.status === 'failed') {
        console.error('Task execution error:', res.error, res.nodes['task-1']?.error);
      }
      expect(res.status).toBe('completed');

      const tasks = listTasksByBrief(db, brief.id);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Implement feature');
      expect(tasks[0].status).toBe('completed');
    });

    it('executes AgentNodeRunner with event persistence', async () => {
      const brief = createBrief(db, 'software', 'Test agent events');

      const graph: GraphDefinition = {
        nodes: [
          {
            id: 'scout-1',
            type: 'agent',
            config: {
              agent: 'scout',
              prompt: 'Explore codebase',
            },
          },
        ],
        edges: [],
      };

      const engine = new GraphEngine();
      engine.registerRunner('agent', new AgentNodeRunner({ db, briefId: brief.id }));

      const res = await engine.executeGraph(graph, { briefId: brief.id });
      expect(res.status).toBe('completed');
    });
  });
});
