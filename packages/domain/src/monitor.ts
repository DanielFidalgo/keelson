import { DomainValidationError } from './errors.js';
import { slotAt, slotStart } from './slot.js';
import type { SnapshotHash } from './snapshot.js';

export const MIN_PROBE_INTERVAL_SECONDS = 300;

const ALLOWED_URL_PROTOCOLS: readonly string[] = ['http:', 'https:'];

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

export function updateMonitor(monitor: Monitor, changes: MonitorChanges): Monitor {
  const updated: Monitor = { ...monitor, ...changes };
  assertValid(updated);
  return updated;
}

export function advanceSchedule(monitor: Monitor, now: Date): { monitor: Monitor; slot: number } {
  const slot = slotAt(now, monitor.intervalSeconds);
  return { monitor: { ...monitor, nextProbeAt: slotStart(slot + 1, monitor.intervalSeconds) }, slot };
}

function assertValid(fields: ValidatedFields): void {
  const problems = [
    ...requiredTextProblems(fields),
    ...urlProblems(fields.url),
    ...intervalProblems(fields.intervalSeconds),
    ...authSecretRefProblems(fields.authSecretRef),
  ];
  if (problems.length > 0) throw new DomainValidationError(problems);
}

function requiredTextProblems(fields: ValidatedFields): string[] {
  const requiredTexts = { id: fields.id, tenantId: fields.tenantId, name: fields.name };
  return Object.entries(requiredTexts)
    .filter(([, value]) => value.trim() === '')
    .map(([field]) => `${field} must not be empty`);
}

function urlProblems(url: string): string[] {
  const protocol = URL.canParse(url) ? new URL(url).protocol : null;
  if (protocol !== null && ALLOWED_URL_PROTOCOLS.includes(protocol)) return [];
  return ['url must be an absolute http or https URL'];
}

function intervalProblems(intervalSeconds: number): string[] {
  if (Number.isInteger(intervalSeconds) && intervalSeconds >= MIN_PROBE_INTERVAL_SECONDS) return [];
  return [`intervalSeconds must be an integer of at least ${String(MIN_PROBE_INTERVAL_SECONDS)}`];
}

function authSecretRefProblems(authSecretRef: string | null): string[] {
  if (authSecretRef === null || authSecretRef.trim() !== '') return [];
  return ['authSecretRef must be null or a non-empty reference'];
}
