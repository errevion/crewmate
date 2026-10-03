import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { StateManager, reduceState } from "../src/core/state/state-manager.js";
import { type StateEvent } from "../src/core/schemas/state.js";

describe("State Reducer", () => {
  it("reconstructs state from sequence of events", () => {
    const events: StateEvent[] = [
      {
        id: "evt_001",
        timestamp: "2026-09-26T10:00:00Z",
        event: "INIT",
        initialNode: "plan",
      },
      {
        id: "evt_002",
        timestamp: "2026-09-26T10:01:00Z",
        event: "NODE_TRANSITION",
        from: "plan",
        to: "execute",
        reason: "advance",
      },
      {
        id: "evt_003",
        timestamp: "2026-09-26T10:02:00Z",
        event: "GATE_CHECK",
        node: "execute",
        phase: "post",
        gate: "crewmate scan arch",
        status: "passed",
        exitCode: 0,
      },
      {
        id: "evt_004",
        timestamp: "2026-09-26T10:03:00Z",
        event: "NODE_TRANSITION",
        from: "execute",
        to: "verify",
        reason: "advance",
      },
      {
        id: "evt_005",
        timestamp: "2026-09-26T10:04:00Z",
        event: "GATE_CHECK",
        node: "verify",
        phase: "post",
        gate: "crewmate scan dead-code",
        status: "failed",
        exitCode: 1,
        evidence: { unreferenced: ["src/unused.ts"] },
      },
      {
        id: "evt_006",
        timestamp: "2026-09-26T10:05:00Z",
        event: "RETRY_INCREMENT",
        node: "verify",
        retryCount: 1,
        maxRetries: 2,
      },
      {
        id: "evt_007",
        timestamp: "2026-09-26T10:06:00Z",
        event: "NODE_TRANSITION",
        from: "verify",
        to: "execute",
        reason: "on_fail: route(execute)",
      },
    ];

    const state = reduceState(events);
    assert.equal(state.currentNode, "execute");
    assert.equal(state.status, "active");
    assert.equal(state.retryCounts["verify"], 1);
    assert.equal(state.lastGateResults["verify"].length, 1);
    assert.equal(state.lastGateResults["verify"][0].status, "failed");
    assert.equal(state.history.length, 7);
  });

  it("handles escalation and completion", () => {
    const events: StateEvent[] = [
      {
        id: "evt_e1",
        timestamp: "2026-09-26T10:00:00Z",
        event: "INIT",
        initialNode: "verify",
      },
      {
        id: "evt_e2",
        timestamp: "2026-09-26T10:01:00Z",
        event: "ESCALATE",
        node: "verify",
        target: "human",
        reason: "too many retries",
      },
    ];
    const escalatedState = reduceState(events);
    assert.equal(escalatedState.status, "escalated");
    assert.equal(escalatedState.escalationTarget, "human");

    const completeEvents: StateEvent[] = [
      {
        id: "evt_c1",
        timestamp: "2026-09-26T10:00:00Z",
        event: "INIT",
        initialNode: "verify",
      },
      {
        id: "evt_c2",
        timestamp: "2026-09-26T10:01:00Z",
        event: "COMPLETE",
        node: "done",
      },
    ];
    const completedState = reduceState(completeEvents);
    assert.equal(completedState.status, "completed");
    assert.equal(completedState.currentNode, "done");
  });
});

describe("StateManager", () => {
  it("appends and reads back events from disk", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crewmate-state-test-"),
    );
    try {
      const manager = new StateManager(tmpDir);
      assert.equal(await manager.exists(), false);

      await manager.appendEvent({
        timestamp: "2026-09-26T12:00:00Z",
        event: "INIT",
        initialNode: "plan",
      });

      assert.equal(await manager.exists(), true);
      const events = await manager.readEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].event, "INIT");
      assert.ok(
        events[0].id.startsWith("evt_"),
        `Expected evt_ prefix on ${events[0].id}`,
      );

      const state = await manager.getState();
      assert.equal(state.currentNode, "plan");
      assert.equal(state.status, "active");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
