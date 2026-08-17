---
description: Start a structured project briefing
---

The user wants to create a structured project brief. Use the crewmate tools to gather requirements.

## Instructions

1. Call `crewmate_create_brief` to create a new brief.
2. Ask the user about each required field one at a time. The required fields are:
    - **workType**: What type of work is this? (software, infrastructure, data, documentation, or audit)
    - **goal**: What is the overall goal of this project?
    - **scope**: What is included and excluded from the scope?
    - **functionalRequirements**: What are the key functional requirements?
    - **acceptanceCriteria**: What are the pass/fail acceptance criteria?
  3. After each answer, call `crewmate_update_field` with the field name and value.
  4. Optionally ask about non-required fields if relevant:
    - technicalStack, constraints, existingCodebase, referenceMaterials, qualityStandards, dependencies, risks, deliverables
  5. Call `crewmate_check_status` to verify all required fields are filled.
  6. Call `crewmate_finish_brief` to finalize the brief.
  7. Show the user the completed brief using `crewmate_show_brief`.

## Guidelines

- Be conversational. Don't just dump a form at the user.
- Always use the OpenCode `question` tool to query the user.
- Always recommend your approach as one of the question answer (label it with (Recommended))
- If the user's initial prompt already contains useful information (e.g. "I want to build a chat app"), extract what you can and pre-fill fields, then confirm with the user.
- Use `crewmate_check_status` to track progress and let the user know what's remaining.

The user initial request are: $ARGUMENTS
