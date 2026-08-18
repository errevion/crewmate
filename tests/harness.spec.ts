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
  });

  it('should include canonical FIELD_SCHEMAS definitions', () => {
    expect(CREWMATE_PLUGIN).toContain('const FIELD_SCHEMAS =');
    expect(CREWMATE_PLUGIN).toContain('workType: z.enum');
    expect(CREWMATE_PLUGIN).toContain('technicalStack: z.object');
    expect(CREWMATE_PLUGIN).toContain('constraints: z.object');
    expect(CREWMATE_PLUGIN).toContain('qualityStandards: z.object');
    expect(CREWMATE_PLUGIN).toContain('deliverables: z.array');
  });

  it('should not append --json to CLI commands in runCrewmate', () => {
    expect(CREWMATE_PLUGIN).not.toContain('"--json"');
    expect(CREWMATE_PLUGIN).toContain('const cmd = ["crewmate", ...args].join(" ")');
  });

  it('should correctly format task add arguments in crewmate_add_task', () => {
    expect(CREWMATE_PLUGIN).toContain(
      '["task", "add", args.briefId, "--title", escapedTitle, "--description", escapedDesc]'
    );
    expect(CREWMATE_PLUGIN).not.toContain('JSON.stringify(args.dependencies)');
    expect(CREWMATE_PLUGIN).toContain(
      'const taskTitle = args.title && args.title.trim().length > 0'
    );
    expect(CREWMATE_PLUGIN).toContain('.split(/\\r?\\n/)[0]');
    expect(CREWMATE_PLUGIN).not.toMatch(/split\("\r?\n"\)/);
  });
});
