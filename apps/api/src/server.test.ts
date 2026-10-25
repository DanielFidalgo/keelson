import { MAX_PAGE_LIMIT, SEARCH_MAX_LENGTH } from '@keelson/application';
import { createSnapshot, MIN_PROBE_INTERVAL_SECONDS } from '@keelson/domain';
import { asValue } from 'awilix';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORIZED,
  AUTHORIZED_AS_OTHER_TENANT,
  CATALOG,
  EMPTY_CATALOG,
  INTERNAL_AUTHORIZED,
  MCP_URL,
  NOT_AN_MCP_SERVER,
  OTHER_TENANT_ID,
  seedDownIncident,
  seedDrift,
  seedDriftIncident,
  seedMonitor,
  seedProbeServing,
  startApi,
  UP,
  type TestApi,
} from './test-support.js';

const PROBLEM_JSON = 'application/problem+json';
const SERVER_ERROR = 500;

let started: TestApi | undefined;

afterEach(async () => {
  await started?.server.close();
  started = undefined;
});

async function api(): Promise<TestApi> {
  started = await startApi();
  return started;
}

const newMonitorBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Docs',
  url: MCP_URL,
  intervalSeconds: MIN_PROBE_INTERVAL_SECONDS,
  ...overrides,
});

async function registerMonitor(server: FastifyInstance, inspector: TestApi['inspector']): Promise<{ id: string }> {
  inspector.respondWith(UP);
  const response = await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: newMonitorBody() });
  return response.json<{ id: string }>();
}

describe('authentication', () => {
  it.each([
    ['GET', '/v1/monitors', undefined],
    ['POST', '/v1/monitors', newMonitorBody()],
    ['GET', '/v1/monitors/mon_1', undefined],
    ['GET', '/v1/incidents', undefined],
    ['GET', '/v1/webhook-endpoints', undefined],
  ] as const)('%s %s without a valid API key returns 401 problem+json', async (method, url, payload) => {
    const { server, unitOfWork, inspector } = await api();
    const request = { method, url, ...(payload === undefined ? {} : { payload }) };

    const missing = await server.inject(request);
    const wrong = await server.inject({ ...request, headers: { authorization: 'Bearer nope' } });

    for (const response of [missing, wrong]) {
      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(PROBLEM_JSON);
      expect(response.json()).toMatchObject({ status: 401, title: 'Unauthorized', detail: 'A valid API key is required.' });
      expect(response.headers['www-authenticate']).toBe('Bearer');
    }
    expect(inspector.targets).toEqual([]);
    expect(unitOfWork.transaction.monitors.records.size).toBe(0);
  });

  it('the internal token is not an API key', async () => {
    const { server } = await api();

    const response = await server.inject({ method: 'GET', url: '/v1/monitors', headers: INTERNAL_AUTHORIZED });

    expect(response.statusCode).toBe(401);
  });
});

