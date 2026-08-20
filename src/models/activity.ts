/**
 * Frontman activity entity definition for granular state tracking and visualization
 */

export const FRONTMAN_ACTIVITIES = [
  'questioning',
  'awaiting_response',
  'analyzing',
  'planning',
  'orchestrating',
  'reviewing',
  'idle',
] as const;

/**
 * Granular activity state of Frontman
 */
export type FrontmanActivityType = (typeof FRONTMAN_ACTIVITIES)[number];

/**
 * A tracked activity record for Frontman
 */
export interface FrontmanActivity {
  id: string;
  briefId: string;
  activityType: FrontmanActivityType;
  message: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string | null;
}

export const ACTIVITY_FIELDS = [
  'id',
  'briefId',
  'activityType',
  'message',
  'metadata',
  'startedAt',
  'endedAt',
] as const;

/**
 *
 */
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];
