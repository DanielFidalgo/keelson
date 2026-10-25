import type { HealthState, HealthStateInputs } from './health-state.js';

export interface HealthStateCase {
  readonly name: string;
  readonly inputs: HealthStateInputs;
  readonly expected: HealthState;
}

// Shared with the Postgres health filter's parity test, so the SQL and the domain rule cannot drift apart.
export const HEALTH_STATE_CASES: readonly HealthStateCase[] = [
  {
    name: 'paused wins over an open down incident',
    inputs: { status: 'paused', hasProbe: true, openIncidentKinds: ['down'] },
    expected: 'paused',
  },
  {
    name: 'paused wins over an open drift incident',
    inputs: { status: 'paused', hasProbe: true, openIncidentKinds: ['drift'] },
    expected: 'paused',
  },
  {
    name: 'paused wins when never probed',
    inputs: { status: 'paused', hasProbe: false, openIncidentKinds: [] },
    expected: 'paused',
  },
  {
    name: 'down wins over drift when both are open',
    inputs: { status: 'active', hasProbe: true, openIncidentKinds: ['drift', 'down'] },
    expected: 'down',
  },
  {
    name: 'an open down incident alone is down',
    inputs: { status: 'active', hasProbe: true, openIncidentKinds: ['down'] },
    expected: 'down',
  },
  {
    name: 'an open down incident without a probe is down',
    inputs: { status: 'active', hasProbe: false, openIncidentKinds: ['down'] },
    expected: 'down',
  },
  {
    name: 'an open drift incident alone is drift',
    inputs: { status: 'active', hasProbe: true, openIncidentKinds: ['drift'] },
    expected: 'drift',
  },
  {
    name: 'an open drift incident without a probe is drift',
    inputs: { status: 'active', hasProbe: false, openIncidentKinds: ['drift'] },
    expected: 'drift',
  },
  {
    name: 'no probe and no incident is pending',
    inputs: { status: 'active', hasProbe: false, openIncidentKinds: [] },
    expected: 'pending',
  },
  {
    name: 'a probed monitor with no incident is up',
    inputs: { status: 'active', hasProbe: true, openIncidentKinds: [] },
    expected: 'up',
  },
];
