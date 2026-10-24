import type {
  Drift,
  Incident,
  IncidentKind,
  Monitor,
  Probe,
  Snapshot,
  SnapshotHash,
  WebhookEndpoint,
} from '@keelson/domain';
import { compareCodeUnits } from '@keelson/domain';
import { paginate } from '../shared/pagination.js';
import type {
  ApiKeyRepository,
  DriftRepository,
  IncidentRepository,
  MonitorRepository,
  Outbox,
  OutboxFailure,
  OutboxMessage,
  Page,
  PageRequest,
  ProbeRepository,
  SnapshotStore,
  TenantRepository,
  WebhookEndpointRepository,
} from '../ports/index.js';

const byId = (item: { id: string }): string => item.id;

const newestFirst = (left: Date, right: Date): number => right.getTime() - left.getTime();

export class InMemoryMonitors implements MonitorRepository {
  readonly records = new Map<string, Monitor>();

  get(id: string): Promise<Monitor | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  // Tests run one use case at a time, so there is no concurrent writer for a lock to exclude.
  lockForUpdate(id: string): Promise<Monitor | null> {
    return this.get(id);
  }

  claimDue(now: Date, limit: number): Promise<Monitor[]> {
    const due = [...this.records.values()]
      .filter((monitor) => monitor.status === 'active' && monitor.nextProbeAt <= now)
      .sort((left, right) => left.nextProbeAt.getTime() - right.nextProbeAt.getTime());
    return Promise.resolve(due.slice(0, limit));
  }

  save(monitor: Monitor): Promise<void> {
    this.records.set(monitor.id, monitor);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }

  listForTenant(tenantId: string, page: PageRequest): Promise<Page<Monitor>> {
    const owned = [...this.records.values()].filter((monitor) => monitor.tenantId === tenantId);
    return Promise.resolve(paginate(owned.sort((left, right) => newestFirst(left.createdAt, right.createdAt)), page, byId));
  }
}

export class InMemoryProbes implements ProbeRepository {
  readonly records = new Map<string, Probe>();

  insertIfAbsent(probe: Probe): Promise<boolean> {
    const key = `${probe.monitorId}:${String(probe.slot)}`;
    if (this.records.has(key)) return Promise.resolve(false);
    this.records.set(key, probe);
    return Promise.resolve(true);
  }

  latestUp(monitorId: string): Promise<Probe | null> {
    const latest = this.forMonitor(monitorId).find((probe) => probe.outcome === 'up');
    return Promise.resolve(latest ?? null);
  }

  listForMonitor(monitorId: string, page: PageRequest): Promise<Page<Probe>> {
    return Promise.resolve(paginate(this.forMonitor(monitorId), page, byId));
  }

  monitorHasSnapshot(monitorId: string, hash: SnapshotHash): Promise<boolean> {
    return Promise.resolve(this.forMonitor(monitorId).some((probe) => probe.snapshotHash === hash));
  }

  // Newest by start time, not by slot: slots of different intervals are not comparable, so after an
  // interval change a higher slot can belong to an older probe.
  private forMonitor(monitorId: string): Probe[] {
    return [...this.records.values()]
      .filter((probe) => probe.monitorId === monitorId)
      .sort((left, right) => newestFirst(left.startedAt, right.startedAt) || compareCodeUnits(right.id, left.id));
  }
}

export class InMemorySnapshots implements SnapshotStore {
  readonly records = new Map<SnapshotHash, Snapshot>();

  saveIfAbsent(snapshot: Snapshot): Promise<void> {
    if (!this.records.has(snapshot.hash)) this.records.set(snapshot.hash, snapshot);
    return Promise.resolve();
  }

  get(hash: SnapshotHash): Promise<Snapshot | null> {
    return Promise.resolve(this.records.get(hash) ?? null);
  }
}

export class InMemoryDrifts implements DriftRepository {
  readonly records = new Map<string, Drift>();

  insert(drift: Drift): Promise<void> {
    this.records.set(drift.id, drift);
    return Promise.resolve();
  }

  get(id: string): Promise<Drift | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }
}

export class InMemoryIncidents implements IncidentRepository {
  readonly records = new Map<string, Incident>();

  // Incidents carry only a monitor id, so tenant ownership is resolved through the monitors.
  constructor(private readonly monitors: InMemoryMonitors) {}

