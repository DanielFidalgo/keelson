import type { ProbeOutcome } from './probe.js';
import type { SnapshotHash } from './snapshot.js';

export const DOWN_AFTER_CONSECUTIVE_FAILURES = 3;

export interface MonitorHealth {
  readonly baselineHash: SnapshotHash | null;
  readonly consecutiveFailures: number;
  readonly downOpen: boolean;
  readonly openDriftToHash: SnapshotHash | null;
}

export type Observation =
  | { readonly outcome: 'up'; readonly snapshotHash: SnapshotHash }
  | { readonly outcome: Exclude<ProbeOutcome, 'up'> };

export type HealthEffect =
  | { readonly type: 'baseline_set'; readonly hash: SnapshotHash }
  | { readonly type: 'down_opened' }
  | { readonly type: 'down_recovered' }
  | { readonly type: 'drift_opened' }
  | { readonly type: 'drift_escalated' }
  | { readonly type: 'drift_reverted' };

export interface Assessment {
  readonly consecutiveFailures: number;
  readonly effects: HealthEffect[];
}

export function assessProbe(health: MonitorHealth, observation: Observation): Assessment {
  if (observation.outcome !== 'up') return assessFailure(health);
  const recovery: HealthEffect[] = health.downOpen ? [{ type: 'down_recovered' }] : [];
  return { consecutiveFailures: 0, effects: [...recovery, ...assessSnapshot(health, observation.snapshotHash)] };
}

function assessFailure(health: MonitorHealth): Assessment {
  const consecutiveFailures = health.consecutiveFailures + 1;
  const crossesThreshold = consecutiveFailures >= DOWN_AFTER_CONSECUTIVE_FAILURES && !health.downOpen;
  return { consecutiveFailures, effects: crossesThreshold ? [{ type: 'down_opened' }] : [] };
}

function assessSnapshot(health: MonitorHealth, hash: SnapshotHash): HealthEffect[] {
  if (health.baselineHash === null) return [{ type: 'baseline_set', hash }];
  if (hash === health.baselineHash) return health.openDriftToHash === null ? [] : [{ type: 'drift_reverted' }];
  if (health.openDriftToHash === null) return [{ type: 'drift_opened' }];
  // The open drift already points at this hash: alerting again would repeat the same problem.
  return hash === health.openDriftToHash ? [] : [{ type: 'drift_escalated' }];
}
