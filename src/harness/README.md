# Harness

The harness system lets Crewmate integrate with different AI coding assistants. Each assistant (OpenCode, Cursor, etc.) has its own adapter that knows how to scaffold the right plugin files, commands, and dependencies into a target project.

## Architecture

```
harness/
  types.ts                        Interface definitions
  registry.ts                     Adapter lookup and registration
  adapters/
    opencode/
      adapter.ts                  OpenCode adapter implementation
      templates/
        crewmate-plugin.ts        Plugin source (exported as string)
        brief.md                  Markdown template for the /brief command
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

Templates are source files exported as string constants. The adapter's `install()` method writes these strings into the target project. This keeps each adapter self-contained — its templates live alongside its implementation, not in a shared directory.

For example, the OpenCode adapter writes:
- `.opencode/plugins/crewmate.ts` — a plugin that exposes Crewmate CLI tools to the AI agent
- `.opencode/commands/brief.md` — a slash command for guided briefing
- `.opencode/package.json` — adds `@opencode-ai/plugin` as a dependency
