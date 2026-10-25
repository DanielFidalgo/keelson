import type { IncidentKind } from '../incidents/incident.js';
import type { MonitorStatus } from './monitor.js';

export const HEALTH_STATES = ['up', 'drift', 'down', 'paused', 'pending'] as const;

export type HealthState = (typeof HEALTH_STATES)[number];

export interface HealthStateInputs {
  readonly status: MonitorStatus;
  readonly hasProbe: boolean;
  readonly openIncidentKinds: readonly IncidentKind[];
}

// First match wins. A failed probe below the down threshold has no incident yet, so it still reads as up.
export function healthStateOf({ status, hasProbe, openIncidentKinds }: HealthStateInputs): HealthState {
  if (status === 'paused') return 'paused';
  if (openIncidentKinds.includes('down')) return 'down';
  if (openIncidentKinds.includes('drift')) return 'drift';
  if (!hasProbe) return 'pending';
  return 'up';
}
