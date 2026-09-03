import type { WorkflowRunView, StageRun, StageRunStatus } from '../models/workflow-run.js';
import type { StageDefinition, NodeDefinition, EdgeDefinition } from '../models/graph.js';
import { SPINNERS } from './ascii.js';
import { getCharSet } from './graph.js';

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Maps a stage status to a colored icon, optionally animated with spinnerFrame.
 */
export function getStageStatusIcon(status: StageRunStatus, spinnerFrame?: number): string {
  switch (status) {
    case 'completed':
      return '{green-fg}✓{/green-fg}';
    case 'running': {
      if (spinnerFrame !== undefined) {
        const spinner = SPINNERS[spinnerFrame % SPINNERS.length];
        return `{yellow-fg}${spinner}{/yellow-fg}`;
      }
      return '{yellow-fg}▶{/yellow-fg}';
    }
    case 'failed':
      return '{red-fg}✗{/red-fg}';
    case 'skipped':
      return '{gray-fg}⊘{/gray-fg}';
    case 'paused':
      return '{yellow-fg}⏸{/yellow-fg}';
    case 'pending':
    default:
      return '{gray-fg}○{/gray-fg}';
  }
}

/**
 * Returns a colored status label for workflow runs.
 */
export function formatWorkflowStatus(status: string, spinnerFrame?: number): string {
  switch (status) {
    case 'running': {
      if (spinnerFrame !== undefined) {
        const spinner = SPINNERS[spinnerFrame % SPINNERS.length];
        return `{yellow-fg}${spinner} running{/yellow-fg}`;
      }
      return '{yellow-fg}running{/yellow-fg}';
    }
    case 'completed':
      return '{green-fg}✓ completed{/green-fg}';
    case 'failed':
      return '{red-fg}✗ failed{/red-fg}';
    case 'paused':
      return '{yellow-fg}⏸ paused{/yellow-fg}';
    case 'cancelled':
      return '{red-fg}cancelled{/red-fg}';
    case 'pending':
    default:
      return '{gray-fg}pending{/gray-fg}';
  }
}

/**
 * Formats node type with specialized tag colors.
 */
export function formatNodeType(type: string): string {
  switch (type) {
    case 'agent':
      return '{cyan-fg}agent{/cyan-fg}';
    case 'condition':
      return '{yellow-fg}condition{/yellow-fg}';
    case 'task':
      return '{magenta-fg}task{/magenta-fg}';
    case 'tool':
      return '{blue-fg}tool{/blue-fg}';
    case 'transform':
      return '{green-fg}transform{/green-fg}';
    case 'human':
      return '{magenta-fg}human{/magenta-fg}';
    default:
      return `{white-fg}${type}{/white-fg}`;
  }
}

/**
 * Summarizes a node's configuration into a short display string.
 */
export function summarizeNodeConfig(node: NodeDefinition): string {
  const cfg = node.config as Record<string, unknown>;
  switch (node.type) {
    case 'agent':
      return `agent: ${cfg?.agent ?? 'unknown'}`;
    case 'task':
      return `task: ${truncate(String(cfg?.title ?? ''), 50)}`;
    case 'condition':
      return `condition: ${cfg?.field ?? cfg?.expression ?? 'eval'}`;
    case 'tool':
      return `tool: ${cfg?.tool ?? 'unknown'}`;
    case 'transform':
      return `transform: ${cfg?.transformType ?? 'custom'}`;
    case 'human':
      return `human: ${truncate(String(cfg?.prompt ?? ''), 50)}`;
    case 'subgraph':
      return `subgraph: ${cfg?.subgraphId ?? 'inline'}`;
    case 'passthrough':
      return 'passthrough';
    default:
      return node.type;
  }
}

/**
 * Formats an edge condition for display.
 */
export function formatEdgeCondition(edge: EdgeDefinition): string {
  if (!edge.condition) {
    return 'always';
  }
  const cond = edge.condition;
  if (cond.type === 'on_success') {
    return 'on_success';
  }
  if (cond.type === 'on_failure') {
    return 'on_failure';
  }
  if (cond.type === 'expression') {
    return `expr: ${cond.expression}`;
  }
  if (cond.field) {
    return `${cond.field} (${cond.operator ?? 'truthy'})`;
  }
  return cond.type ?? 'condition';
}

