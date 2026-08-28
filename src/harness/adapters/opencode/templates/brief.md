---
description: Start a structured project briefing
agent: frontman
---

The user wants to create a structured project brief. Use the crewmate tools to gather requirements.

## Instructions

1. Call `crewmate_create_brief` to create a new brief.
2. Ask the user about each required field one or two at a time. The required fields are:
    - **workType**: What type of work is this? (software, infrastructure, data, documentation, or audit)
    - **goal**: What is the overall goal of this project?
    - **scope**: What is included and excluded from the scope?
    - **functionalRequirements**: What are the key functional requirements?
    - **acceptanceCriteria**: What are the pass/fail acceptance criteria?
3. After each answer, call `crewmate_update_field` with the field name and value.
4. After all required fields are set, call `crewmate_check_status` to confirm completeness.
5. Offer to dispatch Scout (via the Task tool) to auto-discover non-required fields:
    - technicalStack, constraints, existingCodebase, referenceMaterials, qualityStandards, dependencies, risks, deliverables
6. After Scout returns: Scout is an explorer, NOT an advisor. Scout reports only objective facts found in the workspace (files, manifests, configs). Frontman must present these facts and discuss them conversationally with the user first before proposing or recommending any field values. Only persist fields via `crewmate_update_field` after discussing and agreeing with the user.
7. Call `crewmate_check_status` to verify, `crewmate_finish_brief` to finalize, then `crewmate_show_brief` to display the completed brief.
8. Automatically dispatch Planner (via the Task tool) to decompose the brief into implementation tasks. The Planner subagent's result is NOT visible to the user — you MUST output the complete task breakdown as a markdown table before asking for approval. Prompt the user for review/approval via `question`, then persist approved tasks via `crewmate_add_task` in dependency order (tasks with no dependencies first). As you create each task, record the mapping from the task's table row number to the returned task ID. When a task lists dependencies, pass the `dependencies` parameter with the real task IDs of the prerequisite tasks.
9. After task agreement and persistence, present the finalized task list and tell the user to run `/execute` whenever they are ready to begin implementation.

## Guidelines

- Be conversational. Don't just dump a form at the user.
- Ask one or two questions at a time, not all at once.
- Always use the OpenCode `question` tool to query the user.
- Always recommend your approach as one of the question answers (label it with (Recommended)).
- For complex fields (scope, constraints, technicalStack), help the user structure their answers into the correct JSON format.
- If the user's initial prompt already contains useful information, extract what you can and pre-fill fields, then confirm with the user.
- Use `crewmate_check_status` to track progress and let the user know what's remaining.

## Field Format Reference

When calling `crewmate_update_field`:
- **workType**: `"software"` | `"infrastructure"` | `"data"` | `"documentation"` | `"audit"`
- **goal**: plain text string
- **scope**: `{"included": ["..."], "excluded": ["..."]}`
- **functionalRequirements** / **acceptanceCriteria** / **existingCodebase** / **referenceMaterials** / **dependencies** / **risks**: `["item 1", "item 2"]`
- **technicalStack**: `{"frontend": ["..."], "backend": ["..."], "database": ["..."], "tools": ["..."]}`
- **constraints**: `{"exclusions": ["..."], "requirements": ["..."]}`
- **deliverables**: `[{"type": "code"|"doc"|"report", "format": "file"|"repo"|"presentation"}]`
- **qualityStandards**: `{"performance": {}, "security": {}, "accessibility": {}}`

The user initial request are: $ARGUMENTS
