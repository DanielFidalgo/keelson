import type { McpServer } from '@modelcontextprotocol/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const METHOD_NOT_ALLOWED = 405;

export function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  // The body is left out on purpose: Fastify has already parsed it, and the transport receives it as parsedBody.
  const url = `${request.protocol}://${request.hostname}${request.url}`;
  return new Request(url, { method: request.method, headers });
}

export async function sendWebResponse(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  response.headers.forEach((value, name) => void reply.header(name, value));
  return reply.status(response.status).send(await response.text());
}

export interface StatelessMcpPost {
  createServer: (request: FastifyRequest) => McpServer;
  request: FastifyRequest;
  reply: FastifyReply;
}

// A fresh server and transport per request keeps the endpoint stateless: no session outlives the request.
export async function handleStatelessMcpPost({ createServer, request, reply }: StatelessMcpPost): Promise<FastifyReply> {
  const server = createServer(request);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await sendWebResponse(reply, await transport.handleRequest(toWebRequest(request), { parsedBody: request.body }));
  } finally {
    await server.close();
  }
}

export interface StatelessMcpEndpoint {
  app: FastifyInstance;
  path: string;
  createServer: StatelessMcpPost['createServer'];
  // Runs before the body is parsed, so a caller that fails it reaches no MCP handling.
  onRequest?: (request: FastifyRequest) => Promise<void>;
}

export function registerStatelessMcpEndpoint({ app, path, createServer, onRequest }: StatelessMcpEndpoint): void {
  app.post(path, { onRequest: onRequest === undefined ? [] : [onRequest] }, (request, reply) =>
    handleStatelessMcpPost({ createServer, request, reply }),
  );
  // Without sessions there is no stream to open (GET) and no session to end (DELETE), which Streamable HTTP answers with 405.
  app.route({
    method: ['GET', 'DELETE'],
    url: path,
    handler: (_request, reply) => reply.status(METHOD_NOT_ALLOWED).header('allow', 'POST').send(),
  });
}
