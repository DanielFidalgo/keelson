import { newMonitor, newWebhookEndpoint, type Monitor, type RawCatalog, type WebhookEndpoint } from '@keelson/domain';
import {
  FakeInspector,
  FakeSecretStore,
  FixedClock,
  InMemoryUnitOfWork,
  RecordingProbeQueue,
  SequentialIds,
} from '../testing/index.js';
import type { Inspection } from '../ports.js';
import { DispatchDueProbes } from './dispatch-due-probes.js';
import { RunProbe } from './run-probe.js';

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
  const runProbeDeps = { unitOfWork, inspector, secrets, clock, ids };
  return {
    db: unitOfWork.transaction,
    unitOfWork,
    inspector,
    secrets,
    queue,
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

export function catalogDescribing(description: string): RawCatalog {
  return {
    tools: [{ name: 'search', description, inputSchema: { type: 'object' } }],
    prompts: [],
    resources: [],
  };
}

export function upInspection(catalog: RawCatalog): Inspection {
  return { outcome: 'up', latencyMs: 40, serverName: 'docs', serverVersion: '1.0.0', catalog, errorDetail: null };
}

export function failedInspection(outcome: Exclude<Inspection['outcome'], 'up'>): Inspection {
  return { outcome, latencyMs: 10_000, serverName: null, serverVersion: null, catalog: null, errorDetail: outcome };
}