/**
 * Builds an animated connector rail with a moving particle.
 */
function buildAnimatedEdgeArrow(label?: string, spinnerFrame?: number, isAnimated = false): string {
  if (!isAnimated || spinnerFrame === undefined) {
    const labelStr = label ? `(${label})──` : '──';
    return `──${labelStr}►`;
  }

  const dotPos = spinnerFrame % 3;
  if (dotPos === 0) {
    return label ? `──●──(${label})──►` : `──●────►`;
  } else if (dotPos === 1) {
    return label ? `────(${label})──●──►` : `────●──►`;
  } else {
    return label ? `────(${label})────►●` : `──────►●`;
  }
}

/**
 * Renders an ultra-compact, overflow-safe stage stepper tracker.
 * Example: `[4/5] (✓)─(✓)─(✓)─[⠋ 4.Exec]─(○)` (<= 32 chars)
 */
export function renderStageStepper(
  stages: StageDefinition[],
  currentStageId: string | null,
  stageRunMap: Map<string, StageRun>,
  spinnerFrame?: number
): string {
  if (stages.length === 0) {
    return '{gray-fg}(no stages defined){/gray-fg}';
  }

  const currentIndex = Math.max(
    0,
    stages.findIndex((s) => s.id === currentStageId)
  );

  const parts: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const run = stageRunMap.get(stage.id);
    const isCurrent = stage.id === currentStageId;
    const stageStatus: StageRunStatus =
      run?.status ?? (isCurrent ? 'running' : i < currentIndex ? 'completed' : 'pending');

    if (isCurrent) {
      const icon = getStageStatusIcon(stageStatus, spinnerFrame);
      const name = truncate(stage.name, 16);
      parts.push(`{bold}{yellow-fg}[${icon} ${i + 1}.${name}]{/yellow-fg}{/bold}`);
    } else if (stageStatus === 'completed') {
      parts.push(`{green-fg}(✓){/green-fg}`);
    } else if (stageStatus === 'failed') {
      parts.push(`{red-fg}(✗){/red-fg}`);
    } else {
      parts.push(`{gray-fg}(○){/gray-fg}`);
    }
  }

  const connector = '{gray-fg}─{/gray-fg}';
  const progressBadge = `{cyan-fg}[${currentIndex + 1}/${stages.length}]{/cyan-fg}`;
  return `${progressBadge} ${parts.join(connector)}`;
}

/**
 * Renders the open graph DAG topology for a specific stage.
 * Uses open tree and flow connectors without closed rectangular cages to avoid border breakage and text wrapping.
 */
