import { createSnapshot, newMonitor, openIncident, type Incident, type Monitor, type Probe, type RawCatalog, type Snapshot } from '@keelson/domain';
import type { Inspection } from '@keelson/application';
import {
  FakeCredentialFactory,
  FakeInspector,
  FakeSecretStore,
  FixedClock,
  InMemoryUnitOfWork,
  RecordingProbeQueue,
  SequentialIds,
} from '@keelson/application/testing';
import { createLoggerOptions } from '@keelson/infrastructure';
import { asValue } from 'awilix';
import type { FastifyInstance } from 'fastify';
import { loadApiConfig } from './config.js';
import { createApiContainer } from './container.js';
import { buildApiServer } from './server.js';

export const INTERNAL_TOKEN = 'test-internal-token';
export const NOW = new Date('2026-10-22T12:00:00Z');
export const TENANT_ID = 'ten_1';
export const OTHER_TENANT_ID = 'ten_2';
export const MCP_URL = 'https://mcp.example.com/mcp';

const API_KEY = 'key_1';
const OTHER_API_KEY = 'key_2';

export const authorizedAs = (key: string) => ({ authorization: `Bearer ${key}` });
export const AUTHORIZED = authorizedAs(API_KEY);
export const AUTHORIZED_AS_OTHER_TENANT = authorizedAs(OTHER_API_KEY);
export const INTERNAL_AUTHORIZED = authorizedAs(INTERNAL_TOKEN);

export const CATALOG: RawCatalog = {
  tools: [{ name: 'search', description: 'Searches the docs', inputSchema: { type: 'object' } }],
  prompts: [],
  resources: [],
};
export const EMPTY_CATALOG: RawCatalog = { tools: [], prompts: [], resources: [] };

export const UP: Inspection = { outcome: 'up', latencyMs: 40, serverName: 'docs', serverVersion: '1.0.0', catalog: CATALOG, errorDetail: null };
export const NOT_AN_MCP_SERVER: Inspection = {
  outcome: 'protocol_error',
  latencyMs: 12,
  serverName: null,
  serverVersion: null,
  catalog: null,
  errorDetail: 'not json-rpc',
};

const ENVIRONMENT = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  WORKER_URL: 'http://worker.internal:8080',
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: INTERNAL_TOKEN,
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
};

export interface TestApi {
  server: FastifyInstance;
  container: ReturnType<typeof createApiContainer>;
  unitOfWork: InMemoryUnitOfWork;
  inspector: FakeInspector;
  queue: RecordingProbeQueue;
  secrets: FakeSecretStore;
}

// Everything that would reach the network or a database is replaced by an in-memory double.
export async function startApi(): Promise<TestApi> {
  const container = createApiContainer(loadApiConfig(ENVIRONMENT));
  const unitOfWork = new InMemoryUnitOfWork();
  const inspector = new FakeInspector();
  const queue = new RecordingProbeQueue();
  const secrets = new FakeSecretStore();
  const credentials = new FakeCredentialFactory();
  container.register({
    clock: asValue(new FixedClock(NOW)),
    ids: asValue(new SequentialIds()),
    unitOfWork: asValue(unitOfWork),
    inspector: asValue(inspector),
    queue: asValue(queue),
    secrets: asValue(secrets),
    credentials: asValue(credentials),
    loggerOptions: asValue({ ...createLoggerOptions(), level: 'silent' }),
  });
  const { apiKeys } = unitOfWork.transaction;
  await apiKeys.insert({ id: 'key_row_1', tenantId: TENANT_ID, keyHash: credentials.hashApiKey(API_KEY), createdAt: NOW });
  await apiKeys.insert({ id: 'key_row_2', tenantId: OTHER_TENANT_ID, keyHash: credentials.hashApiKey(OTHER_API_KEY), createdAt: NOW });
  return { server: buildApiServer(container), container, unitOfWork, inspector, queue, secrets };
}

export async function seedMonitor(unitOfWork: InMemoryUnitOfWork, overrides: { id?: string; tenantId?: string; name?: string } = {}): Promise<Monitor> {
  const monitor = newMonitor(
    { id: 'mon_1', tenantId: TENANT_ID, name: 'Docs', url: MCP_URL, intervalSeconds: 300, authSecretRef: null, ...overrides },
    NOW,
  );
  await unitOfWork.transaction.monitors.save(monitor);
  return monitor;
}

// A probe that served `catalog`, with the snapshot stored the way RunProbe would have stored it.
export async function seedProbeServing(unitOfWork: InMemoryUnitOfWork, monitorId: string, catalog: RawCatalog): Promise<Snapshot> {
  const snapshot = createSnapshot(catalog);
  await unitOfWork.transaction.snapshots.saveIfAbsent(snapshot);
  // The slot only has to be unique per monitor, and probes are seeded one at a time.
  const slot = unitOfWork.transaction.probes.records.size + 1;
  const probe: Probe = {
    id: `probe_${String(slot)}`,
    monitorId,
    slot,
    startedAt: NOW,
    latencyMs: 40,
    outcome: 'up',
    errorDetail: null,
    serverName: 'docs',
    serverVersion: '1.0.0',
    snapshotHash: snapshot.hash,
  };
  await unitOfWork.transaction.probes.insertIfAbsent(probe);
  return snapshot;
}

export async function seedDriftIncident(unitOfWork: InMemoryUnitOfWork, monitorId: string): Promise<Incident> {
  const incident = openIncident({ id: 'inc_1', monitorId, kind: 'drift', lastDriftId: null }, NOW);
  await unitOfWork.transaction.incidents.save(incident);
  return incident;
}
