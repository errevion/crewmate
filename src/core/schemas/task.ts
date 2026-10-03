import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "pending",
  "active",
  "blocked",
  "done",
  "failed",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const DependencyReasonSchema = z.enum([
  "file-overlap",
  "contract-consumer",
  "manual",
]);
export type DependencyReason = z.infer<typeof DependencyReasonSchema>;

export const TaskDependencySchema = z.object({
  taskId: z.string(),
  reason: DependencyReasonSchema,
});
export type TaskDependency = z.infer<typeof TaskDependencySchema>;

export const ScopeAmendmentRecordSchema = z.object({
  type: z.enum(["scope_amendment", "scope_conflict"]),
  file: z.string(),
  at: z.string(),
  conflictingTaskId: z.string().optional(),
  reason: z.string().optional(),
});
export type ScopeAmendmentRecord = z.infer<typeof ScopeAmendmentRecordSchema>;

export const TaskDefinitionSchema = z.object({
  id: z.string(),
  goal: z.string(),
  contract: z.string(),
  files: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  dependencies: z.array(TaskDependencySchema).optional(),
  status: TaskStatusSchema.default("pending"),
  amendments: z.array(ScopeAmendmentRecordSchema).default([]),
  base_commit: z.string().optional(),
  created_at: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
});
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

// Append-only event log schemas for .crewmate/tasks.jsonl
export const TaskCreateEventSchema = z.object({
  event: z.literal("create"),
  id: z.string(),
  goal: z.string(),
  contract: z.string(),
  files: z.array(z.string()),
  depends_on: z.array(z.string()),
  dependencies: z.array(TaskDependencySchema).optional(),
  at: z.string(),
});
export type TaskCreateEvent = z.infer<typeof TaskCreateEventSchema>;

export const TaskStatusChangeEventSchema = z.object({
  event: z.literal("status_change"),
  id: z.string(),
  from: TaskStatusSchema,
  to: TaskStatusSchema,
  reason: z.string().optional(),
  at: z.string(),
});
export type TaskStatusChangeEvent = z.infer<typeof TaskStatusChangeEventSchema>;

export const TaskLockGrantEventSchema = z.object({
  event: z.literal("lock_grant"),
  id: z.string(),
  files: z.array(z.string()),
  at: z.string(),
});
export type TaskLockGrantEvent = z.infer<typeof TaskLockGrantEventSchema>;

export const TaskLockReleaseEventSchema = z.object({
  event: z.literal("lock_release"),
  id: z.string(),
  files: z.array(z.string()),
  at: z.string(),
});
export type TaskLockReleaseEvent = z.infer<typeof TaskLockReleaseEventSchema>;

export const TaskScopeAmendmentEventSchema = z.object({
  event: z.literal("scope_amendment"),
  id: z.string(),
  file: z.string(),
  reason: z.string().optional(),
  at: z.string(),
});
export type TaskScopeAmendmentEvent = z.infer<
  typeof TaskScopeAmendmentEventSchema
>;

export const TaskScopeConflictEventSchema = z.object({
  event: z.literal("scope_conflict"),
  id: z.string(),
  file: z.string(),
  conflictingTaskId: z.string(),
  reason: z.string().optional(),
  at: z.string(),
});
export type TaskScopeConflictEvent = z.infer<
  typeof TaskScopeConflictEventSchema
>;

export const TaskEventSchema = z.discriminatedUnion("event", [
  TaskCreateEventSchema,
  TaskStatusChangeEventSchema,
  TaskLockGrantEventSchema,
  TaskLockReleaseEventSchema,
  TaskScopeAmendmentEventSchema,
  TaskScopeConflictEventSchema,
]);
export type TaskEvent = z.infer<typeof TaskEventSchema>;