export function renderStageGraph(
  stage: StageDefinition,
  stageStatus: StageRunStatus,
  spinnerFrame?: number,
  options: { maxPromptLen?: number; fullWidth?: boolean } = {}
): string[] {
  const nodes = stage.graph?.nodes ?? [];
  const edges = stage.graph?.edges ?? [];
  const maxPrompt = options.maxPromptLen ?? (options.fullWidth ? 90 : 65);
  const isRunning = stageStatus === 'running';

  const lines: string[] = [];

  if (nodes.length === 0) {
    lines.push('{gray-fg}• (no nodes in stage graph){/gray-fg}');
    return lines;
  }

  // Find entry nodes and build adjacency map
  const outgoingMap = new Map<string, EdgeDefinition[]>();
  const incomingMap = new Map<string, EdgeDefinition[]>();
  for (const edge of edges) {
    const outList = outgoingMap.get(edge.from) ?? [];
    outList.push(edge);
    outgoingMap.set(edge.from, outList);

    const inList = incomingMap.get(edge.to) ?? [];
    inList.push(edge);
    incomingMap.set(edge.to, inList);
  }

  // Case 1: Single Node in stage graph
  if (nodes.length === 1) {
    const node = nodes[0];
    const nodeIcon =
      isRunning && spinnerFrame !== undefined
        ? `{yellow-fg}${SPINNERS[spinnerFrame % SPINNERS.length]}{/yellow-fg}`
        : isRunning
          ? '{yellow-fg}▶{/yellow-fg}'
          : stageStatus === 'completed'
            ? '{green-fg}✓{/green-fg}'
            : '{gray-fg}○{/gray-fg}';

    const cfg = node.config as Record<string, unknown>;
    const typeBadge = formatNodeType(node.type);
    const agentSuffix = node.type === 'agent' && cfg?.agent ? ` (${cfg.agent})` : '';

    lines.push(`• [ ${nodeIcon} {bold}${node.id}{/bold} ] ${typeBadge}${agentSuffix}`);

    if (node.type === 'agent' && cfg?.prompt) {
      lines.push(`  {gray-fg}Prompt: "${truncate(String(cfg.prompt), maxPrompt)}"{/gray-fg}`);
    } else if (node.type === 'task' && cfg?.title) {
      lines.push(`  {gray-fg}Task: "${truncate(String(cfg.title), maxPrompt)}"{/gray-fg}`);
    } else if (node.type === 'condition' && (cfg?.field || cfg?.expression)) {
      lines.push(
        `  {gray-fg}Check: ${cfg.field ?? cfg.expression} (${cfg.operator ?? 'truthy'}){/gray-fg}`
      );
    } else if (node.type === 'tool' && cfg?.tool) {
      lines.push(`  {gray-fg}Tool: ${cfg.tool}{/gray-fg}`);
    }

    lines.push('  {gray-fg}(entry node · single step){/gray-fg}');
    return lines;
  }

  // Case 2: Linear chain (NodeA -> NodeB -> NodeC)
  const isLinear =
    nodes.length > 1 &&
    edges.length === nodes.length - 1 &&
    nodes.every((n, idx) => {
      if (idx === 0) {
        return (
          (outgoingMap.get(n.id)?.length ?? 0) === 1 && (incomingMap.get(n.id)?.length ?? 0) === 0
        );
      }
      if (idx === nodes.length - 1) {
        return (
          (incomingMap.get(n.id)?.length ?? 0) === 1 && (outgoingMap.get(n.id)?.length ?? 0) === 0
        );
      }
      return (
        (incomingMap.get(n.id)?.length ?? 0) === 1 && (outgoingMap.get(n.id)?.length ?? 0) === 1
      );
    });

  if (isLinear) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isNodeRunning = isRunning && i === 0;
      const nodeIcon =
        isNodeRunning && spinnerFrame !== undefined
          ? `{yellow-fg}${SPINNERS[(spinnerFrame + i) % SPINNERS.length]}{/yellow-fg}`
          : stageStatus === 'completed'
            ? '{green-fg}✓{/green-fg}'
            : '{gray-fg}○{/gray-fg}';

      const typeBadge = formatNodeType(node.type);
      const configSummary = summarizeNodeConfig(node);

      lines.push(`[ ${nodeIcon} {bold}${truncate(node.id, 35)}{/bold} ] ${typeBadge}`);
      lines.push(`  {gray-fg}${truncate(configSummary, maxPrompt)}{/gray-fg}`);

      if (i < nodes.length - 1) {
        const outEdges = outgoingMap.get(node.id) ?? [];
        const edge = outEdges[0];
        const condLabel = edge ? formatEdgeCondition(edge) : 'always';
        const animDot =
          isRunning && spinnerFrame !== undefined ? (spinnerFrame % 2 === 0 ? ' ●' : '  ') : '';
        lines.push('  │');
        lines.push(`  │ {yellow-fg}${condLabel}{/yellow-fg}${animDot}`);
        lines.push('  ▼');
      }
    }
    return lines;
  }

  // Case 3: Branching / Tree / Complex DAG Topology
  const entryNodes = nodes.filter((n) => (incomingMap.get(n.id)?.length ?? 0) === 0);
  const roots = entryNodes.length > 0 ? entryNodes : [nodes[0]];

  for (const root of roots) {
    const rootIcon =
      isRunning && spinnerFrame !== undefined
        ? `{yellow-fg}${SPINNERS[spinnerFrame % SPINNERS.length]}{/yellow-fg}`
        : stageStatus === 'completed'
          ? '{green-fg}✓{/green-fg}'
          : '{gray-fg}○{/gray-fg}';

    const rootBadge = formatNodeType(root.type);
    lines.push(`[ ${rootIcon} {bold}${root.id}{/bold} ] ${rootBadge}`);

    const rootOutEdges = outgoingMap.get(root.id) ?? [];
    if (rootOutEdges.length === 0) {
      lines.push(`  {gray-fg}└─ (no outgoing connections){/gray-fg}`);
    } else {
      for (let eIdx = 0; eIdx < rootOutEdges.length; eIdx++) {
        const edge = rootOutEdges[eIdx];
        const isLastEdge = eIdx === rootOutEdges.length - 1;
        const targetNode = nodes.find((n) => n.id === edge.to);
        const cond = formatEdgeCondition(edge);
        const arrow = buildAnimatedEdgeArrow(cond, spinnerFrame, isRunning);

        const targetIcon =
          stageStatus === 'completed' ? '{green-fg}✓{/green-fg}' : '{gray-fg}○{/gray-fg}';
        const targetType = targetNode ? formatNodeType(targetNode.type) : 'node';
        const branchChar = isLastEdge ? '└──' : '├──';

        lines.push(
          `  ${branchChar}${arrow} [ ${targetIcon} {bold}${edge.to}{/bold} ] ${targetType}`
        );
      }
    }
  }

  // Any standalone nodes
  const targetNodeIds = new Set(edges.map((e) => e.to));
  const rootNodeIds = new Set(roots.map((r) => r.id));
  const standaloneNodes = nodes.filter((n) => !targetNodeIds.has(n.id) && !rootNodeIds.has(n.id));

  for (const standalone of standaloneNodes) {
    const sIcon = stageStatus === 'completed' ? '{green-fg}✓{/green-fg}' : '{gray-fg}○{/gray-fg}';
    const sBadge = formatNodeType(standalone.type);
    lines.push(`[ ${sIcon} {bold}${standalone.id}{/bold} ] ${sBadge}`);
  }

  return lines;
}

