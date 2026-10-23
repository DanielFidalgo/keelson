import type { ServerResponse } from 'node:http';
import { startTestHttpServer, type RecordedRequest, type TestHttpServer } from '../network/test-http-server.js';

type ListPage = { items: unknown; nextCursor?: string };

export interface FakeMcpBehaviour {
  capabilities?: Record<string, object>;
  serverInfo?: { name: string; version: string };
  // Returning a handled marker lets a test take over the whole response (401, hang, malformed body).
  intercept?: (request: RecordedRequest, response: ServerResponse) => 'handled' | 'continue';
  tools?: (cursor: string | undefined) => ListPage;
  prompts?: (cursor: string | undefined) => ListPage;
  resources?: (cursor: string | undefined) => ListPage;
}

const DEFAULT_CAPABILITIES = { tools: {}, prompts: {}, resources: {} };
const DEFAULT_SERVER_INFO = { name: 'fake-mcp', version: '9.9.9' };

export interface FakeMcpServer extends TestHttpServer {
  readonly rpcMethods: () => string[];
}

// A minimal MCP server over plain JSON responses, so tests control pagination, failures and hangs exactly.
export async function startFakeMcpServer(behaviour: FakeMcpBehaviour = {}): Promise<FakeMcpServer> {
  const server = await startTestHttpServer((request, response) => {
    if (behaviour.intercept?.(request, response) === 'handled') return;
    if (request.method !== 'POST') return void response.writeHead(405).end();
    const message = JSON.parse(request.body) as { id?: number; method: string; params?: { cursor?: string; protocolVersion?: string } };
    if (message.id === undefined) return void response.writeHead(202).end();
    reply(response, message.id, resultFor(message, behaviour));
  });
  return { ...server, rpcMethods: () => server.requests.flatMap((request) => rpcMethodOf(request)) };
}

function rpcMethodOf(request: RecordedRequest): string[] {
  if (request.method !== 'POST') return [];
  return [(JSON.parse(request.body) as { method: string }).method];
}

function resultFor(
  message: { method: string; params?: { cursor?: string; protocolVersion?: string } },
  behaviour: FakeMcpBehaviour,
): Record<string, unknown> {
  const cursor = message.params?.cursor;
  switch (message.method) {
    case 'initialize':
      return {
        protocolVersion: message.params?.protocolVersion,
        capabilities: behaviour.capabilities ?? DEFAULT_CAPABILITIES,
        serverInfo: behaviour.serverInfo ?? DEFAULT_SERVER_INFO,
      };
    case 'tools/list':
      return page('tools', behaviour.tools?.(cursor) ?? { items: [] });
    case 'prompts/list':
      return page('prompts', behaviour.prompts?.(cursor) ?? { items: [] });
    case 'resources/list':
      return page('resources', behaviour.resources?.(cursor) ?? { items: [] });
    default:
      return {};
  }
}

function page(key: string, listPage: ListPage): Record<string, unknown> {
  return { [key]: listPage.items, ...(listPage.nextCursor === undefined ? {} : { nextCursor: listPage.nextCursor }) };
}

function reply(response: ServerResponse, id: number, result: Record<string, unknown>): void {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}
