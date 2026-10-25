import type { HealthState, IncidentView, Probe } from './api/client.js';

// The words the dashboard uses for the API's enumerations, kept in one place so a state reads the same on every page.

export const HEALTH_LABELS: Record<HealthState, string> = {
  up: 'Up',
  drift: 'Drift',
  down: 'Down',
  paused: 'Paused',
  pending: 'Pending',
};

export const PROBE_OUTCOME_LABELS: Record<Probe['outcome'], string> = {
  up: 'Up',
  timeout: 'Timeout',
  connection_error: 'Connection error',
  protocol_error: 'Protocol error',
  auth_error: 'Auth error',
};

export const INCIDENT_KIND_LABELS: Record<IncidentView['kind'], string> = {
  drift: 'Drift',
  down: 'Down',
};

export const INCIDENT_STATE_LABELS = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
} as const;

export const RESOLUTION_LABELS: Record<NonNullable<IncidentView['resolution']>, string> = {
  recovered: 'Recovered',
  approved: 'Approved',
  reverted: 'Reverted',
};
