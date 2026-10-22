import { describe, expect, it } from 'vitest';
import { assessProbe, type MonitorHealth } from './health.js';
import type { SnapshotHash } from './snapshot.js';

const H1 = 'hash-1' as SnapshotHash;
const H2 = 'hash-2' as SnapshotHash;
const H3 = 'hash-3' as SnapshotHash;

const fresh: MonitorHealth = { baselineHash: null, consecutiveFailures: 0, downOpen: false, openDriftToHash: null };
const baselined: MonitorHealth = { ...fresh, baselineHash: H1 };
const drifting: MonitorHealth = { ...baselined, openDriftToHash: H2 };

describe('assessProbe', () => {
  it('sets the baseline on the first successful probe', () => {
    expect(assessProbe(fresh, { outcome: 'up', snapshotHash: H1 })).toEqual({
      consecutiveFailures: 0,
      effects: [{ type: 'baseline_set', hash: H1 }],
    });
  });

  it('does nothing when the snapshot matches the baseline', () => {
    expect(assessProbe(baselined, { outcome: 'up', snapshotHash: H1 })).toEqual({ consecutiveFailures: 0, effects: [] });
  });

  it('opens a drift when the snapshot differs and no drift is open', () => {
    expect(assessProbe(baselined, { outcome: 'up', snapshotHash: H2 })).toEqual({
      consecutiveFailures: 0,
      effects: [{ type: 'drift_opened' }],
    });
  });

  it('raises nothing for a stable drift, so there is one alert per problem', () => {
    expect(assessProbe(drifting, { outcome: 'up', snapshotHash: H2 })).toEqual({ consecutiveFailures: 0, effects: [] });
  });

  it('escalates an open drift when the snapshot moves to a third hash', () => {
    expect(assessProbe(drifting, { outcome: 'up', snapshotHash: H3 })).toEqual({
      consecutiveFailures: 0,
      effects: [{ type: 'drift_escalated' }],
    });
  });

  it('reverts an open drift when the snapshot returns to the baseline', () => {
    expect(assessProbe(drifting, { outcome: 'up', snapshotHash: H1 })).toEqual({
      consecutiveFailures: 0,
      effects: [{ type: 'drift_reverted' }],
    });
  });

  it('counts a failure below the threshold without effects', () => {
    expect(assessProbe({ ...baselined, consecutiveFailures: 1 }, { outcome: 'timeout' })).toEqual({
      consecutiveFailures: 2,
      effects: [],
    });
  });

  it('opens a down incident on the third consecutive failure', () => {
    expect(assessProbe({ ...baselined, consecutiveFailures: 2 }, { outcome: 'connection_error' })).toEqual({
      consecutiveFailures: 3,
      effects: [{ type: 'down_opened' }],
    });
  });

  it('raises nothing for further failures while a down incident is open', () => {
    expect(assessProbe({ ...baselined, consecutiveFailures: 5, downOpen: true }, { outcome: 'timeout' })).toEqual({
      consecutiveFailures: 6,
      effects: [],
    });
  });

  it('recovers the down incident before opening a drift found on the same probe', () => {
    const health = { ...baselined, consecutiveFailures: 4, downOpen: true };
    expect(assessProbe(health, { outcome: 'up', snapshotHash: H2 })).toEqual({
      consecutiveFailures: 0,
      effects: [{ type: 'down_recovered' }, { type: 'drift_opened' }],
    });
  });
});
