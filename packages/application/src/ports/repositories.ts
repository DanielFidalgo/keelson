import type {
  Alert,
  Drift,
  Incident,
  IncidentKind,
  Monitor,
  Probe,
  Snapshot,
  SnapshotHash,
  WebhookEndpoint,
} from '@keelson/domain';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export interface PageRequest {
  cursor: string | null;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MonitorRepository {
  get(id: string): Promise<Monitor | null>;
  lockForUpdate(id: string): Promise<Monitor | null>;
  claimDue(now: Date, limit: number): Promise<Monitor[]>;
  save(monitor: Monitor): Promise<void>;
  delete(id: string): Promise<void>;
  listForTenant(tenantId: string, page: PageRequest): Promise<Page<Monitor>>;
}

export interface ProbeRepository {
  insertIfAbsent(probe: Probe): Promise<boolean>;
  latestUp(monitorId: string): Promise<Probe | null>;
  listForMonitor(monitorId: string, page: PageRequest): Promise<Page<Probe>>;
  monitorHasSnapshot(monitorId: string, hash: SnapshotHash): Promise<boolean>;
}

export interface SnapshotStore {
  saveIfAbsent(snapshot: Snapshot, now: Date): Promise<void>;
  get(hash: SnapshotHash): Promise<Snapshot | null>;
}

export interface DriftRepository {
  insert(drift: Drift): Promise<void>;
  get(id: string): Promise<Drift | null>;
}

export interface IncidentRepository {
  findOpen(monitorId: string, kind: IncidentKind): Promise<Incident | null>;
  get(id: string): Promise<Incident | null>;
  save(incident: Incident): Promise<void>;
  listForTenant(
    tenantId: string,
    filter: { state: 'open' | 'resolved' | null },
    page: PageRequest,
  ): Promise<Page<Incident>>;
}

export interface WebhookEndpointRepository {
  get(id: string): Promise<WebhookEndpoint | null>;
  save(endpoint: WebhookEndpoint): Promise<void>;
  delete(id: string): Promise<void>;
  listActive(tenantId: string): Promise<WebhookEndpoint[]>;
  listForTenant(tenantId: string, page: PageRequest): Promise<Page<WebhookEndpoint>>;
}

export interface OutboxMessage {
  id: string;
  incidentId: string;
  endpointId: string;
  alert: Alert;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: Date;
  sentAt: Date | null;
  // Why the latest delivery attempt failed; kept after a later success as the last problem this message had.
  lastError: string | null;
}

export interface OutboxFailure {
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
}

export interface Outbox {
  enqueue(messages: OutboxMessage[]): Promise<void>;
  // Only unsent messages of active endpoints are due; a disabled endpoint's messages wait until it is re-enabled.
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<OutboxMessage[]>;
  markSent(id: string, now: Date): Promise<void>;
  markFailed(id: string, failure: OutboxFailure): Promise<void>;
}

export interface TenantRepository {
  insert(tenant: { id: string; name: string }): Promise<void>;
}

export interface ApiKeyRepository {
  insert(key: { id: string; tenantId: string; keyHash: string; createdAt: Date }): Promise<void>;
  findTenantIdByHash(keyHash: string): Promise<string | null>;
}
