import { describe, it, expect } from 'vitest';
import {
  renderWorkflowSection,
  renderWorkflowDetails,
  getStageStatusIcon,
  formatWorkflowStatus,
  summarizeNodeConfig,
  formatNodeType,
  renderStageStepper,
  renderStageGraph,
} from '../src/utils/workflow-render.js';
import type { WorkflowRunView } from '../src/models/workflow-run.js';
import type { StageDefinition } from '../src/models/graph.js';
import { DEFAULT_WORKFLOW } from '../src/graph/default-workflow.js';

describe('Workflow Rendering in Watch Dashboard', () => {
  const mockWorkflowRun: WorkflowRunView = {
    id: 'wfr_test_123',
    briefId: 'brf_test_456',
    workflowDef: DEFAULT_WORKFLOW,
    status: 'running',
    currentStage: 'discussion',
    context: {},
    startedAt: '2026-09-02T10:00:00.000Z',
    completedAt: null,
    stageRuns: [
      {
        id: 'sr_1',
        workflowRunId: 'wfr_test_123',
        stageId: 'discussion',
        status: 'running',
        context: {},
        startedAt: '2026-09-02T10:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'sr_2',
        workflowRunId: 'wfr_test_123',
        stageId: 'research',
        status: 'pending',
        context: {},
        startedAt: null,
        completedAt: null,
      },
    ],
  };

  describe('getStageStatusIcon', () => {
    it('returns green checkmark for completed stage', () => {
      expect(getStageStatusIcon('completed')).toContain('✓');
    });

    it('returns spinner when running and frame provided', () => {
      const icon = getStageStatusIcon('running', 0);
      expect(icon).toContain('⠋');
    });

    it('returns play icon when running and frame not provided', () => {
      expect(getStageStatusIcon('running')).toContain('▶');
    });

    it('returns cross for failed stage', () => {
      expect(getStageStatusIcon('failed')).toContain('✗');
    });

    it('returns circle for pending stage', () => {
      expect(getStageStatusIcon('pending')).toContain('○');
    });

    it('returns pause icon for paused stage', () => {
      expect(getStageStatusIcon('paused')).toContain('⏸');
    });

    it('returns forbidden icon for skipped stage', () => {
      expect(getStageStatusIcon('skipped')).toContain('⊘');
    });
  });

  describe('formatWorkflowStatus', () => {
    it('formats running status with spinner frame', () => {
      const status = formatWorkflowStatus('running', 1);
      expect(status).toContain('⠙');
      expect(status).toContain('running');
    });

    it('formats completed status', () => {
      expect(formatWorkflowStatus('completed')).toContain('completed');
    });

    it('formats failed status', () => {
      expect(formatWorkflowStatus('failed')).toContain('failed');
    });

    it('formats paused status', () => {
      expect(formatWorkflowStatus('paused')).toContain('paused');
    });
  });

  describe('formatNodeType', () => {
    it('formats agent type with cyan tag', () => {
      expect(formatNodeType('agent')).toContain('cyan-fg');
    });

    it('formats condition type with yellow tag', () => {
      expect(formatNodeType('condition')).toContain('yellow-fg');
    });

    it('formats task type with magenta tag', () => {
      expect(formatNodeType('task')).toContain('magenta-fg');
    });
  });

  describe('summarizeNodeConfig', () => {
    it('summarizes agent node config', () => {
      const summary = summarizeNodeConfig({
        id: 'n1',
        type: 'agent',
        config: { agent: 'scout', prompt: 'test' },
      });
      expect(summary).toBe('agent: scout');
    });

    it('summarizes task node config', () => {
      const summary = summarizeNodeConfig({
        id: 'n2',
        type: 'task',
        config: { title: 'Implement feature', description: 'desc' },
      });
      expect(summary).toBe('task: Implement feature');
    });

    it('summarizes condition node config', () => {
      const summary = summarizeNodeConfig({
        id: 'n3',
        type: 'condition',
        config: { field: 'isComplete', operator: 'truthy' },
      });
      expect(summary).toBe('condition: isComplete');
    });

    it('summarizes tool node config', () => {
      const summary = summarizeNodeConfig({
        id: 'n4',
        type: 'tool',
        config: { tool: 'npm_test' },
      });
      expect(summary).toBe('tool: npm_test');
    });
  });

  describe('renderStageStepper', () => {
    it('renders ultra-compact stepper with progress badge and active stage highlighted', () => {
      const stageRunMap = new Map();
      const stepper = renderStageStepper(DEFAULT_WORKFLOW.stages, 'discussion', stageRunMap, 0);
      expect(stepper).toContain('[1/5]');
      expect(stepper).toContain('1.Discussion');
    });

    it('renders empty message when no stages defined', () => {
      const stepper = renderStageStepper([], null, new Map());
      expect(stepper).toContain('no stages defined');
    });
  });

  describe('renderStageGraph', () => {
    it('renders open vertical flow for linear 2-node graph (discussion stage)', () => {
      const discussionStage = DEFAULT_WORKFLOW.stages[0];
      const lines = renderStageGraph(discussionStage, 'running', 0);
      const text = lines.join('\n');
      expect(text).toContain('frontman-interview');
      expect(text).toContain('validate-brief');
      expect(text).toContain('on_success');
      expect(text).toContain('▼');
    });

    it('renders open bullet for single-node graph (research stage)', () => {
      const researchStage = DEFAULT_WORKFLOW.stages[1];
      const lines = renderStageGraph(researchStage, 'running', 0);
      const text = lines.join('\n');
      expect(text).toContain('scout-explore');
      expect(text).toContain('agent');
      expect(text).toContain('(scout)');
      expect(text).toContain('entry node · single step');
    });

    it('renders open branching tree for multi-output node graphs', () => {
      const branchStage: StageDefinition = {
        id: 'custom-stage',
        name: 'Custom',
        graph: {
          nodes: [
            { id: 'start', type: 'agent', config: { agent: 'scout' } },
            { id: 'node-b', type: 'task', config: { title: 'Task B', description: '' } },
            { id: 'node-c', type: 'tool', config: { tool: 'build' } },
          ],
          edges: [
            { from: 'start', to: 'node-b', condition: { type: 'on_success' } },
            { from: 'start', to: 'node-c', condition: { type: 'on_failure' } },
          ],
        },
      };

      const lines = renderStageGraph(branchStage, 'running', 0);
      const text = lines.join('\n');
      expect(text).toContain('start');
      expect(text).toContain('node-b');
      expect(text).toContain('node-c');
      expect(text).toContain('├──');
      expect(text).toContain('└──');
    });
  });

  describe('renderWorkflowSection (zoomed stage view)', () => {
    it('renders empty fallback when workflowRun is null', () => {
      const output = renderWorkflowSection(null);
      expect(output).toContain('No active workflow run');
      expect(output).toContain('crewmate workflow start');
    });

    it('renders workflow name, status, stage stepper, and zoomed active stage graph', () => {
      const output = renderWorkflowSection(mockWorkflowRun, 0);
      expect(output).toContain('Software Development');
      expect(output).toContain('running');
      expect(output).toContain('[1/5]');
      expect(output).toContain('Discussion');
      expect(output).toContain('frontman-interview');
      expect(output).toContain('validate-brief');
    });

    it('animates spinners on successive frames', () => {
      const frame0 = renderWorkflowSection(mockWorkflowRun, 0);
      const frame1 = renderWorkflowSection(mockWorkflowRun, 1);
      expect(frame0).toContain('⠋');
      expect(frame1).toContain('⠙');
    });
  });

  describe('renderWorkflowDetails (fullscreen modal view)', () => {
    it('renders empty fallback when workflowRun is null', () => {
      const output = renderWorkflowDetails(null);
      expect(output).toContain('No active workflow run');
    });

    it('renders full workflow details with stages and complete open DAG layouts', () => {
      const output = renderWorkflowDetails(mockWorkflowRun, 0);
      expect(output).toContain('Software Development Workflow');
      expect(output).toContain('wfr_test_123');
      expect(output).toContain('Stage Pipeline Overview:');
      expect(output).toContain('Stages & Graph DAG Layouts:');
      expect(output).toContain('Discussion');
      expect(output).toContain('frontman-interview');
      expect(output).toContain('validate-brief');
      expect(output).toContain('Research & Discovery');
      expect(output).toContain('scout-explore');
      expect(output).toContain('Planning');
      expect(output).toContain('planner-decompose');
      expect(output).toContain('Execution');
      expect(output).toContain('executor-run');
      expect(output).toContain('Verification');
      expect(output).toContain('verify-artifacts');
    });
  });
});
