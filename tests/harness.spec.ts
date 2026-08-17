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
  });
});
