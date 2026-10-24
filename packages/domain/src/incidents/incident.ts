import { DomainValidationError } from '../shared/errors.js';
import { requiredTextProblems } from '../shared/validation.js';

export type IncidentKind = 'down' | 'drift';
export type Resolution = 'recovered' | 'approved' | 'reverted';

export interface Incident {
  readonly id: string;
  readonly monitorId: string;
  readonly kind: IncidentKind;
  readonly state: 'open' | 'resolved';
  readonly openedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolution: Resolution | null;
  readonly acknowledgedAt: Date | null;
  readonly lastDriftId: string | null;
}

export interface NewIncidentInput {
  id: string;
  monitorId: string;
  kind: IncidentKind;
  lastDriftId: string | null;
}

export function openIncident(input: NewIncidentInput, now: Date): Incident {
  const problems = requiredTextProblems({ id: input.id, monitorId: input.monitorId });
  if (problems.length > 0) throw new DomainValidationError(problems);
  return {
    ...input,
    state: 'open',
    openedAt: new Date(now),
    resolvedAt: null,
    resolution: null,
    acknowledgedAt: null,
  };
}

export function escalateIncident(incident: Incident, driftId: string): Incident {
  assertOpen(incident, 'escalate');
  return { ...incident, lastDriftId: driftId };
}

export function resolveIncident(incident: Incident, resolution: Resolution, now: Date): Incident {
  assertOpen(incident, 'resolve');
  return { ...incident, state: 'resolved', resolvedAt: new Date(now), resolution };
}

export function acknowledgeIncident(incident: Incident, now: Date): Incident {
  assertOpen(incident, 'acknowledge');
  return { ...incident, acknowledgedAt: new Date(now) };
}

function assertOpen(incident: Incident, action: string): void {
  if (incident.state === 'resolved') throw new DomainValidationError([`cannot ${action} a resolved incident`]);
}
