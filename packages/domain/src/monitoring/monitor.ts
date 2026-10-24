import { DomainValidationError } from '../shared/errors.js';
import { slotAt, slotStart } from './slot.js';
import type { SnapshotHash } from '../snapshots/snapshot.js';
import { requiredTextProblems, urlProblems } from '../shared/validation.js';

export const MIN_PROBE_INTERVAL_SECONDS = 300;

export type MonitorStatus = 'active' | 'paused';

export interface Monitor {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly url: string;
  readonly transport: 'streamable_http';
  readonly authSecretRef: string | null;
  readonly intervalSeconds: number;
  readonly nextProbeAt: Date;
  readonly baselineHash: SnapshotHash | null;
  readonly consecutiveFailures: number;
  readonly status: MonitorStatus;
  readonly createdAt: Date;
}

export interface NewMonitorInput {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  authSecretRef: string | null;
}

export interface MonitorChanges {
  name?: string;
  intervalSeconds?: number;
  status?: MonitorStatus;
  authSecretRef?: string | null;
}

type ValidatedFields = Pick<Monitor, 'id' | 'tenantId' | 'name' | 'url' | 'intervalSeconds' | 'authSecretRef'>;

export function newMonitor(input: NewMonitorInput, now: Date): Monitor {
  assertValid(input);
  return {
    ...input,
    transport: 'streamable_http',
    nextProbeAt: new Date(now),
    baselineHash: null,
    consecutiveFailures: 0,
    status: 'active',
    createdAt: new Date(now),
  };
}

export function updateMonitor(monitor: Monitor, changes: MonitorChanges, now: Date): Monitor {
  const updated: Monitor = { ...monitor, ...changes };
  assertValid(updated);
  return updated.intervalSeconds === monitor.intervalSeconds ? updated : rescheduled(updated, now);
}

export function approveBaseline(monitor: Monitor, hash: SnapshotHash): Monitor {
  return { ...monitor, baselineHash: hash };
}

export function advanceSchedule(monitor: Monitor, now: Date): { monitor: Monitor; slot: number } {
  const slot = slotAt(now, monitor.intervalSeconds);
  return { monitor: { ...monitor, nextProbeAt: slotStart(slot + 1, monitor.intervalSeconds) }, slot };
}

// Slots of the old interval mean nothing to the new one, so probing resumes at the next boundary of the new grid.
function rescheduled(monitor: Monitor, now: Date): Monitor {
  const nextSlot = slotAt(now, monitor.intervalSeconds) + 1;
  return { ...monitor, nextProbeAt: slotStart(nextSlot, monitor.intervalSeconds) };
}

function assertValid(fields: ValidatedFields): void {
  const problems = [
    ...requiredTextProblems({ id: fields.id, tenantId: fields.tenantId, name: fields.name }),
    ...urlProblems(fields.url),
    ...intervalProblems(fields.intervalSeconds),
    ...authSecretRefProblems(fields.authSecretRef),
  ];
  if (problems.length > 0) throw new DomainValidationError(problems);
}

function intervalProblems(intervalSeconds: number): string[] {
  if (Number.isInteger(intervalSeconds) && intervalSeconds >= MIN_PROBE_INTERVAL_SECONDS) return [];
  return [`intervalSeconds must be an integer of at least ${String(MIN_PROBE_INTERVAL_SECONDS)}`];
}

function authSecretRefProblems(authSecretRef: string | null): string[] {
  if (authSecretRef === null || authSecretRef.trim() !== '') return [];
  return ['authSecretRef must be null or a non-empty reference'];
}