describe('monitors', () => {
  it('POST /v1/monitors with interval 60 returns 400 listing the problem, without contacting the server', async () => {
    const { server, inspector } = await api();

    const response = await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: newMonitorBody({ intervalSeconds: 60 }) });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
    expect(response.json()).toMatchObject({
      status: 400,
      errors: [`intervalSeconds must be an integer of at least ${String(MIN_PROBE_INTERVAL_SECONDS)}`],
    });
    expect(inspector.targets).toEqual([]);
  });

  it('POST /v1/monitors with an empty body lists every missing field, not just the first', async () => {
    const { server } = await api();

    const response = await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: string[] }>().errors).toEqual([
      "body must have required property 'name'",
      "body must have required property 'url'",
      "body must have required property 'intervalSeconds'",
    ]);
  });

  it('POST /v1/monitors for a non-MCP URL returns 400 and stores nothing', async () => {
    const { server, inspector, unitOfWork } = await api();
    inspector.respondWith(NOT_AN_MCP_SERVER);

    const response = await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: newMonitorBody() });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: string[] }>().errors[0]).toContain('not an MCP server');
    expect(unitOfWork.transaction.monitors.records.size).toBe(0);
  });

  it('POST /v1/monitors returns 201 with the monitor; GET lists it; another tenant gets 404', async () => {
    const { server, inspector } = await api();
    inspector.respondWith(UP);

    const created = await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: newMonitorBody() });
    const { id } = created.json<{ id: string }>();
    const listed = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });
    const foreignGet = await server.inject({ method: 'GET', url: `/v1/monitors/${id}`, headers: AUTHORIZED_AS_OTHER_TENANT });
    const foreignList = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Docs',
      url: MCP_URL,
      intervalSeconds: 300,
      status: 'active',
      baselineHash: null,
      hasAuthSecret: false,
    });
    expect(listed.json()).toMatchObject({ items: [{ id }], nextCursor: null, total: 1 });
    expect(foreignGet.statusCode).toBe(404);
    expect(foreignGet.headers['content-type']).toContain(PROBLEM_JSON);
    expect(foreignList.json()).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(inspector.targets).toEqual([{ url: MCP_URL, bearerToken: null }]);
  });

  it('keeps the auth secret in the secret store and never returns it', async () => {
    const { server, inspector, secrets } = await api();
    inspector.respondWith(UP);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/monitors',
      headers: AUTHORIZED,
      payload: newMonitorBody({ authSecret: 'tok-private' }),
    });
    const { id } = response.json<{ id: string }>();
    const fetched = await server.inject({ method: 'GET', url: `/v1/monitors/${id}`, headers: AUTHORIZED });

    expect(response.statusCode).toBe(201);
    expect(inspector.targets[0]?.bearerToken).toBe('tok-private');
    expect(secrets.refs()).toHaveLength(1);
    expect(response.json()).toMatchObject({ hasAuthSecret: true });
    for (const body of [response.body, fetched.body]) {
      expect(body).not.toContain('tok-private');
      expect(body).not.toContain(secrets.refs()[0]);
    }
  });

  it('rejects fields the contract does not define instead of passing them on', async () => {
    const { server, inspector } = await api();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/monitors',
      headers: AUTHORIZED,
      payload: newMonitorBody({ tenantId: OTHER_TENANT_ID, id: 'chosen' }),
    });

    expect(response.statusCode).toBe(400);
    expect(inspector.targets).toEqual([]);
  });

  it('rejects an unknown page limit and accepts the largest allowed one', async () => {
    const { server } = await api();

    const tooMany = await server.inject({ method: 'GET', url: `/v1/monitors?limit=${String(MAX_PAGE_LIMIT + 1)}`, headers: AUTHORIZED });
    const largest = await server.inject({ method: 'GET', url: `/v1/monitors?limit=${String(MAX_PAGE_LIMIT)}`, headers: AUTHORIZED });

    expect(tooMany.statusCode).toBe(400);
    expect(largest.statusCode).toBe(200);
  });

  it('pages through monitors with nextCursor', async () => {
    const { server, unitOfWork } = await api();
    for (const id of ['mon_a', 'mon_b', 'mon_c']) await seedMonitor(unitOfWork, { id });

    const first = await server.inject({ method: 'GET', url: '/v1/monitors?limit=2', headers: AUTHORIZED });
    const { items: firstItems, nextCursor } = first.json<{ items: unknown[]; nextCursor: string }>();
    const second = await server.inject({ method: 'GET', url: `/v1/monitors?limit=2&cursor=${nextCursor}`, headers: AUTHORIZED });

    expect(firstItems).toHaveLength(2);
    expect(second.json()).toMatchObject({ items: [{}], nextCursor: null });
  });

  it('PATCH /v1/monitors/{id} changes only the fields sent', async () => {
    const { server, inspector } = await api();
    const { id } = await registerMonitor(server, inspector);

    const response = await server.inject({ method: 'PATCH', url: `/v1/monitors/${id}`, headers: AUTHORIZED, payload: { status: 'paused' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, name: 'Docs', intervalSeconds: 300, status: 'paused' });
  });

  it('PATCH /v1/monitors/{id} reports a rule the domain enforces as 400', async () => {
    const { server, inspector } = await api();
    const { id } = await registerMonitor(server, inspector);

    const response = await server.inject({ method: 'PATCH', url: `/v1/monitors/${id}`, headers: AUTHORIZED, payload: { intervalSeconds: 10 } });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: string[] }>().errors).toHaveLength(1);
  });

  it('PATCH /v1/monitors/{id} refuses a field outside the contract', async () => {
    const { server, inspector } = await api();
    const { id } = await registerMonitor(server, inspector);

    const response = await server.inject({ method: 'PATCH', url: `/v1/monitors/${id}`, headers: AUTHORIZED, payload: { tenantId: OTHER_TENANT_ID } });

    expect(response.statusCode).toBe(400);
  });

  it('DELETE /v1/monitors/{id} returns 204, removes the monitor and its secret', async () => {
    const { server, inspector, secrets } = await api();
    inspector.respondWith(UP);
    const created = await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: newMonitorBody({ authSecret: 'tok' }) });
    const { id } = created.json<{ id: string }>();

    const deleted = await server.inject({ method: 'DELETE', url: `/v1/monitors/${id}`, headers: AUTHORIZED });
    const afterwards = await server.inject({ method: 'GET', url: `/v1/monitors/${id}`, headers: AUTHORIZED });

    expect(deleted.statusCode).toBe(204);
    expect(afterwards.statusCode).toBe(404);
    expect(secrets.refs()).toEqual([]);
  });

  it('a foreign tenant cannot delete the monitor', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({ method: 'DELETE', url: '/v1/monitors/mon_1', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(response.statusCode).toBe(404);
    expect(unitOfWork.transaction.monitors.records.size).toBe(1);
  });
});

