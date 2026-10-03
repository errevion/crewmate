import { z } from "zod";
import { randomBytes } from "node:crypto";

export function generateEventId(): string {
  return `evt_${randomBytes(4).toString("hex")}`;
}

export const GateResultSchema = z.object({
  gate: z.string(),
  type: z.enum(["hard", "soft"]),
  phase: z.enum(["pre", "post"]),
  status: z.enum(["passed", "failed"]),
  exitCode: z.number().int().default(0),
  output: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export type GateResult = z.infer<typeof GateResultSchema>;

export const InitEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("INIT"),
  initialNode: z.string(),
  workflow: z.string().optional(),
});

export const NodeTransitionEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("NODE_TRANSITION"),
  from: z.string(),
  to: z.string(),
  reason: z.string(),
});

export const GateCheckEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("GATE_CHECK"),
  node: z.string(),
  phase: z.enum(["pre", "post"]),
  gate: z.string(),
  status: z.enum(["passed", "failed"]),
  exitCode: z.number().int().default(0),
  output: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const RetryIncrementEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("RETRY_INCREMENT"),
  node: z.string(),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
});

export const EscalateEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("ESCALATE"),
  node: z.string(),
  target: z.string(),
  reason: z.string(),
});

export const OverrideEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("OVERRIDE"),
  from: z.string(),
  to: z.string(),
  reason: z.string().optional(),
});

export const CompleteEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("COMPLETE"),
  node: z.string(),
});

export const RunStartEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("RUN_START"),
  runId: z.string(),
  workflow: z.string(),
  initialNode: z.string(),
});

export const ResetEventSchema = z.object({
  id: z.string().default(generateEventId),
  timestamp: z.string(),
  event: z.literal("RESET"),
  runId: z.string(),
  node: z.string(),
  reason: z.string().optional(),
});

export const StateEventSchema = z.discriminatedUnion("event", [
  InitEventSchema,
  NodeTransitionEventSchema,
  GateCheckEventSchema,
  RetryIncrementEventSchema,
  EscalateEventSchema,
  OverrideEventSchema,
  CompleteEventSchema,
  RunStartEventSchema,
  ResetEventSchema,
]);

export type StateEvent = z.infer<typeof StateEventSchema>;
export type StateEventInput = z.input<typeof StateEventSchema>;

export interface EngineState {
  currentNode: string;
  status: "active" | "completed" | "escalated";
  currentRunId?: string;
  activeWorkflow?: string;
  retryCounts: Record<string, number>;
  lastGateResults: Record<string, GateResult[]>;
  escalationTarget?: string;
  history: StateEvent[];
}
