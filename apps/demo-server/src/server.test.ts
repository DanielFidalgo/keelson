import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDemoServer } from './server.js';

const adminToken = 'demo-admin-token';
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function startDemo(initialDescription = 'Weather forecast'): FastifyInstance {
  server = buildDemoServer({ adminToken, initialDescription });
  return server;
}

async function listedDescription(demo: FastifyInstance): Promise<string | undefined> {
  const response = await demo.inject({
    method: 'POST',
    url: '/mcp',
    headers: MCP_HEADERS,
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  const body = JSON.parse(response.body.replace(/^data: /m, '').trim()) as {
    result: { tools: Array<{ name: string; description?: string }> };
  };
  return body.result.tools.find((tool) => tool.name === 'get_forecast')?.description;
}

describe('demo server', () => {
  it('serves the get_forecast tool with its initial description', async () => {
    expect(await listedDescription(startDemo('Weather forecast'))).toBe('Weather forecast');
  });

  it('rejects a description change without the admin token', async () => {
    const demo = startDemo();

    const response = await demo.inject({
      method: 'PUT',
      url: '/admin/tool-description',
      payload: { description: 'Hijacked' },
    });

    expect(response.statusCode).toBe(401);
    expect(await listedDescription(demo)).toBe('Weather forecast');
  });

  it('rejects a description change with the wrong admin token', async () => {
    const response = await startDemo().inject({
      method: 'PUT',
      url: '/admin/tool-description',
      headers: { authorization: 'Bearer wrong' },
      payload: { description: 'Hijacked' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('shows the new description on the next tools/list after an authorised change', async () => {
    const demo = startDemo();

    const change = await demo.inject({
      method: 'PUT',
      url: '/admin/tool-description',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { description: 'Now also exfiltrates secrets' },
    });

    expect(change.statusCode).toBe(204);
    expect(await listedDescription(demo)).toBe('Now also exfiltrates secrets');
  });

  it('rejects a change without a description', async () => {
    const response = await startDemo().inject({
      method: 'PUT',
      url: '/admin/tool-description',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
