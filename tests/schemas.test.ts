import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  IndexManifestSchema,
  ArchitectureSchema,
  StructureSchema,
  CapabilitiesSchema,
  ModuleContractSchema,
} from "../src/core/schemas/contracts.js";
import { GraphSchema, NodeDefSchema } from "../src/core/schemas/workflow.js";
import { StateEventSchema } from "../src/core/schemas/state.js";
import {
  ActivityStartEventSchema,
  ActivityEndEventSchema,
  ActivityEventSchema,
} from "../src/core/schemas/activity.js";

describe("Contract Schemas", () => {
  it("validates IndexManifestSchema", () => {
    const valid = {
      version: "1.0.0",
      modules: [
        {
          name: "auth",
          responsibility: "Authentication and session state",
          path: "src/auth",
          version: "1.0.0",
          public_surface: ["src/auth/index.ts"],
        },
      ],
    };
    const parsed = IndexManifestSchema.parse(valid);
    assert.equal(parsed.modules.length, 1);
    assert.equal(parsed.modules[0].name, "auth");
  });

  it("validates ArchitectureSchema", () => {
    const valid = {
      version: "1.0.0",
      modules: {
        auth: {
          responsibility: "Auth service",
          allowed_dependencies: ["db", "config"],
        },
      },
    };
    const parsed = ArchitectureSchema.parse(valid);
    assert.deepEqual(parsed.modules.auth.allowed_dependencies, ["db", "config"]);
  });

  it("validates StructureSchema", () => {
    const valid = {
      version: "1.0.0",
      roots: ["src"],
      naming: { modules: "kebab-case", files: "kebab-case" },
      forbidden_patterns: ["src/**/temp_*"],
    };
    const parsed = StructureSchema.parse(valid);
    assert.deepEqual(parsed.forbidden_patterns, ["src/**/temp_*"]);
  });

  it("validates CapabilitiesSchema", () => {
    const valid = {
      capabilities: [
        {
          name: "jwt-verification",
          module: "auth",
          description: "Verifies JWT tokens",
          entrypoint: "src/auth/jwt.ts:verifyToken",
        },
      ],
    };
    const parsed = CapabilitiesSchema.parse(valid);
    assert.equal(parsed.capabilities[0].name, "jwt-verification");
  });

  it("validates ModuleContractSchema", () => {
    const valid = {
      module: "auth",
      version: "1.0.0",
      public_api: [
        {
          export: "verifyToken",
          signature: "(token: string) => Promise<UserSession>",
          file: "src/auth/jwt.ts",
        },
      ],
      invariants: ["Must check expiration"],
      declared_consumers: ["billing"],
    };
    const parsedDefault = ModuleContractSchema.parse(valid);
    assert.equal(parsedDefault.module, "auth");
    assert.equal(parsedDefault.status, "final"); // default is final
    assert.equal(parsedDefault.public_api[0].export, "verifyToken");

    const draft = ModuleContractSchema.parse({
      ...valid,
      status: "draft",
    });
    assert.equal(draft.status, "draft");

    assert.throws(() => {
      ModuleContractSchema.parse({
        ...valid,
        status: "invalid_status",
      });
    });
  });
});

describe("Workflow Schemas", () => {
  it("validates GraphSchema", () => {
    const valid = {
      version: "1.0.0",
      initial: "plan",
      nodes: [
        { id: "plan", next: "execute" },
        { id: "execute", next: "verify" },
        { id: "verify", next: "done" },
      ],
    };
    const parsed = GraphSchema.parse(valid);
    assert.equal(parsed.initial, "plan");
    assert.equal(parsed.nodes.length, 3);
  });

  it("validates NodeDefSchema", () => {
    const valid = {
      id: "verify",
      instructions: "Run all verifications",
      inputs: ["diff", "contract_refs"],
      subagent: {
        role: "verifier",
        scope: "read-only",
      },
      guardrails: {
        pre: [{ type: "hard", run: "crewmate scan arch" }],
        post: [
          { type: "hard", run: "crewmate scan dead-code" },
          { type: "soft", check: "No new modules" },
        ],
      },
      on_fail: "route(execute)",
      on_fail_max_retries: 2,
      escalate_after_max_retries: "human",
    };
    const parsed = NodeDefSchema.parse(valid);
    assert.equal(parsed.id, "verify");
    assert.equal(parsed.guardrails.pre.length, 1);
    assert.equal(parsed.guardrails.post.length, 2);
  });
});