/**
 * Renders the compact workflow section for the main dashboard quadrant.
 * Zooms into the current stage's graph topology and provides an ultra-compact stage stepper.
 */
export function renderWorkflowSection(
  workflowRun: WorkflowRunView | null | undefined,
  spinnerFrame?: number
): string {
  if (!workflowRun) {
    return [
      '{gray-fg}No active workflow run.{/gray-fg}',
      '',
      '{gray-fg}Use {bold}crewmate workflow start{/bold} to initialize a workflow.{/gray-fg}',
    ].join('\n');
  }

  const { workflowDef, status, currentStage, stageRuns = [] } = workflowRun;
  const stages = workflowDef?.stages ?? [];
  const stageRunMap = new Map<string, StageRun>(stageRuns.map((sr) => [sr.stageId, sr]));

  const lines: string[] = [];

  // Header line: Workflow name & status badge
  const statusLabel = formatWorkflowStatus(status, spinnerFrame);
  lines.push(`{bold}${truncate(workflowDef.name, 45)}{/bold}  ${statusLabel}`);

  // Stage progress stepper bar
  const stepperLine = renderStageStepper(stages, currentStage, stageRunMap, spinnerFrame);
  lines.push(stepperLine);
  lines.push('');

  // Active Stage Zoom
  const activeStage = stages.find((s) => s.id === currentStage) ?? stages[0];
  if (activeStage) {
    const activeStageRun = stageRunMap.get(activeStage.id);
    const activeStageStatus =
      activeStageRun?.status ?? (status === 'completed' ? 'completed' : 'running');
    const activeIcon = getStageStatusIcon(activeStageStatus, spinnerFrame);

    lines.push(
      `{cyan-fg}Stage:{/cyan-fg} {bold}${truncate(activeStage.name, 35)}{/bold} ${activeIcon}`
    );

    // Zoomed Graph of the Active Stage
    const graphLines = renderStageGraph(activeStage, activeStageStatus, spinnerFrame, {
      maxPromptLen: 65,
    });
    lines.push(...graphLines);
  }

  return lines.join('\n');
}

/**
 * Renders the fullscreen workflow modal view with complete multi-stage DAG, stages, nodes, and edges details.
 */
