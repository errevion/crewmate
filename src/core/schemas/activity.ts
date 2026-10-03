import { z } from "zod";

export const ActivityStatusSchema = z.enum(["completed", "failed", "interrupted"]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ActivityStartEventSchema = z.object({
  event: z.literal("start"),
  id: z.string().min(1),
  agent: z.string().min(1),
  label: z.string().min(1),
  node: z.string().optional(),
  parent: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  at: z.string(), // ISO timestamp
});

export type ActivityStartEvent = z.infer<typeof ActivityStartEventSchema>;

export const ActivityEndEventSchema = z.object({
  event: z.literal("end"),
  id: z.string().min(1),
  agent: z.string().optional(),
  status: ActivityStatusSchema.default("completed"),
  meta: z.record(z.string(), z.unknown()).optional(),
  at: z.string(), // ISO timestamp
});

export type ActivityEndEvent = z.infer<typeof ActivityEndEventSchema>;

export const ActivityEventSchema = z.discriminatedUnion("event", [
  ActivityStartEventSchema,
  ActivityEndEventSchema,
]);

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export interface ActivityRecord {
  id: string;
  agent: string;
  label: string;
  node?: string;
  parent?: string;
  startAt: string;
  endAt?: string;
  status: "active" | ActivityStatus;
  startMeta?: Record<string, unknown>;
  endMeta?: Record<string, unknown>;
  isUnclosed: boolean;
}

export interface ActivityTreeNode {
  activity: ActivityRecord;
  children: ActivityTreeNode[];
}

export interface ActivityProvenance {
  originatingActivityId: string;
  originatingAgent: string;
  originatingLabel: string;
  originatingAt: string;
  subsequentReferenceCount: number;
  subsequentActivityIds: string[];
}
