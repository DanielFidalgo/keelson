import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticTokenCaller } from '../internal-auth/static-token.js';
import { HttpProbeQueue } from './http-probe-queue.js';

const WORKER_URL = 'http://localhost:8081';
const JOB = { monitorId: 'mon-1', slot: 42 };

const queue = (onDeliveryError: (error: unknown) => void | Promise<void> = () => undefined): HttpProbeQueue =>
  new HttpProbeQueue({
    workerUrl: WORKER_URL,
    caller: new StaticTokenCaller({ internalStaticToken: 'internal' }),
    onDeliveryError,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpProbeQueue', () => {
  it('posts the job to the worker probe endpoint with the internal credential', async () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchStub);

    await queue().enqueue(JOB);

    await vi.waitFor(() => {
      expect(fetchStub).toHaveBeenCalledOnce();
    });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${WORKER_URL}/internal/probe`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer internal', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ monitorId: 'mon-1', slot: 42 });
  });

  it('resolves before the worker has answered', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetchStub = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal('fetch', fetchStub);

    await queue().enqueue(JOB);

    await vi.waitFor(() => {
      expect(fetchStub).toHaveBeenCalledOnce();
    });
    answer(new Response(null, { status: 204 }));
  });

  it('reports a worker that rejects the job instead of throwing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })));
    const onDeliveryError = vi.fn();

    await queue(onDeliveryError).enqueue(JOB);

    await vi.waitFor(() => {
      expect(onDeliveryError).toHaveBeenCalledOnce();
    });
    expect(onDeliveryError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('500') as string }), JOB);
  });

  it('reports a worker that cannot be reached instead of leaving an unhandled rejection', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    const onDeliveryError = vi.fn();

    await queue(onDeliveryError).enqueue(JOB);

    await vi.waitFor(() => {
      expect(onDeliveryError).toHaveBeenCalledWith(expect.any(TypeError), JOB);
    });
  });

  describe.each([
    ['throws', () => { throw new Error('reporter failed'); }],
    ['rejects', () => Promise.reject(new Error('reporter failed'))],
  ])('when the error callback %s', (_behaviour, failingReporter) => {
    it('leaves no unhandled rejection and writes the loss to stdout', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })));
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const onDeliveryError = vi.fn(failingReporter);

      try {
        await queue(onDeliveryError).enqueue(JOB);
        await vi.waitFor(() => {
          expect(stdout).toHaveBeenCalledOnce();
        });
        // unhandledRejection fires after the microtask queue drains, so one macrotask turn is enough to observe it.
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
        expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
          event: 'probe.enqueue_failure_unreported',
          monitorId: 'mon-1',
          slot: 42,
          error: 'reporter failed',
        });
      } finally {
        process.off('unhandledRejection', unhandled);
        stdout.mockRestore();
      }
    });
  });
});
