import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';

const API_KEY = 'key_secret_value';
const JSON_TYPE = { 'content-type': 'application/json' };
const PROBLEM_TYPE = { 'content-type': 'application/problem+json' };

const emptyPage = { items: [], nextCursor: null };

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

    await clientOver(fetchStub).listMonitors();

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

    await clientOver(fetchStub, { onUnauthorized }).listMonitors().catch(() => undefined);

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not call the API without a key', async () => {
    const fetchStub = respondingWith(emptyPage);

    const failure = await clientOver(fetchStub, { apiKey: () => null }).listMonitors().catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 401 });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('follows nextCursor until the last page', async () => {
    const monitor = (id: string) => ({ id });
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [monitor('mon_1')], nextCursor: 'after_1' }), { headers: JSON_TYPE }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [monitor('mon_2')], nextCursor: null }), { headers: JSON_TYPE }));

    const monitors = await clientOver(fetchStub).listMonitors();

    expect(monitors.map(({ id }) => id)).toEqual(['mon_1', 'mon_2']);
    expect(lastRequest(fetchStub, 1).url).toContain('cursor=after_1');
  });

  it('asks only for open incidents', async () => {
    const fetchStub = respondingWith(emptyPage);

    await clientOver(fetchStub).listOpenIncidents();

    expect(lastRequest(fetchStub).url).toContain('state=open');
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
