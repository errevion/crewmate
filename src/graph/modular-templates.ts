import { frontmanInterviewNode } from './workflows/software-development/nodes/frontman-interview.node.js';
import { validateBriefNode } from './workflows/software-development/nodes/validate-brief.node.js';
import { scoutExploreNode } from './workflows/software-development/nodes/scout-explore.node.js';
import { plannerDecomposeNode } from './workflows/software-development/nodes/planner-decompose.node.js';
import { executorRunNode } from './workflows/software-development/nodes/executor-run.node.js';
import { verifyArtifactsNode } from './workflows/software-development/nodes/verify-artifacts.node.js';

/**
 * Returns a map of relative file paths to file contents for the modular JSON workflow.
 * These files represent isolated, reusable nodes and stages.
 */
export function getModularWorkflowFiles(): Record<string, string> {
  const files: Record<string, string> = {};

  // Individual node files
  files['.crewmate/workflows/nodes/frontman-interview.json'] =
    JSON.stringify(frontmanInterviewNode, null, 2) + '\n';

  files['.crewmate/workflows/nodes/validate-brief.json'] =
    JSON.stringify(validateBriefNode, null, 2) + '\n';

  files['.crewmate/workflows/nodes/scout-explore.json'] =
    JSON.stringify(scoutExploreNode, null, 2) + '\n';

  files['.crewmate/workflows/nodes/planner-decompose.json'] =
    JSON.stringify(plannerDecomposeNode, null, 2) + '\n';

  files['.crewmate/workflows/nodes/executor-run.json'] =
    JSON.stringify(executorRunNode, null, 2) + '\n';

  files['.crewmate/workflows/nodes/verify-artifacts.json'] =
    JSON.stringify(verifyArtifactsNode, null, 2) + '\n';

  // Individual stage files referencing nodes
  files['.crewmate/workflows/stages/discussion.json'] =
    JSON.stringify(
      {
        id: 'discussion',
        name: 'Discussion',
        description: 'Requirements elicitation and brief completion with the Frontman agent.',
        graph: {
          id: 'discussion-graph',
          nodes: ['../nodes/frontman-interview.json', '../nodes/validate-brief.json'],
          edges: [
            {
              from: 'frontman-interview',
              to: 'validate-brief',
              condition: { type: 'on_success' },
            },
          ],
        },
      },
      null,
      2
    ) + '\n';

  files['.crewmate/workflows/stages/research.json'] =
    JSON.stringify(
      {
        id: 'research',
        name: 'Research & Discovery',
        description: 'Scout codebase exploration and architecture discovery.',
        graph: {
          id: 'research-graph',
          nodes: ['../nodes/scout-explore.json'],
          edges: [],
        },
      },
      null,
      2
    ) + '\n';

  files['.crewmate/workflows/stages/planning.json'] =
    JSON.stringify(
      {
        id: 'planning',
        name: 'Planning',
        description: 'Planner task decomposition into DAG with artifact requirements.',
        graph: {
          id: 'planning-graph',
          nodes: ['../nodes/planner-decompose.json'],
          edges: [],
        },
      },
      null,
      2
    ) + '\n';

  files['.crewmate/workflows/stages/execution.json'] =
    JSON.stringify(
      {
        id: 'execution',
        name: 'Execution',
        description: 'Executor agents implementing tasks with locking and knowledge recording.',
        graph: {
          id: 'execution-graph',
          nodes: ['../nodes/executor-run.json'],
          edges: [],
        },
      },
      null,
      2
    ) + '\n';

  files['.crewmate/workflows/stages/verification.json'] =
    JSON.stringify(
      {
        id: 'verification',
        name: 'Verification',
        description: 'Final quality checks, test verification, and artifact review.',
        graph: {
          id: 'verification-graph',
          nodes: ['../nodes/verify-artifacts.json'],
          edges: [],
        },
      },
      null,
      2
    ) + '\n';

  // Root workflow definition referencing stages
  files['.crewmate/workflows/default.json'] =
    JSON.stringify(
      {
        id: 'software-development',
        name: 'Software Development Workflow',
        description:
          'Standard default Crewmate workflow with requirements discussion, scout discovery, planning, execution, and verification.',
        version: '1.0.0',
        metadata: {
          requiredBriefFields: [
            'workType',
            'goal',
            'scope',
            'functionalRequirements',
            'acceptanceCriteria',
          ],
        },
        stages: [
          './stages/discussion.json',
          './stages/research.json',
          './stages/planning.json',
          './stages/execution.json',
          './stages/verification.json',
        ],
      },
      null,
      2
    ) + '\n';

  return files;
}
