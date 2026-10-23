import { McpServer } from '@modelcontextprotocol/server';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerStatelessMcpEndpoint, sendWebResponse, toWebRequest } from './stateless-mcp-endpoint.js';

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function serverWithOneTool(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  server.registerTool('ping', { description: 'Answers pong' }, () => ({ content: [{ type: 'text', text: 'pong' }] }));
  return server;
}

function appWithEndpoint(): FastifyInstance {
  app = Fastify();
  registerStatelessMcpEndpoint({ app, path: '/mcp', createServer: serverWithOneTool });
  return app;
}

describe('toWebRequest', () => {
  it('keeps the method, the full url and the string headers', async () => {
    let seen: Request | undefined;
    app = Fastify();
    app.post('/echo', (request) => {
      seen = toWebRequest(request);
      return {};
    });

    await app.inject({ method: 'POST', url: '/echo?a=1', headers: { host: 'api.example.com', 'x-test': 'yes' }, payload: {} });

    expect(seen?.method).toBe('POST');
    expect(seen?.url).toBe('http://api.example.com/echo?a=1');
    expect(seen?.headers.get('x-test')).toBe('yes');
  });
});

describe('sendWebResponse', () => {
  it('copies status, headers and body onto the reply', async () => {
    app = Fastify();
    app.get('/relay', (_request, reply) =>
      sendWebResponse(reply, new Response('hello', { status: 202, headers: { 'x-relayed': 'true' } })),
    );

    const response = await app.inject({ method: 'GET', url: '/relay' });

    expect(response.statusCode).toBe(202);
    expect(response.headers['x-relayed']).toBe('true');
    expect(response.body).toBe('hello');
  });
});

describe('registerStatelessMcpEndpoint', () => {
  it('answers a POST with the tools of a server built for that request', async () => {
    const response = await appWithEndpoint().inject({ method: 'POST', url: '/mcp', headers: MCP_HEADERS, payload: LIST_TOOLS });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"ping"');
  });

  it('builds a new server for every request', async () => {
    let built = 0;
    app = Fastify();
    registerStatelessMcpEndpoint({
      app,
      path: '/mcp',
      createServer: () => {
        built += 1;
        return serverWithOneTool();
      },
    });

    await app.inject({ method: 'POST', url: '/mcp', headers: MCP_HEADERS, payload: LIST_TOOLS });
    await app.inject({ method: 'POST', url: '/mcp', headers: MCP_HEADERS, payload: LIST_TOOLS });

    expect(built).toBe(2);
  });

  it('runs the onRequest hook before any MCP handling', async () => {
    let built = 0;
    app = Fastify();
    registerStatelessMcpEndpoint({
      app,
      path: '/mcp',
      createServer: () => {
        built += 1;
        return serverWithOneTool();
      },
      onRequest: () => Promise.reject(Object.assign(new Error('no'), { statusCode: 401 })),
    });

    const response = await app.inject({ method: 'POST', url: '/mcp', headers: MCP_HEADERS, payload: LIST_TOOLS });

    expect(response.statusCode).toBe(401);
    expect(built).toBe(0);
  });

  it.each(['GET', 'DELETE'] as const)('answers %s with 405 and Allow: POST, since there is no session or stream', async (method) => {
    const response = await appWithEndpoint().inject({ method, url: '/mcp', headers: { accept: MCP_HEADERS.accept } });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
  });
});
