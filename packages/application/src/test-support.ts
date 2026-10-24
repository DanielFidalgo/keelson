import {
  newMonitor,
  newWebhookEndpoint,
  type Alert,
  type Monitor,
  type RawCatalog,
  type SnapshotHash,
  type WebhookEndpoint,
  type WebhookFormat,
} from '@keelson/domain';
import {
  FakeCredentialFactory,
  FakeInspector,
  FakeSecretStore,
  FixedClock,
  InMemoryUnitOfWork,
  RecordingAlertChannel,
  RecordingProbeQueue,
  SequentialIds,
} from './testing/index.js';
import type { Inspection, OutboxMessage } from './ports/index.js';
import { DispatchDueProbes } from './probing/dispatch-due-probes.js';
import { RunProbe } from './probing/run-probe.js';

export const NOW = new Date('2026-10-22T12:00:00Z');
export const TENANT_ID = 'ten_1';
export const MONITOR_ID = 'mon_1';
export const INTERVAL_SECONDS = 300;

export function createHarness() {
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIds();
  const inspector = new FakeInspector();
  const secrets = new FakeSecretStore();
  const queue = new RecordingProbeQueue();
  const credentials = new FakeCredentialFactory();
  const channels: Record<WebhookFormat, RecordingAlertChannel> = {
    standard: new RecordingAlertChannel(),
    slack: new RecordingAlertChannel(),
  };
  const runProbeDeps = { unitOfWork, inspector, secrets, clock, ids };
  return {
    db: unitOfWork.transaction,
    unitOfWork,
    inspector,
    secrets,
    queue,
    clock,
    ids,
    credentials,
    channels,
    deps: { unitOfWork, inspector, secrets, queue, clock, ids, credentials, channels },
    runProbeDeps,
    runProbe: new RunProbe(runProbeDeps),
    dispatchDueProbes: new DispatchDueProbes({ unitOfWork, queue, clock }),
  };
}

export type Harness = ReturnType<typeof createHarness>;

export async function seedMonitor(harness: Harness, overrides: Partial<Monitor> = {}): Promise<Monitor> {
  const monitor: Monitor = {
    ...newMonitor(
      {
        id: MONITOR_ID,
        tenantId: TENANT_ID,
        name: 'Docs server',
        url: 'https://mcp.example.com/mcp',
        intervalSeconds: INTERVAL_SECONDS,
        authSecretRef: null,
      },
      NOW,
    ),
    ...overrides,
  };
  await harness.db.monitors.save(monitor);
  return monitor;
}

export async function seedEndpoint(
  harness: Harness,
  id: string,
  status: WebhookEndpoint['status'] = 'active',
): Promise<void> {
  const endpoint = newWebhookEndpoint(
    { id, tenantId: TENANT_ID, url: `https://hooks.example.com/${id}`, format: 'slack', secretRef: null },
    NOW,
  );
  await harness.db.webhookEndpoints.save({ ...endpoint, status });
}

export async function seedStandardEndpoint(harness: Harness, id: string, signingSecret: string): Promise<void> {
  const secretRef = await harness.secrets.create(`webhook-${id}`, signingSecret);
  const endpoint = newWebhookEndpoint(
    { id, tenantId: TENANT_ID, url: `https://hooks.example.com/${id}`, format: 'standard', secretRef },
    NOW,
  );
  await harness.db.webhookEndpoints.save(endpoint);
}

export const SAMPLE_ALERT: Alert = {
  type: 'incident.opened',
  incidentId: 'inc_1',
  monitorId: MONITOR_ID,
  monitorName: 'Docs server',
  kind: 'down',
  severity: null,
  changes: [],
  resolution: null,
  occurredAt: NOW,
};

export async function seedOutboxMessage(harness: Harness, id: string, endpointId: string): Promise<void> {
  const message: OutboxMessage = {
    id,
    incidentId: SAMPLE_ALERT.incidentId,
    endpointId,
    alert: SAMPLE_ALERT,
    idempotencyKey: `msg_${id}`,
    attempts: 0,
    nextAttemptAt: NOW,
    sentAt: null,
    lastError: null,
  };
  await harness.db.outbox.enqueue([message]);
}

export function catalogDescribing(description: string): RawCatalog {
  return {
    tools: [{ name: 'search', description, inputSchema: { type: 'object' } }],
    prompts: [],
    resources: [],
  };
}

export const NEVER_SEEN_HASH = 'never-seen' as SnapshotHash;

// Hashes of the snapshots the monitor's up probes recorded, oldest first.
export function probedHashes(harness: Harness): SnapshotHash[] {
  return [...harness.db.probes.records.values()]
    .sort((left, right) => left.slot - right.slot)
    .map((probe) => {
      if (probe.snapshotHash === null) throw new Error(`probe in slot ${String(probe.slot)} recorded no snapshot`);
      return probe.snapshotHash;
    });
}

export function upInspection(catalog: RawCatalog): Inspection {
  return { outcome: 'up', latencyMs: 40, serverName: 'docs', serverVersion: '1.0.0', catalog, errorDetail: null };
}

export function failedInspection(outcome: Exclude<Inspection['outcome'], 'up'>): Inspection {
  return { outcome, latencyMs: 10_000, serverName: null, serverVersion: null, catalog: null, errorDetail: outcome };
}
