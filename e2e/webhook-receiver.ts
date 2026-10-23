import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  headers: IncomingHttpHeaders;
  // Kept as received: a signature is computed over the exact bytes, so re-serialising parsed JSON could not verify it.
  body: string;
}

const ACCEPTED = 204;

export class WebhookReceiver {
  readonly requests: ReceivedWebhook[] = [];
  private readonly server: Server;

  private constructor() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        this.requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(ACCEPTED);
        response.end();
      });
    });
  }

  static async start(): Promise<WebhookReceiver> {
    const receiver = new WebhookReceiver();
    await new Promise<void>((resolve) => {
      receiver.server.listen(0, '127.0.0.1', resolve);
    });
    return receiver;
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}/hooks/keelson`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
}
