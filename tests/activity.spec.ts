import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { createBrief } from '../src/db/brief-repo.js';
import {
  setActivity,
  getCurrentActivity,
  clearActivity,
  listActivities,
} from '../src/db/activity-repo.js';

describe('Frontman Activity Repository', () => {
  let db: Database.Database;
  let briefId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const brief = createBrief(db);
    briefId = brief.id;
  });

  it('sets active activity and retrieves it with getCurrentActivity', () => {
    const activity = setActivity(db, briefId, 'questioning', {
      message: 'What database should we use?',
      metadata: { field: 'technicalStack' },
    });

    expect(activity.id).toBeDefined();
    expect(activity.briefId).toBe(briefId);
    expect(activity.activityType).toBe('questioning');
    expect(activity.message).toBe('What database should we use?');
    expect(activity.metadata).toEqual({ field: 'technicalStack' });
    expect(activity.endedAt).toBeNull();

    const current = getCurrentActivity(db, briefId);
    expect(current).not.toBeNull();
    expect(current?.id).toBe(activity.id);
    expect(current?.activityType).toBe('questioning');
  });

  it('automatically closes previous open activity when setting a new activity', () => {
    const first = setActivity(db, briefId, 'questioning', {
      message: 'Initial question',
    });

    const second = setActivity(db, briefId, 'analyzing', {
      message: 'Analyzing user answer',
    });

    const current = getCurrentActivity(db, briefId);
    expect(current?.id).toBe(second.id);
    expect(current?.activityType).toBe('analyzing');

    const all = listActivities(db, { briefId });
    expect(all).toHaveLength(2);
    const past = all.find((a) => a.id === first.id);
    expect(past?.endedAt).not.toBeNull();
  });

  it('clears active activity with clearActivity', () => {
    setActivity(db, briefId, 'planning', {
      message: 'Breaking down tasks',
    });

    expect(getCurrentActivity(db, briefId)).not.toBeNull();

    const cleared = clearActivity(db, briefId);
    expect(cleared).toBe(true);

    expect(getCurrentActivity(db, briefId)).toBeNull();
  });

  it('lists historical activities with limit', () => {
    setActivity(db, briefId, 'questioning');
    setActivity(db, briefId, 'analyzing');
    setActivity(db, briefId, 'planning');
    setActivity(db, briefId, 'orchestrating');

    const all = listActivities(db, { briefId, limit: 2 });
    expect(all).toHaveLength(2);
    expect(all[0].activityType).toBe('orchestrating');
    expect(all[1].activityType).toBe('planning');
  });
});
