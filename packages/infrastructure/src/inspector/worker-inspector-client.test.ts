import type { Inspection } from '@keelson/application';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticTokenCaller } from '../internal-auth/static-token.js';
import { WorkerInspectorClient } from './worker-inspector-client.js';

const WORKER_URL = 'https://worker.example.test';

const inspection: Inspection = {
  outcome: 'up',
  latencyMs: 120,
  serverName: 'weather',
  serverVersion: '1.2.0',
  catalog: { tools: [{ name: 'get_forecast' }], prompts: [], resources: [] },
  errorDetail: null,
};

const clientFor = (): WorkerInspectorClient =>
  new WorkerInspectorClient({ workerUrl: WORKER_URL, caller: new StaticTokenCaller({ internalStaticToken: 'internal' }) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerInspectorClient', () => {
  it("posts the target and returns the worker's Inspection", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(Response.json(inspection)));
    vi.stubGlobal('fetch', fetchStub);

    const result = await clientFor().inspect({ url: 'https://mcp.example.test/mcp', bearerToken: 'tok' });

    expect(result).toEqual(inspection);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/internal/inspect`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer internal', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://mcp.example.test/mcp', bearerToken: 'tok' });
  });

  it('fails when the worker answers with an error status', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 403 })));

    await expect(clientFor().inspect({ url: 'https://mcp.example.test/mcp', bearerToken: null })).rejects.toThrow('403');
  });
});
