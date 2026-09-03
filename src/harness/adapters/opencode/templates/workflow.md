---
description: Execute a complete graph-based workflow.
---

Let's run the Crewmate workflow.

1. First, check active workflow run status via `crewmate_workflow_status`.
   - If no active workflow run exists, create a brief session record (`crewmate_create_brief`) and start a new workflow run (`crewmate_workflow_start`). Only populate brief fields if the active stage definition explicitly instructs it.
   - If an active workflow run exists, inspect its `currentStage` and resume from there.

2. Follow the active stage definition dynamically from `workflowDef.stages`:
   - Inspect the current stage's `name`, `description`, and `graph.nodes`.
   - Execute the stage's node sequence according to node types (`agent`, `task`, `condition`, `tool`, `transform`, `human`, `subgraph`, `passthrough`).
   - Coordinate subagents, evaluate conditions, prompt the user for approvals, or perform required transformations as defined by the stage.
   - When the stage's goals and nodes are satisfied, advance to the next stage (`crewmate_workflow_advance`).

3. Keep Frontman's active state updated using `crewmate_set_activity`.
