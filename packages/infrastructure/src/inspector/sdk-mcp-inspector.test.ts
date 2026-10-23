import { afterEach, describe, expect, it } from 'vitest';
import type { Clock } from '@keelson/application';
import { createGuardedFetch } from '../network/guarded-fetch.js';
import { startFakeMcpServer, type FakeMcpBehaviour, type FakeMcpServer } from './fake-mcp-server.js';
import { MAX_LIST_PAGES, PROBE_BUDGET_MS, SdkMcpInspector } from './sdk-mcp-inspector.js';

const permissive = { allowPrivateAddresses: true, allowHttp: true };
const forecastTool = { name: 'get_forecast', description: 'Weather', inputSchema: { type: 'object' } };

const realClock: Clock = { now: () => new Date() };
const inspectorFor = (policy = permissive, clock: Clock = realClock) =>
  new SdkMcpInspector({ fetch: createGuardedFetch(policy), clock });

const servers: FakeMcpServer[] = [];
async function serve(behaviour: FakeMcpBehaviour = {}): Promise<FakeMcpServer> {
  const server = await startFakeMcpServer(behaviour);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const mcpUrl = (server: FakeMcpServer) => `${server.origin}/mcp`;

describe('SdkMcpInspector', () => {
  it('reports up with the server identity and its tools', async () => {
    const server = await serve({ tools: () => ({ items: [forecastTool] }) });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection).toMatchObject({
      outcome: 'up',
      serverName: 'fake-mcp',
      serverVersion: '9.9.9',
      errorDetail: null,
      catalog: { tools: [forecastTool], prompts: [], resources: [] },
    });
  });

  it('collects every page of a paginated list', async () => {
    const server = await serve({
      tools: (cursor) =>
        cursor === undefined
          ? { items: [forecastTool], nextCursor: 'two' }
          : { items: [{ ...forecastTool, name: 'get_alerts' }] },
    });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.catalog?.tools).toHaveLength(2);
  });

  it('sends the bearer token and the Keelson user agent', async () => {
    const server = await serve();

    await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: 'secret-token' });

    const first = server.requests[0];
    expect(first?.headers['authorization']).toBe('Bearer secret-token');
    expect(first?.headers['user-agent']).toMatch(/^Keelson\//);
  });

  it('returns empty prompts and resources without asking a server that lacks those capabilities', async () => {
    const server = await serve({ capabilities: { tools: {} } });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.catalog).toEqual({ tools: [], prompts: [], resources: [] });
    expect(server.rpcMethods()).not.toContain('prompts/list');
    expect(server.rpcMethods()).not.toContain('resources/list');
  });

  it('never calls a tool', async () => {
    const server = await serve({ tools: () => ({ items: [forecastTool] }) });

    await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(server.rpcMethods()).not.toContain('tools/call');
  });

  it('measures latency with the injected clock', async () => {
    const server = await serve();
    const instants = [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.250Z')];
    const clock: Clock = { now: () => instants.shift() ?? new Date('2026-01-01T00:00:01.000Z') };

    const inspection = await inspectorFor(permissive, clock).inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.latencyMs).toBe(250);
  });

  it('reports timeout within 10.5 s when the server never answers', async () => {
    const server = await serve({ intercept: () => 'handled' });
    const startedAt = Date.now();

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.outcome).toBe('timeout');
    expect(Date.now() - startedAt).toBeLessThan(PROBE_BUDGET_MS + 500);
  }, 15_000);

  it('stops after the page cap and reports protocol_error', async () => {
    let pagesServed = 0;
    const server = await serve({
      tools: () => {
        pagesServed += 1;
        return { items: [], nextCursor: `page-${String(pagesServed)}` };
      },
    });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.outcome).toBe('protocol_error');
    expect(inspection.catalog).toBeNull();
    expect(pagesServed).toBe(MAX_LIST_PAGES);
  });

  it('accepts a list that ends exactly on the page cap', async () => {
    const server = await serve({
      tools: (cursor) => {
        const page = cursor === undefined ? 1 : Number(cursor) + 1;
        return page < MAX_LIST_PAGES ? { items: [], nextCursor: String(page) } : { items: [forecastTool] };
      },
    });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.outcome).toBe('up');
  });

  it.each([401, 403])('reports auth_error on %i', async (status) => {
    const server = await serve({
      intercept: (_request, response) => {
        response.writeHead(status).end();
        return 'handled';
      },
    });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: 'wrong' });

    expect(inspection.outcome).toBe('auth_error');
  });

  it.each([404, 500, 503])('reports protocol_error with the status in the detail on HTTP %i', async (status) => {
    const server = await serve({
      intercept: (_request, response) => {
        response.writeHead(status).end();
        return 'handled';
      },
    });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.outcome).toBe('protocol_error');
    expect(inspection.errorDetail).toContain(`HTTP ${String(status)}`);
  });

  it('reports connection_error on a refused port', async () => {
    const server = await serve();
    const url = mcpUrl(server);
    await server.close();

    const inspection = await inspectorFor().inspect({ url, bearerToken: null });

    expect(inspection.outcome).toBe('connection_error');
    expect(inspection.catalog).toBeNull();
  });

  it('reports connection_error for a hostname that does not resolve', async () => {
    const inspection = await inspectorFor().inspect({ url: 'http://keelson-test.invalid/mcp', bearerToken: null });

    expect(inspection.outcome).toBe('connection_error');
  });

  it('reports connection_error when the destination is not permitted', async () => {
    const server = await serve();

    const inspection = await inspectorFor({ allowPrivateAddresses: false, allowHttp: true }).inspect({
      url: mcpUrl(server),
      bearerToken: null,
    });

    expect(inspection.outcome).toBe('connection_error');
    expect(server.requests).toHaveLength(0);
  });

  it('reports protocol_error when the endpoint is not an MCP server', async () => {
    const server = await serve({
      intercept: (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
        return 'handled';
      },
    });

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.outcome).toBe('protocol_error');
  });

  it.each([
    ['a non-array tools list', { tools: () => ({ items: 'nope' }) }],
    ['a tools list holding non-objects', { tools: () => ({ items: ['nope'] }) }],
  ])('reports protocol_error for %s', async (_name, behaviour) => {
    const server = await serve(behaviour);

    const inspection = await inspectorFor().inspect({ url: mcpUrl(server), bearerToken: null });

    expect(inspection.outcome).toBe('protocol_error');
    expect(inspection.catalog).toBeNull();
  });
});
