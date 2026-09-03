import type { WorkflowDefinition } from '../../../models/graph.js';
import { discussionStage } from './stages/discussion.stage.js';
import { researchStage } from './stages/research.stage.js';
import { planningStage } from './stages/planning.stage.js';
import { executionStage } from './stages/execution.stage.js';
import { verificationStage } from './stages/verification.stage.js';

export * from './nodes/frontman-interview.node.js';
export * from './nodes/validate-brief.node.js';
export * from './nodes/scout-explore.node.js';
export * from './nodes/planner-decompose.node.js';
export * from './nodes/executor-run.node.js';
export * from './nodes/verify-artifacts.node.js';

export * from './stages/discussion.stage.js';
export * from './stages/research.stage.js';
export * from './stages/planning.stage.js';
export * from './stages/execution.stage.js';
export * from './stages/verification.stage.js';

/**
 * The Default Crewmate Software Development Workflow
 *
 * Assembled from independent reusable stages and nodes:
 * 1. Discussion: Frontman requirements elicitation
 * 2. Research: Scout codebase & architecture discovery
 * 3. Planning: Planner task decomposition & DAG creation
 * 4. Execution: Concurrent Executor implementation with file locking & artifacts
 * 5. Verification: Verification & artifact compliance check
 */
export const DEFAULT_WORKFLOW: WorkflowDefinition = {
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
  stages: [discussionStage, researchStage, planningStage, executionStage, verificationStage],
};
