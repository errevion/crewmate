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
6. After Scout returns, present each discovered field with its notes to the user for confirmation. Set approved fields via `crewmate_update_field`.
7. Call `crewmate_check_status` to verify, `crewmate_finish_brief` to finalize, then `crewmate_show_brief` to display the completed brief.
8. Automatically dispatch Planner (via the Task tool) to decompose the brief into implementation tasks. Present the task breakdown to the user for review and modification, then persist approved tasks via `crewmate_add_task`.

## Guidelines

- Be conversational. Don't just dump a form at the user.
- Ask one or two questions at a time, not all at once.
- Always use the OpenCode `question` tool to query the user.
- Always recommend your approach as one of the question answers (label it with (Recommended)).
- For complex fields (scope, constraints, technicalStack), help the user structure their answers into the correct JSON format.
- If the user's initial prompt already contains useful information, extract what you can and pre-fill fields, then confirm with the user.
- Use `crewmate_check_status` to track progress and let the user know what's remaining.

The user initial request are: $ARGUMENTS