  findOpen(monitorId: string, kind: IncidentKind): Promise<Incident | null> {
    const open = [...this.records.values()].find(
      (incident) => incident.monitorId === monitorId && incident.kind === kind && incident.state === 'open',
    );
    return Promise.resolve(open ?? null);
  }

  get(id: string): Promise<Incident | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  save(incident: Incident): Promise<void> {
    this.records.set(incident.id, incident);
    return Promise.resolve();
  }

  listForTenant(
    tenantId: string,
    filter: { state: 'open' | 'resolved' | null },
    page: PageRequest,
  ): Promise<Page<Incident>> {
    const matching = [...this.records.values()]
      .filter((incident) => this.monitors.records.get(incident.monitorId)?.tenantId === tenantId)
      .filter((incident) => filter.state === null || incident.state === filter.state)
      .sort((left, right) => newestFirst(left.openedAt, right.openedAt));
    return Promise.resolve(paginate(matching, page, byId));
  }
}

export class InMemoryWebhookEndpoints implements WebhookEndpointRepository {
  readonly records = new Map<string, WebhookEndpoint>();

  get(id: string): Promise<WebhookEndpoint | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  save(endpoint: WebhookEndpoint): Promise<void> {
    this.records.set(endpoint.id, endpoint);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }

  listActive(tenantId: string): Promise<WebhookEndpoint[]> {
    return Promise.resolve(this.ownedBy(tenantId).filter((endpoint) => endpoint.status === 'active'));
  }

  listForTenant(tenantId: string, page: PageRequest): Promise<Page<WebhookEndpoint>> {
    return Promise.resolve(paginate(this.ownedBy(tenantId), page, byId));
  }

  private ownedBy(tenantId: string): WebhookEndpoint[] {
    return [...this.records.values()]
      .filter((endpoint) => endpoint.tenantId === tenantId)
      .sort((left, right) => newestFirst(left.createdAt, right.createdAt));
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly records = new Map<string, OutboxMessage>();

  // Messages are claimable only while their endpoint is active, which the real adapter expresses as a join.
  constructor(private readonly endpoints: InMemoryWebhookEndpoints) {}

  messages(): OutboxMessage[] {
    return [...this.records.values()];
  }

  enqueue(messages: OutboxMessage[]): Promise<void> {
    for (const message of messages) this.records.set(message.id, message);
    return Promise.resolve();
  }

  // Pushing nextAttemptAt to the lease deadline hides claimed rows from other workers until the lease lapses.
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<OutboxMessage[]> {
    const due = this.messages()
      .filter((message) => message.sentAt === null && message.nextAttemptAt <= now)
      .filter((message) => this.endpoints.records.get(message.endpointId)?.status === 'active')
      .slice(0, limit);
    const claimed = due.map((message) => ({ ...message, nextAttemptAt: leaseUntil }));
    for (const message of claimed) this.records.set(message.id, message);
    return Promise.resolve(claimed);
  }

  markSent(id: string, now: Date): Promise<void> {
    return this.update(id, { sentAt: now });
  }

  markFailed(id: string, failure: OutboxFailure): Promise<void> {
    return this.update(id, failure);
  }

  private update(id: string, changes: Partial<OutboxMessage>): Promise<void> {
    const message = this.records.get(id);
    if (message === undefined) return Promise.reject(new Error(`unknown outbox message: ${id}`));
    this.records.set(id, { ...message, ...changes });
    return Promise.resolve();
  }
}

export class InMemoryTenants implements TenantRepository {
  readonly records = new Map<string, { id: string; name: string }>();

  insert(tenant: { id: string; name: string }): Promise<void> {
    this.records.set(tenant.id, tenant);
    return Promise.resolve();
  }
}

export class InMemoryApiKeys implements ApiKeyRepository {
  readonly records = new Map<string, { id: string; tenantId: string; keyHash: string; createdAt: Date }>();

  insert(key: { id: string; tenantId: string; keyHash: string; createdAt: Date }): Promise<void> {
    this.records.set(key.id, key);
    return Promise.resolve();
  }

  findTenantIdByHash(keyHash: string): Promise<string | null> {
    const match = [...this.records.values()].find((key) => key.keyHash === keyHash);
    return Promise.resolve(match?.tenantId ?? null);
  }
}