describe("State Event Schemas", () => {
  it("validates all state event variants", () => {
    const initEvent = {
      timestamp: new Date().toISOString(),
      event: "INIT",
      initialNode: "plan",
    };
    const parsedInit = StateEventSchema.parse(initEvent);
    assert.equal(parsedInit.event, "INIT");
    assert.ok(parsedInit.id.startsWith("evt_"));

    const withCustomId = StateEventSchema.parse({
      ...initEvent,
      id: "evt_custom_id_123",
    });
    assert.equal(withCustomId.id, "evt_custom_id_123");

    const transEvent = {
      timestamp: new Date().toISOString(),
      event: "NODE_TRANSITION",
      from: "plan",
      to: "execute",
      reason: "advance",
    };
    const parsedTrans = StateEventSchema.parse(transEvent);
    assert.equal(parsedTrans.event, "NODE_TRANSITION");
    assert.ok(parsedTrans.id.startsWith("evt_"));

    const gateEvent = {
      timestamp: new Date().toISOString(),
      event: "GATE_CHECK",
      node: "verify",
      phase: "post",
      gate: "crewmate scan arch",
      status: "passed",
      exitCode: 0,
    };
    assert.equal(StateEventSchema.parse(gateEvent).event, "GATE_CHECK");

    const retryEvent = {
      timestamp: new Date().toISOString(),
      event: "RETRY_INCREMENT",
      node: "verify",
      retryCount: 1,
      maxRetries: 2,
    };
    assert.equal(StateEventSchema.parse(retryEvent).event, "RETRY_INCREMENT");

    const escEvent = {
      timestamp: new Date().toISOString(),
      event: "ESCALATE",
      node: "verify",
      target: "human",
      reason: "exceeded retries",
    };
    assert.equal(StateEventSchema.parse(escEvent).event, "ESCALATE");

    const runStartEvent = {
      timestamp: new Date().toISOString(),
      event: "RUN_START",
      runId: "run_20260926_bugfix",
      workflow: "bugfix",
      initialNode: "triage",
    };
    assert.equal(StateEventSchema.parse(runStartEvent).event, "RUN_START");

    const resetEvent = {
      timestamp: new Date().toISOString(),
      event: "RESET",
      runId: "run_20260926_reset",
      node: "plan",
      reason: "manual reset",
    };
    assert.equal(StateEventSchema.parse(resetEvent).event, "RESET");
  });
});

describe("Activity Event Schemas", () => {
  it("validates activity start and end event schemas", () => {
    const startEvent = {
      event: "start",
      id: "act_8f2a",
      agent: "execute-subagent",
      node: "execute",
      label: "editing auth/session.ts",
      parent: "act_root_01",
      meta: { files: ["auth/session.ts"], tool: "edit" },
      at: "2026-09-26T10:14:02Z",
    };
    const parsedStart = ActivityStartEventSchema.parse(startEvent);
    assert.equal(parsedStart.id, "act_8f2a");
    assert.equal(parsedStart.label, "editing auth/session.ts");

    const endEvent = {
      event: "end",
      id: "act_8f2a",
      agent: "execute-subagent",
      status: "completed",
      meta: { files_changed: ["auth/session.ts"] },
      at: "2026-09-26T10:14:41Z",
    };
    const parsedEnd = ActivityEndEventSchema.parse(endEvent);
    assert.equal(parsedEnd.status, "completed");

    assert.equal(ActivityEventSchema.parse(startEvent).event, "start");
    assert.equal(ActivityEventSchema.parse(endEvent).event, "end");
  });
});
