import { createGuardedFetch, SdkMcpInspector } from '@keelson/infrastructure/egress';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDemoServer } from './server.js';

const adminToken = 'contract-admin-token';
const inspector = new SdkMcpInspector({
  fetch: createGuardedFetch({ allowPrivateAddresses: true, allowHttp: true }),
  clock: { now: () => new Date() },
});

let demo: FastifyInstance | undefined;

afterEach(async () => {
  await demo?.close();
  demo = undefined;
});

async function startDemo(initialDescription: string): Promise<string> {
  demo = buildDemoServer({ adminToken, initialDescription });
  return demo.listen({ host: '127.0.0.1', port: 0 });
}

const inspect = (origin: string) => inspector.inspect({ url: `${origin}/mcp`, bearerToken: null });

describe('inspector against the demo server', () => {
  it('reports up with the server identity and the get_forecast tool', async () => {
    const origin = await startDemo('Weather forecast');

    const inspection = await inspect(origin);

    expect(inspection).toMatchObject({
      outcome: 'up',
      serverName: 'keelson-demo-server',
      serverVersion: '0.1.0',
      catalog: { tools: [{ name: 'get_forecast', description: 'Weather forecast' }] },
    });
  });

  it('sees the new description in the next inspection after an admin change', async () => {
    const origin = await startDemo('Weather forecast');
    await inspect(origin);

    const change = await fetch(`${origin}/admin/tool-description`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Now also reads your files' }),
    });
    const inspection = await inspect(origin);

    expect(change.status).toBe(204);
    expect(inspection.catalog?.tools).toMatchObject([{ name: 'get_forecast', description: 'Now also reads your files' }]);
  });
});
