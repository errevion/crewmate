import { z } from "zod";

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  next: z.string().optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphSchema = z.object({
  version: z.string().default("1.0.0"),
  name: z.string().optional(),
  initial: z.string().min(1),
  nodes: z.array(GraphNodeSchema).min(1),
});

export type Graph = z.infer<typeof GraphSchema>;

export const HardGuardrailSchema = z.object({
  type: z.literal("hard"),
  run: z.string().min(1),
  description: z.string().optional(),
});

export const SoftGuardrailSchema = z.object({
  type: z.literal("soft"),
  check: z.string().min(1),
  description: z.string().optional(),
});

export const GuardrailSchema = z.union([
  HardGuardrailSchema,
  SoftGuardrailSchema,
]);
export type Guardrail = z.infer<typeof GuardrailSchema>;
export type HardGuardrail = z.infer<typeof HardGuardrailSchema>;
export type SoftGuardrail = z.infer<typeof SoftGuardrailSchema>;

export const SubagentDefSchema = z.object({
  role: z.string().min(1),
  agent: z.string().optional(),
  scope: z.string().default("read-only"),
  allowed_tools: z.array(z.string()).optional(),
});

export type SubagentDef = z.infer<typeof SubagentDefSchema>;

export const NodeDefSchema = z.object({
  id: z.string().min(1),
  instructions: z.string().default(""),
  inputs: z.array(z.string()).default([]),
  subagent: SubagentDefSchema.optional(),
  guardrails: z
    .object({
      pre: z.array(GuardrailSchema).default([]),
      post: z.array(GuardrailSchema).default([]),
    })
    .default({ pre: [], post: [] }),
  on_fail: z.string().optional(), // e.g. "route(execute)"
  on_fail_max_retries: z.number().int().nonnegative().default(2),
  escalate_after_max_retries: z.string().default("human"),
});

export type NodeDef = z.infer<typeof NodeDefSchema>;
