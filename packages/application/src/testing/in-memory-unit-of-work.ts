import type { Transaction, UnitOfWork } from '../ports/index.js';
import { InMemoryIncidentDirectory, InMemoryMonitorDirectory } from './in-memory-directories.js';
import {
  InMemoryApiKeys,
  InMemoryDrifts,
  InMemoryIncidents,
  InMemoryMonitors,
  InMemoryOutbox,
  InMemoryProbes,
  InMemorySnapshots,
  InMemoryTenants,
  InMemoryWebhookEndpoints,
} from './in-memory-repositories.js';

export class InMemoryTransaction implements Transaction {
  readonly monitors = new InMemoryMonitors();
  readonly probes = new InMemoryProbes();
  readonly snapshots = new InMemorySnapshots();
  readonly drifts = new InMemoryDrifts();
  readonly incidents = new InMemoryIncidents(this.monitors);
  readonly webhookEndpoints = new InMemoryWebhookEndpoints();
  readonly outbox = new InMemoryOutbox(this.webhookEndpoints);
  readonly tenants = new InMemoryTenants();
  readonly apiKeys = new InMemoryApiKeys();
  readonly monitorDirectory = new InMemoryMonitorDirectory({
    monitors: this.monitors,
    probes: this.probes,
    incidents: this.incidents,
    drifts: this.drifts,
    snapshots: this.snapshots,
  });
  readonly incidentDirectory = new InMemoryIncidentDirectory({
    monitors: this.monitors,
    incidents: this.incidents,
    drifts: this.drifts,
  });
}

// Deliberately has no rollback: work runs straight against the shared maps, so a failure part-way
// leaves its earlier writes behind. Use-case tests therefore assert committed outcomes only; atomicity
// is verified against the real database adapter.
export class InMemoryUnitOfWork implements UnitOfWork {
  readonly transaction = new InMemoryTransaction();

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(this.transaction);
  }
}
