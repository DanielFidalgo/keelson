import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticTokenCaller } from '../internal-auth/static-token.js';
import { HttpProbeQueue } from './http-probe-queue.js';

const WORKER_URL = 'http://localhost:8081';

const queue = (): HttpProbeQueue =>
  new HttpProbeQueue({ workerUrl: WORKER_URL, caller: new StaticTokenCaller({ internalStaticToken: 'internal' }) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpProbeQueue', () => {
  it('posts the job to the worker probe endpoint with the internal credential', async () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchStub);

    await queue().enqueue({ monitorId: 'mon-1', slot: 42 });

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/internal/probe`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer internal', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ monitorId: 'mon-1', slot: 42 });
  });

  it('fails when the worker rejects the job', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })));

    await expect(queue().enqueue({ monitorId: 'mon-1', slot: 42 })).rejects.toThrow('500');
  });
});
