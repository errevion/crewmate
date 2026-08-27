import { describe, it, expect, beforeEach } from 'vitest';
import { getAdapter, listAdapters, listAdapterNames } from '../src/harness/registry.js';
import { CREWMATE_PLUGIN } from '../src/harness/adapters/opencode/templates/crewmate-plugin.js';
import type { HarnessAdapter } from '../src/harness/types.js';

describe('harness registry', () => {
  it("should return OpenCode adapter for 'opencode'", () => {
    const adapter = getAdapter('opencode');
    expect(adapter).toBeDefined();
    expect(adapter?.name).toBe('opencode');
    expect(adapter?.description).toBe('OpenCode AI coding assistant');
  });

  it('should return undefined for unknown harness', () => {
    const adapter = getAdapter('unknown');
    expect(adapter).toBeUndefined();
  });

  it('should list all available adapters', () => {
    const names = listAdapterNames();
    expect(names).toContain('opencode');
  });

  it('should list adapters with correct structure', () => {
    const adapters = listAdapters();
    expect(adapters.length).toBeGreaterThan(0);

    for (const adapter of adapters) {
      expect(adapter).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        install: expect.any(Function),
        update: expect.any(Function),
      });
    }
  });

  it('should produce a valid crewmate plugin template without syntax errors', () => {
    expect(CREWMATE_PLUGIN).toBeDefined();
    expect(typeof CREWMATE_PLUGIN).toBe('string');
    expect(CREWMATE_PLUGIN.length).toBeGreaterThan(0);
    // Should not contain broken escaping like \' inside JSON examples
    expect(CREWMATE_PLUGIN).not.toContain('\\\'{\\"included\\"');
    // Verify required exports and tools exist
    expect(CREWMATE_PLUGIN).toContain('export default CrewmatePlugin');
    expect(CREWMATE_PLUGIN).toContain('crewmate_create_brief');
    expect(CREWMATE_PLUGIN).toContain('crewmate_update_field');
    expect(CREWMATE_PLUGIN).toContain('crewmate_get_field');
    expect(CREWMATE_PLUGIN).toContain('crewmate_show_brief');
    expect(CREWMATE_PLUGIN).toContain('crewmate_check_status');
    expect(CREWMATE_PLUGIN).toContain('crewmate_finish_brief');
    expect(CREWMATE_PLUGIN).toContain('crewmate_add_task');
    expect(CREWMATE_PLUGIN).toContain('crewmate_list_tasks');
    expect(CREWMATE_PLUGIN).toContain('crewmate_update_task');
    expect(CREWMATE_PLUGIN).toContain('crewmate_remove_task');
    expect(CREWMATE_PLUGIN).toContain('crewmate_acquire_lock');
    expect(CREWMATE_PLUGIN).toContain('crewmate_release_lock');
    expect(CREWMATE_PLUGIN).toContain('crewmate_list_locks');
    expect(CREWMATE_PLUGIN).toContain('crewmate_add_artifact');
    expect(CREWMATE_PLUGIN).toContain('crewmate_list_artifacts');
  });

  it('should include canonical FIELD_SCHEMAS definitions', () => {
    expect(CREWMATE_PLUGIN).toContain('const FIELD_SCHEMAS =');
    expect(CREWMATE_PLUGIN).toContain('workType: z.enum');
    expect(CREWMATE_PLUGIN).toContain('technicalStack: z.object');
    expect(CREWMATE_PLUGIN).toContain('constraints: z.object');
    expect(CREWMATE_PLUGIN).toContain('qualityStandards: z.object');
    expect(CREWMATE_PLUGIN).toContain('deliverables: z.array');
  });

  it('should spawn crewmate safely with argument array without raw string join', () => {
    expect(CREWMATE_PLUGIN).not.toContain('"--json"');
    expect(CREWMATE_PLUGIN).toContain('import spawn from "cross-spawn"');
    expect(CREWMATE_PLUGIN).toContain('spawn("crewmate", args');
    expect(CREWMATE_PLUGIN).not.toContain('shell: isWin');
    expect(CREWMATE_PLUGIN).not.toContain('["crewmate", ...args].join(" ")');
    expect(CREWMATE_PLUGIN).not.toContain('$.escape');
  });

  it('should extract error details from stdout JSON in runCrewmate error handling', () => {
    expect(CREWMATE_PLUGIN).toContain('parsed && parsed.error');
    expect(CREWMATE_PLUGIN).toContain('errorDetails = parsed.error');
  });

  it('should pass unescaped raw argument values directly to runCrewmate across write tools', () => {
    // update_field should pass base64 encoded value with --base64
    expect(CREWMATE_PLUGIN).toContain(
      '["brief", "set", args.field, b64Value, "--base64", ...idArgs]'
    );
    expect(CREWMATE_PLUGIN).toContain(
      'const b64Value = Buffer.from(args.value, "utf-8").toString("base64")'
    );
    // add_artifact should pass args.content directly
    expect(CREWMATE_PLUGIN).toContain('"--content",');
    expect(CREWMATE_PLUGIN).toContain('args.content,');
    // set_activity should pass args.message directly
    expect(CREWMATE_PLUGIN).toContain('cmdParts.push("--message", args.message)');
    // add_event should pass args.message directly
    expect(CREWMATE_PLUGIN).toContain('"--message",');
    expect(CREWMATE_PLUGIN).toContain('args.message,');
    // acquire_lock should pass ...args.files directly
    expect(CREWMATE_PLUGIN).toContain('...args.files,');
  });

  it('should correctly format task add arguments in crewmate_add_task', () => {
    expect(CREWMATE_PLUGIN).toContain(
      '["task", "add", args.briefId, "--title", taskTitle, "--description", taskDescription]'
    );
    expect(CREWMATE_PLUGIN).not.toContain('JSON.stringify(args.dependencies)');
    expect(CREWMATE_PLUGIN).toContain(
      'const taskTitle = args.title && args.title.trim().length > 0'
    );
    expect(CREWMATE_PLUGIN).toContain('.split(/\\r?\\n/)[0]');
    expect(CREWMATE_PLUGIN).not.toMatch(/split\("\r?\n"\)/);
  });

  it('should include tool.execute.before hook for automatic dispatch event recording with deduplication', () => {
    expect(CREWMATE_PLUGIN).toContain('"tool.execute.before": async');
    expect(CREWMATE_PLUGIN).toContain('toolName === "task"');
    expect(CREWMATE_PLUGIN).toContain('["scout", "planner", "executor"].includes(subagent)');
    expect(CREWMATE_PLUGIN).toContain('"Dispatched scout to explore the codebase"');
    expect(CREWMATE_PLUGIN).toContain('"Dispatched planner to decompose the brief into tasks"');
    expect(CREWMATE_PLUGIN).toContain('Dispatched executor for');
    expect(CREWMATE_PLUGIN).toContain('isDuplicate');
    expect(CREWMATE_PLUGIN).toContain('taskId && e.taskId === taskId');
    expect(CREWMATE_PLUGIN).toContain('!taskId && !e.taskId && e.message === msg');
    expect(CREWMATE_PLUGIN).toContain('args.prompt.match');
  });

  it('should include tool.execute.after hook for automatic status and lock event recording', () => {
    expect(CREWMATE_PLUGIN).toContain('"tool.execute.after": async');
    expect(CREWMATE_PLUGIN).toContain('toolName === "crewmate_update_task"');
    expect(CREWMATE_PLUGIN).toContain('toolName === "crewmate_acquire_lock"');
    expect(CREWMATE_PLUGIN).toContain('status === "in_progress"');
    expect(CREWMATE_PLUGIN).toContain('status === "completed"');
    expect(CREWMATE_PLUGIN).toContain('Started task');
    expect(CREWMATE_PLUGIN).toContain('Completed task');
    expect(CREWMATE_PLUGIN).toContain('Locked');
  });

  it('should include event hook for automatic subagent lifecycle tracking', () => {
    expect(CREWMATE_PLUGIN).toContain('event: async ({ event }');
    expect(CREWMATE_PLUGIN).toContain('event.type === "message.part.updated"');
    expect(CREWMATE_PLUGIN).toContain('event.type === "session.created"');
    expect(CREWMATE_PLUGIN).toContain('event.type === "session.idle"');
    expect(CREWMATE_PLUGIN).toContain('event.type === "session.error"');
    expect(CREWMATE_PLUGIN).toContain('Finished codebase exploration');
    expect(CREWMATE_PLUGIN).toContain('Finished task breakdown');
    expect(CREWMATE_PLUGIN).toContain('parentSessionId');
    expect(CREWMATE_PLUGIN).toContain('sessionIdle');
    expect(CREWMATE_PLUGIN).toContain('Interrupted');
    expect(CREWMATE_PLUGIN).toContain(
      '"task",\n                  "update",\n                  tracked.taskId,\n                  "--status",\n                  "pending"'
    );
    expect(CREWMATE_PLUGIN).toContain(
      '"lock",\n                  "release",\n                  tracked.taskId'
    );
  });

  it('should include heartbeat and dispose hook for session liveness tracking', () => {
    expect(CREWMATE_PLUGIN).toContain('session", "heartbeat"');
    expect(CREWMATE_PLUGIN).toContain('session", "stop"');
    expect(CREWMATE_PLUGIN).toContain('dispose: async () =>');
  });
});
