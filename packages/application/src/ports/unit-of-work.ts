import type {
  ApiKeyRepository,
  DriftRepository,
  IncidentRepository,
  MonitorRepository,
  Outbox,
  ProbeRepository,
  SnapshotStore,
  TenantRepository,
  WebhookEndpointRepository,
} from './repositories.js';

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
