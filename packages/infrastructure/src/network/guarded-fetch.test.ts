import { afterEach, describe, expect, it } from 'vitest';
import { DestinationRefusedError } from './address-policy.js';
import {
  createGuardedFetch,
  KEELSON_USER_AGENT,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
} from './guarded-fetch.js';
import { startTestHttpServer, type TestHttpServer } from './test-http-server.js';

const permissive = { allowPrivateAddresses: true, allowHttp: true };
const publicOnly = { allowPrivateAddresses: false, allowHttp: true };

const servers: TestHttpServer[] = [];
async function serve(handler: Parameters<typeof startTestHttpServer>[0]): Promise<TestHttpServer> {
  const server = await startTestHttpServer(handler);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function failureOf(attempt: Promise<unknown>): Promise<unknown> {
  try {
    await attempt;
  } catch (error) {
    return error instanceof Error && error.cause !== undefined ? error.cause : error;
  }
  throw new Error('expected the request to fail');
}

describe('guarded fetch', () => {
  it('fetches an allowed destination and identifies itself with the Keelson user agent', async () => {
    const server = await serve((_request, response) => void response.end('ok'));

    const response = await createGuardedFetch(permissive)(`${server.origin}/probe`);

    expect(await response.text()).toBe('ok');
    expect(server.requests[0]?.headers['user-agent']).toBe(KEELSON_USER_AGENT);
  });

  it('refuses a host resolving to 127.0.0.1 before connecting', async () => {
    const server = await serve((_request, response) => void response.end('secret'));
    const port = new URL(server.origin).port;

    const failure = await failureOf(createGuardedFetch(publicOnly)(`http://localhost:${port}/`));

    expect(failure).toBeInstanceOf(DestinationRefusedError);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses a literal private address before connecting', async () => {
    const server = await serve((_request, response) => void response.end('secret'));

    const failure = await failureOf(createGuardedFetch(publicOnly)(`${server.origin}/`));

    expect(failure).toBeInstanceOf(DestinationRefusedError);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses a redirect to 169.254.169.254', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    });

    const failure = await failureOf(createGuardedFetch(permissive)(`${server.origin}/`));

    expect(failure).toBeInstanceOf(DestinationRefusedError);
    expect(server.requests).toHaveLength(1);
  });

  it('rejects, without crashing, for a hostname that does not resolve', async () => {
    const failure = await failureOf(createGuardedFetch(permissive)('http://keelson-test.invalid/'));

    expect(failure).toMatchObject({ code: 'ENOTFOUND' });
  });

  it('refuses http unless allowHttp is set', async () => {
    const server = await serve((_request, response) => void response.end('ok'));

    const failure = await failureOf(
      createGuardedFetch({ allowPrivateAddresses: true, allowHttp: false })(`${server.origin}/`),
    );

    expect(failure).toBeInstanceOf(DestinationRefusedError);
    expect(server.requests).toHaveLength(0);
  });

  it('follows redirects up to the limit', async () => {
    const server = await serve((request, response) => {
      const hop = Number(request.url.slice(1));
      if (hop < MAX_REDIRECTS) response.writeHead(302, { location: `/${String(hop + 1)}` }).end();
      else response.end('arrived');
    });

    const response = await createGuardedFetch(permissive)(`${server.origin}/0`);

    expect(await response.text()).toBe('arrived');
  });

  it('hands back a redirect untouched when the caller asks for manual handling', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(302, { location: '/elsewhere' }).end();
    });

    const response = await createGuardedFetch(permissive)(`${server.origin}/`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(server.requests).toHaveLength(1);
  });

  it('stops following redirects beyond the limit', async () => {
    const server = await serve((request, response) => {
      const hop = Number(request.url.slice(1));
      response.writeHead(302, { location: `/${String(hop + 1)}` }).end();
    });

    await expect(createGuardedFetch(permissive)(`${server.origin}/0`)).rejects.toThrow();
    expect(server.requests.length).toBeLessThanOrEqual(MAX_REDIRECTS + 1);
  });

  it('reads a body of exactly the size cap in full', async () => {
    const server = await serve((_request, response) => void response.end(Buffer.alloc(MAX_RESPONSE_BYTES)));

    const response = await createGuardedFetch(permissive)(`${server.origin}/`);

    expect((await response.arrayBuffer()).byteLength).toBe(MAX_RESPONSE_BYTES);
  });

  it('reads a chunked body at the size cap in full', async () => {
    const chunkBytes = MAX_RESPONSE_BYTES / 4;
    const server = await serve((_request, response) => {
      for (let chunk = 0; chunk < 4; chunk += 1) response.write(Buffer.alloc(chunkBytes));
      response.end();
    });

    const response = await createGuardedFetch(permissive)(`${server.origin}/`);

    expect((await response.arrayBuffer()).byteLength).toBe(MAX_RESPONSE_BYTES);
  });

  it('rejects a response that declares a content-length above the size cap', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': String(MAX_RESPONSE_BYTES + 1) });
      response.write(Buffer.alloc(1024));
    });

    const failure = await failureOf(createGuardedFetch(permissive)(`${server.origin}/`));

    expect(failure).toBeInstanceOf(ResponseTooLargeError);
  });

  it('errors the body stream of a chunked response that streams past the size cap', async () => {
    const server = await serve((_request, response) => {
      response.write(Buffer.alloc(MAX_RESPONSE_BYTES));
      response.end(Buffer.alloc(1));
    });

    const response = await createGuardedFetch(permissive)(`${server.origin}/`);

    await expect(response.text()).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('resolves a response without a body', async () => {
    const server = await serve((_request, response) => void response.writeHead(204).end());

    const response = await createGuardedFetch(permissive)(`${server.origin}/`);

    expect(response.status).toBe(204);
  });

  it('preserves status and headers of a response it wraps', async () => {
    const server = await serve((_request, response) => {
      response.writeHead(201, { 'x-probe': 'seen' }).end('created');
    });

    const response = await createGuardedFetch(permissive)(`${server.origin}/`);

    expect([response.status, response.headers.get('x-probe'), await response.text()]).toEqual([201, 'seen', 'created']);
  });
});
