/**
 * Execution event entity definition for live workflow visualization
 */

export const EVENT_ACTORS = ['frontman', 'scout', 'planner', 'executor'] as const;

/**
 * Agent role that produced an event
 */
export type EventActor = (typeof EVENT_ACTORS)[number];

export const EVENT_TYPES = [
  'dispatched',
  'started',
  'locked',
  'artifact',
  'completed',
  'error',
] as const;

/**
 * Kind of lifecycle event an agent emitted
 */
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * A workflow lifecycle event emitted by an agent (Frontman, Scout, Planner, Executor)
 */
export interface ExecutionEvent {
  id: string;
  briefId: string;
  taskId: string | null;
  actor: EventActor;
  type: EventType;
  message: string;
  createdAt: string;
}

export const EVENT_FIELDS = [
  'id',
  'briefId',
  'taskId',
  'actor',
  'type',
  'message',
  'createdAt',
] as const;

/**
 *
 */
export type EventField = (typeof EVENT_FIELDS)[number];

// Map camelCase fields to snake_case column names
export const EVENT_FIELD_TO_COLUMN: Record<string, string> = {
  id: 'id',
  briefId: 'brief_id',
  taskId: 'task_id',
  actor: 'actor',
  type: 'type',
  message: 'message',
  createdAt: 'created_at',
};

// Reverse mapping
export const EVENT_COLUMN_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_FIELD_TO_COLUMN).map(([k, v]) => [v, k])
);
