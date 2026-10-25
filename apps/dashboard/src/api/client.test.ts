import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from './client.js';

const API_KEY = 'key_secret_value';
const JSON_TYPE = { 'content-type': 'application/json' };
const PROBLEM_TYPE = { 'content-type': 'application/problem+json' };

const emptyPage = { items: [], nextCursor: null, total: 0 };

function respondingWith(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: JSON_TYPE, ...init })));
}

function clientOver(fetchStub: typeof fetch, overrides: { onUnauthorized?: () => void; apiKey?: () => string | null } = {}) {
  return createApiClient({ apiKey: () => API_KEY, onUnauthorized: () => undefined, fetch: fetchStub, ...overrides });
}

function lastRequest(fetchStub: ReturnType<typeof vi.fn<typeof fetch>>, call = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchStub.mock.calls[call] ?? [];
  // The client always requests by path, never with a Request or URL object.
  return { url: url as string, init: init ?? {} };
}

describe('createApiClient', () => {
  it('sends the key as a Bearer header and never puts it in the URL', async () => {
    const fetchStub = respondingWith(emptyPage);

    await clientOver(fetchStub).listMonitors({});

    const { url, init } = lastRequest(fetchStub);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(url).not.toContain(API_KEY);
  });

  it('surfaces a problem+json answer as an ApiError carrying the problem', async () => {
    const problem = { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'The request is not valid.', errors: ['limit must be integer'] };
    const fetchStub = respondingWith(problem, { status: 400, headers: PROBLEM_TYPE });

    const failure = await clientOver(fetchStub).getMonitor('mon_1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 400, message: 'The request is not valid.', problem });
  });

  it('reports an answer that is not problem+json with the status alone', async () => {
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })));

    const failure = await clientOver(fetchStub).getMonitor('mon_1').catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 502, message: 'The API answered 502.' });
  });

  it('tells the owner of the key when the API rejects it', async () => {
    const onUnauthorized = vi.fn();
    const problem = { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'A valid API key is required.' };
    const fetchStub = respondingWith(problem, { status: 401, headers: PROBLEM_TYPE });

    await clientOver(fetchStub, { onUnauthorized }).listMonitors({}).catch(() => undefined);

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not call the API without a key', async () => {
    const fetchStub = respondingWith(emptyPage);

    const failure = await clientOver(fetchStub, { apiKey: () => null }).listMonitors({}).catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 401 });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('sends the monitor filters, the cursor and the limit, and returns the page with its total', async () => {
    const page = { items: [], nextCursor: 'after_9', total: 42 };
    const fetchStub = respondingWith(page);

    const result = await clientOver(fetchStub).listMonitors({ health: 'drift', q: 'docs', cursor: 'after_1', limit: 10 });

    const query = new URL(lastRequest(fetchStub).url, 'http://localhost').searchParams;
    expect(Object.fromEntries(query)).toEqual({ health: 'drift', q: 'docs', cursor: 'after_1', limit: '10' });
    expect(result).toEqual(page);
  });

  it('leaves out filters that are unset or empty', async () => {
    const fetchStub = respondingWith(emptyPage);

    await clientOver(fetchStub).listMonitors({ health: null, q: '', cursor: null, limit: 20 });

    expect(lastRequest(fetchStub).url).toBe('/v1/monitors?limit=20');
  });

  it('sends the incident state, kind and acknowledged filters', async () => {
    const fetchStub = respondingWith({ ...emptyPage, total: 0 });

    await clientOver(fetchStub).listIncidents({ state: 'open', kind: 'down', acknowledged: false, limit: 20 });

    const query = new URL(lastRequest(fetchStub).url, 'http://localhost').searchParams;
    expect(Object.fromEntries(query)).toEqual({ state: 'open', kind: 'down', acknowledged: 'false', limit: '20' });
  });

  it('pages the probes of one monitor', async () => {
    const fetchStub = respondingWith({ ...emptyPage, total: 0 });

    await clientOver(fetchStub).listProbes('mon_1', { cursor: 'after_2', limit: 50 });

    expect(lastRequest(fetchStub).url).toBe('/v1/monitors/mon_1/probes?cursor=after_2&limit=50');
  });

  it.each([
    ['getHealthCounts', (client: ApiClient) => client.getHealthCounts(), '/v1/monitors/health-counts'],
    ['getIncidentCounts', (client: ApiClient) => client.getIncidentCounts(), '/v1/incidents/counts'],
    ['getMonitorStats', (client: ApiClient) => client.getMonitorStats('mon_1'), '/v1/monitors/mon_1/stats'],
    ['getSnapshot', (client: ApiClient) => client.getSnapshot('mon_1', 'abc'), '/v1/monitors/mon_1/snapshots/abc'],
    ['getDrift', (client: ApiClient) => client.getDrift('mon_1'), '/v1/monitors/mon_1/drift'],
    ['getMonitor', (client: ApiClient) => client.getMonitor('mon_1'), '/v1/monitors/mon_1'],
    ['getWebhookEndpoint', (client: ApiClient) => client.getWebhookEndpoint('whe_1'), '/v1/webhook-endpoints/whe_1'],
    ['listWebhookEndpoints', (client: ApiClient) => client.listWebhookEndpoints({}), '/v1/webhook-endpoints'],
  ])('%s reads its endpoint', async (_name, call, path) => {
    const fetchStub = respondingWith({});

    await call(clientOver(fetchStub));

    expect(lastRequest(fetchStub).url).toBe(path);
    expect(lastRequest(fetchStub).init.method).toBe('GET');
  });

  it('creates a monitor by posting the request as JSON', async () => {
    const fetchStub = respondingWith({ id: 'mon_1' }, { status: 201 });
    const request = { name: 'Docs', url: 'https://mcp.example.com/mcp', intervalSeconds: 900 };

    await clientOver(fetchStub).createMonitor(request);

    const { url, init } = lastRequest(fetchStub);
    expect([url, init.method, init.body]).toEqual(['/v1/monitors', 'POST', JSON.stringify(request)]);
  });

  it('updates a monitor with PATCH, sending a null token to clear it', async () => {
    const fetchStub = respondingWith({ id: 'mon_1' });

    await clientOver(fetchStub).updateMonitor('mon_1', { authSecret: null });

    const { url, init } = lastRequest(fetchStub);
    expect([url, init.method, init.body]).toEqual(['/v1/monitors/mon_1', 'PATCH', JSON.stringify({ authSecret: null })]);
  });

  it.each([
    ['deleteMonitor', (client: ApiClient) => client.deleteMonitor('mon_1'), '/v1/monitors/mon_1'],
    ['deleteWebhookEndpoint', (client: ApiClient) => client.deleteWebhookEndpoint('whe_1'), '/v1/webhook-endpoints/whe_1'],
  ])('%s sends DELETE and accepts an empty 204 answer', async (_name, call, path) => {
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));

    await expect(call(clientOver(fetchStub))).resolves.toBeUndefined();

    expect([lastRequest(fetchStub).url, lastRequest(fetchStub).init.method]).toEqual([path, 'DELETE']);
  });

  it('creates and updates webhook endpoints', async () => {
    const fetchStub = respondingWith({ id: 'whe_1' });
    const client = clientOver(fetchStub);

    await client.createWebhookEndpoint({ url: 'https://hooks.example.com/x', format: 'slack' });
    await client.updateWebhookEndpoint('whe_1', { status: 'disabled' });

    expect(lastRequest(fetchStub, 0).init).toMatchObject({ method: 'POST', body: JSON.stringify({ url: 'https://hooks.example.com/x', format: 'slack' }) });
    expect(lastRequest(fetchStub, 1)).toMatchObject({ url: '/v1/webhook-endpoints/whe_1', init: { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) } });
  });

  it('approves a baseline by posting the snapshot hash as JSON', async () => {
    const fetchStub = respondingWith({ id: 'mon_1' });

    await clientOver(fetchStub).approveBaseline('mon_1', 'a'.repeat(64));

    const { url, init } = lastRequest(fetchStub);
    expect(url).toBe('/v1/monitors/mon_1/baseline');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ snapshotHash: 'a'.repeat(64) }));
  });

  it('acknowledges an incident, encoding the id into the path', async () => {
    const fetchStub = respondingWith({ id: 'inc/1' });

    await clientOver(fetchStub).acknowledgeIncident('inc/1');

    const { url, init } = lastRequest(fetchStub);
    expect(url).toBe('/v1/incidents/inc%2F1/acknowledge');
    expect(init.method).toBe('POST');
  });
});