export function renderWorkflowDetails(
  workflowRun: WorkflowRunView | null | undefined,
  spinnerFrame?: number
): string {
  if (!workflowRun) {
    return [
      '{bold}{yellow-fg}Workflow Information{/yellow-fg}{/bold}',
      '',
      '{gray-fg}No active workflow run found for this brief.{/gray-fg}',
      '',
      'You can start a workflow run with:',
      '  {bold}crewmate workflow start{/bold}',
      '',
      'Or run a workflow headless with:',
      '  {bold}crewmate workflow run -f <workflow.json>{/bold}',
    ].join('\n');
  }

  const { workflowDef, status, currentStage, startedAt, completedAt, stageRuns = [] } = workflowRun;
  const stages = workflowDef?.stages ?? [];
  const stageRunMap = new Map<string, StageRun>(stageRuns.map((sr) => [sr.stageId, sr]));
  const cs = getCharSet();

  const lines: string[] = [];

  // Top header box
  const statusLabel = formatWorkflowStatus(status, spinnerFrame);
  lines.push(
    `{bold}{cyan-fg}Workflow:{/cyan-fg} ${workflowDef.name}{/bold} (v${workflowDef.version ?? '1.0.0'})`
  );
  lines.push(
    `{gray-fg}ID:{/gray-fg} ${workflowDef.id}  ·  {gray-fg}Status:{/gray-fg} ${statusLabel}  ·  {gray-fg}Run ID:{/gray-fg} ${workflowRun.id}`
  );
  if (workflowDef.description) {
    lines.push(`{gray-fg}Description:{/gray-fg} ${workflowDef.description}`);
  }
  lines.push(
    `{gray-fg}Started:{/gray-fg} ${startedAt}${completedAt ? `  ·  {gray-fg}Completed:{/gray-fg} ${completedAt}` : ''}`
  );
  lines.push('');

  // Global Pipeline visual overview
  lines.push('{bold}{yellow-fg}Stage Pipeline Overview:{/yellow-fg}{/bold}');
  const pipelineParts: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const run = stageRunMap.get(stage.id);
    const isCurrent = stage.id === currentStage;
    const stageStatus: StageRunStatus = run?.status ?? (isCurrent ? 'running' : 'pending');
    const icon = getStageStatusIcon(stageStatus, isCurrent ? spinnerFrame : undefined);

    if (isCurrent) {
      pipelineParts.push(`{bold}{yellow-fg}[${icon} ${i + 1}.${stage.name}]{/yellow-fg}{/bold}`);
    } else if (stageStatus === 'completed') {
      pipelineParts.push(`{green-fg}[${icon} ${i + 1}.${stage.name}]{/green-fg}`);
    } else {
      pipelineParts.push(`{gray-fg}[${icon} ${i + 1}.${stage.name}]{/gray-fg}`);
    }
  }
  lines.push(`  ${pipelineParts.join('{gray-fg} ──► {/gray-fg}')}`);
  lines.push('');

  // Detailed Stage & Graph Breakdown for EVERY stage
  lines.push('{bold}{yellow-fg}Stages & Graph DAG Layouts:{/yellow-fg}{/bold}');
  lines.push('');

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const run = stageRunMap.get(stage.id);
    const isCurrent = stage.id === currentStage;
    const stageStatus: StageRunStatus = run?.status ?? (isCurrent ? 'running' : 'pending');
    const icon = getStageStatusIcon(stageStatus, isCurrent ? spinnerFrame : undefined);

    const currentBadge = isCurrent ? ' {bold}{yellow-fg}◄ ACTIVE STAGE{/yellow-fg}{/bold}' : '';
    lines.push(
      `  {bold}${i + 1}. [${icon}] ${stage.name}{/bold} {gray-fg}(id: ${stage.id}, status: ${stageStatus})${currentBadge}{/gray-fg}`
    );
    if (stage.description) {
      lines.push(`     {gray-fg}${stage.description}{/gray-fg}`);
    }
    if (run?.startedAt) {
      lines.push(
        `     {gray-fg}Started: ${run.startedAt}${run.completedAt ? ` · Completed: ${run.completedAt}` : ''}{/gray-fg}`
      );
    }
    lines.push('');

    // Stage 2D Graph Visual Layout
    const graphLines = renderStageGraph(stage, stageStatus, isCurrent ? spinnerFrame : undefined, {
      fullWidth: true,
    });
    for (const gLine of graphLines) {
      lines.push(`     ${gLine}`);
    }
    lines.push('');

    if (i < stages.length - 1) {
      lines.push(`     {gray-fg}${cs.branch}{/gray-fg}`);
      lines.push(`     {gray-fg}▼{/gray-fg}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
