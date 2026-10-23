import type { Alert, RawCatalog, WebhookFormat } from '@keelson/domain';
import { newMonitor, newWebhookEndpoint } from '@keelson/domain';
import type { Inspection } from '@keelson/application';
import {
  FakeInspector,
  FakeSecretStore,
  FixedClock,
  InMemoryUnitOfWork,
  RecordingAlertChannel,
  SequentialIds,
} from '@keelson/application/testing';
import { createLoggerOptions } from '@keelson/infrastructure';
import { asValue } from 'awilix';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './config.js';
import { createWorkerContainer } from './container.js';
import { buildWorkerServer } from './server.js';

const INTERNAL_TOKEN = 'test-internal-token';
const AUTHORIZED = { authorization: `Bearer ${INTERNAL_TOKEN}` };
const NOW = new Date('2026-10-22T12:00:00Z');
const MONITOR_ID = 'mon_1';
const SECRET_BEARER_TOKEN = 'super-secret-bearer-token';
const CATALOG: RawCatalog = {
  tools: [{ name: 'search', description: 'Searches the docs', inputSchema: { type: 'object' } }],
  prompts: [],
  resources: [],
};
const UP: Inspection = { outcome: 'up', latencyMs: 40, serverName: 'docs', serverVersion: '1.0.0', catalog: CATALOG, errorDetail: null };

const ENVIRONMENT = {
  DATABASE_URL: 'postgres://keelson@localhost/keelson',
  INTERNAL_AUTH_MODE: 'static',
  INTERNAL_STATIC_TOKEN: INTERNAL_TOKEN,
  SECRET_STORE: 'file',
  SECRETS_DIR: '/var/keelson/secrets',
  GCP_PROJECT: 'keelson-test',
};

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function startWorker() {
  const container = createWorkerContainer(loadWorkerConfig(ENVIRONMENT));
  const unitOfWork = new InMemoryUnitOfWork();
  const inspector = new FakeInspector();
  const channels: Record<WebhookFormat, RecordingAlertChannel> = {
    standard: new RecordingAlertChannel(),
    slack: new RecordingAlertChannel(),
  };
  const logLines: string[] = [];
  container.register({
    clock: asValue(new FixedClock(NOW)),
    ids: asValue(new SequentialIds()),
    unitOfWork: asValue(unitOfWork),
    inspector: asValue(inspector),
    secrets: asValue(new FakeSecretStore()),
    channels: asValue(channels),
    loggerOptions: asValue({ ...createLoggerOptions(), stream: { write: (line: string) => void logLines.push(line) } }),
  });
  server = buildWorkerServer(container);
  const logged = () => logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { server, container, unitOfWork, inspector, channels, logLines, logged };
}

async function seedMonitor(unitOfWork: InMemoryUnitOfWork): Promise<void> {
  const monitor = newMonitor(
    { id: MONITOR_ID, tenantId: 'ten_1', name: 'Docs', url: 'https://mcp.example.com/mcp', intervalSeconds: 300, authSecretRef: null },
    NOW,
  );
  await unitOfWork.transaction.monitors.save(monitor);
}

const probeRequest = (headers: Record<string, string> = AUTHORIZED) => ({
  method: 'POST' as const,
  url: '/internal/probe',
  headers,
  payload: { monitorId: MONITOR_ID, slot: 7 },
});

const throwingUnitOfWork = { run: () => Promise.reject(new Error('connection refused to db.internal')) };

