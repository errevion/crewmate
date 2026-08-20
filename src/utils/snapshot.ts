/**
 * Workflow snapshot builder — reads current state from the database and
 * derives a view for the live dashboard.
 */
import { getDb } from '../db/connection.js';
import type Database from 'better-sqlite3';
import { resolveBrief } from '../db/brief-repo.js';
import { listTasksByBrief } from '../db/task-repo.js';
import { listLocks } from '../db/lock-repo.js';
import { listArtifacts } from '../db/artifact-repo.js';
import { listEvents, countEvents } from '../db/event-repo.js';
import { getCurrentActivity } from '../db/activity-repo.js';
import { EVENT_ACTORS, type EventActor } from '../models/event.js';
import type { ExecutionEvent } from '../models/event.js';
import type { FrontmanActivity } from '../models/activity.js';
import type { FileLock } from '../models/lock.js';
import type { ExecutionArtifact } from '../models/artifact.js';
import type { Task } from '../models/task.js';
import type { DispatchEdge } from './graph.js';

/**
 * Parses the target agent from a dispatched event message
 * Expected format: "Dispatched <agent> for task ..."
 */
function parseDispatchTarget(message: string): EventActor {
  const match = message.toLowerCase().match(/\b(frontman|scout|planner|executor)\b/);
  return (match?.[1] as EventActor) ?? 'executor';
}

/**
 * A task as rendered on the live dashboard, with derived dependency state
 */
export interface TaskView {
  id: string;
  title: string;
  status: Task['status'];
  dependencies: string[];
  field: string | null;
  ready: boolean;
  blocked: boolean;
}

/**
 * Current activity state of an agent
 */
export type AgentState = 'idle' | 'active' | 'error';

/**
 * An agent as rendered on the live dashboard
 */
export interface AgentView {
  actor: EventActor;
  state: AgentState;
  taskId: string | null;
  taskTitle: string | null;
  message: string | null;
}

/**
 * A point-in-time view of the workflow for the dashboard
 */
export interface WorkflowSnapshot {
  briefId: string;
  briefStatus: string;
  goal: string | null;
  tasks: TaskView[];
  locks: FileLock[];
  artifacts: ExecutionArtifact[];
  events: ExecutionEvent[];
  agents: AgentView[];
  activeCount: number;
  completedCount: number;
  totalCount: number;
  eventCount: number;
  updatedAt: string;
  dispatchEdges: DispatchEdge[];
  frontmanState: 'thinking' | 'asking' | 'idle';
  currentActivity?: FrontmanActivity | null;
}

/**
 * Options controlling snapshot building
 */
export interface SnapshotOptions {
  briefId?: string;
  eventLimit?: number;
  artifactLimit?: number;
}

function deriveAgentState(type: ExecutionEvent['type']): AgentState {
  if (type === 'error') {
    return 'error';
  }
  if (type === 'completed') {
    return 'idle';
  }
  return 'active';
}

/**
 * Builds a snapshot of the current workflow state for a brief
 *
 * @param options Optional brief ID and fetch limits
 * @param db Database connection (defaults to the shared connection)
 * @returns The workflow snapshot, or null if no brief exists
 */
