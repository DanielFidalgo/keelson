import {
  computeChanges,
  type Change,
  type Incident,
  type Monitor,
  type Probe,
  type Snapshot,
  type SnapshotHash,
  type WebhookEndpoint,
} from '@keelson/domain';
import { NotFoundError } from './errors.js';
import { requireOwned } from './ownership.js';
import type { Page, PageRequest, Transaction } from './ports.js';

export interface MonitorQuery {
  tenantId: string;
  monitorId: string;
}

export interface CurrentDrift {
  fromHash: SnapshotHash;
  toHash: SnapshotHash;
  changes: Change[];
}

export function listMonitors(tx: Transaction, input: { tenantId: string; page: PageRequest }): Promise<Page<Monitor>> {
  return tx.monitors.listForTenant(input.tenantId, input.page);
}

export async function getMonitor(tx: Transaction, { tenantId, monitorId }: MonitorQuery): Promise<Monitor> {
  return requireOwned(await tx.monitors.get(monitorId), tenantId, 'monitor');
}

export async function listProbes(tx: Transaction, input: MonitorQuery & { page: PageRequest }): Promise<Page<Probe>> {
  await getMonitor(tx, input);
  return tx.probes.listForMonitor(input.monitorId, input.page);
}

export async function getSnapshot(
  tx: Transaction,
  input: MonitorQuery & { snapshotHash: SnapshotHash },
): Promise<Snapshot> {
  await getMonitor(tx, input);
  // Snapshots are shared across tenants by hash, so reading one is allowed only for a monitor that served it.
  const snapshot = (await tx.probes.monitorHasSnapshot(input.monitorId, input.snapshotHash))
    ? await tx.snapshots.get(input.snapshotHash)
    : null;
  if (snapshot === null) throw new NotFoundError('snapshot not found');
  return snapshot;
}

export async function getCurrentDrift(tx: Transaction, input: MonitorQuery): Promise<CurrentDrift | null> {
  const monitor = await getMonitor(tx, input);
  const latest = await tx.probes.latestUp(monitor.id);
  const fromHash = monitor.baselineHash;
  const toHash = latest?.snapshotHash ?? null;
  if (fromHash === null || toHash === null || fromHash === toHash) return null;

  const baseline = await requiredSnapshot(tx, fromHash);
  const current = await requiredSnapshot(tx, toHash);
  return { fromHash, toHash, changes: computeChanges(baseline.catalog, current.catalog) };
}

export function listIncidents(
  tx: Transaction,
  input: { tenantId: string; state: Incident['state'] | null; page: PageRequest },
): Promise<Page<Incident>> {
  return tx.incidents.listForTenant(input.tenantId, { state: input.state }, input.page);
}

export function listWebhookEndpoints(
  tx: Transaction,
  input: { tenantId: string; page: PageRequest },
): Promise<Page<WebhookEndpoint>> {
  return tx.webhookEndpoints.listForTenant(input.tenantId, input.page);
}

export async function getWebhookEndpoint(
  tx: Transaction,
  input: { tenantId: string; endpointId: string },
): Promise<WebhookEndpoint> {
  return requireOwned(await tx.webhookEndpoints.get(input.endpointId), input.tenantId, 'webhook endpoint');
}

async function requiredSnapshot(tx: Transaction, hash: SnapshotHash): Promise<Snapshot> {
  const snapshot = await tx.snapshots.get(hash);
  if (snapshot === null) throw new Error(`invariant broken: snapshot ${hash} is missing`);
  return snapshot;
}
