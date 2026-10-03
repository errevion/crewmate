## Description
<!-- Provide a concise explanation of the changes made and the motivation behind them. -->

## Type of Change
<!-- Mark the relevant option with an 'x'. -->
- [ ] `feat`: A new feature or capability
- [ ] `fix`: A bug fix
- [ ] `docs`: Documentation updates or additions
- [ ] `refactor`: Code change that neither fixes a bug nor adds a feature
- [ ] `perf`: A code change that improves performance
- [ ] `test`: Adding missing tests or correcting existing tests
- [ ] `ci`: Changes to CI/CD workflows or tooling
- [ ] `chore`: Repository maintenance, configuration, or dependencies

## Related Crewmate Workflows & Modules
<!-- Mention the affected workflows and module contracts. -->
- **Workflow:** (e.g. `crewmate-feature-pipeline`, `contract-sync`)
- **Affected Modules:** (e.g. `engine`, `task`, `activity`, `scanner`, `schemas`, `cli`, `opencode-adapter`)
- **Related Issues / Tasks:** (e.g. Closes #123, task_001)

## Contract & Architecture Impact
<!-- Confirm that Crewmate contracts and architecture rules are preserved. -->
- [ ] Module contracts in `.crewmate/contracts/modules/` updated or reconciled (if applicable)
- [ ] `.crewmate/contracts/architecture.yaml` dependency rules respected
- [ ] `.crewmate/contracts/capabilities.yaml` updated (if new capability added)
- [ ] No forbidden patterns introduced (`src/**/temp_*`, `src/**/legacy_*`)

## Verification Checklist
<!-- All checks must pass before merging. -->
- [ ] `npm test` passed (all unit and integration test suites pass)
- [ ] `crewmate scan arch` passed (0 architecture boundary violations)
- [ ] `crewmate scan dead-code` passed (0 safe-delete candidates)
- [ ] TypeScript compilation passed (`npm run build`)
- [ ] PR title adheres to Conventional Commits format (`feat(...)`, `fix(...)`, etc.)

## Additional Context / Screenshots
<!-- Add any relevant notes, test run outputs, or screenshots if applicable. -->