export function buildSnapshot(
  options: SnapshotOptions = {},
  db: Database.Database = getDb()
): WorkflowSnapshot | null {
  const brief = resolveBrief(options.briefId, db);
  if (!brief) {
    return null;
  }

  const tasks = listTasksByBrief(db, brief.id);
  const locks = listLocks(db);
  const artifacts = listArtifacts(db, { briefId: brief.id });
  const events = listEvents(db, { briefId: brief.id, limit: options.eventLimit ?? 200 });
  const eventCount = countEvents(db, brief.id);

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const completedIds = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));

  const taskViews: TaskView[] = tasks.map((t) => {
    const ready = t.status === 'pending' && t.dependencies.every((d) => completedIds.has(d));
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      dependencies: t.dependencies,
      field: t.field,
      ready,
      blocked: t.status === 'pending' && !ready,
    };
  });

  const agents: AgentView[] = EVENT_ACTORS.map((actor) => {
    const latest = events.find((e) => e.actor === actor);
    if (!latest) {
      return { actor, state: 'idle', taskId: null, taskTitle: null, message: null };
    }
    const task = latest.taskId ? tasksById.get(latest.taskId) : null;
    return {
      actor,
      state: deriveAgentState(latest.type),
      taskId: latest.taskId,
      taskTitle: task?.title ?? null,
      message: latest.message,
    };
  });

  const artifactLimit = options.artifactLimit ?? 10;
  const recentArtifacts = artifacts.slice(-artifactLimit);

  // Compute dispatch edges for activity graph visualization (only currently active dispatches)
  const dispatchedEvents = events
    .filter((e) => e.actor === 'frontman' && e.type === 'dispatched')
    .filter((e) => {
      const target = parseDispatchTarget(e.message);

      if (e.taskId) {
        const task = tasksById.get(e.taskId);
        if (task && task.status === 'completed') {
          return false;
        }
        const hasCompletedEvent = events.some(
          (evt) => evt.taskId === e.taskId && evt.type === 'completed'
        );
        if (hasCompletedEvent) {
          return false;
        }
      } else {
        // Non-task dispatches (e.g. scout or planner)
        // If target has finished (emitted completed after dispatch), it's done
        const dispatchTime = new Date(e.createdAt).getTime();
        const hasCompletedEvent = events.some(
          (evt) =>
            evt.actor === target &&
            evt.type === 'completed' &&
            new Date(evt.createdAt).getTime() >= dispatchTime
        );
        if (hasCompletedEvent) {
          return false;
        }
      }

      return true;
    })
    .slice(-6); // Take up to 6 active dispatches

  const dispatchEdges = dispatchedEvents
    .map((e) => ({
      source: 'frontman' as const,
      target: parseDispatchTarget(e.message),
      taskId: e.taskId,
      startTime: new Date(e.createdAt).getTime(),
      nextPlayAt: undefined,
    }))
    .reverse(); // Most recent first

  const activeCount = taskViews.filter((t) => t.status === 'in_progress').length;
  const completedCount = taskViews.filter((t) => t.status === 'completed').length;

  const currentActivity = getCurrentActivity(db, brief.id);

  let frontmanState: 'thinking' | 'asking' | 'idle';
  if (currentActivity) {
    if (
      currentActivity.activityType === 'questioning' ||
      currentActivity.activityType === 'awaiting_response'
    ) {
      frontmanState = 'asking';
    } else if (
      currentActivity.activityType === 'analyzing' ||
      currentActivity.activityType === 'planning' ||
      currentActivity.activityType === 'orchestrating' ||
      currentActivity.activityType === 'reviewing'
    ) {
      frontmanState = 'thinking';
    } else {
      frontmanState = 'idle';
    }
  } else if (brief.status === 'draft') {
    frontmanState = 'asking';
  } else if (taskViews.length === 0 || completedCount < taskViews.length) {
    frontmanState = 'thinking';
  } else {
    frontmanState = 'idle';
  }

  return {
    briefId: brief.id,
    briefStatus: brief.status,
    goal: brief.goal,
    tasks: taskViews,
    locks,
    artifacts: recentArtifacts,
    events,
    agents,
    activeCount,
    completedCount,
    totalCount: taskViews.length,
    eventCount,
    updatedAt: new Date().toISOString(),
    dispatchEdges,
    frontmanState,
    currentActivity,
  };
}

/**
 * Returns events that are not present in a set of known event IDs
 *
 * @param snapshot The freshly built snapshot
 * @param seenIds The set of event IDs already displayed
 */
export function newEvents(snapshot: WorkflowSnapshot, seenIds: Set<string>): ExecutionEvent[] {
  return snapshot.events.filter((e) => !seenIds.has(e.id));
}
