import type {
  Alert,
  Drift,
  Incident,
  IncidentKind,
  Monitor,
  Probe,
  ProbeOutcome,
  RawCatalog,
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
}

export interface Outbox {
  enqueue(messages: OutboxMessage[]): Promise<void>;
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<OutboxMessage[]>;
  markSent(id: string, now: Date): Promise<void>;
  markFailed(id: string, attempts: number, nextAttemptAt: Date): Promise<void>;
}

export interface TenantRepository {
  insert(tenant: { id: string; name: string }): Promise<void>;
}

export interface ApiKeyRepository {
  insert(key: { id: string; tenantId: string; keyHash: string; createdAt: Date }): Promise<void>;
  findTenantIdByHash(keyHash: string): Promise<string | null>;
}

export interface Transaction {
  monitors: MonitorRepository;
  probes: ProbeRepository;
  snapshots: SnapshotStore;
  drifts: DriftRepository;
  incidents: IncidentRepository;
  webhookEndpoints: WebhookEndpointRepository;
  outbox: Outbox;
  tenants: TenantRepository;
  apiKeys: ApiKeyRepository;
}

export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

export interface ProbeJob {
  monitorId: string;
  slot: number;
}

// Enqueueing the same job twice must not run it twice: the queue is the first line of defence against duplicate probes.
export interface ProbeQueue {
  enqueue(job: ProbeJob): Promise<void>;
}

export interface InspectionTarget {
  url: string;
  bearerToken: string | null;
}

export interface Inspection {
  outcome: ProbeOutcome;
  latencyMs: number;
  serverName: string | null;
  serverVersion: string | null;
  catalog: RawCatalog | null;
  errorDetail: string | null;
}

export interface McpInspector {
  inspect(target: InspectionTarget): Promise<Inspection>;
}

export interface SecretStore {
  read(ref: string): Promise<string>;
  create(name: string, value: string): Promise<string>;
  destroy(ref: string): Promise<void>;
}

export interface Delivery {
  url: string;
  signingSecret: string | null;
  alert: Alert;
  messageId: string;
  timestamp: Date;
}

export type DeliveryResult = { delivered: true } | { delivered: false; reason: string };

export interface AlertChannel {
  deliver(delivery: Delivery): Promise<DeliveryResult>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface CredentialFactory {
  signingSecret(): string;
  apiKey(): { plainText: string; hash: string };
  hashApiKey(plainText: string): string;
}
