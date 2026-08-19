# Harness

The harness system lets Crewmate integrate with different AI coding assistants. Each assistant (OpenCode today; Cursor, Claude Code, etc. in the future) has its own adapter that knows how to scaffold the right plugin files, slash commands, agent prompts, and dependencies into a target project.

## Architecture

```text
harness/
  types.ts                        Interface definitions
  registry.ts                     Adapter lookup and registration
  adapters/
    opencode/
      adapter.ts                  OpenCode adapter implementation
      templates/
        crewmate-plugin.ts        Plugin source template (TypeScript)
        brief.md                  Markdown template for the /brief command
        execute.md                Markdown template for the /execute command
        agents/
          Frontman.md             Primary orchestrator agent prompt
          Scout.md                Read-only codebase explorer subagent prompt
          Planner.md              Task decomposition subagent prompt
          Executor.md             Implementation subagent prompt
```

### `HarnessAdapter` interface

Every adapter implements two properties and one method:

```typescript
interface HarnessAdapter {
  name: string;
  description: string;
  install(targetDir: string): Promise<InstallResult>;
}
```

`install()` receives a target project directory and writes whatever files that AI assistant needs to interact with Crewmate. It returns the harness name and a list of files written.

### Registry

The registry maps adapter names to instances. Commands use `getAdapter(name)` to look up an adapter and `listAdapterNames()` to show available options.

## Adding a new adapter

1. Create a directory at `adapters/<name>/`
2. Add `adapter.ts` implementing `HarnessAdapter`
3. Add a `templates/` subdirectory with any files your adapter needs to scaffold
4. Import and register the adapter in `registry.ts`:

```typescript
import { YourAdapter } from './adapters/<name>/adapter.js';

const adapters: Record<string, HarnessAdapter> = {
  opencode: new OpenCodeAdapter(),
  '<name>': new YourAdapter(),
};
```

### Adapter templates

Templates live directly alongside each adapter implementation. The adapter's `install()` method imports or reads these templates and writes them into the target project directory.

For example, the OpenCode adapter writes into `.opencode/`:

- `.opencode/plugins/crewmate.ts` — hooks Crewmate's tools into OpenCode
- `.opencode/commands/brief.md` — the `/brief` command that starts the planning conversation
- `.opencode/commands/execute.md` — the `/execute` command that runs the implementation plan
- `.opencode/agents/frontman.md` — supervisor agent that orchestrates brief creation and task dispatch
- `.opencode/agents/scout.md` — read-only codebase explorer subagent
- `.opencode/agents/planner.md` — task decomposition subagent
- `.opencode/agents/executor.md` — parallel implementation subagent
- `.opencode/package.json` — adds `@opencode-ai/plugin` as a dependency