describe('probes, snapshots and baseline', () => {
  it('GET /v1/monitors/{id}/probes lists the probes of a monitor', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    const snapshot = await seedProbeServing(unitOfWork, 'mon_1', CATALOG);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/probes', headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ outcome: 'up', latencyMs: 40, serverName: 'docs', snapshotHash: snapshot.hash }],
      nextCursor: null,
      total: 1,
    });
  });

  it('GET /v1/monitors/{id}/probes is 404 for another tenant', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/probes', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(response.statusCode).toBe(404);
  });

  it('GET /v1/monitors/{id}/snapshots/{hash} returns the catalog the monitor served', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    const snapshot = await seedProbeServing(unitOfWork, 'mon_1', CATALOG);

    const response = await server.inject({ method: 'GET', url: `/v1/monitors/mon_1/snapshots/${snapshot.hash}`, headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      hash: snapshot.hash,
      catalog: { tools: [{ name: 'search', description: 'Searches the docs', inputSchema: { type: 'object' } }], prompts: [], resources: [] },
    });
  });

  it('GET /v1/monitors/{id}/snapshots/{hash} is 404 for a snapshot the monitor never served', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    const { hash } = createSnapshot(CATALOG);

    const response = await server.inject({ method: 'GET', url: `/v1/monitors/mon_1/snapshots/${hash}`, headers: AUTHORIZED });

    expect(response.statusCode).toBe(404);
  });

  it('GET /v1/monitors/{id}/snapshots/{hash} is 400 for a hash that is not 64 lowercase hex characters', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/snapshots/NOT-A-HASH', headers: AUTHORIZED });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: string[] }>().errors).toEqual(['snapshot hash must be 64 lowercase hex characters']);
  });

  it('GET /v1/monitors/{id}/drift is null without a baseline', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/drift', headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ drift: null });
  });

  it('GET /v1/monitors/{id}/drift lists what changed since the baseline', async () => {
    const { server, unitOfWork } = await api();
    const monitor = await seedMonitor(unitOfWork);
    const baseline = await seedProbeServing(unitOfWork, monitor.id, CATALOG);
    await unitOfWork.transaction.monitors.save({ ...monitor, baselineHash: baseline.hash });
    const current = await seedProbeServing(unitOfWork, monitor.id, EMPTY_CATALOG);

    const response = await server.inject({ method: 'GET', url: `/v1/monitors/${monitor.id}/drift`, headers: AUTHORIZED });

    expect(response.json()).toEqual({
      drift: {
        fromHash: baseline.hash,
        toHash: current.hash,
        changes: [{ kind: 'tool_removed', name: 'search', severity: 'critical' }],
      },
    });
  });

  it('POST /v1/monitors/{id}/baseline approves a snapshot the monitor served', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    const snapshot = await seedProbeServing(unitOfWork, 'mon_1', CATALOG);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/monitors/mon_1/baseline',
      headers: AUTHORIZED,
      payload: { snapshotHash: snapshot.hash },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'mon_1', baselineHash: snapshot.hash });
  });

  it('POST /v1/monitors/{id}/baseline with an unknown hash returns 404', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/monitors/mon_1/baseline',
      headers: AUTHORIZED,
      payload: { snapshotHash: createSnapshot(CATALOG).hash },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });

  it('POST /v1/monitors/{id}/baseline with a malformed hash returns 400', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/monitors/mon_1/baseline',
      headers: AUTHORIZED,
      payload: { snapshotHash: 'abc' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('incidents', () => {
  it('GET /v1/incidents lists incidents on the tenant monitors and filters by state', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDriftIncident(unitOfWork, 'mon_1');

    const open = await server.inject({ method: 'GET', url: '/v1/incidents?state=open', headers: AUTHORIZED });
    const resolved = await server.inject({ method: 'GET', url: '/v1/incidents?state=resolved', headers: AUTHORIZED });
    const foreign = await server.inject({ method: 'GET', url: '/v1/incidents', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(open.json()).toMatchObject({ items: [{ id: 'inc_1', kind: 'drift', state: 'open', acknowledgedAt: null }] });
    expect(resolved.json()).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(foreign.json()).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('GET /v1/incidents rejects a state it does not know', async () => {
    const { server } = await api();

    const response = await server.inject({ method: 'GET', url: '/v1/incidents?state=maybe', headers: AUTHORIZED });

    expect(response.statusCode).toBe(400);
  });

  it('POST /v1/incidents/{id}/acknowledge marks the incident as seen', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDriftIncident(unitOfWork, 'mon_1');

    const response = await server.inject({ method: 'POST', url: '/v1/incidents/inc_1/acknowledge', headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ acknowledgedAt: string }>().acknowledgedAt).toBe('2026-10-22T12:00:00.000Z');
  });

  it('POST /v1/incidents/{id}/acknowledge is 404 for another tenant', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDriftIncident(unitOfWork, 'mon_1');

    const response = await server.inject({ method: 'POST', url: '/v1/incidents/inc_1/acknowledge', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(response.statusCode).toBe(404);
  });
});

describe('webhook endpoints', () => {
  const standardEndpoint = { url: 'https://hooks.example.com/keelson', format: 'standard' };

  it('POST /v1/webhook-endpoints returns the signing secret once; GET never includes it', async () => {
    const { server, secrets } = await api();

    const created = await server.inject({ method: 'POST', url: '/v1/webhook-endpoints', headers: AUTHORIZED, payload: standardEndpoint });
    const { id, signingSecret } = created.json<{ id: string; signingSecret: string }>();
    const fetched = await server.inject({ method: 'GET', url: `/v1/webhook-endpoints/${id}`, headers: AUTHORIZED });
    const listed = await server.inject({ method: 'GET', url: '/v1/webhook-endpoints', headers: AUTHORIZED });

    expect(created.statusCode).toBe(201);
    expect(signingSecret).toMatch(/^whsec_/);
    expect(created.json()).toMatchObject({ url: standardEndpoint.url, format: 'standard', status: 'active' });
    for (const response of [fetched, listed]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(signingSecret);
      expect(response.body).not.toContain('signingSecret');
      expect(response.body).not.toContain(secrets.refs()[0]);
    }
    expect(listed.json()).toMatchObject({ items: [{ id }], nextCursor: null, total: 1 });
  });

  it('a slack endpoint has no signing secret', async () => {
    const { server } = await api();

    const created = await server.inject({
      method: 'POST',
      url: '/v1/webhook-endpoints',
      headers: AUTHORIZED,
      payload: { url: 'https://hooks.slack.com/services/T/B/x', format: 'slack' },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ format: 'slack', signingSecret: null });
  });

  it('rejects a webhook URL the domain refuses, storing no secret', async () => {
    const { server, secrets } = await api();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhook-endpoints',
      headers: AUTHORIZED,
      payload: { url: 'ftp://hooks.example.com', format: 'standard' },
    });

    expect(response.statusCode).toBe(400);
    expect(secrets.refs()).toEqual([]);
  });

  it('PATCH disables and DELETE removes an endpoint, and another tenant cannot see it', async () => {
    const { server, secrets } = await api();
    const created = await server.inject({ method: 'POST', url: '/v1/webhook-endpoints', headers: AUTHORIZED, payload: standardEndpoint });
    const { id } = created.json<{ id: string }>();

    const foreign = await server.inject({ method: 'GET', url: `/v1/webhook-endpoints/${id}`, headers: AUTHORIZED_AS_OTHER_TENANT });
    const patched = await server.inject({
      method: 'PATCH',
      url: `/v1/webhook-endpoints/${id}`,
      headers: AUTHORIZED,
      payload: { status: 'disabled' },
    });
    const deleted = await server.inject({ method: 'DELETE', url: `/v1/webhook-endpoints/${id}`, headers: AUTHORIZED });
    const afterwards = await server.inject({ method: 'GET', url: `/v1/webhook-endpoints/${id}`, headers: AUTHORIZED });

    expect(foreign.statusCode).toBe(404);
    expect(patched.json()).toMatchObject({ id, status: 'disabled', url: standardEndpoint.url });
    expect(deleted.statusCode).toBe(204);
    expect(afterwards.statusCode).toBe(404);
    expect(secrets.refs()).toEqual([]);
  });

  it('refuses an unknown format', async () => {
    const { server } = await api();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhook-endpoints',
      headers: AUTHORIZED,
      payload: { url: 'https://hooks.example.com', format: 'pagerduty' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('documentation and health', () => {
  it('GET /reference serves the Scalar page and GET /openapi.yaml serves the document', async () => {
    const { server } = await api();

    // The Scalar plugin serves its page under a trailing slash and redirects the bare path there.
    const redirect = await server.inject({ method: 'GET', url: '/reference' });
    const reference = await server.inject({ method: 'GET', url: redirect.headers.location as string });
    const document = await server.inject({ method: 'GET', url: '/openapi.yaml' });

    expect(redirect.headers.location).toBe('/reference/');
    expect(reference.statusCode).toBe(200);
    expect(reference.headers['content-type']).toContain('text/html');
    expect(reference.body).toContain('/openapi.yaml');
    expect(document.statusCode).toBe(200);
    expect(document.headers['content-type']).toContain('yaml');
    expect(document.body).toMatch(/^openapi: 3\.1\.0/);
  });

  it('GET /health needs no credentials', async () => {
    const { server } = await api();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
  });

  it('answers an unknown route with problem+json', async () => {
    const { server } = await api();

    const response = await server.inject({ method: 'GET', url: '/v2/anything', headers: AUTHORIZED });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });
});

describe('POST /internal/dispatch', () => {
  it('returns 401 without an internal token, and does nothing', async () => {
    const { server, unitOfWork, queue } = await api();
    await seedMonitor(unitOfWork);

    const missing = await server.inject({ method: 'POST', url: '/internal/dispatch' });
    const wrong = await server.inject({ method: 'POST', url: '/internal/dispatch', headers: { authorization: 'Bearer wrong' } });
    const apiKey = await server.inject({ method: 'POST', url: '/internal/dispatch', headers: AUTHORIZED });

    expect([missing.statusCode, wrong.statusCode, apiKey.statusCode]).toEqual([401, 401, 401]);
    expect(queue.jobs).toEqual([]);
  });

  it('with an internal token enqueues the due probes and returns { dispatched }', async () => {
    const { server, unitOfWork, queue } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({ method: 'POST', url: '/internal/dispatch', headers: INTERNAL_AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ dispatched: 1 });
    expect(queue.jobs).toMatchObject([{ monitorId: 'mon_1' }]);
  });
});

describe('failures', () => {
  it('answers a failed API key lookup with a server error, not with 401', async () => {
    const { server, container } = await api();
    container.register({ unitOfWork: asValue({ run: () => Promise.reject(new Error('connection refused to db.internal')) }) });

    const response = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });

    expect(response.statusCode).toBe(SERVER_ERROR);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
    expect(response.body).not.toContain('db.internal');
  });

  it('answers malformed JSON with 400 problem+json', async () => {
    const { server } = await api();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/monitors',
      headers: { ...AUTHORIZED, 'content-type': 'application/json' },
      payload: '{"name":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });
});

describe('tenant scope', () => {
  it('a monitor of one tenant never appears in the list of the other', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork, { id: 'mon_other', tenantId: OTHER_TENANT_ID });

    const mine = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });
    const theirs = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(mine.json()).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(theirs.json()).toMatchObject({ items: [{ id: 'mon_other' }] });
  });
});

describe('monitor read models', () => {
  const ids = (response: { json: () => { items: { id: string }[] } }) => response.json().items.map((item) => item.id);

  it('existing clients still work: listMonitors without new parameters returns every monitor with its summary', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork, { id: 'mon_a' });
    await seedMonitor(unitOfWork, { id: 'mon_b', name: 'Search' });
    await seedProbeServing(unitOfWork, 'mon_a', CATALOG);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        { id: 'mon_b', summary: { health: 'pending', latestProbe: null, recentLatenciesMs: [], toolCount: null, openIncident: null } },
        { id: 'mon_a', name: 'Docs', url: MCP_URL, status: 'active', hasAuthSecret: false },
      ],
      nextCursor: null,
      total: 2,
    });
  });

  it('each item carries the monitor summary: latest probe, recent latencies and open incident', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedProbeServing(unitOfWork, 'mon_1', CATALOG);
    await seedDrift(unitOfWork, 'mon_1', 'warning');
    await seedDriftIncident(unitOfWork, 'mon_1', 'drift_1');

    const response = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });

    expect(response.json<{ items: unknown[] }>().items[0]).toMatchObject({
      summary: {
        health: 'drift',
        latestProbe: { outcome: 'up', startedAt: '2026-10-22T12:00:00.000Z', latencyMs: 40 },
        recentLatenciesMs: [40],
        toolCount: null,
        openIncident: { id: 'inc_1', kind: 'drift', severity: 'warning' },
      },
    });
  });

  it('GET /v1/monitors?health= keeps only monitors in that health', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork, { id: 'mon_a' });
    await seedMonitor(unitOfWork, { id: 'mon_b' });
    await seedDriftIncident(unitOfWork, 'mon_b');

    const drifted = await server.inject({ method: 'GET', url: '/v1/monitors?health=drift', headers: AUTHORIZED });
    const down = await server.inject({ method: 'GET', url: '/v1/monitors?health=down', headers: AUTHORIZED });

    expect(ids(drifted)).toEqual(['mon_b']);
    expect(drifted.json()).toMatchObject({ total: 1 });
    expect(down.json()).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('GET /v1/monitors?q= matches the name or the URL, ignoring case', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork, { id: 'mon_a', name: 'Search Service' });
    await seedMonitor(unitOfWork, { id: 'mon_b', name: 'Docs' });

    const byName = await server.inject({ method: 'GET', url: '/v1/monitors?q=SEARCH', headers: AUTHORIZED });
    const byUrl = await server.inject({ method: 'GET', url: '/v1/monitors?q=MCP.EXAMPLE', headers: AUTHORIZED });
    const none = await server.inject({ method: 'GET', url: '/v1/monitors?q=nothing', headers: AUTHORIZED });

    expect(ids(byName)).toEqual(['mon_a']);
    expect(ids(byUrl)).toHaveLength(2);
    expect(none.json()).toMatchObject({ items: [], total: 0 });
  });

  it('total counts every monitor the filters match, not only the page', async () => {
    const { server, unitOfWork } = await api();
    for (const id of ['mon_a', 'mon_b', 'mon_c']) await seedMonitor(unitOfWork, { id });

    const response = await server.inject({ method: 'GET', url: '/v1/monitors?limit=1', headers: AUTHORIZED });

    expect(response.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(response.json()).toMatchObject({ total: 3 });
  });

  it('GET /v1/monitors rejects a health it does not know, as problem+json', async () => {
    const { server } = await api();

    const response = await server.inject({ method: 'GET', url: '/v1/monitors?health=bogus', headers: AUTHORIZED });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });

  it('GET /v1/monitors rejects a search longer than the limit and accepts one of exactly that length', async () => {
    const { server } = await api();

    const tooLong = await server.inject({ method: 'GET', url: `/v1/monitors?q=${'a'.repeat(SEARCH_MAX_LENGTH + 1)}`, headers: AUTHORIZED });
    const longest = await server.inject({ method: 'GET', url: `/v1/monitors?q=${'a'.repeat(SEARCH_MAX_LENGTH)}`, headers: AUTHORIZED });

    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.headers['content-type']).toContain(PROBLEM_JSON);
    expect(longest.statusCode).toBe(200);
  });

  it('GET /v1/monitors/{id} returns the same summary as a list item', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedProbeServing(unitOfWork, 'mon_1', CATALOG);

    const detail = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1', headers: AUTHORIZED });
    const listed = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: 'mon_1', summary: { health: 'up', latestProbe: { outcome: 'up' } } });
    expect(detail.json()).toEqual(listed.json<{ items: unknown[] }>().items[0]);
  });

  it("another tenant's monitor stats and summary are 404", async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const summary = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1', headers: AUTHORIZED_AS_OTHER_TENANT });
    const stats = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/stats', headers: AUTHORIZED_AS_OTHER_TENANT });

    for (const response of [summary, stats]) {
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(PROBLEM_JSON);
    }
  });

  it('GET /v1/monitors/health-counts is not captured by /v1/monitors/{monitorId}', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork, { id: 'mon_a' });
    await seedMonitor(unitOfWork, { id: 'mon_b' });
    await seedDriftIncident(unitOfWork, 'mon_b');

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/health-counts', headers: AUTHORIZED });
    const foreign = await server.inject({ method: 'GET', url: '/v1/monitors/health-counts', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ total: 2, up: 0, drift: 1, down: 0, paused: 0, pending: 1 });
    expect(foreign.json()).toEqual({ total: 0, up: 0, drift: 0, down: 0, paused: 0, pending: 0 });
  });

  it('GET /v1/monitors/{id}/stats reports uptime and p95 over the last 24 hours', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedProbeServing(unitOfWork, 'mon_1', CATALOG);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/stats', headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ windowHours: 24, probes: 1, uptimeRatio: 1, p95LatencyMs: 40 });
  });

  it('GET /v1/monitors/{id}/stats has null ratios when there were no probes', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);

    const response = await server.inject({ method: 'GET', url: '/v1/monitors/mon_1/stats', headers: AUTHORIZED });

    expect(response.json()).toEqual({ windowHours: 24, probes: 0, uptimeRatio: null, p95LatencyMs: null });
  });

  it('keeps the secret reference out of the summaries', async () => {
    const { server, inspector, secrets } = await api();
    inspector.respondWith(UP);
    await server.inject({ method: 'POST', url: '/v1/monitors', headers: AUTHORIZED, payload: newMonitorBody({ authSecret: 'token-1' }) });

    const listed = await server.inject({ method: 'GET', url: '/v1/monitors', headers: AUTHORIZED });
    const detail = await server.inject({ method: 'GET', url: `/v1/monitors/${listed.json<{ items: { id: string }[] }>().items[0]?.id ?? ''}`, headers: AUTHORIZED });

    for (const response of [listed, detail]) {
      expect(response.body).toContain('"hasAuthSecret":true');
      expect(response.body).not.toContain(secrets.refs()[0]);
      expect(response.body).not.toContain('authSecretRef');
    }
  });
});