describe('worker server', () => {
  it.each([
    ['POST', '/internal/probe'],
    ['POST', '/internal/inspect'],
    ['POST', '/internal/outbox/drain'],
  ] as const)('internal routes return 401 without a valid internal token: %s %s', async (method, url) => {
    const { server: worker, unitOfWork, inspector } = startWorker();

    const missing = await worker.inject({ method, url, payload: {} });
    const wrong = await worker.inject({ method, url, headers: { authorization: 'Bearer wrong' }, payload: {} });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unitOfWork.transaction.probes.records.size).toBe(0);
    expect(inspector.targets).toEqual([]);
  });

  it('GET /healthz needs no credentials', async () => {
    const response = await startWorker().server.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
  });

  it('POST /internal/probe returns 204 and records the probe', async () => {
    const { server: worker, unitOfWork, inspector } = startWorker();
    await seedMonitor(unitOfWork);
    inspector.respondWith(UP);

    const response = await worker.inject(probeRequest());

    expect(response.statusCode).toBe(204);
    expect([...unitOfWork.transaction.probes.records.values()]).toMatchObject([{ monitorId: MONITOR_ID, slot: 7, outcome: 'up' }]);
  });

  it('POST /internal/probe rejects a malformed job with 400', async () => {
    const response = await startWorker().server.inject({ ...probeRequest(), payload: { monitorId: MONITOR_ID, slot: 'soon' } });

    expect(response.statusCode).toBe(400);
  });

  it('POST /internal/probe returns 500 when the unit of work throws, so Cloud Tasks retries', async () => {
    const { server: worker, container } = startWorker();
    container.register({ unitOfWork: asValue(throwingUnitOfWork) });

    const response = await worker.inject(probeRequest());

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('db.internal');
  });

  it('on the last retry (X-CloudTasks-TaskRetryCount = 4) a failure logs probe.retries_exhausted at error level', async () => {
    const { server: worker, container, logged } = startWorker();
    container.register({ unitOfWork: asValue(throwingUnitOfWork) });

    await worker.inject(probeRequest({ ...AUTHORIZED, 'x-cloudtasks-taskretrycount': '4' }));

    expect(logged()).toContainEqual(
      expect.objectContaining({ event: 'probe.retries_exhausted', severity: 'ERROR', monitorId: MONITOR_ID, slot: 7 }),
    );
  });

  it('before the last retry a failure does not claim the retries are exhausted', async () => {
    const { server: worker, container, logged } = startWorker();
    container.register({ unitOfWork: asValue(throwingUnitOfWork) });

    await worker.inject(probeRequest({ ...AUTHORIZED, 'x-cloudtasks-taskretrycount': '3' }));

    expect(logged().map((line) => line['event'])).not.toContain('probe.retries_exhausted');
  });

  it('POST /internal/inspect returns the inspection without writing', async () => {
    const { server: worker, unitOfWork, inspector } = startWorker();
    inspector.respondWith(UP);

    const response = await worker.inject({
      method: 'POST',
      url: '/internal/inspect',
      headers: AUTHORIZED,
      payload: { url: 'https://mcp.example.com/mcp', bearerToken: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(UP);
    expect(inspector.targets).toEqual([{ url: 'https://mcp.example.com/mcp', bearerToken: null }]);
    expect(unitOfWork.transaction.probes.records.size).toBe(0);
  });

  it('POST /internal/inspect rejects a body without a url with 400', async () => {
    const response = await startWorker().server.inject({
      method: 'POST',
      url: '/internal/inspect',
      headers: AUTHORIZED,
      payload: { bearerToken: null },
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /internal/outbox/drain returns { sent, failed }', async () => {
    const { server: worker, unitOfWork, channels } = startWorker();
    const endpoint = newWebhookEndpoint(
      { id: 'whk_1', tenantId: 'ten_1', url: 'https://hooks.example.com/1', format: 'slack', secretRef: null },
      NOW,
    );
    const alert: Alert = {
      type: 'incident.opened',
      incidentId: 'inc_1',
      monitorId: MONITOR_ID,
      monitorName: 'Docs',
      kind: 'down',
      severity: null,
      changes: [],
      resolution: null,
      occurredAt: NOW,
    };
    await unitOfWork.transaction.webhookEndpoints.save(endpoint);
    await unitOfWork.transaction.outbox.enqueue([
      { id: 'out_1', incidentId: 'inc_1', endpointId: 'whk_1', alert, idempotencyKey: 'msg_1', attempts: 0, nextAttemptAt: NOW, sentAt: null },
    ]);

    const response = await worker.inject({ method: 'POST', url: '/internal/outbox/drain', headers: AUTHORIZED });

    expect(response.json()).toEqual({ sent: 1, failed: 0 });
    expect(channels.slack.deliveries).toHaveLength(1);
  });

  it('never logs a request body or the credentials it carries', async () => {
    const { server: worker, inspector, logLines } = startWorker();
    inspector.respondWith(UP);

    await worker.inject({
      method: 'POST',
      url: '/internal/inspect',
      headers: AUTHORIZED,
      payload: { url: 'https://mcp.example.com/mcp', bearerToken: SECRET_BEARER_TOKEN },
    });

    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join('')).not.toContain(SECRET_BEARER_TOKEN);
    expect(logLines.join('')).not.toContain(INTERNAL_TOKEN);
  });

  it('links log lines to the Cloud Trace of the request', async () => {
    const { server: worker, logged } = startWorker();

    await worker.inject({ method: 'GET', url: '/healthz', headers: { 'x-cloud-trace-context': '105445aa7843bc8bf206b12000100000/1;o=1' } });

    expect(logged()).toContainEqual(
      expect.objectContaining({ 'logging.googleapis.com/trace': 'projects/keelson-test/traces/105445aa7843bc8bf206b12000100000' }),
    );
  });
});
