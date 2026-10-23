import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface TestHttpServer {
  readonly origin: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

export type TestHandler = (request: RecordedRequest, response: ServerResponse) => void;

// Binds an ephemeral loopback port so tests never contend for a fixed port or touch the network.
export async function startTestHttpServer(handler: TestHandler): Promise<TestHttpServer> {
  const requests: RecordedRequest[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      handler(recorded, response);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // Hanging-server tests leave sockets open, which would otherwise keep close() from resolving.
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}
