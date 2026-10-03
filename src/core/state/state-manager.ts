import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  type EngineState,
  type GateResult,
  type StateEvent,
  type StateEventInput,
  StateEventSchema,
} from "../schemas/state.js";

export function reduceState(events: StateEvent[]): EngineState {
  const state: EngineState = {
    currentNode: "",
    status: "active",
    retryCounts: {},
    lastGateResults: {},
    escalationTarget: undefined,
    history: [],
  };

  for (const event of events) {
    state.history.push(event);

    switch (event.event) {
      case "INIT": {
        state.currentNode = event.initialNode;
        state.status = "active";
        state.retryCounts = {};
        state.lastGateResults = {};
        state.escalationTarget = undefined;
        if (!state.currentRunId) {
          state.currentRunId = `run_${event.timestamp.replace(/[-:T.Z]/g, "").slice(0, 14)}_init`;
        }
        state.activeWorkflow =
          event.workflow || state.activeWorkflow || "default";
        break;
      }
      case "RUN_START": {
        state.currentRunId = event.runId;
        state.activeWorkflow = event.workflow;
        state.currentNode = event.initialNode;
        state.status = "active";
        state.retryCounts = {};
        state.lastGateResults = {};
        state.escalationTarget = undefined;
        break;
      }
      case "RESET": {
        state.currentNode = event.node;
        state.status = "active";
        state.retryCounts = {};
        state.lastGateResults = {};
        state.escalationTarget = undefined;
        if (event.runId) {
          state.currentRunId = event.runId;
        }
        break;
      }
      case "NODE_TRANSITION": {
        state.currentNode = event.to;
        break;
      }
      case "GATE_CHECK": {
        if (!state.lastGateResults[event.node]) {
          state.lastGateResults[event.node] = [];
        }
        const result: GateResult = {
          gate: event.gate,
          type: "hard", // GATE_CHECK events are recorded for hard checks
          phase: event.phase,
          status: event.status,
          exitCode: event.exitCode,
          output: event.output,
          evidence: event.evidence,
          error: event.error,
        };
        // Update or append
        const existingIdx = state.lastGateResults[event.node].findIndex(
          (g) => g.gate === event.gate && g.phase === event.phase,
        );
        if (existingIdx >= 0) {
          state.lastGateResults[event.node][existingIdx] = result;
        } else {
          state.lastGateResults[event.node].push(result);
        }
        break;
      }
      case "RETRY_INCREMENT": {
        state.retryCounts[event.node] = event.retryCount;
        break;
      }
      case "ESCALATE": {
        state.status = "escalated";
        state.escalationTarget = event.target;
        break;
      }
      case "OVERRIDE": {
        state.currentNode = event.to;
        break;
      }
      case "COMPLETE": {
        state.status = "completed";
        state.currentNode = event.node;
        break;
      }
    }
  }

  return state;
}

export class StateManager {
  private stateFilePath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.stateFilePath = path.join(projectRoot, ".crewmate", "state.jsonl");
  }

  public getFilePath(): string {
    return this.stateFilePath;
  }

  public async exists(): Promise<boolean> {
    try {
      await fs.access(this.stateFilePath);
      return true;
    } catch {
      return false;
    }
  }

  public async readEvents(): Promise<StateEvent[]> {
    try {
      const content = await fs.readFile(this.stateFilePath, "utf-8");
      const lines = content
        .split("\n")
        .filter((line: string) => line.trim().length > 0);
      const events: StateEvent[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          const parsed = JSON.parse(line);
          const validated = StateEventSchema.parse(parsed);
          events.push(validated);
        } catch (err) {
          throw new Error(
            `Malformed state event at line ${i + 1} in ${this.stateFilePath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return events;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  public async appendEvent(event: StateEventInput): Promise<StateEvent> {
    const validated = StateEventSchema.parse(event);
    const line = JSON.stringify(validated) + "\n";
    const dir = path.dirname(this.stateFilePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(this.stateFilePath, line, "utf-8");
    return validated;
  }

  public async getState(): Promise<EngineState> {
    const events = await this.readEvents();
    return reduceState(events);
  }
}