describe('incident read models', () => {
  it('GET /v1/incidents items carry the monitor name and the severity of the last drift, and a total', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDrift(unitOfWork, 'mon_1', 'critical');
    await seedDriftIncident(unitOfWork, 'mon_1', 'drift_1');
    await seedDownIncident(unitOfWork, 'mon_1');

    const response = await server.inject({ method: 'GET', url: '/v1/incidents', headers: AUTHORIZED });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: { id: string }[] }>().items).toHaveLength(2);
    expect(response.json()).toMatchObject({ total: 2 });
    expect(response.json<{ items: unknown[] }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'inc_1', kind: 'drift', monitorName: 'Docs', severity: 'critical' }),
        expect.objectContaining({ id: 'inc_down', kind: 'down', monitorName: 'Docs', severity: null }),
      ]),
    );
  });

  it('GET /v1/incidents?kind= keeps only incidents of that kind', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDriftIncident(unitOfWork, 'mon_1');
    await seedDownIncident(unitOfWork, 'mon_1');

    const down = await server.inject({ method: 'GET', url: '/v1/incidents?kind=down', headers: AUTHORIZED });

    expect(down.json()).toMatchObject({ items: [{ id: 'inc_down' }], total: 1 });
  });

  it('GET /v1/incidents?acknowledged= separates acknowledged from unacknowledged incidents', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDriftIncident(unitOfWork, 'mon_1');
    await seedDownIncident(unitOfWork, 'mon_1');
    await server.inject({ method: 'POST', url: '/v1/incidents/inc_1/acknowledge', headers: AUTHORIZED });

    const acknowledged = await server.inject({ method: 'GET', url: '/v1/incidents?state=open&acknowledged=true', headers: AUTHORIZED });
    const waiting = await server.inject({ method: 'GET', url: '/v1/incidents?state=open&acknowledged=false', headers: AUTHORIZED });

    expect(acknowledged.json()).toMatchObject({ items: [{ id: 'inc_1' }], total: 1 });
    expect(waiting.json()).toMatchObject({ items: [{ id: 'inc_down' }], total: 1 });
  });

  it.each(['kind=bogus', 'acknowledged=maybe'])('GET /v1/incidents?%s is 400 problem+json', async (query) => {
    const { server } = await api();

    const response = await server.inject({ method: 'GET', url: `/v1/incidents?${query}`, headers: AUTHORIZED });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain(PROBLEM_JSON);
  });

  it('GET /v1/incidents/counts counts the tenant incidents by state and kind', async () => {
    const { server, unitOfWork } = await api();
    await seedMonitor(unitOfWork);
    await seedDriftIncident(unitOfWork, 'mon_1');
    await seedDownIncident(unitOfWork, 'mon_1');
    await server.inject({ method: 'POST', url: '/v1/incidents/inc_1/acknowledge', headers: AUTHORIZED });

    const response = await server.inject({ method: 'GET', url: '/v1/incidents/counts', headers: AUTHORIZED });
    const foreign = await server.inject({ method: 'GET', url: '/v1/incidents/counts', headers: AUTHORIZED_AS_OTHER_TENANT });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ open: 1, acknowledged: 1, resolved: 0, drift: 1, down: 1 });
    expect(foreign.json()).toEqual({ open: 0, acknowledged: 0, resolved: 0, drift: 0, down: 0 });
  });
});
